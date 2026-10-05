import {
  DOMParser,
  onWarningStopParsing,
  type Document,
  type Element,
  type Node,
} from "@xmldom/xmldom";
import {
  EET_REGEX,
  EET_SCHEMA_NAMESPACE,
  SOAP_ENV_NAMESPACE,
} from "./constants.ts";
import { EET_WARNING_MESSAGES, isRetryableEetError } from "./errors.ts";
import type {
  EetSubmissionResult,
  EetTransportResponse,
  EetWarning,
} from "./types.ts";

const xmlParser = new DOMParser({
  locator: false,
  onError: onWarningStopParsing,
});

export interface EetSoapFault {
  code: string;
  message: string;
  actor?: string;
}

interface EetProtocolErrorContextBase {
  statusCode: number;
  rawXml: string;
  globalTransactionId?: string;
  retryable: boolean;
}

export type EetProtocolErrorContext =
  | (EetProtocolErrorContextBase & {
      kind: "soap-fault";
      fault: EetSoapFault;
    })
  | (EetProtocolErrorContextBase & {
      kind: "http-error";
    })
  | (EetProtocolErrorContextBase & {
      kind: "malformed-response";
      path?: string;
    });

export class EetProtocolError extends Error {
  readonly context: EetProtocolErrorContext;

  constructor(
    message: string,
    context: EetProtocolErrorContext,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EetProtocolError";
    this.context = context;
  }
}

export function parseEetResponse(
  response: Readonly<EetTransportResponse>,
): EetSubmissionResult {
  const metadata = responseMetadata(response);
  let message: ResponseMessage | undefined;

  try {
    message = inspectResponseXml(response.body);

    if (message?.kind === "odpoved") {
      return decodeOdpoved(message.element, metadata);
    }

    if (message?.kind === "soap-fault") {
      return decodeSoapFault(message.element, metadata);
    }
  } catch (error) {
    if (error instanceof EetProtocolError) {
      throw error;
    }

    if (!isSuccessfulStatus(response.statusCode)) {
      throw httpError(metadata, error);
    }

    throw malformedResponseError(metadata, error);
  }

  if (!isSuccessfulStatus(response.statusCode)) {
    throw httpError(metadata);
  }

  throw malformedResponseError(
    metadata,
    new MalformedResponse(
      "EET response does not contain Odpoved or SOAP Fault",
    ),
  );
}

interface ResponseMetadata {
  statusCode: number;
  rawXml: string;
  globalTransactionId?: string;
}

type ResponseMessage =
  | { kind: "odpoved"; element: Element }
  | { kind: "soap-fault"; element: Element };

class MalformedResponse extends Error {
  readonly path?: string;

  constructor(message: string, path?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MalformedResponse";
    this.path = path;
  }
}

function responseMetadata(
  response: Readonly<EetTransportResponse>,
): ResponseMetadata {
  const globalTransactionId = getGlobalTransactionId(response.headers);

  return {
    statusCode: response.statusCode,
    rawXml: response.body,
    ...(globalTransactionId === undefined ? {} : { globalTransactionId }),
  };
}

function inspectResponseXml(body: string): ResponseMessage | undefined {
  const document = parseXml(body);
  const root = document.documentElement;

  if (root === null) {
    throw malformed("EET response does not contain a document element");
  }

  if (matches(root, EET_SCHEMA_NAMESPACE, "Odpoved")) {
    return { kind: "odpoved", element: root };
  }

  if (!matches(root, SOAP_ENV_NAMESPACE, "Envelope")) {
    return undefined;
  }

  const bodyElement = oneChild(
    root,
    SOAP_ENV_NAMESPACE,
    "Body",
    "Envelope.Body",
  );
  const responses = children(bodyElement, EET_SCHEMA_NAMESPACE, "Odpoved");
  const faults = children(bodyElement, SOAP_ENV_NAMESPACE, "Fault");

  if (responses.length > 1) {
    throw malformed(
      "SOAP Body contains multiple EET responses",
      "Envelope.Body.Odpoved",
    );
  }

  if (faults.length > 1) {
    throw malformed(
      "SOAP Body contains multiple faults",
      "Envelope.Body.Fault",
    );
  }

  if (responses.length === 1 && faults.length === 1) {
    throw malformed(
      "SOAP Body contains both Odpoved and Fault",
      "Envelope.Body",
    );
  }

  if (responses[0]) {
    return { kind: "odpoved", element: responses[0] };
  }

  if (faults[0]) {
    return { kind: "soap-fault", element: faults[0] };
  }

  return undefined;
}

