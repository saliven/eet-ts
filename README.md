# eet-ts

TypeScript SDK for EET 2.0 (Czech electronic sales registration).

It validates sales, builds and signs the SOAP request with WS-Security, sends it over HTTPS, and turns the response into a typed result. You bring the certificate and the sale; the SDK handles the protocol.

- Typed results: accepted with a POK, verification OK, or rejected with an EET code
- Validation of every field before anything is sent
- P12 or PEM certificates
- Multiple taxpayers and cash registers from one client
- Built-in playground endpoint
- Pluggable transport and signer

## Install

```bash
pnpm add eet-ts
```

## Quick Start

This example uses the official playground certificate for `CZ00000019`. You can download it from [Dokumenty ke stažení](https://eet.gov.cz/cs/pro-vyvojare/dokumenty-ke-stazeni) (`CAEET_Playground_2026_v1.zip`).

```ts
import { readFile } from "node:fs/promises";
import { EetCertificate, EetClient, Environment, SubmissionStatus } from "eet-ts";

const certificate = new EetCertificate({
  p12: await readFile("./CA_EET-Playground-CZ00000019.p12"),
  passphrase: process.env.EET_CERT_PASSWORD,
});

// EetTaxpayer
const taxpayer = {
  eic: "CZ00000019",
  certificate,
};

// EetCashRegister
const cashRegister = {
  id: "SDK-TEST-01",
  unitId: "303",
};

const eet = new EetClient({
  environment: Environment.Playground,
  taxpayer,
});

const result = await eet.registerSale({
  cashRegister,
  receiptNumber: `ORDER-${Date.now()}`,
  occurredAt: new Date(),
  totalAmount: 10_000, // 100.00 CZK
});

if (result.status === SubmissionStatus.Accepted) {
  console.log(result.pok); // print this on the receipt
}
```

## Sales

`registerSale` and `verifySale` take the same input:

| Field                            | EET attribute        | Notes                                                  |
| -------------------------------- | -------------------- | ------------------------------------------------------ |
| `cashRegister.id`                | `id_pokl`            | Required. 1 to 20 characters: `0-9a-zA-Z.,:;/#-_ `.    |
| `cashRegister.unitId`            | `id_jednotky`        | Required. Unit ID, 1 to 999999999, no leading zeroes.  |
| `receiptNumber`                  | `porad_cis`          | Required. 1 to 25 characters, same character set.      |
| `occurredAt`                     | `dat_trzby`          | Required. `Date` or ISO string with offset.            |
| `totalAmount`                    | `celk_trzba`         | Required. See [Amounts](#amounts).                     |
| `firstSubmission`                | `prvni_zaslani`      | Defaults to `true`. Set `false` when resending a sale. |
| `messageUuid`                    | `uuid_zpravy`        | Generated when omitted.                                |
| `submittedAt`                    | `dat_odesl`          | Defaults to now.                                       |
| `taxpayerEic`                    | `eic_popl`           | Defaults to the taxpayer's EIC.                        |
| `authorizingTaxpayerEic`         | `eic_poverujiciho`   | Optional.                                              |
| `multipleTaxpayersAuthorization` | `povereni_vice_popl` | Optional.                                              |
| `intendedForSettlementAmount`    | `urceno_cerp_zuct`   | Optional amount.                                       |
| `settledAmount`                  | `cerp_zuct`          | Optional amount.                                       |

### Amounts

Amounts can be integer minor units or EET decimal strings.

```ts
totalAmount: 10_000; // 100.00 CZK
totalAmount: "100.00"; // exact EET decimal string
```

Numbers must be integers and are read as hundredths of CZK: `1` is `0.01`, `100` is `1.00`, `10_000` is `100.00`.

Strings must already be in EET format: exactly two decimals, a dot separator, no leading zeroes, and an absolute value below 100 million CZK.

### Verification Mode

`verifySale` sends the sale with `overeni="true"`. EET checks the message without registering it and returns `SubmissionStatus.VerificationOk` (EET code `0`). Use it to test a setup against production without recording real sales.

```ts
const result = await eet.verifySale({
  cashRegister,
  receiptNumber: "CHECK-1",
  occurredAt: new Date(),
  totalAmount: 100,
});
```

## Results

Every EET answer becomes one of three results, discriminated by `status`:

```ts
const result = await eet.registerSale(sale);

switch (result.status) {
  case SubmissionStatus.Accepted:
    console.log(result.pok, result.receivedAt, result.warnings);
    break;
  case SubmissionStatus.VerificationOk:
    console.log(result.message, result.warnings);
    break;
  case SubmissionStatus.Rejected:
    console.error(result.code, result.message, result.retryable);
    break;
}
```

| Status           | Meaning                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| `Accepted`       | The sale is registered. `pok` is the confirmation code.                 |
| `VerificationOk` | A `verifySale` message passed all checks. Nothing was registered.       |
| `Rejected`       | EET refused the message. `code` is the EET error code; see `retryable`. |

Every result also has:

- `test`: the `test` flag from the EET response (`true` on the playground)
- `warnings`: EET warnings, with `knownMessage` filled in for documented codes
- `rawXml`: the raw response body
- `globalTransactionId`: the value of the `X-Global-Transaction-Id` header, when present

A valid EET outcome takes precedence over the HTTP status. A response that contains a POK is always `Accepted`.

## Errors

There are three kinds of failure. Each is thrown, not returned:

| Error                | When                                                              | Retryable                     |
| -------------------- | ----------------------------------------------------------------- | ----------------------------- |
| `EetValidationError` | The sale is invalid. Nothing was sent.                            | No. Fix the input.            |
| `EetTransportError`  | The request failed or timed out before a response arrived.        | Yes                           |
| `EetProtocolError`   | No valid EET outcome: SOAP fault, HTTP error, malformed response. | See `error.context.retryable` |

```ts
import { EetProtocolError, EetTransportError, EetValidationError } from "eet-ts";

try {
  await eet.registerSale(sale);
} catch (error) {
  if (error instanceof EetValidationError) {
    console.error(error.issues); // [{ path, message }]
  } else if (error instanceof EetTransportError) {
    console.error(error.message, error.cause);
  } else if (error instanceof EetProtocolError) {
    // kind: "soap-fault" | "http-error" | "malformed-response"
    console.error(error.context.kind, error.context.statusCode);
    console.error(error.context.globalTransactionId, error.context.rawXml);
  }
}
```

### Retrying

When a sale fails with a retryable error, or a rejected result has `retryable: true`, send it again with `firstSubmission: false`. Keep the receipt data the same.

```ts
await eet.registerSale({ ...sale, firstSubmission: false });
```

Set a request timeout on the client:

```ts
new EetClient({ environment: Environment.Playground, taxpayer, timeoutMs: 2_000 });
```

## Certificates

`EetCertificate` accepts P12 or PEM material. Parsing happens once in the constructor, so create certificates at startup and reuse them. One certificate can be shared by several taxpayers.

```ts
const certificate = new EetCertificate({
  p12: await readFile("./certificate.p12"),
  passphrase: process.env.EET_CERT_PASSWORD,
});
```

```ts
const certificate = new EetCertificate({
  privateKeyPem: await readFile("./private-key.pem"),
  certificatePem: await readFile("./certificate.pem"),
});
```

## Taxpayers and Cash Registers

A taxpayer (`EetTaxpayer`) is a plain object holding an EIC and the certificate used for signing. Set a default taxpayer on the client and override it per request when billing for someone else.

A cash register (`EetCashRegister`) is a plain object too. One taxpayer can run many registers, so every sale names its register.

```ts
const eet = new EetClient({ environment: Environment.Playground, taxpayer });

const registerA = { id: "REGISTER-A", unitId: "303" };
const registerB = { id: "REGISTER-B", unitId: "304" };

await eet.registerSale({ cashRegister: registerA, ...sale });
await eet.registerSale({ cashRegister: registerB, ...sale });
await eet.registerSale({ cashRegister: registerA, ...sale }, { taxpayer: otherTaxpayer });
```

The client does not require a default taxpayer. Without one, pass `{ taxpayer }` on every request.

## Environments

The playground endpoint is built in:

```ts
new EetClient({ environment: Environment.Playground, taxpayer });
// https://pg.trzbyeet.gov.cz/eet/services/EETServiceSOAP/v4
```

The production endpoint is not bundled until the official URL is confirmed. Pass it explicitly:

```ts
new EetClient({
  environment: { endpoint: "https://..." },
  taxpayer,
});
```

## Advanced Usage

### Build a Signed Request Without Sending It

```ts
const request = await eet.buildSignedRequest({
  cashRegister,
  receiptNumber: "1003",
  occurredAt: new Date(),
  totalAmount: 12_345,
});

request.xml; // signed SOAP envelope
request.uuid; // uuid_zpravy
request.endpoint;
request.soapAction;
```

### Parse a Response Yourself

```ts
const result = eet.parseResponse(responseXml, {
  "x-global-transaction-id": "trace-id",
});
```

### Custom Transport

The default transport reuses TLS connections through a keep-alive agent shared by all clients in the process. That matters because the HTTPS round trip is the main cost: per-sale CPU work (validation, XML, signing) is about 0.6 ms on typical hardware.

Pass your own agent to tune pooling:

```ts
import { Agent } from "node:https";
import { HttpsEetTransport } from "eet-ts";

const transport = new HttpsEetTransport(new Agent({ keepAlive: true, maxSockets: 32 }));
const eet = new EetClient({ environment: Environment.Playground, taxpayer, transport });
```

You can also implement `EetTransport` (`send(request)`) or `EetSigner` (`sign(envelope, certificate)`) to replace the HTTP layer or signing entirely, for example in tests.

## Protocol Coverage

- EET schema namespace `http://fs.gov.cz/eet/schema/v4`, version `4.1`
- SOAP 1.1, SOAP action `http://fs.gov.cz/eet/OdeslaniTrzby`
- WS-Security BinarySecurityToken with X509v3 certificate
- Exclusive C14N, SHA-256 digest, RSA-SHA256 signature
- 12 kB limit on the signed SOAP request

Official developer documentation: [Základní informace pro vývojáře](https://eet.gov.cz/cs/pro-vyvojare/zakladni-informace-pro-vyvojare).

## Development

```bash
pnpm install
pnpm typecheck
pnpm test             # unit tests, no network
pnpm test:playground  # live tests against the EET playground
pnpm build
```

`pnpm test:playground` downloads the official playground certificate bundle, extracts the P12 and its password, and sends a verification sale and an operational sale to the playground. The operational sale returns a fictitious POK ending in `-ff`. If the bundle URL changes, update `CERTIFICATE_ZIP_URL` in `test/playground.test.ts`.
