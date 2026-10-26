import { describe, expect, it, vi } from "vitest";
import type { EetCashRegister } from "../src/cash-register.ts";
import { EetCertificate } from "../src/certificate.ts";
import { EetClient } from "../src/client.ts";
import {
  EET_PLAYGROUND_ENDPOINT,
  EET_SOAP_ACTION,
  Environment,
  SubmissionStatus,
} from "../src/constants.ts";
import { EetProtocolError } from "../src/index.ts";
import type { EetTaxpayer } from "../src/taxpayer.ts";
import type { EetSigner, EetTransport } from "../src/types.ts";

const taxpayer: EetTaxpayer = {
  eic: "CZ8551015704",
  certificate: new EetCertificate({ privateKeyPem: "key", certificatePem: "cert" }),
};

const cashRegister: EetCashRegister = {
  id: "00/2535/CN58",
  unitId: "181",
};

const clocks = {
  now: () => new Date("2027-01-08T20:19:40Z"),
  uuid: () => "e23e5a5a-08d7-4a08-844d-2b6c6b60621d",
};

const sale = {
  cashRegister,
  receiptNumber: "0/2482/IE25",
  occurredAt: "2027-01-07T22:01:00+01:00",
  totalAmount: 8_798_800,
};

describe("EetClient", () => {
  it("builds, signs, sends, and parses a sale submission", async () => {
    const signer: EetSigner = {
      sign: vi.fn((xml: string) => `<signed>${xml}</signed>`),
    };
    const transport: EetTransport = {
      send: vi.fn(async (request) => {
        expect(request.endpoint).toBe(EET_PLAYGROUND_ENDPOINT);
        expect(request.soapAction).toBe(EET_SOAP_ACTION);
        expect(request.xml).toContain("<signed>");
        expect(request.xml).toContain('prvni_zaslani="true"');
        expect(request.xml).not.toContain('overeni="true"');

        return {
          statusCode: 200,
          headers: { "x-global-transaction-id": "trace-client" },
          body: `<tns:Odpoved xmlns:tns="http://fs.gov.cz/eet/schema/v4"><tns:Hlavicka uuid_zpravy="e23e5a5a-08d7-4a08-844d-2b6c6b60621d" dat_prij="2027-03-04T18:25:21+01:00" /><tns:Potvrzeni pok="987a6be5-6af5-44f3-b4fc-987654321000-ff" test="true" /></tns:Odpoved>`,
        };
      }),
    };

    const client = new EetClient({ environment: Environment.Playground, taxpayer, signer, transport, ...clocks });

    await expect(client.registerSale(sale)).resolves.toMatchObject({
      status: SubmissionStatus.Accepted,
      pok: "987a6be5-6af5-44f3-b4fc-987654321000-ff",
      globalTransactionId: "trace-client",
    });
  });

  it("uses verification mode for verifySale", async () => {
    const signer: EetSigner = {
      sign: vi.fn((xml: string) => xml),
    };
    const transport: EetTransport = {
      send: vi.fn(async (request) => {
        expect(request.xml).toContain('overeni="true"');

        return {
          statusCode: 200,
          headers: {},
          body: `<tns:Odpoved xmlns:tns="http://fs.gov.cz/eet/schema/v4"><tns:Hlavicka uuid_zpravy="e23e5a5a-08d7-4a08-844d-2b6c6b60621d" dat_odmit="2027-03-04T18:25:21+01:00" /><tns:Chyba kod="0">Datovou zpravu evidovane trzby v overovacim modu se podarilo zpracovat</tns:Chyba></tns:Odpoved>`,
        };
      }),
    };

    const client = new EetClient({ environment: Environment.Playground, taxpayer, signer, transport, ...clocks });

    await expect(client.verifySale(sale)).resolves.toMatchObject({ status: SubmissionStatus.VerificationOk, code: 0 });
  });

  it("lets a request taxpayer override the client default", async () => {
    const override: EetTaxpayer = {
      eic: "CZ00000019",
      certificate: new EetCertificate({ privateKeyPem: "other-key", certificatePem: "other-cert" }),
    };
    const signer: EetSigner = {
      sign: vi.fn((xml: string) => xml),
    };
    const transport: EetTransport = {
      send: vi.fn(async (request) => {
        expect(request.xml).toContain('eic_popl="CZ00000019"');
        expect(request.xml).toContain('id_jednotky="181"');
        expect(request.xml).toContain('id_pokl="00/2535/CN58"');

        return {
          statusCode: 200,
          headers: {},
          body: `<tns:Odpoved xmlns:tns="http://fs.gov.cz/eet/schema/v4"><tns:Hlavicka uuid_zpravy="e23e5a5a-08d7-4a08-844d-2b6c6b60621d" dat_prij="2027-03-04T18:25:21+01:00" /><tns:Potvrzeni pok="987a6be5-6af5-44f3-b4fc-987654321000-ff" test="true" /></tns:Odpoved>`,
        };
      }),
    };

    const client = new EetClient({ environment: Environment.Playground, taxpayer, signer, transport, ...clocks });

    await expect(client.registerSale(sale, { taxpayer: override })).resolves.toMatchObject({ status: SubmissionStatus.Accepted });
  });

  it("requires a taxpayer on the client or the request", async () => {
    const signer: EetSigner = {
      sign: vi.fn((xml: string) => xml),
    };
    const transport: EetTransport = {
      send: vi.fn(async () => ({
        statusCode: 200,
        headers: {},
        body: `<tns:Odpoved xmlns:tns="http://fs.gov.cz/eet/schema/v4"><tns:Hlavicka uuid_zpravy="e23e5a5a-08d7-4a08-844d-2b6c6b60621d" dat_prij="2027-03-04T18:25:21+01:00" /><tns:Potvrzeni pok="987a6be5-6af5-44f3-b4fc-987654321000-ff" test="true" /></tns:Odpoved>`,
      })),
    };
    const client = new EetClient({ environment: Environment.Playground, signer, transport, ...clocks });

    await expect(client.registerSale(sale)).rejects.toThrow("taxpayer");
    await expect(client.registerSale(sale, { taxpayer })).resolves.toMatchObject({ status: SubmissionStatus.Accepted });
  });

  it("uses structured protocol errors for transport responses", async () => {
    const signer: EetSigner = { sign: (xml) => xml };
    const transport: EetTransport = {
      send: async () => ({
        statusCode: 503,
        headers: { "x-global-transaction-id": "trace-client-error" },
        body: "temporarily unavailable",
      }),
    };
    const client = new EetClient({ environment: Environment.Playground, taxpayer, signer, transport, ...clocks });

    await expect(client.registerSale(sale)).rejects.toMatchObject({
      name: "EetProtocolError",
      context: {
        kind: "http-error",
        statusCode: 503,
        globalTransactionId: "trace-client-error",
      },
    });
  });

  it("uses structured protocol errors for manual parsing", () => {
    const client = new EetClient({ environment: Environment.Playground, taxpayer });

    expect(() => client.parseResponse("<broken>"))
      .toThrow(EetProtocolError);
  });

  it("keeps manual bare-response parsing", () => {
    const client = new EetClient({ environment: Environment.Playground, taxpayer });
    const result = client.parseResponse(
      `<tns:Odpoved xmlns:tns="http://fs.gov.cz/eet/schema/v4">` +
      `<tns:Hlavicka uuid_zpravy="e23e5a5a-08d7-4a08-844d-2b6c6b60621d" dat_prij="2027-03-04T18:25:21+01:00"/>` +
      `<tns:Potvrzeni pok="987a6be5-6af5-44f3-b4fc-987654321000-ff"/>` +
      `</tns:Odpoved>`,
    );

    expect(result).toMatchObject({ status: SubmissionStatus.Accepted });
  });
});
