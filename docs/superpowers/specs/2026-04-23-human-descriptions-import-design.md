# Human Descriptions Import — Design

**Date:** 2026-04-23
**Status:** Ready for implementation

---

## Goal

Import 590 manually-written, paragraph-length artwork descriptions from a CSV (`tmp/CLIR Image Descriptions Sheet - Brief Descriptions.csv`) into the `alt_text_long` field of the artworks table, supersede the existing AI-generated long descriptions for matched SKUs, and produce two artifacts: a per-row update log and a full-catalog export CSV that lets Creative Growth compare AI vs. human long descriptions side-by-side for the ~1,500+ artworks still on AI-only.

**Spec revision 2026-04-23 (mid-execution):** First execution attempt revealed that the human CSV's `SKU` column does NOT correspond to the DB's `inventory_number` column. They are two separate columns in the original Art Cloud export (column 28 = "Inventory Number", numeric like `38754`; column 31 = "SKU", artist-coded like `ABai 1`), and only "Inventory Number" was imported on the original load. Before the human descriptions can be matched, a new `sku` column must be added to `artworks` and backfilled from `inventory_2026-04-02.csv` keyed on `inventory_number`. See "Schema (already migrated)" and "Component 0: SKU column" sections below.

The existing short `alt_text` (used by `<img alt>` on grid pages) is **left untouched** — the human CSV has only paragraph-form content, and there is no good algorithmic way to derive a screen-reader-quality short alt from it. The existing AI-generated short alt remains in place; an admin can later improve it manually via the admin console.

Bundled into the same change: a schema cleanup that renames the two description fields to reflect their actual purpose (alt-text for two different page contexts, not "ai" content vs. "alt"), drops the dangerous fallback that pumps long content into grid `<img alt>` attributes, and removes the "About This Work" section from the artwork detail page (which was wrongly using the long-form alt text as visible body content).

---

## Why this matters (accessibility context)

Screen readers announce the alt attribute of every image they encounter, in order, before the user can decide whether to interact. On a grid page that shows two dozen artworks, that means the screen reader narrates an alt for each card in sequence. If every alt is a 300-word paragraph, what takes a sighted user a few seconds of skimming becomes several minutes of forced listening. A short alt — roughly the length of a tweet — gives enough text to identify the work and let the user decide whether to drill in; the full paragraph then lives on the detail page where the user has explicitly chosen to engage. WCAG and WebAIM both encode this: alt text should be "as concise as possible while serving the equivalent purpose for that context," and "context" includes whether the image stands alone or sits in a grid of fifty.

This is the model the schema and UI now need to reflect cleanly.

---

## Schema (already migrated)

The following SQL was run by the user in the Supabase SQL Editor on 2026-04-23:

```sql
ALTER TABLE artworks RENAME COLUMN ai_description TO alt_text_long;
ALTER TABLE artworks ADD COLUMN description_origin TEXT
  CHECK (description_origin IN ('human', 'ai'));
UPDATE artworks SET description_origin = 'ai'
  WHERE alt_text_long IS NOT NULL;
ALTER TABLE artworks DROP COLUMN fts;
ALTER TABLE artworks ADD COLUMN fts tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(medium, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(alt_text, '')), 'C') ||
  setweight(to_tsvector('english', coalesce(alt_text_long, '')), 'D')
) STORED;
CREATE INDEX idx_artworks_fts ON artworks USING GIN(fts);
```

**Additional SQL (mid-execution revision, 2026-04-23):** Adding the SKU column required by Component 0:

```sql
ALTER TABLE artworks ADD COLUMN sku TEXT;
CREATE INDEX idx_artworks_sku ON artworks(sku);
```

The `sku` column is intentionally **not** UNIQUE — the source Art Cloud CSV has 2 duplicate SKUs (`DMi 662`, `JS 27`) representing distinct artworks that share an artist code. They have different `inventory_number` values, so primary-key uniqueness is preserved.

**Resulting field semantics:**
- `alt_text` — short alt text (≤150 chars, may end with `…`), used in `<img alt>` on grid pages
- `alt_text_long` — full alt text (paragraph), used in `<img alt>` on artwork detail page
- `description_origin` — `'human'` for human-authored, `'ai'` for AI-generated, `NULL` if neither field has content
- `sku` — artist-coded identifier from the Art Cloud `SKU` column (e.g., `ABai 1`, `CLIR2022.25`). Distinct from `inventory_number` (which is a numeric Art Cloud ID). Both are preserved.

The migration file `supabase/migrations/001_initial.sql` should be updated in source control to reflect the new state, even though the schema change has already been applied — otherwise a fresh environment built from migrations will diverge from production.

---

## Component 0: SKU column add and backfill

The `sku` column was missing from the original import; the human-descriptions CSV keys on it. Backfilling restores parity with the Art Cloud source.

