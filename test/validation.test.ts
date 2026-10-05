import { describe, expect, it } from "vitest";
import { EetValidationError } from "../src/types.ts";
import { getAdvisoryIssues, normalizeSale } from "../src/validation.ts";

const cashRegister = {
  id: "00/2535/CN58",
  unitId: "181",
};

const options = {
  taxpayer: {
    eic: "CZ8551015704",
  },
  verification: false,
  now: () => new Date("2027-01-08T20:19:40Z"),
  uuid: () => "e23e5a5a-08d7-4a08-844d-2b6c6b60621d",
};

describe("normalizeSale", () => {
  it("normalizes defaults from client options", () => {
    const sale = normalizeSale(
      {
        cashRegister,
        receiptNumber: "0/2482/IE25",
        occurredAt: "2027-01-07T22:01:00+01:00",
        totalAmount: 8_798_800,
      },
      options,
    );

    expect(sale).toMatchObject({
      uuid: "e23e5a5a-08d7-4a08-844d-2b6c6b60621d",
      submittedAt: "2027-01-08T20:19:40Z",
      firstSubmission: true,
      verification: false,
      taxpayerEic: "CZ8551015704",
      unitId: "181",
      cashRegisterId: "00/2535/CN58",
      receiptNumber: "0/2482/IE25",
      occurredAt: "2027-01-07T22:01:00+01:00",
      totalAmount: "87988.00",
    });
  });

  it("rejects schema-invalid fields before signing", () => {
    expect(() =>
      normalizeSale(
        {
          cashRegister,
          receiptNumber: "invalid space and dollar $",
          occurredAt: "2027-01-07T22:01:00",
          totalAmount: "00010.25",
        },
        options,
      ),
    ).toThrow(EetValidationError);
  });

  it("returns advisory warnings for non-critical checks", () => {
    const sale = normalizeSale(
      {
        cashRegister: { id: "00/2535/CN58", unitId: "18" },
        receiptNumber: "1",
        occurredAt: "2027-01-07T22:01:00+01:00",
        totalAmount: 100,
        authorizingTaxpayerEic: "CZ8551015704",
      },
      options,
    );

    expect(getAdvisoryIssues(sale)).toEqual([
      { path: "unitId", message: "expected MOJE Dane format is at least two digits ending in 1, 2, 3, or 4" },
      { path: "authorizingTaxpayerEic", message: "should differ from taxpayerEic" },
    ]);
  });
});
