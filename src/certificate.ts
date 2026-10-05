import { createPrivateKey, type KeyObject } from "node:crypto";
import forge from "node-forge";

export type EetCertificateInput =
  | {
      privateKeyPem: string | Buffer;
      certificatePem: string | Buffer;
    }
  | {
      p12: Buffer;
      passphrase?: string;
    };

export interface CertificateMaterial {
  privateKeyPem: string;
  certificatePem: string;
  certificateBase64: string;
}

export class EetCertificate {
  readonly material: CertificateMaterial;
  private keyObject?: KeyObject;

  constructor(input: EetCertificateInput) {
    this.material = loadCertificate(input);
  }

  get privateKey(): KeyObject {
    this.keyObject ??= createPrivateKey(this.material.privateKeyPem);
    return this.keyObject;
  }
}

export function loadCertificate(
  input: EetCertificateInput,
): CertificateMaterial {
  if ("privateKeyPem" in input) {
    const privateKeyPem = input.privateKeyPem.toString("utf-8");
    const certificatePem = input.certificatePem.toString("utf-8");

    return {
      privateKeyPem,
      certificatePem,
      certificateBase64: pemCertificateToBase64(certificatePem),
    };
  }

  return loadP12CertificateMaterial(input.p12, input.passphrase ?? "");
}

function loadP12CertificateMaterial(
  p12Buffer: Buffer,
  passphrase: string,
): CertificateMaterial {
  const asn1 = forge.asn1.fromDer(p12Buffer.toString("binary"));
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, passphrase);
  const oids = forge.pki.oids;
  const shroudedKeyBagOid = oids.pkcs8ShroudedKeyBag as string;
  const keyBagOid = oids.keyBag as string;
  const certBagOid = oids.certBag as string;
  const keyBag =
    p12.getBags({ bagType: shroudedKeyBagOid })[shroudedKeyBagOid]?.[0] ??
    p12.getBags({ bagType: keyBagOid })[keyBagOid]?.[0];
  const certBag = p12.getBags({ bagType: certBagOid })[certBagOid]?.[0];

  if (!keyBag?.key || !certBag?.cert) {
    throw new Error(
      "P12 certificate must contain a private key and X509 certificate",
    );
  }

  const privateKeyPem = forge.pki.privateKeyToPem(keyBag.key);
  const certificatePem = forge.pki.certificateToPem(certBag.cert);

  return {
    privateKeyPem,
    certificatePem,
    certificateBase64: pemCertificateToBase64(certificatePem),
  };
}

function pemCertificateToBase64(pem: string): string {
  return pem
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
}