**Backfill script** (`scripts/backfill-sku.ts`, one-shot):
1. Read `inventory_2026-04-02.csv`. For each row, read `Inventory Number` (column 28) and `SKU` (column 31).
2. For each row with both values present: `UPDATE artworks SET sku = :sku WHERE inventory_number = :inv`.
3. Log a summary: rows in CSV, rows with both values, rows updated, rows skipped (no inv match).

**Going-forward import** (`scripts/import-csv.ts`): add `sku` to the upsert payload so subsequent CSV refreshes also map the SKU column. The conflict key remains `inventory_number` (still unique).

---

## Component 1: Update + export script

**File:** `scripts/import-human-descriptions.ts`
**npm script:** `import:descriptions`

### Inputs

- `tmp/CLIR Image Descriptions Sheet - Brief Descriptions.csv` (path configurable via env var `HUMAN_CSV_PATH`, default as written)
- Supabase service role key (from `.env.local`, same pattern as other scripts)

### Behavior

1. Parse the CSV. Required columns: `SKU`, `Item Description *`. Other columns are ignored.
2. Build an in-memory map: `inventory_number → { description, source_row }`.
3. Page through every artwork in `artworks` (using existing pagination pattern from `seed-categories.ts` / `migrate-images.ts` — the REST API caps at 1,000 rows per page). Select must include the new `sku` column. For each artwork:
   - Capture `prior_alt_text_long` (current value).
   - If `sku` is present in the human-CSV map:
     - Compute `new_alt_text_long` = the human paragraph, with leading/trailing whitespace stripped.
     - UPDATE the row: `alt_text_long = new_alt_text_long`, `description_origin = 'human'`. The existing `alt_text` (short form) is **not** modified.
     - Append a log entry: `status='success'`, `prior_alt_text_long`, `new_alt_text_long`.
     - Append an export entry with the prior long-form value populated alongside the new one.
   - Else (artwork not in CSV): no DB update; add an export entry with current values only (`prior_ai_alt_text_long` left blank since current = prior).

   Note: when two DB rows share the same SKU (the `DMi 662` / `JS 27` case), both will be updated with the same human description if that SKU appears in the human CSV — intentional, since the CSV speaks of artworks by SKU and ambiguity in the source data should propagate to both copies.
4. After processing all artworks, also report any SKUs in the CSV that did not match any DB row — append fail log entries with `status='fail'`, `reason='sku not found in db'`.
5. Write the two CSV artifacts to `tmp/`.

### Edge cases

- **Empty description in CSV row:** log as `fail`, `reason='empty description'`. Do not update.
- **Whitespace-only description:** treated as empty after strip.
- **Multi-line descriptions:** preserved as-is in `alt_text_long` (newlines kept).
- **SKU collision (CSV has multiple rows with same SKU):** last one wins, prior occurrences logged with `status='fail'`, `reason='superseded by later row in csv'`.
- **DB update failure (network, RLS, etc.):** log as `fail`, `reason=<error message>`. Continue with next row.
- **Idempotency:** the script can be re-run safely. It overwrites with the same values and produces fresh log + export artifacts each run (filenames carry timestamps).

### Output: artifact 1 — update log

**File:** `tmp/import-human-descriptions-log_<ISO-timestamp>.csv`

| Column | Notes |
|---|---|
| `sku` | The CSV's SKU value |
| `status` | `success` or `fail` |
| `reason` | Empty on success; explanation on fail |
| `artwork_id` | UUID if matched, empty if not |
| `prior_alt_text_long` | Snapshot of what was overwritten (empty if no prior content) |
| `new_alt_text_long` | The human paragraph as written |

One row per CSV input row, plus one row per CSV SKU that didn't match the DB.

### Output: artifact 2 — catalog export

**File:** `tmp/descriptions-export_<ISO-timestamp>.csv`

| Column | Notes |
|---|---|
| `sku` | `sku` field from DB (artist-coded, e.g., `ABai 1`) |
| `inventory_number` | `inventory_number` field from DB (numeric Art Cloud ID) — included so CG can cross-reference with their internal records |
| `image_url` | Resolved via the same `resolveImageUrl()` helper the UI uses, so URLs match what's served |
| `description_origin` | `'human'` / `'ai'` / empty |
| `alt_text_long` | Current value (post-update — human for matched rows, AI for the rest) |
| `alt_text` | Current value (untouched by this script — AI for all rows that ever ran through the AI pipeline) |
| `prior_ai_alt_text_long` | The pre-update AI-generated long alt text — populated only for `description_origin='human'` rows where prior content existed; empty for AI rows (since current = prior) and for rows that had no prior content |

One row per artwork in the database. Sorted by `inventory_number` for stable diffing.

The asymmetric `prior_ai_alt_text_long` population (only for human-overwritten rows) is intentional: it lets Creative Growth compare AI vs. human long-descriptions side-by-side for the 590 overwritten rows without bloating the export with redundant duplicate columns for the ~1,500 AI-only rows. The short `alt_text` column is included so CG sees the complete current state of each row, even though this script never modifies it.

---

## Component 2: UI + scripts updates (rename rollout)

