import { DOMParser, type Element } from "@xmldom/xmldom";
import { ExclusiveCanonicalization } from "xml-crypto/lib/exclusive-canonicalization.js";
import { bytesToBase64, utf8Bytes } from "./bytes.ts";
import type { EetCertificate } from "./certificate.ts";
import {
  BASE64_BINARY_VALUE_TYPE,
  DS_NAMESPACE,
  EXCLUSIVE_C14N_ALGORITHM,
  RSA_SHA256_SIGNATURE_ALGORITHM,
  SHA256_DIGEST_ALGORITHM,
  SOAP_ENV_NAMESPACE,
  WSU_NAMESPACE,
  X509_TOKEN_REFERENCE_VALUE_TYPE,
  X509_V3_VALUE_TYPE,
} from "./constants.ts";
import { defaultEetCrypto } from "./crypto.ts";
import type { EetCrypto, EetSigner } from "./types.ts";

const xmlParser = new DOMParser();
const canonicalization = new ExclusiveCanonicalization();

export interface WsSecuritySignerOptions {
  crypto?: EetCrypto;
}

export class WsSecuritySigner implements EetSigner {
  private readonly crypto: EetCrypto;

  constructor(options: WsSecuritySignerOptions = {}) {
    this.crypto = options.crypto ?? defaultEetCrypto();
  }

  sign(unsignedEnvelope: string, certificate: EetCertificate): Promise<string> {
    return signSoapEnvelope(unsignedEnvelope, certificate, this.crypto);
  }
}

export async function signSoapEnvelope(
  unsignedEnvelope: string,
  certificate: EetCertificate,
  crypto: EetCrypto = defaultEetCrypto(),
): Promise<string> {
  const body = findBody(unsignedEnvelope);
  const bodyId = body.getAttributeNS(WSU_NAMESPACE, "Id");

  if (!bodyId) {
    throw new Error("SOAP Body must have a wsu:Id attribute");
  }

  const tokenId = `X509-${bodyId}`;
  const digest = await crypto.sha256(utf8Bytes(canonicalize(body)));
  const signedInfo = canonicalize(
    parseElement(
      `<ds:SignedInfo xmlns:ds="${DS_NAMESPACE}">` +
        `<ds:CanonicalizationMethod Algorithm="${EXCLUSIVE_C14N_ALGORITHM}"/>` +
        `<ds:SignatureMethod Algorithm="${RSA_SHA256_SIGNATURE_ALGORITHM}"/>` +
        `<ds:Reference URI="#${bodyId}">` +
        `<ds:Transforms><ds:Transform Algorithm="${EXCLUSIVE_C14N_ALGORITHM}"/></ds:Transforms>` +
        `<ds:DigestMethod Algorithm="${SHA256_DIGEST_ALGORITHM}"/>` +
        `<ds:DigestValue>${bytesToBase64(digest)}</ds:DigestValue>` +
        `</ds:Reference>` +
        `</ds:SignedInfo>`,
    ),
  );
  const signatureValue = await crypto.signRsaSha256(
    utf8Bytes(signedInfo),
    certificate,
  );

  const token =
    `<wsse:BinarySecurityToken wsu:Id="${tokenId}" EncodingType="${BASE64_BINARY_VALUE_TYPE}" ValueType="${X509_V3_VALUE_TYPE}">` +
    certificate.material.certificateBase64 +
    `</wsse:BinarySecurityToken>`;
  const signature =
    `<ds:Signature xmlns:ds="${DS_NAMESPACE}">` +
    signedInfo +
    `<ds:SignatureValue>${bytesToBase64(signatureValue)}</ds:SignatureValue>` +
    `<ds:KeyInfo><wsse:SecurityTokenReference>` +
    `<wsse:Reference URI="#${tokenId}" ValueType="${X509_TOKEN_REFERENCE_VALUE_TYPE}"/>` +
    `</wsse:SecurityTokenReference></ds:KeyInfo>` +
    `</ds:Signature>`;

  return addToSecurityHeader(unsignedEnvelope, token, signature);
}

function findBody(envelope: string): Element {
  const body = parseElement(envelope).getElementsByTagNameNS(
    SOAP_ENV_NAMESPACE,
    "Body",
  )[0];

  if (body === undefined) {
    throw new Error("SOAP envelope does not contain a Body");
  }

  return body;
}

function parseElement(xml: string): Element {
  const root = xmlParser.parseFromString(xml, "text/xml").documentElement;

  if (root === null) {
    throw new Error("XML does not contain a document element");
  }

  return root;
}

function canonicalize(element: Element): string {
  return canonicalization.process(
    element as unknown as Parameters<typeof canonicalization.process>[0],
    {},
  );
}

function addToSecurityHeader(
  envelope: string,
  token: string,
  signature: string,
): string {
  const openSecurity = `<wsse:Security soap:mustUnderstand="1">`;
  const emptySecurity = `<wsse:Security soap:mustUnderstand="1"/>`;
  const closeSecurity = `</wsse:Security>`;

  if (envelope.includes(emptySecurity)) {
    return envelope.replace(
      emptySecurity,
      `${openSecurity}${token}${signature}${closeSecurity}`,
    );
  }

  if (envelope.includes(openSecurity) && envelope.includes(closeSecurity)) {
    return envelope
      .replace(openSecurity, `${openSecurity}${token}`)
      .replace(closeSecurity, `${signature}${closeSecurity}`);
  }

  throw new Error("SOAP envelope does not contain an empty WS-Security header");
}
