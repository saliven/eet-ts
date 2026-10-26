// oxlint-disable no-redeclare
import type { InferObjectValues } from "./types.ts";

export const EET_SCHEMA_NAMESPACE = "http://fs.gov.cz/eet/schema/v4";
export const EET_SCHEMA_VERSION = "4.1";
export const EET_SOAP_ACTION = "http://fs.gov.cz/eet/OdeslaniTrzby";
export const EET_PLAYGROUND_ENDPOINT =
  "https://pg.trzbyeet.gov.cz:443/eet/services/EETServiceSOAP/v4";
export const EET_MAX_SOAP_BYTES = 12 * 1024;

export const SOAP_ENV_NAMESPACE = "http://schemas.xmlsoap.org/soap/envelope/";
export const WSU_NAMESPACE =
  "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd";
export const WSSE_NAMESPACE =
  "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd";
export const DS_NAMESPACE = "http://www.w3.org/2000/09/xmldsig#";

export const BASE64_BINARY_VALUE_TYPE =
  "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary";
export const X509_V3_VALUE_TYPE =
  "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3";
export const X509_TOKEN_REFERENCE_VALUE_TYPE =
  "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3";

export const EXCLUSIVE_C14N_ALGORITHM =
  "http://www.w3.org/2001/10/xml-exc-c14n#";
export const SHA256_DIGEST_ALGORITHM =
  "http://www.w3.org/2001/04/xmlenc#sha256";
export const RSA_SHA256_SIGNATURE_ALGORITHM =
  "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";

export const EET_REGEX = {
  amount: /^((0|-?[1-9]\d{0,7})\.\d\d|-0\.(0[1-9]|[1-9]\d))$/,
  dateTime: /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:Z|[+-]\d\d:\d\d)$/,
  eic: /^CZ[0-9]{8,10}$/,
  idJednotky: /^[1-9][0-9]{0,8}$/,
  pok: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}-[0-9a-fA-F]{2}$/,
  string20: /^[0-9a-zA-Z.,:;/#\-_ ]{1,20}$/,
  string25: /^[0-9a-zA-Z.,:;/#\-_ ]{1,25}$/,
  uuid: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/,
};

export const ASCII_XML_VALUE_REGEX = /^[\u0009\u000a\u000d\u0020-\u007e]*$/;

export const Environment = {
  Playground: "playground",
  Production: "production",
} as const;
export type Environment = InferObjectValues<typeof Environment>;

export const SubmissionStatus = {
  Accepted: "accepted",
  VerificationOk: "verification-ok",
  Rejected: "rejected",
} as const;
export type SubmissionStatus = InferObjectValues<typeof SubmissionStatus>;
