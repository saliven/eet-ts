import { randomUUID } from "node:crypto";
import { SignedXml } from "xml-crypto";
import type { EetCertificate } from "./certificate.ts";
import {
  BASE64_BINARY_VALUE_TYPE,
  EXCLUSIVE_C14N_ALGORITHM,
  RSA_SHA256_SIGNATURE_ALGORITHM,
  SHA256_DIGEST_ALGORITHM,
  WSSE_NAMESPACE,
  X509_TOKEN_REFERENCE_VALUE_TYPE,
  X509_V3_VALUE_TYPE,
} from "./constants.ts";
import type { EetSigner } from "./types.ts";

export class WsSecuritySigner implements EetSigner {
  sign(unsignedEnvelope: string, certificate: EetCertificate): string {
    return signSoapEnvelope(unsignedEnvelope, certificate);
  }
}

export function signSoapEnvelope(
  unsignedEnvelope: string,
  certificate: EetCertificate,
): string {
  const { material } = certificate;
  const tokenId = `X509-${randomUUID()}`;
  const envelopeWithToken = addBinarySecurityToken(
    unsignedEnvelope,
    tokenId,
    material.certificateBase64,
  );

  const signedXml = new SignedXml({
    idMode: "wssecurity",
    privateKey: certificate.privateKey,
    publicCert: material.certificatePem,
    canonicalizationAlgorithm: EXCLUSIVE_C14N_ALGORITHM,
    signatureAlgorithm: RSA_SHA256_SIGNATURE_ALGORITHM,
    getKeyInfoContent: () =>
      `<wsse:SecurityTokenReference>` +
      `<wsse:Reference URI="#${tokenId}" ValueType="${X509_TOKEN_REFERENCE_VALUE_TYPE}" />` +
      `</wsse:SecurityTokenReference>`,
  });

  signedXml.addReference({
    xpath: "//*[local-name(.)='Body']",
    transforms: [EXCLUSIVE_C14N_ALGORITHM],
    digestAlgorithm: SHA256_DIGEST_ALGORITHM,
  });

  signedXml.computeSignature(envelopeWithToken, {
    prefix: "ds",
    location: {
      reference: "//*[local-name(.)='Security']",
      action: "append",
    },
    existingPrefixes: {
      soap: "http://schemas.xmlsoap.org/soap/envelope/",
      wsse: WSSE_NAMESPACE,
    },
  });

  return signedXml.getSignedXml();
}

function addBinarySecurityToken(
  envelope: string,
  tokenId: string,
  certificateBase64: string,
): string {
  const openSecurity = `<wsse:Security soap:mustUnderstand="1">`;
  const emptySecurity = `<wsse:Security soap:mustUnderstand="1"/>`;
  const token =
    `<wsse:BinarySecurityToken wsu:Id="${tokenId}" EncodingType="${BASE64_BINARY_VALUE_TYPE}" ValueType="${X509_V3_VALUE_TYPE}">` +
    certificateBase64 +
    `</wsse:BinarySecurityToken>`;

  if (envelope.includes(emptySecurity)) {
    return envelope.replace(
      emptySecurity,
      `${openSecurity}${token}</wsse:Security>`,
    );
  }

  if (envelope.includes(openSecurity)) {
    return envelope.replace(openSecurity, `${openSecurity}${token}`);
  }

  throw new Error("SOAP envelope does not contain an empty WS-Security header");
}
