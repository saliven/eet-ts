import { DOMParser } from "@xmldom/xmldom";
import forge from "node-forge";
import { describe, expect, it } from "vitest";
import { SignedXml } from "xml-crypto";
import { EetCertificate } from "../src/certificate.ts";
import { DS_NAMESPACE } from "../src/constants.ts";
import { ForgeEetCrypto, WebCryptoEetCrypto } from "../src/crypto.ts";
import { signSoapEnvelope, WsSecuritySigner } from "../src/signing.ts";
import { buildUnsignedSoapEnvelope } from "../src/xml.ts";

const material = createCertificate();
const cert = new EetCertificate(material);
const unsigned = buildUnsignedSoapEnvelope(
  '<tns:Trzba xmlns:tns="http://fs.gov.cz/eet/schema/v4"><tns:Hlavicka uuid_zpravy="a" /></tns:Trzba>',
  "Body-1",
);

describe("signSoapEnvelope", () => {
  it("adds WS-Security BinarySecurityToken and a Body signature", async () => {
    const signed = await signSoapEnvelope(unsigned, cert);

    expect(signed).toContain('<wsse:BinarySecurityToken wsu:Id="X509-Body-1"');
    expect(signed).toContain("<ds:Signature");
    expect(signed).toContain('<ds:Reference URI="#Body-1"');
    expect(signed).toContain("http://www.w3.org/2001/04/xmlenc#sha256");
    expect(signed).toContain("http://www.w3.org/2001/04/xmldsig-more#rsa-sha256");
    expect(signed).toContain('<wsse:SecurityTokenReference><wsse:Reference URI="#X509-Body-1"');
    // Body digest produced by the previous xml-crypto based signer for the same envelope.
    expect(signed).toContain("<ds:DigestValue>BTd03Wit+cynXiu0vk5fAkcpgPihVdT1O38YXbKUQag=</ds:DigestValue>");
  });

  it.each([
    ["Web Crypto", new WebCryptoEetCrypto()],
    ["node-forge", new ForgeEetCrypto()],
  ])("produces a signature xml-crypto verifies with %s", async (_name, crypto) => {
    const signed = await new WsSecuritySigner({ crypto }).sign(unsigned, cert);

    expect(verify(signed)).toBe(true);
    expect(verify(signed.replace('uuid_zpravy="a"', 'uuid_zpravy="b"'))).toBe(false);
  });

  it("produces identical output with every crypto backend", async () => {
    const webCrypto = await signSoapEnvelope(unsigned, cert, new WebCryptoEetCrypto());
    const pureJs = await signSoapEnvelope(unsigned, cert, new ForgeEetCrypto());

    expect(pureJs).toBe(webCrypto);
  });

  it("requires a Body with wsu:Id", async () => {
    await expect(signSoapEnvelope(unsigned.replace(' wsu:Id="Body-1"', ""), cert)).rejects.toThrow("wsu:Id");
  });
});

function verify(xml: string): boolean {
  const document = new DOMParser().parseFromString(xml, "text/xml");
  const signature = document.getElementsByTagNameNS(DS_NAMESPACE, "Signature")[0];
  const verifier = new SignedXml({ publicCert: material.certificatePem, idMode: "wssecurity" });

  verifier.loadSignature(signature as unknown as Node);

  try {
    return verifier.checkSignature(xml);
  } catch {
    return false;
  }
}

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