function parseXml(body: string): Document {
  try {
    return xmlParser.parseFromString(body, "application/xml");
  } catch (cause) {
    throw malformed("EET response is not well-formed XML", undefined, cause);
  }
}

function decodeOdpoved(
  element: Element,
  metadata: ResponseMetadata,
): EetSubmissionResult {
  const headers = children(element, EET_SCHEMA_NAMESPACE, "Hlavicka");
  const confirmations = children(element, EET_SCHEMA_NAMESPACE, "Potvrzeni");
  const errors = children(element, EET_SCHEMA_NAMESPACE, "Chyba");

  if (headers.length > 1) {
    throw malformed(
      "Odpoved contains multiple Hlavicka elements",
      "Odpoved.Hlavicka",
    );
  }

  if (confirmations.length > 1) {
    throw malformed(
      "Odpoved contains multiple Potvrzeni elements",
      "Odpoved.Potvrzeni",
    );
  }

  if (errors.length > 1) {
    throw malformed(
      "Odpoved contains multiple Chyba elements",
      "Odpoved.Chyba",
    );
  }

  if (confirmations.length === 1 && errors.length === 1) {
    throw malformed("Odpoved contains both Potvrzeni and Chyba", "Odpoved");
  }

  const warnings = parseWarnings(element);

  if (confirmations[0]) {
    const header = requireOnly(
      headers,
      "Odpoved must contain one Hlavicka",
      "Odpoved.Hlavicka",
    );
    const confirmation = confirmations[0];
    const uuid = matchValue(
      requiredAttribute(header, "uuid_zpravy", "Odpoved.Hlavicka.uuid_zpravy"),
      EET_REGEX.uuid,
      "Odpoved.Hlavicka.uuid_zpravy",
      "Invalid response UUID",
    );
    const receivedAt = validDateTime(
      requiredAttribute(header, "dat_prij", "Odpoved.Hlavicka.dat_prij"),
      "Odpoved.Hlavicka.dat_prij",
    );
    const pok = matchValue(
      requiredAttribute(confirmation, "pok", "Odpoved.Potvrzeni.pok"),
      EET_REGEX.pok,
      "Odpoved.Potvrzeni.pok",
      "Invalid POK",
    );

    return {
      status: "accepted",
      uuid,
      pok,
      receivedAt,
      test: parseBooleanAttribute(
        confirmation,
        "test",
        "Odpoved.Potvrzeni.test",
      ),
      warnings,
      ...resultMetadata(metadata),
    };
  }

  if (errors[0]) {
    return decodeChyba(headers[0], errors[0], warnings, metadata);
  }

  throw malformed("Odpoved does not contain Potvrzeni or Chyba", "Odpoved");
}

function decodeChyba(
  header: Element | undefined,
  error: Element,
  warnings: EetWarning[],
  metadata: ResponseMetadata,
): EetSubmissionResult {
  const code = parseIntegerAttribute(
    error,
    "kod",
    "Odpoved.Chyba.kod",
    /^-?\d{1,3}$/,
  );
  const message = requiredText(error, "Odpoved.Chyba");
  const uuid = optionalValidatedAttribute(
    header,
    "uuid_zpravy",
    EET_REGEX.uuid,
    "Odpoved.Hlavicka.uuid_zpravy",
  );
  const rejectedAt = optionalDateTimeAttribute(
    header,
    "dat_odmit",
    "Odpoved.Hlavicka.dat_odmit",
  );
  const base = {
    ...(uuid === undefined ? {} : { uuid }),
    ...(rejectedAt === undefined ? {} : { rejectedAt }),
    test: parseBooleanAttribute(error, "test", "Odpoved.Chyba.test"),
    warnings,
    ...resultMetadata(metadata),
  };

  return code === 0
    ? { status: "verification-ok", ...base, code, message }
    : {
        status: "rejected",
        ...base,
        code,
        message,
        retryable: isRetryableEetError(code),
      };
}

