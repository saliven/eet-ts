import { describe, expect, it } from "vitest";
import type { NormalizedSale } from "../src/types.ts";
import { buildTrzbaXml, buildUnsignedSoapEnvelope } from "../src/xml.ts";

const sale: NormalizedSale = {
  uuid: "e23e5a5a-08d7-4a08-844d-2b6c6b60621d",
  submittedAt: "2027-01-08T21:19:40+01:00",
  firstSubmission: true,
  verification: false,
  taxpayerEic: "CZ8551015704",
  authorizingTaxpayerEic: "CZ00000019",
  multipleTaxpayersAuthorization: true,
  unitId: "181",
  cashRegisterId: "00/2535/CN58",
  receiptNumber: "0/2482/IE25",
  occurredAt: "2027-01-07T22:01:00+01:00",
  totalAmount: "87988.00",
  intendedForSettlementAmount: "343.00",
  settledAmount: "237.00",
};

describe("buildTrzbaXml", () => {
  it("builds operational Trzba XML and omits verification", () => {
    expect(buildTrzbaXml(sale)).toBe(
      '<tns:Trzba xmlns:tns="http://fs.gov.cz/eet/schema/v4"><tns:Hlavicka uuid_zpravy="e23e5a5a-08d7-4a08-844d-2b6c6b60621d" dat_odesl="2027-01-08T21:19:40+01:00" prvni_zaslani="true"/><tns:Data eic_popl="CZ8551015704" eic_poverujiciho="CZ00000019" povereni_vice_popl="true" id_jednotky="181" id_pokl="00/2535/CN58" porad_cis="0/2482/IE25" dat_trzby="2027-01-07T22:01:00+01:00" celk_trzba="87988.00" urceno_cerp_zuct="343.00" cerp_zuct="237.00"/></tns:Trzba>',
    );
  });

  it("adds verification flag when requested", () => {
    expect(buildTrzbaXml({ ...sale, verification: true })).toContain('overeni="true"');
  });
});

describe("buildUnsignedSoapEnvelope", () => {
  it("wraps body XML in SOAP 1.1 envelope", () => {
    const xml = buildUnsignedSoapEnvelope("<tns:Trzba />", "Body-1");

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<soap:Body wsu:Id="Body-1"><tns:Trzba/></soap:Body>');
    expect(xml).toContain('<wsse:Security soap:mustUnderstand="1"/>');
  });
});
