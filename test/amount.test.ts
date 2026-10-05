import { describe, expect, it } from "vitest";
import { normalizeAmountInput } from "../src/amount.ts";

describe("normalizeAmountInput", () => {
  it("accepts valid EET amount strings", () => {
    expect(normalizeAmountInput("250.00")).toEqual({ value: "250.00", valid: true });
    expect(normalizeAmountInput("-187.20")).toEqual({ value: "-187.20", valid: true });
    expect(normalizeAmountInput("0.56")).toEqual({ value: "0.56", valid: true });
    expect(normalizeAmountInput("-0.01")).toEqual({ value: "-0.01", valid: true });
  });

  it("formats integer minor-unit numbers as CZK decimal strings", () => {
    expect(normalizeAmountInput(10_000)).toEqual({ value: "100.00", valid: true });
    expect(normalizeAmountInput(25_000)).toEqual({ value: "250.00", valid: true });
    expect(normalizeAmountInput(-18_720)).toEqual({ value: "-187.20", valid: true });
    expect(normalizeAmountInput(56)).toEqual({ value: "0.56", valid: true });
    expect(normalizeAmountInput(-1)).toEqual({ value: "-0.01", valid: true });
  });

  it("rejects invalid values", () => {
    expect(normalizeAmountInput("020.45")).toEqual({ value: "020.45", valid: false });
    expect(normalizeAmountInput("-0.00")).toEqual({ value: "-0.00", valid: false });
    expect(normalizeAmountInput(".20")).toEqual({ value: ".20", valid: false });
    expect(normalizeAmountInput("100000000.00")).toEqual({ value: "100000000.00", valid: false });
    expect(normalizeAmountInput(0.2)).toEqual({ value: "0.2", valid: false });
    expect(normalizeAmountInput(10_000_000_000)).toEqual({ value: "10000000000", valid: false });
  });
});
