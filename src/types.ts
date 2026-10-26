import type { AmountInput } from "./amount.ts";
import type { EetCashRegister } from "./cash-register.ts";
import type { EetCertificate } from "./certificate.ts";
import type { Environment, SubmissionStatus } from "./constants.ts";
import type { EetTaxpayer } from "./taxpayer.ts";

export type InferObjectValues<T> = T[keyof T];

export interface EetCustomEnvironment {
  endpoint: string;
  test?: boolean;
}

export type EetEnvironmentInput = Environment | EetCustomEnvironment;

export interface EetClientOptions {
  environment: EetEnvironmentInput;
  taxpayer?: EetTaxpayer;
  timeoutMs?: number;
  transport?: EetTransport;
  signer?: EetSigner;
  now?: () => Date;
  uuid?: () => string;
}

export interface EetRequestOptions {
  taxpayer?: EetTaxpayer;
}

export interface BuildSignedRequestOptions extends EetRequestOptions {
  verification?: boolean;
}

export interface RegisterSaleInput {
  cashRegister: EetCashRegister;
  receiptNumber: string;
  occurredAt: string | Date;
  totalAmount: AmountInput;
  firstSubmission?: boolean;
  messageUuid?: string;
  submittedAt?: string | Date;
  taxpayerEic?: string;
  authorizingTaxpayerEic?: string;
  multipleTaxpayersAuthorization?: boolean;
  intendedForSettlementAmount?: AmountInput;
  settledAmount?: AmountInput;
}

export interface NormalizedSale {
  uuid: string;
  submittedAt: string;
  firstSubmission: boolean;
  verification: boolean;
  taxpayerEic: string;
  authorizingTaxpayerEic?: string;
  multipleTaxpayersAuthorization?: boolean;
  unitId: string;
  cashRegisterId: string;
  receiptNumber: string;
  occurredAt: string;
  totalAmount: string;
  intendedForSettlementAmount?: string;
  settledAmount?: string;
}

export interface SignedEetRequest {
  xml: string;
  uuid: string;
  endpoint: string;
  soapAction: string;
}

export interface EetTransportRequest {
  endpoint: string;
  soapAction: string;
  xml: string;
  timeoutMs?: number;
}

export interface EetTransportResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

export interface EetTransport {
  send(request: EetTransportRequest): Promise<EetTransportResponse>;
}

export interface EetSigner {
  sign(
    unsignedEnvelope: string,
    certificate: EetCertificate,
  ): Promise<string> | string;
}

export interface EetWarning {
  code: number;
  message: string;
  knownMessage?: string;
}

export type EetSubmissionResult =
  | {
      status: typeof SubmissionStatus.Accepted;
      uuid: string;
      pok: string;
      receivedAt: string;
      test: boolean;
      warnings: EetWarning[];
      globalTransactionId?: string;
      rawXml: string;
    }
  | {
      status: typeof SubmissionStatus.VerificationOk;
      uuid?: string;
      code: 0;
      message: string;
      rejectedAt?: string;
      test: boolean;
      warnings: EetWarning[];
      globalTransactionId?: string;
      rawXml: string;
    }
  | {
      status: typeof SubmissionStatus.Rejected;
      uuid?: string;
      code: number;
      message: string;
      rejectedAt?: string;
      retryable: boolean;
      test: boolean;
      warnings: EetWarning[];
      globalTransactionId?: string;
      rawXml: string;
    };

export interface ValidationIssue {
  path: string;
  message: string;
}

export class EetValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "EetValidationError";
    this.issues = issues;
  }
}

export class EetTransportError extends Error {
  readonly retryable = true;
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "EetTransportError";
    this.cause = cause;
  }
}