These ship together with the new import script in a single commit. The schema rename is already applied, so the codebase is currently broken against production — these edits are the catch-up.

### Files

- **`src/lib/types.ts`** — rename `ai_description` → `alt_text_long`; add `description_origin: 'human' | 'ai' | null`.
- **`src/lib/utils.ts`** — `getAltText()` returns `alt_text` only. The fallback to the long form is removed (rationale above; the fallback would dump paragraphs into `<img alt>`). The fallback chain becomes: `alt_text` → title + medium fallback. (No fallback to `alt_text_long` even though it exists, because using the long form in `<img alt>` is exactly the bug we're fixing.)
- **`src/app/artwork/[id]/page.tsx`** — `<img alt>` reads from `alt_text_long`; **delete the entire "About This Work" `<section>`** (lines 273-283). The section was rendering the alt text as visible body content, which is the wrong purpose for that field.
- **`src/components/ArtworkCard.tsx`** — no functional change; continues to call `getAltText()` which now returns short form only.
- **`src/app/admin/artworks/[id]/page.tsx`** — rename all `ai_description` → `alt_text_long` field references in the form state, fetch, and submit. Relabel the form fields: "Long alt text (detail page)" and "Short alt text (grid page)". **Delete the existing "copy long → short" button** — under the new model `alt_text_long` and `alt_text` serve different page contexts and have different content sources (long is human-or-AI prose, short is concise screen-reader text), so direct copying no longer makes sense. An admin who wants a fresh short alt should write one.
- **`public/review.html`** — rename all `ai_description` references (8 spots: query URLs, PATCH bodies, display markup, edit markup, in-memory mutations). Element IDs (`descDisplay`, `descEdit`) can stay as-is — they're internal labels, not column names.
- **`scripts/generate-descriptions.ts`** — rename all `ai_description` references (4 spots: type, select, filter, update payload). Update payload should also set `description_origin: 'ai'`. Note: the JSON keys in the AI prompt response (`alt_text`, `description`) are internal to the prompt contract and do not need to change.
- **`scripts/migrate-and-describe.ts`** — same rename (5 spots). Same `description_origin: 'ai'` addition on the update payload.
- **`supabase/migrations/001_initial.sql`** — update column names and FTS index to match the applied state, and add the `description_origin` column. (No new migration file; just edit in place since this represents what should be created on a fresh environment.)
- **`.gitignore`** — add `tmp/` so the input CSV and the two output artifacts don't accidentally get committed. The `tmp/` folder currently exists with the input CSV but isn't ignored.

### Order of operations

1. Schema migration (DONE, manually applied)
2. All UI/script renames committed in one go (this commit also adds the new import script)
3. `npm run import:descriptions` against production
4. Manual verification:
   - Visit `/collection` and inspect alt attributes in DevTools — should be ≤150 char, ending with `…` for human-overwritten rows
   - Visit a known-overwritten artwork's detail page and inspect the `<img alt>` — should be the full paragraph
   - Confirm the "About This Work" section is no longer rendered
   - Spot-check the export CSV against 2-3 known SKUs
5. Open the two artifacts, share with Creative Growth

---

## Out of scope (explicit)

- **Repurposing the "About This Work" section** for narrative / artist-voice content. Section is removed in this work; a future feature can reintroduce it pointed at a new field (e.g., `narrative` or `artist_statement`).
- **Re-running AI generation** for the ~1,500 artworks not in the human CSV. Their existing AI descriptions are preserved.
- **Cleaning up the `description_reviewed` schema drift** — `public/review.html` references a `description_reviewed` column that isn't in the migration file. Acknowledged but not fixed here; address in a separate cleanup.
- **Alt text quality audit** for the AI-generated short alts on the ~1,500 remaining artworks. They've been reviewed via the existing review SPA; no rework planned.
- **Rebuilding the description review SPA** to support the new schema beyond the minimal rename. The SPA continues to work with the same approve/edit/skip flow against the renamed fields.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Rename breaks production until the code-side updates land | Migration was applied immediately before the code changes; minimize the gap by landing all rename edits in one commit |
| CSV SKU format mismatch (e.g., trailing whitespace in `inventory_number` from import-csv.ts) | Trim both sides of the comparison. Log any unmatched SKUs in the fail log so we can spot-check whether the issue is data drift vs. genuine missing artworks. |
| Existing AI long descriptions are lost on overwrite | Captured in the per-row log (`prior_alt_text_long`) for any row touched. Recoverable from the timestamped log file in `tmp/`. |
| FTS index recreation is non-trivial on 2,000+ rows | Migration was already run by user; not a concern at script-run time. |
| Short `alt_text` becomes inconsistent with the long form for human rows (long is human-authored, short is still AI-generated) | Acknowledged tradeoff. `alt_text_long` and `alt_text` serve different contexts and don't need to match in tone or content. If CG eventually wants human-authored short alts too, that is a follow-up CSV import or admin-form workflow. |