function decodeSoapFault(element: Element, metadata: ResponseMetadata): never {
  const codeElement = oneFaultChild(
    element,
    "faultcode",
    "Envelope.Body.Fault.faultcode",
  );
  const code = requiredText(codeElement, "Envelope.Body.Fault.faultcode");
  const message = requiredText(
    oneFaultChild(element, "faultstring", "Envelope.Body.Fault.faultstring"),
    "Envelope.Body.Fault.faultstring",
  );
  const actorElement = optionalFaultChild(
    element,
    "faultactor",
    "Envelope.Body.Fault.faultactor",
  );
  const actor =
    actorElement === undefined
      ? undefined
      : requiredText(actorElement, "Envelope.Body.Fault.faultactor");

  throw new EetProtocolError(`EET SOAP fault: ${message}`, {
    kind: "soap-fault",
    ...metadata,
    retryable: isRetryableSoapFault(code, codeElement),
    fault: {
      code,
      message,
      ...(actor === undefined ? {} : { actor }),
    },
  });
}

function parseWarnings(element: Element): EetWarning[] {
  return children(element, EET_SCHEMA_NAMESPACE, "Varovani").map((warning) => {
    const code = parseIntegerAttribute(
      warning,
      "kod_varov",
      "Odpoved.Varovani.kod_varov",
      /^[1-9]\d{0,2}$/,
    );
    const message = requiredText(warning, "Odpoved.Varovani");
    const knownMessage = EET_WARNING_MESSAGES[code];

    return {
      code,
      message,
      ...(knownMessage === undefined ? {} : { knownMessage }),
    };
  });
}

function resultMetadata(metadata: ResponseMetadata) {
  return {
    ...(metadata.globalTransactionId === undefined
      ? {}
      : { globalTransactionId: metadata.globalTransactionId }),
    rawXml: metadata.rawXml,
  };
}

function childElements(parent: Element): Element[] {
  const result: Element[] = [];

  for (
    let node: Node | null = parent.firstChild;
    node !== null;
    node = node.nextSibling
  ) {
    if (node.nodeType === node.ELEMENT_NODE) {
      result.push(node as Element);
    }
  }

  return result;
}

function children(
  parent: Element,
  namespace: string,
  localName: string,
): Element[] {
  return childElements(parent).filter((element) =>
    matches(element, namespace, localName),
  );
}

function matches(
  element: Element,
  namespace: string,
  localName: string,
): boolean {
  return element.namespaceURI === namespace && element.localName === localName;
}

function oneChild(
  parent: Element,
  namespace: string,
  localName: string,
  path: string,
): Element {
  return requireOnly(
    children(parent, namespace, localName),
    `Expected one ${localName} element`,
    path,
  );
}

function oneFaultChild(
  parent: Element,
  localName: string,
  path: string,
): Element {
  return requireOnly(
    faultChildren(parent, localName),
    `Expected one ${localName} element`,
    path,
  );
}

function optionalFaultChild(
  parent: Element,
  localName: string,
  path: string,
): Element | undefined {
  const elements = faultChildren(parent, localName);
  if (elements.length > 1) {
    throw malformed(`Expected at most one ${localName} element`, path);
  }

  return elements[0];
}

function faultChildren(parent: Element, localName: string): Element[] {
  return childElements(parent).filter(
    (element) =>
      element.localName === localName &&
      (element.namespaceURI === null ||
        element.namespaceURI === SOAP_ENV_NAMESPACE),
  );
}

function requireOnly(
  elements: Element[],
  message: string,
  path: string,
): Element {
  if (elements.length !== 1) {
    throw malformed(message, path);
  }

  return elements[0]!;
}

function requiredAttribute(
  element: Element,
  name: string,
  path: string,
): string {
  if (!element.hasAttribute(name)) {
    throw malformed(`Missing ${name} attribute`, path);
  }

  const value = element.getAttribute(name);
  if (value === null || value.length === 0) {
    throw malformed(`${name} must not be empty`, path);
  }

  return value;
}

function optionalValidatedAttribute(
  element: Element | undefined,
  name: string,
  pattern: RegExp,
  path: string,
): string | undefined {
  if (!element?.hasAttribute(name)) {
    return undefined;
  }

  const value = element.getAttribute(name) ?? "";
  return matchValue(value, pattern, path, `Invalid ${name}`);
}

function optionalDateTimeAttribute(
  element: Element | undefined,
  name: string,
  path: string,
): string | undefined {
  if (!element?.hasAttribute(name)) {
    return undefined;
  }

  return validDateTime(element.getAttribute(name) ?? "", path);
}

