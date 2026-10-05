export const EET_ERROR_MESSAGES: Record<number, string> = {
  [-1]: "Docasna technicka chyba zpracovani - odeslete prosim datovou zpravu pozdeji",
  0: "Datovou zpravu evidovane trzby v overovacim modu se podarilo zpracovat",
  2: "Kodovani XML neni platne",
  3: "XML zprava nevyhovela kontrole XML schematu",
  4: "Neplatny podpis SOAP zpravy",
  6: "EICpoplatnika ma chybnou strukturu",
  7: "Datova zprava je prilis velka",
  8: "Datova zprava nebyla zpracovana kvuli technicke chybe nebo chybe dat",
};

export const EET_WARNING_MESSAGES: Record<number, string> = {
  1: "EIC poplatnika v datove zprave se neshoduje s EIC v certifikatu",
  2: "Chybny format EIC poverujiciho poplatnika",
  4: "The date and time of the transaction are later than the date and time the message was received.",
  5: "The date and time of transaction is far in the past",
  6: "The registrating unit identifier (id_jednotky) does not match the expected format",
  7: "The EIC of the authorizing taxpayer matches the EIC of the reporting taxpayer",
};

export function isRetryableEetError(code: number): boolean {
  return code < 0 || code === 8;
}
