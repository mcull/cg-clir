# Archive Import & Theme Taxonomy — Design

**Date:** 2026-04-23
**Status:** Ready for implementation (Project A of two — Project B is the UI for theme + decade filters and will be brainstormed separately)

---

## Goal

Reconcile the artworks DB with `tmp/ADD TAGS TO CREATIVE GROWTH PUBLIC ARCHIVE - 1stdibs_clir_picks_2026-03-17.csv` (the "1stDibs picks" CSV, ~2,059 rows). Two operations bundled:

1. **Theme tagging** — for every CSV row whose SKU already exists in the DB (909 SKUs), upsert a controlled-vocabulary "theme" tag from CSV col T into the existing `categories` table, distinguished from the existing AI-suggested format categories (Drawings, Paintings, etc.) by a new `kind` discriminator.
2. **New artwork ingestion** — for every CSV row whose SKU does NOT exist in the DB (1,150 SKUs), insert a new artwork from CSV metadata, download the image from CSV `Link 1`, upload through the existing 4-variant R2 pipeline, generate AI alt text + alt_text_long via Claude Vision, and attach the theme tag.

Excluded from this project (handled separately later):
- Image validation / re-download for existing artworks with broken image URLs
- Marking DB-only artworks (those not in the CSV) as inactive (`on_website = false`)
- Refreshing metadata (title, medium, dimensions, date, artist) for SKUs that already exist in the DB
- The UI dropdowns for theme + decade filters (Project B)

---

## Why these scope choices

The CSV's name (`1stdibs_clir_picks`) and the user's framing ("I don't really have a sense of what the authoritative materials are... overfill the DB and then winnow with CG staff") indicate this CSV is a curated subset prepared for a specific channel, not a replacement source of truth. So we add what's missing, tag what we can, and defer destructive operations (deactivation, metadata clobber) until CG can review the resulting state.

For new artworks, `on_website` defaults to `true` — they go live immediately with AI-generated alt text. This is the user's explicit call (curators can flip individual rows off via the admin if needed; the volume makes upfront curation impractical).

---

## Schema changes

**Manual SQL** (run by user via Supabase SQL Editor before script execution, per TD-001):

```sql
ALTER TABLE categories ADD COLUMN kind TEXT
  CHECK (kind IN ('format', 'theme'));

-- Backfill existing rows as 'format' (they're the AI-suggested
-- Drawings/Paintings/etc. taxonomy from the original seed)
UPDATE categories SET kind = 'format' WHERE kind IS NULL;

-- Going forward, we expect every category to have a kind. This is enforced
-- by application code, not the DB constraint, since admin-created categories
-- may want flexibility.
```

The `categories` table after migration:
- Existing 8 rows → `kind = 'format'` (Drawings, Paintings, Mixed Media, Sculpture & 3D, Fiber Art & Textiles, Prints & Multiples, CLIR Collection, Photography & Digital)
- New 8 rows added by this script → `kind = 'theme'` (music, people, plants, animals, abstract, other, food, pop culture)

`artwork_categories` join table is unchanged — it accommodates both kinds of category links per artwork without schema work.

---

## Theme normalization

CSV col T values look like `clir abstract`, `clear plants`, `clir music, clir people` (multiple themes comma-separated). The data uses both `clir` and `clear` prefixes inconsistently.

Normalization rule (applied in script):
1. Split on commas
2. Trim whitespace
3. Lowercase
4. Strip leading `clir ` or `clear ` prefix
5. Drop empty strings
6. Validate against the fixed set of 8: `music`, `people`, `plants`, `animals`, `abstract`, `other`, `food`, `pop culture`. Anything outside the set is dropped + logged as a warning.

A row's themes are the unique normalized values surviving validation. Empty theme list is allowed (artwork gets no theme attachments).

---

## CSV column mapping (verified)

