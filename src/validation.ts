import { normalizeAmountInput, type AmountInput } from "./amount.ts";
import { ASCII_XML_VALUE_REGEX, EET_REGEX } from "./constants.ts";
import { eetDateTime } from "./datetime.ts";
import type {
  NormalizedSale,
  RegisterSaleInput,
  ValidationIssue,
} from "./types.ts";
import { EetValidationError } from "./types.ts";

export interface NormalizeSaleOptions {
  taxpayer: { eic: string };
  verification: boolean;
  now: () => Date;
  uuid: () => string;
}

interface NormalizedValue<T> {
  value: T;
  issues: ValidationIssue[];
}

export function normalizeSale(
  input: RegisterSaleInput,
  options: NormalizeSaleOptions,
): NormalizedSale {
  const submittedAt = normalizeDateTime(
    "submittedAt",
    input.submittedAt ?? options.now(),
  );
  const occurredAt = normalizeDateTime("occurredAt", input.occurredAt);
  const totalAmount = normalizeAmount("totalAmount", input.totalAmount);
  const intendedForSettlementAmount =
    input.intendedForSettlementAmount === undefined
      ? undefined
      : normalizeAmount(
          "intendedForSettlementAmount",
          input.intendedForSettlementAmount,
        );
  const settledAmount =
    input.settledAmount === undefined
      ? undefined
      : normalizeAmount("settledAmount", input.settledAmount);

  const normalized: NormalizedSale = {
    uuid: input.messageUuid ?? options.uuid(),
    submittedAt: submittedAt.value,
    firstSubmission: input.firstSubmission ?? true,
    verification: options.verification,
    taxpayerEic: input.taxpayerEic ?? options.taxpayer.eic,
    unitId: String(input.cashRegister.unitId),
    cashRegisterId: input.cashRegister.id,
    receiptNumber: input.receiptNumber,
    occurredAt: occurredAt.value,
    totalAmount: totalAmount.value,
    ...(input.authorizingTaxpayerEic === undefined
      ? {}
      : { authorizingTaxpayerEic: input.authorizingTaxpayerEic }),
    ...(input.multipleTaxpayersAuthorization === undefined
      ? {}
      : {
          multipleTaxpayersAuthorization: input.multipleTaxpayersAuthorization,
        }),
    ...(intendedForSettlementAmount === undefined
      ? {}
      : { intendedForSettlementAmount: intendedForSettlementAmount.value }),
    ...(settledAmount === undefined
      ? {}
      : { settledAmount: settledAmount.value }),
  };

  const issues = [
    ...submittedAt.issues,
    ...occurredAt.issues,
    ...totalAmount.issues,
    ...(intendedForSettlementAmount?.issues ?? []),
    ...(settledAmount?.issues ?? []),
    ...getSaleIssues(normalized),
  ];

  if (issues.length > 0) {
    throw new EetValidationError(issues);
  }

  return normalized;
}

export function validateSale(sale: NormalizedSale): void {
  const issues = getSaleIssues(sale);

  if (issues.length > 0) {
    throw new EetValidationError(issues);
  }
}

export function getAdvisoryIssues(sale: NormalizedSale): ValidationIssue[] {
  return [
    ...(/^\d{2,}[1234]$/.test(sale.unitId)
      ? []
      : [
          {
            path: "unitId",
            message:
              "expected MOJE Dane format is at least two digits ending in 1, 2, 3, or 4",
          },
        ]),
    ...(sale.authorizingTaxpayerEic !== undefined &&
    sale.authorizingTaxpayerEic === sale.taxpayerEic
      ? [
          {
            path: "authorizingTaxpayerEic",
            message: "should differ from taxpayerEic",
          },
        ]
      : []),
  ];
}

function getSaleIssues(sale: NormalizedSale): ValidationIssue[] {
  return [
    ...matchIssue(
      "uuid",
      sale.uuid,
      EET_REGEX.uuid,
      "must be an RFC 9562 UUID version 1-5",
    ),
    ...matchIssue(
      "submittedAt",
      sale.submittedAt,
      EET_REGEX.dateTime,
      "must be ISO 8601 with timezone offset",
    ),
    ...matchIssue(
      "taxpayerEic",
      sale.taxpayerEic,
      EET_REGEX.eic,
      "must match CZ followed by 8 to 10 digits",
    ),
    ...matchIssue(
      "unitId",
      sale.unitId,
      EET_REGEX.idJednotky,
      "must be an integer from 1 to 999999999 without leading zeroes",
    ),
    ...matchIssue(
      "cashRegisterId",
      sale.cashRegisterId,
      EET_REGEX.string20,
      "must be 1 to 20 allowed ASCII characters",
    ),
    ...matchIssue(
      "receiptNumber",
      sale.receiptNumber,
      EET_REGEX.string25,
      "must be 1 to 25 allowed ASCII characters",
    ),
    ...matchIssue(
      "occurredAt",
      sale.occurredAt,
      EET_REGEX.dateTime,
      "must be ISO 8601 with timezone offset",
    ),
    ...matchIssue(
      "totalAmount",
      sale.totalAmount,
      EET_REGEX.amount,
      "must be a valid amount with exactly two decimals",
    ),
    ...(sale.authorizingTaxpayerEic === undefined
      ? []
      : matchIssue(
          "authorizingTaxpayerEic",
          sale.authorizingTaxpayerEic,
          EET_REGEX.eic,
          "must match CZ followed by 8 to 10 digits",
        )),
    ...(sale.intendedForSettlementAmount === undefined
      ? []
      : matchIssue(
          "intendedForSettlementAmount",
          sale.intendedForSettlementAmount,
          EET_REGEX.amount,
          "must be a valid amount with exactly two decimals",
        )),
    ...(sale.settledAmount === undefined
      ? []
      : matchIssue(
          "settledAmount",
          sale.settledAmount,
          EET_REGEX.amount,
          "must be a valid amount with exactly two decimals",
        )),
    ...asciiIssues(sale),
  ];
}

function matchIssue(
  path: string,
  value: string,
  pattern: RegExp,
  message: string,
): ValidationIssue[] {
  return [
    ...(value.length === 0 ? [{ path, message: "must not be empty" }] : []),
    ...(pattern.test(value) ? [] : [{ path, message }]),
  ];
}

function asciiIssues(sale: NormalizedSale): ValidationIssue[] {
  return Object.entries(sale)
    .filter(
      (entry): entry is [string, string | boolean] => entry[1] !== undefined,
    )
    .flatMap(([path, value]) =>
      ASCII_XML_VALUE_REGEX.test(String(value))
        ? []
        : [{ path, message: "must only contain allowed ASCII XML characters" }],
    );
}

function normalizeDateTime(
  path: string,
  value: string | Date,
): NormalizedValue<string> {
  const normalized =
    value instanceof Date && !Number.isNaN(value.getTime())
      ? eetDateTime(value)
      : String(value);

  return EET_REGEX.dateTime.test(normalized)
    ? { value: normalized, issues: [] }
    : {
        value: normalized,
        issues: [{ path, message: `Invalid EET date-time: ${normalized}` }],
      };
}

function normalizeAmount(
  path: string,
  value: AmountInput,
): NormalizedValue<string> {
  const amount = normalizeAmountInput(value);

  return amount.valid
    ? { value: amount.value, issues: [] }
    : {
        value: amount.value,
        issues: [{ path, message: `Invalid EET amount: ${amount.value}` }],
      };
}
