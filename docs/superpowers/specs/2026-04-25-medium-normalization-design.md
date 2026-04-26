# Medium Normalization & Filter — Design

**Date:** 2026-04-25
**Status:** Ready for implementation

---

## Goal

Add a "Medium" filter dropdown to the public collection browse, backed by a normalized taxonomy of art materials (Ink, Acrylic, Pastel, Ceramic, Wood, etc.). Each artwork can be attached to multiple medium tags reflecting all materials used in its creation. The original free-text `artworks.medium` field (e.g. `"Color Stix, ink, and colored pencil on paper"`) stays untouched as the canonical CDWA "Materials/Techniques Description" for display.

The work has three parts:
1. A **two-phase LLM workflow** that proposes a small bucket vocabulary and a per-medium-string mapping (`tmp/medium-buckets.csv`), reviewed by a human, then applied to the DB.
2. A **persisted lookup map** (`scripts/data/medium-buckets.json`) that future importers consult so newly-imported artworks get the right tags without another LLM call.
3. **UI integration**: a new multi-select Medium dropdown in `FilterBar`, plumbed through `collection-query.ts` the same way Theme and Format already work.

---

## Background: CDWA conventions (the reasoning behind the model)

CDWA — *Categories for the Description of Works of Art* (the Getty's authoritative cataloging standard) — distinguishes:

- **Medium** = the material applied to the work (ink, acrylic, pastel, charcoal, ceramic, …)
- **Support** = the surface it's applied to (paper, canvas, wood panel, …)

Display syntax is "medium on support" — `oil on canvas`, `ink on paper`. CDWA explicitly recommends enumerating individual materials when known rather than lumping into "mixed media" — *"thoroughness and a high level of exhaustivity are preferred over a cursory analysis."*

This spec follows CDWA's enumeration preference: each artwork attaches to every material present, and we expose those materials as a faceted filter. The "medium on support" display string remains intact in `artworks.medium` and is what the artwork detail page already shows.

References:
- [Materials/Techniques — Categories for the Description of Works of Art (Getty)](https://www.getty.edu/publications/categories-description-works-art/categories/object-architecture-group/7/)

---

## Storage

### Reuse the existing categories taxonomy

A new `kind = 'medium'` slice of the `categories` table:

```sql
-- No schema migration needed; existing constraint is permissive enough
-- once we update the application's contract.
-- Add 'medium' to the allowed kinds via:
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_kind_check;
ALTER TABLE categories ADD CONSTRAINT categories_kind_check
  CHECK (kind IN ('format', 'theme', 'medium'));
```

Each medium bucket is a row in `categories` with `kind='medium'`, `name='Acrylic'`, `slug='acrylic'`, etc. Artworks attach via the existing `artwork_categories` many-to-many — same shape as Theme and Format. An artwork can have N medium tags. Cohort + cohort-vs-medium queries plug into the existing `collection-query.ts` pattern with a few additions.

### Why not a separate column

A `normalized_medium TEXT` column on `artworks` would be simpler for a single-tag world but breaks our many-to-many requirement. Categories table reuses every piece of FilterBar / faceted-count infrastructure built for Theme and Format. The choice is consistent.

---

## Bucket taxonomy

**Materials only, ~12–18 buckets, no Support facet, no enumerated "Mixed Media" bucket for hybrids** (an artwork using Acrylic + Ink simply has both tags). One catch-all `"Other"` bucket exists for genuinely-unspecifiable cases.

The exact bucket vocabulary is set during Phase 1 by the LLM proposal + human review. Likely buckets based on the current top-20 mediums:

| Bucket | Examples it would absorb |
|---|---|
| Ink | "Ink on paper", "Pen on paper", "Ink on newspaper", "Ink and watercolor on paper" (also tags Watercolor) |
| Pastel | "Pastel on paper" |
| Oil pastel | "Oil pastel on paper" |
| Color Stix | "Color Stix on paper", "Prismastix on wood" (also tags Wood) |
| Colored pencil | "Colored pencil on paper" |
| Pencil / Graphite | "Graphite, ink and watercolor on paper" (also tags Ink + Watercolor) |
| Marker | "Marker on paper" |
| Acrylic | "Acrylic on paper", "Acrylic on magazine" |
| Watercolor | "Watercolor on paper" |
| Oil paint | "Oil on canvas" |
| Crayon | "Crayon on paper" |
| Charcoal | "Charcoal on paper" |
| Ceramic | "Ceramic" |
| Wood | "Prismastix on wood" |
| Fiber / Yarn | "Wool", "Embroidery thread" |
| Other | catch-all when the LLM can't confidently bucket the input |

Bucket names are exposed verbatim in the dropdown UI. Slugs are kebab-cased (`color-stix`, `oil-paint`).

**Support is intentionally NOT a separate facet for v1.** The existing Format taxonomy (Drawing / Painting / Sculpture / Fiber / etc.) already covers the meaningful 2D-vs-3D distinction. Adding Support as a third axis would surface "Paper" for ~90% of the catalog and add no real signal.

---

## Phase 1: LLM proposal + CSV review

**Script:** `scripts/normalize-mediums-propose.ts`
**npm:** `medium:propose`

1. Query the DB for every distinct `medium` string (with row counts) where `medium IS NOT NULL`.
2. Send the full list (~283 strings) to Claude (`claude-sonnet-4-6`) in a single call. System prompt asks for:
   - a small bucket vocabulary (~12–18 buckets) of pure materials
   - for each input string, an array of bucket names the artwork should be tagged with
   - rationale notes for borderline cases
3. Parse the JSON response. Write `tmp/medium-buckets_<timestamp>.csv` with columns:

   | `medium` | `count` | `proposed_buckets` | `notes` |
   |---|---|---|---|
   | `Ink on paper` | 324 | `Ink` | |
   | `Color Stix, ink, and colored pencil on paper` | 90 | `Color Stix; Ink; Colored pencil` | |
   | `Mixed media on paper` | 65 | `Other` | LLM unable to enumerate |
   | … | | | |

   Multi-bucket assignments are semicolon-joined in the `proposed_buckets` cell so the user can edit in Sheets without CSV escaping pain.

4. Print a summary: bucket vocabulary, count of strings per bucket, count of multi-bucket strings.

The user opens the CSV in Sheets, edits where needed (rename buckets, merge buckets, fix specific assignments, add buckets the LLM missed), saves.

### Edge cases for the proposal

- **Empty / NULL medium**: ~561 artworks. Excluded from the proposal. They stay with no medium category attached. Acceptable — they don't appear in the medium filter.
- **Idempotency**: re-running Phase 1 produces a fresh timestamped CSV; the user picks which to apply.
- **Cost**: one Claude Sonnet call with ~283 strings + ~50-line system prompt → ~$0.05.

---

## Phase 2: Apply to DB

**Script:** `scripts/normalize-mediums-apply.ts`
**npm:** `medium:apply`

Takes one argument: the path to the (possibly-edited) CSV from Phase 1.

1. Parse CSV, build `Map<string, string[]>` of medium → buckets.
2. Validate: every bucket name in `proposed_buckets` is either a known existing `kind='medium'` category or a new bucket to be created. Print the bucket vocabulary detected from the CSV; require user confirmation (`y/N`) before any DB writes.
3. Upsert all bucket categories with `kind='medium'`. Build `Map<bucketName, categoryId>`.
4. Page through every artwork with non-null medium. For each row:
   - Look up the artwork's medium string in the CSV map.
   - Compute the desired set of medium-category IDs.
   - Diff against existing `artwork_categories` rows where `category.kind='medium'`. Add missing, remove extra.
5. Persist `scripts/data/medium-buckets.json` (the verified-clean lookup map) for the importers' use.
6. Write a per-row log to `tmp/medium-apply-log_<timestamp>.csv` with columns: `artwork_id, medium, applied_buckets, status`.

---

## Future imports: persisted lookup

`scripts/data/medium-buckets.json` ships in source control. Shape:

```json
{
  "version": "2026-04-25",
  "buckets": ["Ink", "Pastel", "Oil pastel", "Color Stix", "Colored pencil", "Pencil", "Marker", "Acrylic", "Watercolor", "Oil paint", "Crayon", "Charcoal", "Ceramic", "Wood", "Fiber", "Other"],
  "map": {
    "Ink on paper": ["Ink"],
    "Acrylic on paper": ["Acrylic"],
    "Color Stix, ink, and colored pencil on paper": ["Color Stix", "Ink", "Colored pencil"],
    "Mixed media on paper": ["Other"]
  }
}
```

**Update both importers to consult this map on insert:**

- `scripts/import-csv.ts` — on each artwork row, look up its medium string in `map`. Attach the corresponding medium categories via `artwork_categories`.
- `scripts/import-archive.ts` (Branch B path) — same.

**Unknown medium handling:**
- If a future import has a medium string not in `map`, the script logs a warning to stdout listing the unrecognized strings and the affected artwork SKUs. Those artworks insert with NO medium tag — they won't appear in any medium filter until the next normalization pass.
- The maintainer periodically re-runs Phase 1 to absorb new strings into the vocabulary, edits the CSV, runs Phase 2 to refresh the DB and the lookup map.

This trades dynamism for predictability + auditability. New mediums never silently get classified by an LLM whose output drifts.

---

## UI integration

`FilterBar` gains a fourth `MultiSelectDropdown`, label `Medium`, populated from `kind='medium'` categories with facet counts. Position: after `Format` in the dropdown row.

`collection-query.ts` changes:

- `applyAllFilters` / scalar pass: when `state.mediums` is non-empty AND themes/formats are also non-empty, the existing two-dim category intersection logic in `categoryFilteredIds` extends to handle the third dimension (themes ∩ formats ∩ mediums via the same per-kind ID set fetch + intersection).
- New `applySingleDimEmbeddedFilter` cases for medium-only, theme+medium, format+medium, theme+format+medium combinations. The dimension count grows from 2 to 3, so the truth table for "embedded vs catIds .in()" gets more entries:
  - 0 cat dims active: no extra filter
  - 1 cat dim active (theme XOR format XOR medium): embedded INNER filter (already implemented for theme/format; extend to medium)
  - ≥ 2 cat dims active: catIds intersection .in()

The cohort + scalar (decade, artist, q) filtering paths are unchanged.

`FilterState` (in `src/lib/filter-state.ts`) gains a `mediums: string[]` field with `medium=` URL param parsing & serialization, mirroring `themes` / `formats`. Active-filter chips and "Clear all" extend to include medium.

`getFacetCounts` adds a `mediums: Record<string, number>` entry computed via the same `candidateIdsExcept` + `countCategoriesForIds` pattern.

---

## Out of scope (explicit)

- **Support facet.** Format already covers the meaningful 2D/3D split.
- **A "Technique" facet.** CDWA distinguishes materials from techniques (e.g., "etching"). The current data is purely material-focused; technique extraction would require its own LLM pass.
- **Real-time LLM classification on insert.** Would add per-row latency + cost + drift risk. Saved lookup is sufficient.
- **Editing the bucket vocabulary via the admin console.** v1 is "edit the CSV, run Phase 2." A real admin UI for the medium taxonomy is a future enhancement.
- **Display of medium pill badges on artwork cards.** The detail page continues to show the integrated CDWA phrase via `artworks.medium`. Surfacing the bucket tags as visible chips on cards is deferred (could feel cluttered alongside title + artist).
- **Backfilling the ~561 empty-medium artworks.** Requires source data we don't have. They stay un-tagged.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| LLM proposes too many buckets (e.g. 40) | System prompt explicitly requests ~12–18 + reviewer can merge during CSV review |
| LLM mis-buckets (e.g. "Color Stix" → "Crayon") | CSV review catches it before any DB write |
| User edits CSV in Sheets and breaks the multi-value `;`-joined cells | Phase 2 validates the CSV shape and surfaces errors before applying |
| Taxonomy drift over time as new medium strings appear in imports | Importers log unknowns; periodic re-run of Phase 1 absorbs them |
| The `categories` constraint check rejects `'medium'` until the migration runs | Phase 2 will fail with a clear error message if the user hasn't run the ALTER first |
| Race condition on bucket category creation under concurrency | N/A — Phase 2 is single-threaded; importers consume the static map and don't create new buckets |
