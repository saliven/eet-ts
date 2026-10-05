import type { EetCertificate } from "./certificate.ts";

export interface EetTaxpayer {
  eic: string;
  certificate: EetCertificate;
}
