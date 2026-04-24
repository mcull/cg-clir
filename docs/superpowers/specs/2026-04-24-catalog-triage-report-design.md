# Catalog Triage Report — Design

**Date:** 2026-04-24
**Status:** Ready for implementation

---

## Goal

Produce a static, read-only set of CSV reports that lets Creative Growth staff triage the artworks DB. Specifically: which of the ~3,260 artworks should remain on the public site, which are missing images, and what patterns (per artist or per tag) might guide the decision.

The work is bookkeeping — not a UI, not a public surface, not a database write. The outputs land in `tmp/` (gitignored) and get shared with CG outside this codebase.

The naming convention for the two source datasets we compare:
- **MC APR 2** — `inventory_2026-04-02.csv`, the original Art Cloud export that seeded the DB (~2,189 rows).
- **1stdibs_clir_picks_2026-03-17** — `tmp/ADD TAGS TO CREATIVE GROWTH PUBLIC ARCHIVE - 1stdibs_clir_picks_2026-03-17.csv`, the curated subset CG prepared for 1stDibs (~2,059 rows). Imported via the prior `feat/archive-import` PR.

Each SKU known to the DB falls in one of three buckets:
- **`both`** — present in both source CSVs
- **`mc_apr_2_only`** — in the original April catalog but NOT in the 1stDibs picks (~1,200 expected; this is the cohort CG most needs to triage)
- **`1stdibs_only`** — in the picks but NOT in the original April catalog (~1,150; freshly inserted by the prior import)

---

## Outputs

A single `npm run` produces three timestamped CSVs in `tmp/`. All artifacts are read-only descriptions of current DB + source-CSV state.

### Output 1: `triage-per-artwork_<ISO-timestamp>.csv`

One row per SKU known to the DB. Sorted by `artist`, then `sku`. Columns:

| Column | Notes |
|---|---|
| `sku` | from `artworks.sku` |
| `artist` | resolved `<first_name> <last_name>`; `Unknown` if `artist_id` is null |
| `title` | from DB |
| `medium` | from DB |
| `date_created` | from DB (raw text — may be year, full date, or "ND") |
| `bucket` | `both` / `mc_apr_2_only` / `1stdibs_only` |
| `image_state` | `r2` / `artcld` / `null` (based on `image_url` substring matching) |
| `recovery_source` | `1stdibs_link_1_available` if the SKU is in the 1stdibs CSV AND `image_url` is null; else empty |
| `recovery_url` | The `Link 1` URL from 1stdibs picks if `recovery_source` is set; else empty |
| `description_origin` | `human` / `ai` / empty |
| `theme_count` | count of attached `kind='theme'` categories |
| `tag_count` | length of `artworks.tags` array |
| `tags` | `artworks.tags` joined with `; ` |
| `on_website` | true / false |

