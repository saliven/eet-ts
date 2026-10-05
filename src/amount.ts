import { EET_REGEX } from "./constants.ts";

export type AmountInput = string | number;

export interface NormalizedAmountInput {
  value: string;
  valid: boolean;
}

export const normalizeAmountInput = (
  value: AmountInput,
): NormalizedAmountInput => {
  if (typeof value === "string") {
    return { value, valid: EET_REGEX.amount.test(value) };
  }

  if (!Number.isInteger(value) || Math.abs(value) >= 10_000_000_000) {
    return { value: String(value), valid: false };
  }

  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const crowns = Math.floor(absolute / 100);
  const cents = String(absolute % 100).padStart(2, "0");
  const amount = `${sign}${crowns}.${cents}`;

  return {
    value: amount,
    valid: EET_REGEX.amount.test(amount),
  };
};
