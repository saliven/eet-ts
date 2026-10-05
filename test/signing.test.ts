import forge from "node-forge";
import { describe, expect, it } from "vitest";
import { EetCertificate } from "../src/certificate.ts";
import { signSoapEnvelope } from "../src/signing.ts";
import { buildUnsignedSoapEnvelope } from "../src/xml.ts";

describe("signSoapEnvelope", () => {
  it("adds WS-Security BinarySecurityToken and a Body signature", () => {
    const cert = new EetCertificate(createCertificate());
    const unsigned = buildUnsignedSoapEnvelope('<tns:Trzba xmlns:tns="http://fs.gov.cz/eet/schema/v4" />', "Body-1");
    const signed = signSoapEnvelope(unsigned, cert);

    expect(signed).toContain("<wsse:BinarySecurityToken");
    expect(signed).toContain("<ds:Signature");
    expect(signed).toContain('<ds:Reference URI="#Body-1"');
    expect(signed).toContain("http://www.w3.org/2001/04/xmlenc#sha256");
    expect(signed).toContain("http://www.w3.org/2001/04/xmldsig-more#rsa-sha256");
    expect(signed).toContain("<wsse:SecurityTokenReference>");
  });
});

function createCertificate(): { privateKeyPem: string; certificatePem: string } {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date("2027-01-01T00:00:00Z");
  cert.validity.notAfter = new Date("2028-01-01T00:00:00Z");
  cert.setSubject([{ name: "commonName", value: "test" }]);
  cert.setIssuer([{ name: "commonName", value: "test" }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  return {
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
    certificatePem: forge.pki.certificateToPem(cert),
  };
}