| Excel col | CSV header | Use |
|---|---|---|
| B | `Link 1` | Primary image URL (download source for new SKUs) |
| H | `Item Pk` | **Ignored.** Different ID system from DB's `inventory_number` (zero overlap). Documented for clarity. |
| I | `SKU` | Match key against `artworks.sku` |
| J | `Artist Name` | Single string — split into first/last for the `artists` table lookup/insert |
| L | `Title *` | New-row insert |
| M | `Medium 1 *` | New-row insert (free-form text, into `artworks.medium`) |
| N | `Creation Date (if available)` | New-row insert (free-form text, into `artworks.date_created`) |
| O | `Creation Year` | Fallback if N is empty |
| Q, R, S | `Height *`, `Width`, `Depth` | New-row insert (numeric) |
| T | `Tags (clir music, ...)` | Theme normalization |

Other columns ignored.

---

## Per-row processing

For each CSV row (after CSV parse, ordered by row index for deterministic checkpointing):

1. Read SKU. If empty, log skip + continue.
2. Lookup `artworks.sku = SKU` in DB.
3. **Branch A — SKU exists** (909 expected):
   - Normalize themes from col T.
   - For each surviving theme: ensure a `categories` row exists with `name=<theme>, kind='theme'` (lazy-create on first encounter), then ensure an `artwork_categories` link exists between this artwork and that category. Both operations are idempotent upserts.
   - Log row as `theme_upserted` with the list of themes attached.
   - **Do not touch any other field.**
4. **Branch B — SKU does not exist** (1,150 expected):
   - Resolve artist: split `Artist Name` on the FIRST space — text before becomes `first_name`, text after becomes `last_name`. Single-token names (e.g. `Co-Op`) → `first_name = "Co-Op"`, `last_name = ""` (NULL). Compute `slug` via the existing `slugify` util applied to the full `Artist Name`. Lookup artist by `slug`; if not found, INSERT a new artist row with `first_name`, `last_name`, `slug`. (No fuzzy matching — slug equality is the join.)
   - INSERT new artwork row with: `sku`, `title`, `medium`, dimensions (parsed numerics), `date_created` (col N or fallback to col O), `artist_id`, `on_website = true`, `description_origin = NULL` (will be set to `'ai'` after AI gen succeeds), and a placeholder `image_url` set to the CSV `Link 1` (may be replaced by R2 URL after upload).
   - Download `Link 1`. Resize to 4 variants (`original`, `large_1600`, `medium_800`, `thumb_400`) using `sharp`. Upload each to R2 under the bucket's existing key convention (matching `migrate-and-describe.ts`). Update `image_url` to the R2 path of the resized canonical variant.
   - Send `medium_800` (already in memory from resize) to Claude Vision with the existing prompt. On success: UPDATE row with `alt_text` (short) and `alt_text_long` (long) and `description_origin = 'ai'`.
   - Normalize themes from col T (same as Branch A) and attach via `artwork_categories`.
   - Log row as `inserted` with success/fail flags for each sub-step (image, AI, themes).
5. After all rows: write a summary log to `tmp/`.

---

## Reuse, don't reinvent

The script should reuse logic from existing scripts where possible:
- **Image download + resize + R2 upload**: extract or copy the image-handling helpers from `scripts/migrate-and-describe.ts`.
- **AI Vision call**: same prompt and Anthropic SDK invocation as `migrate-and-describe.ts`.
- **Pagination + Supabase client**: same env-var pattern, service-role client, page-by-1000.
- **Artist lookup/insert**: same logic shape as `scripts/import-csv.ts` (slugify, normalize, lookup-then-insert).

If the duplicated logic across scripts grows beyond ~3 sites, factor it into `scripts/lib/` later. For this PR, copy what's needed if it keeps the scope focused.

---

## Concurrency and checkpointing

- **Concurrency:** default 3 simultaneous image+AI pipelines (matches `migrate-and-describe.ts`). Configurable via `CONCURRENCY` env var.
- **Checkpoint file:** `scripts/.archive-import-progress.json`. Tracks the SKUs successfully processed (with their branch + sub-step status). On re-run, the script reads this and skips already-done SKUs. New entries get written incrementally — kill at any point and resume.
- **Why this matters:** rough estimate is several hours of runtime for the 1,150 new inserts (image download from artcld.com + 4 R2 uploads + AI Vision call per row). A flaky network at hour 2 shouldn't force restarting from zero.

---

## Output artifacts

`tmp/archive-import-log_<ISO-timestamp>.csv` — one row per CSV input row:

