import { EET_REGEX } from "./constants.ts";

export function eetDateTime(value: string | Date): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error("Invalid EET date-time: invalid Date");
    }

    return value.toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  if (!EET_REGEX.dateTime.test(value)) {
    throw new Error(`Invalid EET date-time: ${value}`);
  }

  return value;
}
