import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { EetCertificate } from "../src/certificate.ts";
import { EetClient } from "../src/client.ts";
import { Environment, SubmissionStatus } from "../src/constants.ts";

const CERTIFICATE_ZIP_URL =
  "https://eet.gov.cz/assets/cs/cmsmedia/pro-vyvojare/CAEET_Playground_2026_v1.zip";
const DEFAULT_EIC = "CZ00000019";

describe("EET playground", () => {
  it("accepts a verification-mode sale", async () => {
    const client = await playgroundClient();
    const result = await client.verifySale(playgroundSale());

    expect(result).toMatchObject({
      status: SubmissionStatus.VerificationOk,
      code: 0,
      test: true,
    });
  }, 30_000);

  it("accepts an operational playground sale and returns a fictitious POK", async () => {
    const client = await playgroundClient();
    const result = await client.registerSale(playgroundSale());

    expect(result).toMatchObject({
      status: SubmissionStatus.Accepted,
      test: true,
    });
    expect(
      result.status === SubmissionStatus.Accepted ? result.pok.endsWith("-ff") : false,
    ).toBe(true);
  }, 30_000);
});

const playgroundClient = async () => {
  const taxpayer = {
    eic: "CZ00000019",
    certificate: new EetCertificate(await playgroundCertificate("CZ00000019")),
  };

  return new EetClient({
    environment: Environment.Playground,
    taxpayer,
    timeoutMs: 30_000,
  });
};

const playgroundSale = () => ({
  cashRegister: { id: "SDK-TEST-01", unitId: "303" },
  receiptNumber: `SDK-${Date.now()}`,
  occurredAt: new Date(),
  totalAmount: 100,
  firstSubmission: true,
});

const playgroundCertificate = async (eic: string) => {
  const response = await fetch(CERTIFICATE_ZIP_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to download playground certificate bundle from ${CERTIFICATE_ZIP_URL}: HTTP ${response.status}`,
    );
  }
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const p12 = files[`CA_EET-Playground-${eic}.p12`];
  const password = files["password_pokladni_cert_playground.txt"];

  if (!p12 || !password) {
    throw new Error(
      `Official playground certificate bundle does not contain certificate for ${eic}.`,
    );
  }

  return {
    p12: Buffer.from(p12),
    passphrase: Buffer.from(password).toString("utf8").trim(),
  };
};
