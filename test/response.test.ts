import { describe, expect, it } from "vitest";
import { SubmissionStatus } from "../src/constants.ts";
import { EetProtocolError, parseEetResponse } from "../src/response.ts";

const EET_NAMESPACE = "http://fs.gov.cz/eet/schema/v4";
const SOAP_NAMESPACE = "http://schemas.xmlsoap.org/soap/envelope/";
const UUID = "123e4567-e89b-42d3-a456-426655440000";
const RECEIVED_AT = "2027-03-04T18:25:21+01:00";
const POK = "987a6be5-6af5-44f3-b4fc-987654321000-ff";

describe("parseEetResponse", () => {
  it("classifies a non-EET HTTP failure", () => {
    const error = captureProtocolError(() => parseEetResponse({
      statusCode: 503,
      headers: { "X-Global-Transaction-Id": "trace-http" },
      body: "temporarily unavailable",
    }));

    expect(error).toMatchObject({
      context: {
        kind: "http-error",
        statusCode: 503,
        rawXml: "temporarily unavailable",
        globalTransactionId: "trace-http",
        retryable: true,
      },
    });
  });

  it("decodes an accepted SOAP response with warnings and tracing", () => {
    const xml = acceptedEnvelope();
    const result = parseEetResponse({
      statusCode: 200,
      headers: { "x-global-transaction-id": "trace-accepted" },
      body: xml,
    });

    expect(result).toEqual({
      status: SubmissionStatus.Accepted,
      uuid: UUID,
      pok: POK,
      receivedAt: RECEIVED_AT,
      test: true,
      warnings: [{
        code: 1,
        message: "EIC poplatnika se neshoduje",
        knownMessage: "EIC poplatnika v datove zprave se neshoduje s EIC v certifikatu",
      }],
      globalTransactionId: "trace-accepted",
      rawXml: xml,
    });
  });

  it("decodes a bare Odpoved for manual parsing", () => {
    const result = parseEetResponse({
      statusCode: 200,
      headers: {},
      body: acceptedResponse(),
    });

    expect(result).toMatchObject({ status: SubmissionStatus.Accepted, pok: POK });
  });

  it("matches namespace URIs instead of prefixes and ignores unknown metadata", () => {
    const xml =
      `<env:Envelope xmlns:env="${SOAP_NAMESPACE}">` +
      `<env:Header><future:Trace xmlns:future="urn:future">ignored</future:Trace></env:Header>` +
      `<env:Body>${acceptedResponse("eet", " extra=\"ignored\"")}</env:Body>` +
      `</env:Envelope>`;

    expect(parseEetResponse({ statusCode: 200, headers: {}, body: xml }))
      .toMatchObject({ status: SubmissionStatus.Accepted, pok: POK });
  });

  it("trusts a valid POK over an inconsistent HTTP status", () => {
    expect(parseEetResponse({
      statusCode: 500,
      headers: {},
      body: acceptedEnvelope(),
    })).toMatchObject({
      status: SubmissionStatus.Accepted,
      uuid: UUID,
      receivedAt: RECEIVED_AT,
      pok: POK,
    });
  });

  it.each([
    { code: "0", status: SubmissionStatus.VerificationOk, retryable: undefined },
    { code: "2", status: SubmissionStatus.Rejected, retryable: false },
    { code: "-1", status: SubmissionStatus.Rejected, retryable: true },
    { code: "8", status: SubmissionStatus.Rejected, retryable: true },
  ])("maps EET error code $code to $status", ({ code, status, retryable }) => {
    const result = parseEetResponse({
      statusCode: 200,
      headers: {},
      body: errorResponse(code),
    });

    expect(result.status).toBe(status);
    if (result.status === SubmissionStatus.Rejected) {
      expect(result.retryable).toBe(retryable);
    }
  });

  it("preserves warning order and accepts unknown warning codes", () => {
    const xml =
      `<tns:Odpoved xmlns:tns="${EET_NAMESPACE}">` +
      `<tns:Hlavicka uuid_zpravy="${UUID}" dat_prij="${RECEIVED_AT}"/>` +
      `<tns:Potvrzeni pok="${POK}"/>` +
      `<tns:Varovani kod_varov="6">Known warning</tns:Varovani>` +
      `<tns:Varovani kod_varov="99">Future warning</tns:Varovani>` +
      `</tns:Odpoved>`;

    expect(parseEetResponse({ statusCode: 200, headers: {}, body: xml }))
      .toMatchObject({
        warnings: [
          { code: 6, message: "Known warning", knownMessage: "The registrating unit identifier (id_jednotky) does not match the expected format" },
          { code: 99, message: "Future warning" },
        ],
      });
  });

  it("trusts a valid EET error outcome over an inconsistent HTTP status", () => {
    expect(parseEetResponse({ statusCode: 500, headers: {}, body: errorResponse("-1") }))
      .toMatchObject({ status: SubmissionStatus.Rejected, code: -1, retryable: true });
  });

  it.each([
    { code: "soap:Server", retryable: true },
    { code: "soap:Client", retryable: false },
    { code: "evil:Server", retryable: false },
    { code: "missing:Server", retryable: false },
  ])("classifies the SOAP fault $code", ({ code, retryable }) => {
    const xml = soapFault(code);
    const error = captureProtocolError(() => parseEetResponse({
      statusCode: 500,
      headers: { "x-global-transaction-id": "trace-fault" },
      body: xml,
    }));

    expect(error.context).toEqual({
      kind: "soap-fault",
      statusCode: 500,
      rawXml: xml,
      globalTransactionId: "trace-fault",
      retryable,
      fault: {
        code,
        message: "Temporary EET failure",
        actor: "central-system",
      },
    });
  });

  it.each([
    { name: "empty body", body: "", path: undefined },
    { name: "malformed XML", body: "<Odpoved>", path: undefined },
    { name: "wrong namespace", body: "<Odpoved xmlns=\"urn:wrong\"/>", path: undefined },
    { name: "missing SOAP Body", body: `<soap:Envelope xmlns:soap="${SOAP_NAMESPACE}"/>`, path: "Envelope.Body" },
    {
      name: "duplicate SOAP Body",
      body: `<soap:Envelope xmlns:soap="${SOAP_NAMESPACE}"><soap:Body/><soap:Body/></soap:Envelope>`,
      path: "Envelope.Body",
    },
    {
      name: "response and fault",
      body: `<soap:Envelope xmlns:soap="${SOAP_NAMESPACE}"><soap:Body>${acceptedResponse()}${soapFaultElement("soap:Server")}</soap:Body></soap:Envelope>`,
      path: "Envelope.Body",
    },
    {
      name: "conflicting EET outcomes",
      body: `<tns:Odpoved xmlns:tns="${EET_NAMESPACE}"><tns:Hlavicka/><tns:Potvrzeni/><tns:Chyba kod="2">Bad</tns:Chyba></tns:Odpoved>`,
      path: "Odpoved",
    },
    {
      name: "duplicate header",
      body: acceptedResponse().replace(
        "<tns:Potvrzeni",
        `<tns:Hlavicka uuid_zpravy="${UUID}" dat_prij="${RECEIVED_AT}"/><tns:Potvrzeni`,
      ),
      path: "Odpoved.Hlavicka",
    },
    {
      name: "duplicate confirmation",
      body: acceptedResponse().replace(
        "<tns:Varovani",
        `<tns:Potvrzeni pok="${POK}"/><tns:Varovani`,
      ),
      path: "Odpoved.Potvrzeni",
    },
    {
      name: "duplicate error",
      body: errorResponse("2").replace(
        "</tns:Odpoved>",
        `<tns:Chyba kod="2">Second error</tns:Chyba></tns:Odpoved>`,
      ),
      path: "Odpoved.Chyba",
    },
    {
      name: "missing response UUID",
      body: acceptedResponse().replace(` uuid_zpravy="${UUID}"`, ""),
      path: "Odpoved.Hlavicka.uuid_zpravy",
    },
    {
      name: "missing received date-time",
      body: acceptedResponse().replace(` dat_prij="${RECEIVED_AT}"`, ""),
      path: "Odpoved.Hlavicka.dat_prij",
    },
    {
      name: "missing POK",
      body: acceptedResponse().replace(` pok="${POK}"`, ""),
      path: "Odpoved.Potvrzeni.pok",
    },
    {
      name: "invalid POK",
      body: acceptedResponse().replace(POK, "not-a-pok"),
      path: "Odpoved.Potvrzeni.pok",
    },
    {
      name: "invalid response UUID",
      body: acceptedResponse().replace(UUID, "not-a-uuid"),
      path: "Odpoved.Hlavicka.uuid_zpravy",
    },
    {
      name: "invalid received date-time",
      body: acceptedResponse().replace(RECEIVED_AT, "2027-03-04"),
      path: "Odpoved.Hlavicka.dat_prij",
    },
    {
      name: "impossible received date-time",
      body: acceptedResponse().replace(RECEIVED_AT, "2027-02-30T18:25:21+01:00"),
      path: "Odpoved.Hlavicka.dat_prij",
    },
    {
      name: "invalid timezone offset",
      body: acceptedResponse().replace(RECEIVED_AT, "2027-03-04T18:25:21+15:00"),
      path: "Odpoved.Hlavicka.dat_prij",
    },
    {
      name: "invalid error code",
      body: errorResponse("1.5"),
      path: "Odpoved.Chyba.kod",
    },
    {
      name: "out-of-range error code",
      body: errorResponse("1000"),
      path: "Odpoved.Chyba.kod",
    },
    {
      name: "invalid warning code",
      body: acceptedResponse().replace('kod_varov="1"', 'kod_varov="NaN"'),
      path: "Odpoved.Varovani.kod_varov",
    },
    {
      name: "non-positive warning code",
      body: acceptedResponse().replace('kod_varov="1"', 'kod_varov="0"'),
      path: "Odpoved.Varovani.kod_varov",
    },
    {
      name: "empty warning text",
      body: acceptedResponse().replace("EIC poplatnika se neshoduje", ""),
      path: "Odpoved.Varovani",
    },
    {
      name: "empty error text",
      body: errorResponse("2").replace("EET response message", ""),
      path: "Odpoved.Chyba",
    },
    {
      name: "nested element instead of error text",
      body: errorResponse("2").replace(
        "EET response message",
        '<future:Value xmlns:future="urn:future">not direct text</future:Value>',
      ),
      path: "Odpoved.Chyba",
    },
    {
      name: "invalid test boolean",
      body: acceptedResponse().replace('test="true"', 'test="yes"'),
      path: "Odpoved.Potvrzeni.test",
    },
  ])("classifies $name as malformed", ({ body, path }) => {
    const error = captureProtocolError(() => parseEetResponse({ statusCode: 200, headers: {}, body }));

    expect(error.context.kind).toBe("malformed-response");
    if (error.context.kind === "malformed-response") {
      expect(error.context.path).toBe(path);
      expect(error.context.retryable).toBe(false);
    }
  });

  it("uses HTTP classification when a non-2xx body is malformed", () => {
    const error = captureProtocolError(() => parseEetResponse({
      statusCode: 502,
      headers: {},
      body: "<broken>",
    }));

    expect(error.context).toMatchObject({ kind: "http-error", statusCode: 502, retryable: true });
  });

  it("uses the first non-empty global transaction ID", () => {
    const error = captureProtocolError(() => parseEetResponse({
      statusCode: 503,
      headers: { "x-global-transaction-id": ["", "trace-second"] },
      body: "unavailable",
    }));

    expect(error.context.globalTransactionId).toBe("trace-second");
  });
});