function parseBooleanAttribute(
  element: Element,
  name: string,
  path: string,
): boolean {
  if (!element.hasAttribute(name)) {
    return false;
  }

  const value = element.getAttribute(name);
  if (value === "true" || value === "1") {
    return true;
  }
  if (value === "false" || value === "0") {
    return false;
  }

  throw malformed(`${name} must be an XML boolean`, path);
}

function parseIntegerAttribute(
  element: Element,
  name: string,
  path: string,
  pattern: RegExp,
): number {
  const value = requiredAttribute(element, name, path);
  if (!pattern.test(value)) {
    throw malformed(`${name} must be an integer`, path);
  }

  return Number(value);
}

function requiredText(element: Element, path: string): string {
  let text = "";

  for (
    let node: Node | null = element.firstChild;
    node !== null;
    node = node.nextSibling
  ) {
    if (
      node.nodeType === node.TEXT_NODE ||
      node.nodeType === node.CDATA_SECTION_NODE
    ) {
      text += node.nodeValue ?? "";
    }
  }

  const value = text.trim();
  if (value.length === 0) {
    throw malformed("Element text must not be empty", path);
  }

  return value;
}

function matchValue(
  value: string,
  pattern: RegExp,
  path: string,
  message: string,
): string {
  if (!pattern.test(value)) {
    throw malformed(message, path);
  }

  return value;
}

function validDateTime(value: string, path: string): string {
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|([+\-])(\d{2}):(\d{2}))$/.exec(
      value,
    );

  if (!parts) {
    throw malformed("Invalid EET date-time", path);
  }

  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const hour = Number(parts[4]);
  const minute = Number(parts[5]);
  const second = Number(parts[6]);
  const offsetHour = parts[7] === "Z" ? 0 : Number(parts[9]);
  const offsetMinute = parts[7] === "Z" ? 0 : Number(parts[10]);
  const daysInMonth = month >= 1 && month <= 12 ? monthLength(year, month) : 0;

  if (
    year === 0 ||
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0)
  ) {
    throw malformed("Invalid EET date-time", path);
  }

  return value;
}

function monthLength(year: number, month: number): number {
  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leapYear ? 29 : 28;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function malformed(
  message: string,
  path?: string,
  cause?: unknown,
): MalformedResponse {
  return new MalformedResponse(
    message,
    path,
    cause === undefined ? undefined : { cause },
  );
}

function malformedResponseError(
  metadata: ResponseMetadata,
  cause?: unknown,
): EetProtocolError {
  const malformedCause = cause instanceof MalformedResponse ? cause : undefined;

  return new EetProtocolError(
    malformedCause?.message ?? "Malformed EET response",
    {
      kind: "malformed-response",
      ...metadata,
      retryable: false,
      ...(malformedCause?.path === undefined
        ? {}
        : { path: malformedCause.path }),
    },
    cause === undefined ? undefined : { cause },
  );
}

function httpError(
  metadata: ResponseMetadata,
  cause?: unknown,
): EetProtocolError {
  return new EetProtocolError(
    `EET HTTP request failed with status ${metadata.statusCode}`,
    {
      kind: "http-error",
      ...metadata,
      retryable: isRetryableHttpStatus(metadata.statusCode),
    },
    cause === undefined ? undefined : { cause },
  );
}

function isSuccessfulStatus(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 300;
}

function isRetryableSoapFault(code: string, codeElement: Element): boolean {
  const match =
    /^(?:(?<prefix>[A-Za-z_][\w.-]*):)?(?<local>[A-Za-z_][\w.-]*)$/.exec(code);
  if (match?.groups === undefined) {
    return false;
  }

  const namespace = codeElement.lookupNamespaceURI(match.groups.prefix ?? null);
  return (
    namespace === SOAP_ENV_NAMESPACE &&
    (match.groups.local === "Server" || match.groups.local === "Receiver")
  );
}

function getGlobalTransactionId(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
): string | undefined {
  const value = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === "x-global-transaction-id",
  )?.[1];
  const first = Array.isArray(value)
    ? value.find((item) => item.length > 0)
    : value;
  return typeof first === "string" && first.length > 0 ? first : undefined;
}

function isRetryableHttpStatus(statusCode: number): boolean {
  return (
    statusCode === 408 ||
    statusCode === 425 ||
    statusCode === 429 ||
    (statusCode >= 500 && statusCode < 600)
  );
}
