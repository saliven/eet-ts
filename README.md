# eet-ts

TypeScript SDK for the EET 2.0 SOAP API.

The SDK handles EET request validation, SOAP envelope generation, WS-Security signing, HTTPS transport, and response parsing.

## Install

```bash
pnpm add eet-ts
```

## Basic Usage

```ts
import { readFile } from "node:fs/promises";
import { EetCertificate, EetClient, EetProtocolError, type EetCashRegister, type EetTaxpayer } from "eet-ts";

const certificate = new EetCertificate({
  p12: await readFile("./CA_EET-Playground-CZ00000019.p12"),
  passphrase: process.env.EET_CERT_PASSWORD,
});

const taxpayer: EetTaxpayer = {
  eic: "CZ00000019",
  certificate,
};

const cashRegister: EetCashRegister = {
  id: "SDK-TEST-01",
  unitId: "303",
};

const eet = new EetClient({
  environment: "playground",
  taxpayer,
});

const result = await eet.registerSale({
  cashRegister,
  receiptNumber: `ORDER-${Date.now()}`,
  occurredAt: new Date(),
  totalAmount: 10_000,
});

if (result.status === "accepted") {
  console.log(result.pok);
}
```

## Amounts

Amounts can be passed as either EET decimal strings or integer minor units.

```ts
await eet.registerSale({
  cashRegister,
  receiptNumber: "1001",
  occurredAt: new Date(),
  totalAmount: 10_000, // 100.00 CZK
});

await eet.registerSale({
  cashRegister,
  receiptNumber: "1002",
  occurredAt: new Date(),
  totalAmount: "100.00", // exact EET decimal string
});
```

Number inputs must be integers. They are interpreted as hundredths of CZK, so `1` is `0.01`, `100` is `1.00`, and `10_000` is `100.00`.

String inputs must already match the EET format: exactly two decimals, dot separator, no leading zeroes, and absolute value below 100 million CZK.

## Verification Mode

Use `verifySale` to send the request with `overeni="true"`. A valid verification request returns `status: "verification-ok"` with EET code `0`.

```ts
const result = await eet.verifySale({
  cashRegister,
  receiptNumber: "CHECK-1",
  occurredAt: new Date(),
  totalAmount: 100,
});
```

## Responses

`registerSale` and `verifySale` return a discriminated union.

```ts
const result = await eet.registerSale(input);

switch (result.status) {
  case "accepted":
    console.log(result.pok, result.receivedAt, result.warnings);
    break;
  case "verification-ok":
    console.log(result.message, result.warnings);
    break;
  case "rejected":
    console.error(result.code, result.message, result.retryable);
    break;
}
```

Every result includes `rawXml`. If the EET server returns `X-Global-Transaction-Id`, it is exposed as `globalTransactionId`.

Valid EET responses return one of the outcomes above. SOAP faults, HTTP failures without a valid EET outcome, and malformed responses throw `EetProtocolError`:

```ts
try {
  await eet.registerSale(input);
} catch (error) {
  if (error instanceof EetProtocolError) {
    console.error(error.context.kind, error.context.statusCode);
    console.error(error.context.globalTransactionId, error.context.rawXml);
  }
}
```

Protocol errors include conservative retry guidance in `error.context.retryable`. A valid EET outcome takes precedence over the HTTP status, so a received POK is always returned as `status: "accepted"`.

## Certificates

The SDK accepts either P12 material or PEM key/certificate material. A single `EetCertificate` can be shared by multiple taxpayers.

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

A taxpayer is a plain `EetTaxpayer` object combining the EIC with the certificate used for signing. Pass a default taxpayer to the client and override it per request when billing for another entity.

Cash registers are plain objects too: one taxpayer can operate many registers, so every sale names its register in the payload.

```ts
const eet = new EetClient({ environment: "playground", taxpayer });

const registerA: EetCashRegister = { id: "REGISTER-A", unitId: "303" };
const registerB: EetCashRegister = { id: "REGISTER-B", unitId: "304" };

await eet.registerSale({ cashRegister: registerA, ...sale });
await eet.registerSale({ cashRegister: registerB, ...sale });
await eet.registerSale({ cashRegister: registerA, ...sale }, { taxpayer: otherTaxpayer });
```

## Environment

```ts
new EetClient({ environment: "playground", taxpayer });
```

The playground endpoint is built in:

```txt
https://pg.trzbyeet.gov.cz/eet/services/EETServiceSOAP/v4
```

The production endpoint is not bundled until the official production URL is confirmed. Pass it explicitly:

```ts
new EetClient({
  environment: { endpoint: "https://..." },
  taxpayer,
});
```

## Advanced Usage

You can build a signed request without sending it:

```ts
const request = await eet.buildSignedRequest({
  cashRegister,
  receiptNumber: "1003",
  occurredAt: new Date(),
  totalAmount: 12_345,
});

console.log(request.xml);
```

You can also parse a SOAP response manually:

```ts
const result = eet.parseResponse(responseXml, {
  "x-global-transaction-id": "trace-id",
});
```

## Performance

Per-sale CPU work is sub-millisecond (~0.6 ms for validation, XML building, and WS-Security signing on typical hardware). The dominant cost is the HTTPS round trip, so the default transport reuses TLS connections through a keep-alive agent shared by all clients in the process. Pass your own agent to tune pooling:

```ts
const transport = new HttpsEetTransport(new Agent({ keepAlive: true, maxSockets: 32 }));
const eet = new EetClient({ environment: "playground", taxpayer, transport });
```

Create `EetCertificate` instances and resolve taxpayer/cash register objects once — at startup or cached per POS identity — and reuse them for every sale. Certificate material and the signing key are parsed only at construction.

## Playground Tests

The repository includes real playground integration tests. They download the official playground certificate bundle from `https://eet.gov.cz/pro-vyvojare/`, extract the P12 certificate and password, and submit both verification and operational test sales.

```bash
pnpm test:playground
```

Regular tests skip playground calls:

```bash
pnpm test
```

## Development

```bash
pnpm test
pnpm build
pnpm typecheck
pnpm test:playground
```

## Protocol Coverage

- EET schema namespace `http://fs.gov.cz/eet/schema/v4`
- EET schema version `4.1`
- SOAP 1.1
- WS-Security BinarySecurityToken with X509v3 certificate
- Exclusive C14N
- SHA-256 digest
- RSA-SHA256 signature
- SOAP action `http://fs.gov.cz/eet/OdeslaniTrzby`
- 12 kB signed SOAP request size limit