Excluded: artworks not in the DB (we don't know about them).

### Output 2: `triage-per-artist_<ISO-timestamp>.csv`

One row per distinct artist. Sorted by `total_artworks` descending. Columns:

| Column | Notes |
|---|---|
| `artist` | name (or `Unknown`) |
| `total_artworks` | overall count in DB |
| `mc_apr_2_count` | how many of their works appear in MC APR 2 |
| `1stdibs_count` | how many appear in the 1stdibs picks |
| `both_count` | intersection |
| `mc_apr_2_only_count` | the triage cohort per artist (the "do we want to keep showing all these?" number) |
| `mediums` | distinct medium values, comma-joined, lowercased |
| `date_range` | `<earliest>–<latest>` four-digit-year span if parseable; empty otherwise |
| `null_image_count` | how many of theirs have null `image_url` |
| `top_tags` | top 5 most-frequent values from `artworks.tags` across this artist's works, comma-joined |

### Output 3: `triage-tag-frequency_<ISO-timestamp>.csv`

One row per distinct tag value present anywhere in `artworks.tags`. Sorted by `signal_ratio` descending (highest-signal tags surface first). Columns:

| Column | Notes |
|---|---|
| `tag` | the tag string |
| `total_count` | how many DB artworks have this tag |
| `mc_apr_2_only_count` | restricted to artworks in the `mc_apr_2_only` bucket |
| `1stdibs_count` | restricted to artworks whose SKU appears in the 1stdibs picks |
| `signal_ratio` | `mc_apr_2_only_count / total_count`, rounded to 2 decimal places. Values near 1.0 mean "this tag almost exclusively appears on works NOT in the 1stDibs picks" — a candidate signal for triage (e.g., a tag like `ephemera` is likely to score ~1.0). Values near 0 mean the opposite. |

---

## Inputs and join keys

- **MC APR 2** — read `inventory_2026-04-02.csv`, build `Set<sku>` from column `SKU`.
- **1stdibs picks** — read `tmp/ADD TAGS TO CREATIVE GROWTH PUBLIC ARCHIVE - 1stdibs_clir_picks_2026-03-17.csv`, build `Map<sku, link1>` from columns `SKU` and `Link 1`.
- **DB** — page through `artworks` using the existing pagination pattern; select `id, sku, title, medium, date_created, image_url, description_origin, on_website, tags, artist:artists(first_name, last_name)` plus a join through `artwork_categories` to count themes.

`sku` is the join key everywhere (the field is non-unique in the schema by design — duplicates `DMi 662` and `JS 27` exist; the report just emits one row per DB artwork, so duplicates produce duplicate rows, which is correct).

---

## Categorization rules

```
in_mc_apr2 = mc_apr2_skus.has(artwork.sku)
in_1stdibs = onestdibs_skus.has(artwork.sku)

bucket =
  both              if in_mc_apr2 and in_1stdibs
  mc_apr_2_only     if in_mc_apr2 and not in_1stdibs
  1stdibs_only      if not in_mc_apr2 and in_1stdibs
  ?                 if neither — emit as `unknown_source` and log a warning
                                  (these would be DB rows from some other path,
                                  e.g., manually inserted or seeded by a script
                                  outside the two source CSVs)
```

The `unknown_source` bucket should be empty in practice but the script must handle it without crashing.

---

## Implementation outline

**File:** `scripts/catalog-triage-report.ts`

**npm script:** `triage:report`

**Behavior:**
1. Parse the two source CSVs (similar pattern to other scripts in `scripts/`).
2. Page through the DB to fetch all artworks with the columns listed in "Inputs" above. Use a join to fetch theme-category counts (or compute via a separate query that counts `artwork_categories` joined to `categories WHERE kind='theme'`).
3. For each artwork: compute its bucket and image_state, look up the recovery URL from the 1stdibs map, and emit one row to the per-artwork list.
4. Group by artist (in memory) to produce the per-artist summary.
5. Group by tag (in memory) to produce the tag-frequency comparison. Compute `signal_ratio` per tag.
6. Write the three CSVs to `tmp/` with timestamped filenames.
7. Print a brief summary to stdout: row counts per output, plus the `unknown_source` count if non-zero.

**Concurrency / runtime:** none needed. The data fits in memory; this is a few queries plus three writes. Should complete in well under a minute.

**Helpers to reuse:**
- The `csvField` / `writeCsv` helpers from `scripts/import-archive.ts` (extract them to a shared file ONLY if their signatures need to change; otherwise just copy the ~15 lines and let TI-001 track the consolidation).
- The `formatArtistName` util from `src/lib/utils.ts`.

---

## Edge cases

- **Artist is null** (`artist_id IS NULL` on artwork): use literal string `"Unknown"`. Aggregate all such rows together in the per-artist summary as a single `Unknown` row.
- **`artworks.tags` is null** for a row: treat as empty array.
- **Tag values that differ only in casing** (e.g. `"Ephemera"` vs `"ephemera"`): normalize to lowercase + trim before grouping in the tag-frequency report. Display the lowercase form.
- **Dates that don't parse to a year** (e.g., `"ND"`, `"c. 1990s"`): excluded from `date_range` calculation. If an artist has zero parseable dates, `date_range` is empty.
- **`signal_ratio` denominator zero**: not possible since `total_count` is by construction the number of artworks where the tag appears, but the script should guard with a defensive check (return 0 if denominator is 0 to avoid NaN).

---

## Out of scope (explicit)

- **Acting on the report.** This produces a description, not a remediation. Follow-up projects will decide what to do with the data: bulk-deactivate certain artworks, backfill images from `recovery_url`, etc.
- **A web UI for browsing the report.** CSVs only. CG can open in Sheets and filter.
- **Image fetching for the audit.** We don't HEAD-check or download images here — the report describes `image_url` state, not whether the URL actually resolves to a valid image.
- **Theme-tag analysis.** Only the free-form `artworks.tags` (from the original Art Cloud import) is analyzed; the constrained 8-term theme taxonomy is just a count column on the per-artwork sheet.
- **Per-tag artist breakdown.** A tag-frequency row tells you "ephemera appears on 47 artworks, of which 45 are in mc_apr_2_only" but doesn't list which artists. CG can derive that from the per-artwork sheet by filtering on tag.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `signal_ratio` over-reads small samples (e.g., a tag that appears on 1 artwork in `mc_apr_2_only` shows ratio 1.0 and looks like a strong signal) | Sort by `signal_ratio` descending but include `total_count` so reviewers can see the sample size at a glance. |
| In-memory aggregation breaks on a much larger catalog | Catalog is ~3,260 artworks; aggregation is trivial in memory. Document the assumption; revisit if catalog crosses ~50k. |
| Re-running produces noisy timestamped files in `tmp/` | `tmp/` is already gitignored. Old report files stay around for comparison; the user can clean up manually. |
| Artists with the same name resolved to different `artist_id`s would split into multiple rows | The artist-resolution path during imports uses slug equality, so this shouldn't happen unless slugify changed between imports. The per-artist summary groups by resolved name (not artist_id), which papers over any such split. |
| `unknown_source` rows surface (artworks in DB but in neither source CSV) | Logged as a warning with count to stdout; the row still appears in per-artwork CSV under a fourth bucket value. CG can investigate origin separately. |