function acceptedEnvelope(): string {
  return `<soap:Envelope xmlns:soap="${SOAP_NAMESPACE}"><soap:Body>${acceptedResponse()}</soap:Body></soap:Envelope>`;
}

function acceptedResponse(prefix = "tns", extraAttributes = ""): string {
  return (
    `<${prefix}:Odpoved xmlns:${prefix}="${EET_NAMESPACE}"${extraAttributes}>` +
    `<${prefix}:Hlavicka uuid_zpravy="${UUID}" dat_prij="${RECEIVED_AT}"/>` +
    `<${prefix}:Potvrzeni pok="${POK}" test="true"/>` +
    `<${prefix}:Varovani kod_varov="1">EIC poplatnika se neshoduje</${prefix}:Varovani>` +
    `<${prefix}:BudouciPole>ignored</${prefix}:BudouciPole>` +
    `</${prefix}:Odpoved>`
  );
}

function errorResponse(code: string): string {
  return (
    `<tns:Odpoved xmlns:tns="${EET_NAMESPACE}">` +
    `<tns:Hlavicka uuid_zpravy="${UUID}" dat_odmit="${RECEIVED_AT}"/>` +
    `<tns:Chyba kod="${code}" test="false">EET response message</tns:Chyba>` +
    `</tns:Odpoved>`
  );
}

function soapFault(code: string): string {
  return `<soap:Envelope xmlns:soap="${SOAP_NAMESPACE}"><soap:Body>${soapFaultElement(code)}</soap:Body></soap:Envelope>`;
}

function soapFaultElement(code: string): string {
  return (
    `<soap:Fault xmlns:soap="${SOAP_NAMESPACE}" xmlns:evil="urn:not-soap">` +
    `<faultcode>${code}</faultcode>` +
    `<faultstring>Temporary EET failure</faultstring>` +
    `<faultactor>central-system</faultactor>` +
    `</soap:Fault>`
  );
}

function captureProtocolError(run: () => unknown): EetProtocolError {
  try {
    run();
  } catch (error) {
    if (error instanceof EetProtocolError) {
      return error;
    }
    throw error;
  }

  throw new Error("Expected EetProtocolError");
}
