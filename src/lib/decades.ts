import { extractYear } from "./dates";

/**
 * Bucket a free-form date string into a decade label like "1980s".
 * Returns null for unparseable / out-of-range dates.
 */
export function dateToDecade(raw: string | null): string | null {
  const year = extractYear(raw);
  if (year === null) return null;
  return `${Math.floor(year / 10) * 10}s`;
}

/**
 * Given a list of years, return the sorted unique decade labels they fall into.
 * Used to populate the Decade dropdown options from the data we have.
 */
export function decadeOptions(years: number[]): string[] {
  const set = new Set<string>();
  for (const y of years) {
    set.add(`${Math.floor(y / 10) * 10}s`);
  }
  return [...set].sort();
}
