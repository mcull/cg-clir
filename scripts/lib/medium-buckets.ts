/**
 * Pure helpers for the medium normalization workflow.
 * - mediumToBuckets: lookup an artwork's medium string in the
 *   normalized bucket map. Returns the array of bucket names the
 *   artwork should be tagged with, or [] if the medium is unknown
 *   or empty.
 * - parseProposedBuckets: parse the semicolon-joined cell from the
 *   Phase 1 CSV (e.g. "Color Stix; Ink; Colored pencil") into an
 *   array of bucket names.
 */

export type BucketMap = Record<string, string[]>;

export function mediumToBuckets(map: BucketMap, medium: string | null): string[] {
  if (medium === null) return [];
  const trimmed = medium.trim();
  if (!trimmed) return [];
  return map[trimmed] || [];
}

export function parseProposedBuckets(cell: string): string[] {
  if (!cell) return [];
  return cell
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
