import forge from "node-forge";
import { bytesToBinary } from "./bytes.ts";

export type EetCertificateInput =
  | {
      privateKeyPem: string | Uint8Array;
      certificatePem: string | Uint8Array;
    }
  | {
      p12: Uint8Array;
      passphrase?: string;
    };

export interface CertificateMaterial {
  privateKeyPem: string;
  certificatePem: string;
  certificateBase64: string;
}

export class EetCertificate {
  readonly material: CertificateMaterial;

  constructor(input: EetCertificateInput) {
    this.material = loadCertificate(input);
  }
}

export function loadCertificate(
  input: EetCertificateInput,
): CertificateMaterial {
  if ("privateKeyPem" in input) {
    const privateKeyPem = pemText(input.privateKeyPem);
    const certificatePem = pemText(input.certificatePem);

    return {
      privateKeyPem,
      certificatePem,
      certificateBase64: pemCertificateToBase64(certificatePem),
    };
  }

  return loadP12CertificateMaterial(input.p12, input.passphrase ?? "");
}

function pemText(pem: string | Uint8Array): string {
  return typeof pem === "string" ? pem : bytesToBinary(pem);
}

function loadP12CertificateMaterial(
  p12Bytes: Uint8Array,
  passphrase: string,
): CertificateMaterial {
  const asn1 = forge.asn1.fromDer(bytesToBinary(p12Bytes));
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
