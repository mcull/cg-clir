/**
 * Theme taxonomy — a fixed set of curated subject tags imported from
 * the 1stDibs CSV. See:
 *   docs/superpowers/specs/2026-04-23-archive-import-design.md
 *
 * In the source CSV, themes appear as comma-separated strings with a
 * "clir " or "clear " prefix (the prefix is inconsistent in the data).
 * normalizeThemes strips the prefix, lowercases, dedupes, and drops
 * anything outside VALID_THEMES.
 */

export const VALID_THEMES = new Set([
  "music",
  "people",
  "plants",
  "animals",
  "abstract",
  "other",
  "food",
  "pop culture",
]);

export function normalizeThemes(raw: string): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const piece of raw.split(",")) {
    const trimmed = piece.trim().toLowerCase();
    if (!trimmed) continue;

    // Strip leading "clir " or "clear " prefix
    const stripped = trimmed
      .replace(/^clir\s+/, "")
      .replace(/^clear\s+/, "");

    if (!VALID_THEMES.has(stripped)) continue;
    if (seen.has(stripped)) continue;

    seen.add(stripped);
    result.push(stripped);
  }

  return result;
}
