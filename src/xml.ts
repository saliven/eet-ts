import XMLBuilder from "fast-xml-builder";
import { XMLParser } from "fast-xml-parser";
import {
  EET_SCHEMA_NAMESPACE,
  SOAP_ENV_NAMESPACE,
  WSSE_NAMESPACE,
  WSU_NAMESPACE,
} from "./constants.ts";
import type { NormalizedSale } from "./types.ts";

type XmlRecord = Record<string, unknown>;

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  format: false,
  suppressBooleanAttributes: false,
  suppressEmptyNode: true,
});

const bodyParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
});

const isXmlRecord = (value: unknown): value is XmlRecord =>
  typeof value === "object" && value !== null;

export function buildTrzbaXml(sale: NormalizedSale): string {
  return xmlBuilder.build({
    "tns:Trzba": {
      "@_xmlns:tns": EET_SCHEMA_NAMESPACE,
      "tns:Hlavicka": {
        "@_uuid_zpravy": sale.uuid,
        "@_dat_odesl": sale.submittedAt,
        "@_prvni_zaslani": String(sale.firstSubmission),
        ...(sale.verification ? { "@_overeni": "true" } : {}),
      },
      "tns:Data": {
        "@_eic_popl": sale.taxpayerEic,
        ...(sale.authorizingTaxpayerEic === undefined
          ? {}
          : { "@_eic_poverujiciho": sale.authorizingTaxpayerEic }),
        ...(sale.multipleTaxpayersAuthorization === undefined
          ? {}
          : {
              "@_povereni_vice_popl": String(
                sale.multipleTaxpayersAuthorization,
              ),
            }),
        "@_id_jednotky": sale.unitId,
        "@_id_pokl": sale.cashRegisterId,
        "@_porad_cis": sale.receiptNumber,
        "@_dat_trzby": sale.occurredAt,
        "@_celk_trzba": sale.totalAmount,
        ...(sale.intendedForSettlementAmount === undefined
          ? {}
          : { "@_urceno_cerp_zuct": sale.intendedForSettlementAmount }),
        ...(sale.settledAmount === undefined
          ? {}
          : { "@_cerp_zuct": sale.settledAmount }),
      },
    },
  });
}

export function buildUnsignedSoapEnvelope(
  bodyXml: string,
  bodyId: string,
): string {
  const body = bodyParser.parse(bodyXml);

  if (!isXmlRecord(body)) {
    throw new Error("SOAP body XML must be an object element");
  }

  return `<?xml version="1.0" encoding="UTF-8"?>${xmlBuilder.build({
    "soap:Envelope": {
      "@_xmlns:soap": SOAP_ENV_NAMESPACE,
      "@_xmlns:wsse": WSSE_NAMESPACE,
      "@_xmlns:wsu": WSU_NAMESPACE,
      "soap:Header": {
        "wsse:Security": { "@_soap:mustUnderstand": "1" },
      },
      "soap:Body": {
        "@_wsu:Id": bodyId,
        ...body,
      },
    },
  })}`;
}