| Column | Notes |
|---|---|
| `sku` | The CSV SKU |
| `branch` | `existing_skipped` (no SKU), `existing_themed` (Branch A), `inserted` (Branch B success), `failed` (anything broke) |
| `themes_attached` | Comma-separated list of normalized themes successfully linked |
| `themes_dropped` | Comma-separated list of unrecognized values stripped during normalization (data-quality signal) |
| `image_status` | For Branch B: `ok`, `download_failed`, `upload_failed`, or empty for Branch A |
| `ai_status` | For Branch B: `ok`, `failed`, or empty for Branch A |
| `artwork_id` | DB UUID, populated when known |
| `notes` | Free-text reason / error message |

A summary line is printed at the end: rows by branch, successful inserts, failures by category.

---

## Edge cases

- **Empty SKU in CSV row:** log + skip.
- **Artist Name empty:** insert artwork with `artist_id = NULL`.
- **Theme col empty:** insert/update artwork without theme attachments. Not an error.
- **Theme value not in fixed set:** drop, log to `themes_dropped`. Don't fail the row.
- **Image URL is already an R2 URL** (unusual for new SKUs but possible): download still works; the script doesn't care about source domain.
- **AI Vision call fails or rate-limits:** retry once with backoff; on second failure, leave `alt_text` and `alt_text_long` NULL and log `ai_status=failed`. The row's other fields are committed (artwork is still inserted, image still uploaded). A follow-up run of `generate-descriptions.ts` can fill in the missing AI text.
- **Image download fails (404, timeout):** retry once; on second failure, log `image_status=download_failed`. Insert the artwork row with `image_url` set to the original CSV URL (so a future migration can retry). `image_original` field also preserves the source URL.
- **Image upload to R2 fails:** retry once; on second failure, log `image_status=upload_failed`. Same fallback as above — row is committed with the original URL.
- **Duplicate SKU in DB** (the legitimate `DMi 662` / `JS 27` case): Branch A processes both; both get the same theme attachments. Logged as one entry per artwork_id.
- **Idempotency:** safe to re-run. Themes are upserted (no duplicate links). The checkpoint file prevents re-processing successful rows. New-row inserts check existence first via SKU lookup.

---

## Out of scope (explicit)

- **Image validation** for existing DB artworks (HEAD-checking image_url, re-uploading broken ones). Deferred per user — will be its own focused project.
- **Marking DB-only artworks inactive** (`on_website = false`). Deferred per user — they want to overfill and curate with CG staff later.
- **Refreshing metadata** for existing-SKU rows from this CSV. The original Art Cloud import is recent and we don't want to clobber any admin edits.
- **The `Item Pk` column.** Different ID system from DB's `inventory_number`; ignored entirely.
- **Theme + decade UI dropdowns.** Project B, brainstormed separately.
- **A `kind = 'medium'` taxonomy.** Considered and dropped — the existing `format` categories cover the high-level grouping; finer-grained medium buckets can be revisited later (e.g., first-token bucketing of the existing `medium` text field).

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| AI Vision API cost ($15-25 estimated for 1,150 images) | Documented up-front. Script prints estimated remaining cost periodically. User can interrupt at any checkpoint. |
| Several hours of runtime | Checkpointing + resumability. User can kick off and walk away. |
| 1,150 new artworks suddenly visible on the public site | User's explicit call (`on_website = true` default). Mitigated by the fact that AI alt text is generated before exposure (no images go live without descriptions, unless AI gen failed — in which case the row has missing alt text and surfaces in the existing review SPA). |
| AI Vision generates descriptions that misrepresent the artwork (we saw one case earlier where AI vs human descriptions differed substantially) | Existing review SPA at `/review.html` already supports approving/editing/skipping descriptions; new AI descriptions land there for CG review post-import. |
| Theme normalization drops legitimate variants | The fixed-set validation logs `themes_dropped` per row, so any unexpected values are surfaced for follow-up. |
| Schema change applied without code change deployed | Same pattern as the prior `alt_text_long` work: user runs SQL manually, verifies, then code lands in same PR. The `kind` column is nullable and code paths handle both NULL and populated cases gracefully. |
