/**
 * Date parsing utilities for the artworks catalog.
 *
 * Source dates come from the Art Cloud CSVs as free-form strings:
 * "1992", "ND", "c. 1990", "7/20/1987", "1985-1990", etc. We need
 * to derive a year for the decade dropdown (Project B) and the
 * triage report's date_range aggregation (this PR).
 */

const MIN_PLAUSIBLE_YEAR = 1900;
const MAX_PLAUSIBLE_YEAR = new Date().getFullYear() + 1;

/**
 * Extract a four-digit year from a free-form date string.
 *
 * Rules:
 * - Returns null for null, empty, "ND" (case-insensitive), or any
 *   string with no four-digit substring.
 * - Returns the FIRST four-digit year found in the string.
 * - Years outside [MIN_PLAUSIBLE_YEAR, MAX_PLAUSIBLE_YEAR] are
 *   rejected as null (filters out things like "0042" or accidental
 *   inventory numbers that look like years).
 */
export function extractYear(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === "nd") return null;

  const match = trimmed.match(/\d{4}/);
  if (!match) return null;

  const year = parseInt(match[0], 10);
  if (year < MIN_PLAUSIBLE_YEAR || year > MAX_PLAUSIBLE_YEAR) return null;
  return year;
}
