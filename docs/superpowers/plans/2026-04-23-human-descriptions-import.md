# Human Descriptions Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import 590 human-written paragraph descriptions from CSV, supersede AI-generated content for matched SKUs, produce a per-row update log and a full-catalog export with prior-AI snapshots; bundle the schema rename rollout (UI + scripts) needed because the DB column rename has already been applied.

**Architecture:** Two phases. Phase 1 = the import + export script (independently runnable; produces both artifacts in one pass so prior values are captured at update time). Phase 2 = the rename rollout across UI components and adjacent scripts. Phase 1 ships first because the DB schema is already in the renamed state, so getting clean data in is the foundation; Phase 2 makes the codebase consistent with the data.

**Tech Stack:** TypeScript, Node 20+, `tsx` runner, `csv-parse/sync`, `@supabase/supabase-js`, Node's built-in test runner (`node:test`) — no new dependencies.

**Spec reference:** `docs/superpowers/specs/2026-04-23-human-descriptions-import-design.md`

---

## File Structure

**New files:**
- `src/lib/text.ts` — pure utility function `truncateForAlt` that turns a paragraph into a ≤150-char alt text with ellipsis. Lives in `src/lib/` so both the import script and the admin form can import it cleanly.
- `scripts/test-text.ts` — `node:test` assertions for `truncateForAlt`.
- `scripts/import-human-descriptions.ts` — main script. Parses CSV, pages through artworks, updates matched rows, writes the two CSV artifacts.

**Modified files (Phase 1):**
- `package.json` — add `import:descriptions` npm script
- `.gitignore` — add `tmp/` so input CSV and output artifacts stay out of git

**Modified files (Phase 2):**
- `src/lib/types.ts` — rename `ai_description` field on `Artwork` to `alt_text_long`; add `description_origin`
- `src/lib/utils.ts` — `getAltText()` drops the fallback-to-long-form (the bug that motivated this work)
- `src/app/artwork/[id]/page.tsx` — read `alt_text_long` for `<img alt>`; delete the "About This Work" section
- `src/app/admin/artworks/[id]/page.tsx` — rename column references; relabel form fields; update copy-button to truncate
- `public/review.html` — rename column references in fetch URLs and PATCH bodies
- `scripts/generate-descriptions.ts` — rename column refs; set `description_origin: 'ai'` on insert
- `scripts/migrate-and-describe.ts` — same as above
- `supabase/migrations/001_initial.sql` — sync source-controlled schema with the applied state

---

## Phase 0: Pre-flight

### Task 0: Verify the schema migration is in place

**Files:** none (read-only)

- [ ] **Step 1: Confirm columns exist in production**

Run:
```bash
npx tsx --env-file=.env.local -e "
import { createClient } from '@supabase/supabase-js';
const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
c.from('artworks').select('id, alt_text, alt_text_long, description_origin').limit(1).then(({data, error}) => {
  if (error) { console.error('SCHEMA MISMATCH:', error.message); process.exit(1); }
  console.log('OK - columns exist:', Object.keys(data[0]));
});
"
```

Expected: `OK - columns exist: [ 'id', 'alt_text', 'alt_text_long', 'description_origin' ]`

If this fails: stop. The schema migration was not applied as expected; user must re-run the SQL from the spec's "Schema (already migrated)" section before proceeding.

---

## Phase 1: Import + export script

### Task 1: Add `tmp/` to `.gitignore`

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Append `tmp/` to .gitignore**

Edit `.gitignore`, append at the bottom:

```
# Working directory for CSV imports/exports (input + generated artifacts)
tmp/
```

- [ ] **Step 2: Verify input CSV is now ignored**

Run: `git check-ignore "tmp/CLIR Image Descriptions Sheet - Brief Descriptions.csv"`
Expected: outputs the path, exit code 0.

---

### Task 2: Create truncation utility — failing test first

**Files:**
- Create: `scripts/test-text.ts`

- [ ] **Step 1: Write the test file**

Create `scripts/test-text.ts`:

```typescript
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { truncateForAlt } from "../src/lib/text";

test("returns short input verbatim, no ellipsis", () => {
  const input = "A short description.";
  assert.equal(truncateForAlt(input, 150), input);
});

test("trims leading and trailing whitespace", () => {
  assert.equal(truncateForAlt("  hello  ", 150), "hello");
});

test("collapses newlines to single spaces", () => {
  assert.equal(truncateForAlt("line one\nline two", 150), "line one line two");
});

test("collapses runs of whitespace to one space", () => {
  assert.equal(truncateForAlt("a   b\t\tc", 150), "a b c");
});

test("returns empty string for empty input", () => {
  assert.equal(truncateForAlt("", 150), "");
});

test("returns empty string for whitespace-only input", () => {
  assert.equal(truncateForAlt("   \n\t  ", 150), "");
});

test("truncates long input at last word boundary, ending with ellipsis", () => {
  const longInput = "The quick brown fox jumps over the lazy dog. ".repeat(10);
  const result = truncateForAlt(longInput, 150);
  assert.ok(result.length <= 150, `length ${result.length} > 150`);
  assert.ok(result.endsWith("…"), `"${result}" should end with ellipsis`);
  const charBeforeEllipsis = result.slice(-2, -1);
  assert.notEqual(charBeforeEllipsis, " ", "should not have trailing space before ellipsis");
});

test("hard-cuts when no whitespace exists in first maxLen-1 chars", () => {
  const noSpaces = "x".repeat(200);
  const result = truncateForAlt(noSpaces, 150);
  assert.equal(result.length, 150);
  assert.equal(result, "x".repeat(149) + "…");
});

test("respects custom maxLen", () => {
  const input = "abcdefghij ".repeat(5);
  const result = truncateForAlt(input, 20);
  assert.ok(result.length <= 20, `length ${result.length} > 20`);
  assert.ok(result.endsWith("…"));
});

test("does not append ellipsis when input is exactly maxLen", () => {
  const input = "x".repeat(150);
  const result = truncateForAlt(input, 150);
  assert.equal(result, input);
  assert.ok(!result.endsWith("…"));
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx tsx --test scripts/test-text.ts`
Expected: All tests fail with `Error: Cannot find module '../src/lib/text'` or similar.

---

### Task 3: Implement truncation utility

**Files:**
- Create: `src/lib/text.ts`

- [ ] **Step 1: Write the implementation**

Create `src/lib/text.ts`:

```typescript
/**
 * Truncate a paragraph for use as a short alt text.
 *
 * Behavior:
 * - Collapses all whitespace (newlines, tabs, runs of spaces) to single spaces, then trims.
 * - If the result is <= maxLen chars, returns it verbatim with no ellipsis.
 * - Otherwise, slices to (maxLen - 1) chars, finds the last whitespace within that slice,
 *   cuts there, and appends a single Unicode ellipsis (U+2026). Total length <= maxLen.
 * - If no whitespace exists in the first (maxLen - 1) chars, hard-cuts at (maxLen - 1) + ellipsis.
 */
export function truncateForAlt(input: string, maxLen: number = 150): string {
  const collapsed = input.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLen) return collapsed;

  const ellipsis = "…";
  const slice = collapsed.slice(0, maxLen - 1);
  const lastSpace = slice.lastIndexOf(" ");

  if (lastSpace === -1) {
    return slice + ellipsis;
  }
  return slice.slice(0, lastSpace) + ellipsis;
}
```

- [ ] **Step 2: Run the test and verify it passes**

Run: `npx tsx --test scripts/test-text.ts`
Expected: All 10 tests pass.

---

### Task 4: Verify column types align with what the script will fetch

**Files:** none (read-only verification)

- [ ] **Step 1: Confirm `resolveImageUrl()` works without React/Next runtime**

Run:
```bash
npx tsx --env-file=.env.local -e "
import { resolveImageUrl } from './src/lib/utils';
console.log(resolveImageUrl({ image_url: 'foo/bar.jpg', image_original: 'https://cdn.artcld.com/x.jpg' }));
"
```

Expected: prints `https://cdn.artcld.com/x.jpg` (or, if `NEXT_PUBLIC_R2_PUBLIC_URL` is set, the constructed R2 URL). Either is fine — confirms the helper imports cleanly in a Node-only context.

If this fails: the script's `resolveImageUrl` import needs replacement. Reproduce the same logic inline in the script instead of importing.

---

### Task 5: Implement the import + export script

**Files:**
- Create: `scripts/import-human-descriptions.ts`

- [ ] **Step 1: Write the script**

Create `scripts/import-human-descriptions.ts`:

```typescript
#!/usr/bin/env npx tsx
/**
 * import-human-descriptions.ts
 *
 * Reads the human-authored description CSV at HUMAN_CSV_PATH (default:
 * tmp/CLIR Image Descriptions Sheet - Brief Descriptions.csv), updates
 * matched artworks (alt_text_long, alt_text, description_origin='human'),
 * and writes two timestamped CSV artifacts to tmp/:
 *   - import-human-descriptions-log_<ISO>.csv  per-row update log
 *   - descriptions-export_<ISO>.csv             full catalog snapshot
 *
 * Run: npx tsx --env-file=.env.local scripts/import-human-descriptions.ts
 */

import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";
import { truncateForAlt } from "../src/lib/text";
import { resolveImageUrl } from "../src/lib/utils";

// ─── Config ───────────────────────────────────────────────────────────────
const TMP_DIR = path.join(__dirname, "..", "tmp");
const CSV_PATH =
  process.env.HUMAN_CSV_PATH ||
  path.join(TMP_DIR, "CLIR Image Descriptions Sheet - Brief Descriptions.csv");

const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-");
const LOG_FILE = path.join(TMP_DIR, `import-human-descriptions-log_${TIMESTAMP}.csv`);
const EXPORT_FILE = path.join(TMP_DIR, `descriptions-export_${TIMESTAMP}.csv`);

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Error: Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PAGE_SIZE = 1000;
const ALT_MAX_LEN = 150;

// ─── Types ────────────────────────────────────────────────────────────────
interface CsvRow {
  SKU?: string;
  "Item Description *"?: string;
  [key: string]: string | undefined;
}

interface ArtworkRow {
  id: string;
  inventory_number: string | null;
  image_url: string | null;
  image_original: string | null;
  alt_text: string | null;
  alt_text_long: string | null;
  description_origin: "human" | "ai" | null;
}

interface LogEntry {
  sku: string;
  status: "success" | "fail";
  reason: string;
  artwork_id: string;
  prior_alt_text_long: string;
  prior_alt_text: string;
  new_alt_text_long: string;
  new_alt_text: string;
}

interface ExportEntry {
  sku: string;
  image_url: string;
  description_origin: string;
  alt_text_long: string;
  alt_text: string;
  prior_ai_alt_text_long: string;
  prior_ai_alt_text: string;
}

// ─── CSV output helpers ───────────────────────────────────────────────────
function csvField(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function writeCsv(filePath: string, columns: string[], rows: Record<string, string>[]): void {
  const header = columns.join(",");
  const body = rows.map((r) => columns.map((c) => csvField(r[c])).join(",")).join("\n");
  fs.writeFileSync(filePath, header + "\n" + body + "\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────
async function main() {
  // 1. Parse human CSV
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`CSV not found: ${CSV_PATH}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(CSV_PATH, "utf-8");
  const rows: CsvRow[] = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  });
  console.log(`Parsed ${rows.length} rows from ${path.basename(CSV_PATH)}`);

  // 2. Build SKU -> description map (last-wins; track duplicates for logging)
  const skuMap = new Map<string, string>();
  const duplicateSkus = new Set<string>();
  for (const row of rows) {
    const sku = (row.SKU || "").trim();
    const desc = (row["Item Description *"] || "").trim();
    if (!sku) continue;
    if (skuMap.has(sku)) duplicateSkus.add(sku);
    skuMap.set(sku, desc);
  }
  console.log(`Unique SKUs in CSV: ${skuMap.size} (${duplicateSkus.size} duplicates)`);

  // 3. Page through every artwork
  console.log("Fetching all artworks...");
  const allArtworks: ArtworkRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("artworks")
      .select("id, inventory_number, image_url, image_original, alt_text, alt_text_long, description_origin")
      .order("inventory_number", { ascending: true, nullsFirst: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      console.error("Error fetching artworks:", error);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    allArtworks.push(...(data as ArtworkRow[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  console.log(`Fetched ${allArtworks.length} artworks`);

  // 4. Process each artwork
  const logEntries: LogEntry[] = [];
  const exportEntries: ExportEntry[] = [];
  const matchedSkus = new Set<string>();
  let successCount = 0;
  let failCount = 0;

  for (const art of allArtworks) {
    const sku = (art.inventory_number || "").trim();
    const priorLong = art.alt_text_long || "";
    const priorShort = art.alt_text || "";
    const imageUrl = resolveImageUrl(art) || "";

    if (sku && skuMap.has(sku)) {
      const desc = skuMap.get(sku)!;
      matchedSkus.add(sku);

      if (!desc) {
        logEntries.push({
          sku, status: "fail", reason: "empty description",
          artwork_id: art.id,
          prior_alt_text_long: priorLong, prior_alt_text: priorShort,
          new_alt_text_long: "", new_alt_text: "",
        });
        failCount++;
        exportEntries.push({
          sku, image_url: imageUrl,
          description_origin: art.description_origin || "",
          alt_text_long: priorLong, alt_text: priorShort,
          prior_ai_alt_text_long: "", prior_ai_alt_text: "",
        });
        continue;
      }

      const newLong = desc;
      const newShort = truncateForAlt(desc, ALT_MAX_LEN);

      const { error: updateErr } = await supabase
        .from("artworks")
        .update({
          alt_text_long: newLong,
          alt_text: newShort,
          description_origin: "human",
        })
        .eq("id", art.id);

      if (updateErr) {
        logEntries.push({
          sku, status: "fail", reason: `update error: ${updateErr.message}`,
          artwork_id: art.id,
          prior_alt_text_long: priorLong, prior_alt_text: priorShort,
          new_alt_text_long: newLong, new_alt_text: newShort,
        });
        failCount++;
        exportEntries.push({
          sku, image_url: imageUrl,
          description_origin: art.description_origin || "",
          alt_text_long: priorLong, alt_text: priorShort,
          prior_ai_alt_text_long: "", prior_ai_alt_text: "",
        });
        continue;
      }

      logEntries.push({
        sku, status: "success", reason: "",
        artwork_id: art.id,
        prior_alt_text_long: priorLong, prior_alt_text: priorShort,
        new_alt_text_long: newLong, new_alt_text: newShort,
      });
      successCount++;

      exportEntries.push({
        sku, image_url: imageUrl,
        description_origin: "human",
        alt_text_long: newLong, alt_text: newShort,
        prior_ai_alt_text_long: priorLong, prior_ai_alt_text: priorShort,
      });
    } else {
      // Not in human CSV - export current state, no prior_ai_*
      exportEntries.push({
        sku, image_url: imageUrl,
        description_origin: art.description_origin || "",
        alt_text_long: priorLong, alt_text: priorShort,
        prior_ai_alt_text_long: "", prior_ai_alt_text: "",
      });
    }
  }

  // 5. Log fails for CSV SKUs that didn't match any DB row
  for (const sku of skuMap.keys()) {
    if (!matchedSkus.has(sku)) {
      logEntries.push({
        sku, status: "fail", reason: "sku not found in db",
        artwork_id: "",
        prior_alt_text_long: "", prior_alt_text: "",
        new_alt_text_long: "", new_alt_text: "",
      });
      failCount++;
    }
  }

  // 6. Log fails for duplicate SKUs (earlier occurrences superseded by later ones)
  for (const sku of duplicateSkus) {
    logEntries.push({
      sku, status: "fail", reason: "superseded by later row in csv",
      artwork_id: "",
      prior_alt_text_long: "", prior_alt_text: "",
      new_alt_text_long: "", new_alt_text: "",
    });
  }

  // 7. Write artifacts
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

  writeCsv(LOG_FILE,
    ["sku", "status", "reason", "artwork_id", "prior_alt_text_long", "prior_alt_text", "new_alt_text_long", "new_alt_text"],
    logEntries
  );

  writeCsv(EXPORT_FILE,
    ["sku", "image_url", "description_origin", "alt_text_long", "alt_text", "prior_ai_alt_text_long", "prior_ai_alt_text"],
    exportEntries
  );

  // 8. Summary
  console.log("\n=== Summary ===");
  console.log(`Updated:     ${successCount}`);
  console.log(`Failed:      ${failCount}`);
  console.log(`Export rows: ${exportEntries.length}`);
  console.log(`\nLog:    ${LOG_FILE}`);
  console.log(`Export: ${EXPORT_FILE}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Confirm the script's modules resolve**

Run:
```bash
npx tsx -e "import('./scripts/import-human-descriptions.ts').then(() => console.log('imports OK')).catch(e => { console.error(e); process.exit(1); })"
```

Expected: prints `imports OK`.

(Don't run a full `tsc --noEmit` — the project's tsconfig is configured for Next.js and will surface unrelated noise in the script's standalone context. The tsx import check above is sufficient.)

---

### Task 6: Add npm script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add to scripts section**

Edit `package.json`. In the `"scripts"` block, add:

```json
"import:descriptions": "tsx --env-file=.env.local scripts/import-human-descriptions.ts"
```

The block becomes (showing only the addition; preserve all existing scripts):

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "import:csv": "tsx scripts/import-csv.ts",
  "import:images": "tsx scripts/migrate-images.ts",
  "seed:categories": "tsx scripts/seed-categories.ts",
  "generate:descriptions": "tsx scripts/generate-descriptions.ts",
  "import:descriptions": "tsx --env-file=.env.local scripts/import-human-descriptions.ts",
  "migrate:all": "tsx --env-file=.env.local scripts/migrate-and-describe.ts",
  "db:migrate": "tsx scripts/run-migration.ts"
},
```

- [ ] **Step 2: Verify npm sees the script**

Run: `npm run | grep import:descriptions`
Expected: `import:descriptions`

---

### Task 7: Commit Phase 1 code

**Files:** none (git only)

- [ ] **Step 1: Stage and commit**

Run:
```bash
git add .gitignore package.json src/lib/text.ts scripts/test-text.ts scripts/import-human-descriptions.ts
git status
```

Expected: shows the 5 files staged. No untracked CSVs in `tmp/` because of the gitignore.

- [ ] **Step 2: Create commit**

Run:
```bash
git commit -m "$(cat <<'EOF'
Add human descriptions import script with truncation utility

scripts/import-human-descriptions.ts reads the human-authored CSV,
updates matched artworks (alt_text_long, alt_text, description_origin),
and produces two timestamped artifacts in tmp/:
  - per-row update log with prior values for audit
  - full-catalog export with prior AI snapshots for human-overwritten
    rows so Creative Growth can compare AI vs human side-by-side

Truncation logic for the short alt_text is extracted to
scripts/lib/truncate.ts with node:test coverage. tmp/ is gitignored.

The script writes to renamed columns (alt_text_long) which were
established by a manual schema migration on 2026-04-23. The codebase
side of that rename lands in the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds.

---

### Task 8: Run the import on real data

**Files:** none (execution only — produces gitignored artifacts)

- [ ] **Step 1: Run the script**

Run: `npm run import:descriptions`

Expected output ends with a summary block:
```
=== Summary ===
Updated:     ~580-590
Failed:      <small number, depending on SKU mismatches and duplicates>
Export rows: ~2,112

Log:    /Users/cullfam/code/cg_clir/tmp/import-human-descriptions-log_<timestamp>.csv
Export: /Users/cullfam/code/cg_clir/tmp/descriptions-export_<timestamp>.csv
```

If the script errors out: do NOT attempt fixes blind — report the error to the user. Common causes: env vars missing, schema not migrated, network blocked, permission issues.

- [ ] **Step 2: Spot-check the log**

Run: `head -5 tmp/import-human-descriptions-log_*.csv`
Expected: header row + 4 rows. Each row has populated `prior_alt_text_long` (the previous AI text being overwritten) and a `new_alt_text` ending with `…` for any description longer than 150 chars.

- [ ] **Step 3: Spot-check the export**

Run: `head -3 tmp/descriptions-export_*.csv`
Expected: header row + 2 rows. The first data row should have `description_origin = human` if the artwork was matched, or `ai` if not.

- [ ] **Step 4: Sanity-check counts**

Run:
```bash
awk -F',' 'NR>1 {print $2}' tmp/import-human-descriptions-log_*.csv | sort | uniq -c
```

Expected: shows counts of `success` and `fail` rows. Success count should be close to 590 (the CSV row count). Report the actual numbers to the user before proceeding to Phase 2.

- [ ] **Step 5: Verify a known artwork in the DB**

Pick a SKU from the CSV's first row (e.g., `ABai 1`). Run:

```bash
npx tsx --env-file=.env.local -e "
import { createClient } from '@supabase/supabase-js';
const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
c.from('artworks').select('inventory_number, alt_text, alt_text_long, description_origin').eq('inventory_number', 'ABai 1').single().then(({data, error}) => {
  if (error) { console.error(error); process.exit(1); }
  console.log(JSON.stringify(data, null, 2));
});
"
```

Expected: `description_origin: 'human'`, `alt_text_long` is the full paragraph from the CSV, `alt_text` ends with `…` and is ≤150 chars.

---

## Phase 2: Rename rollout

The rename rollout brings the codebase into agreement with the renamed schema. Production code is currently broken against the new schema (queries `ai_description` which no longer exists) — this phase fixes that. All file edits land in one commit because the rename is logically atomic.

### Task 9: Update TypeScript types

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Rename field and add origin**

In `src/lib/types.ts`, find the `Artwork` interface and replace these two lines:

```typescript
  ai_description: string | null;
  alt_text: string | null;
```

with:

```typescript
  alt_text: string | null;
  alt_text_long: string | null;
  description_origin: "human" | "ai" | null;
```

- [ ] **Step 2: Verify nothing else in this file references the old name**

Run: `grep -n "ai_description" src/lib/types.ts`
Expected: no output.

---

### Task 10: Update getAltText helper

**Files:**
- Modify: `src/lib/utils.ts`

- [ ] **Step 1: Replace getAltText**

In `src/lib/utils.ts`, replace the existing `getAltText` function (currently at lines ~84-99) with:

```typescript
/**
 * Get the short alt text for an artwork. Used in <img alt> on grid pages.
 * Does NOT fall back to alt_text_long — that field is for the detail page,
 * where dumping a paragraph into the alt attribute would force screen-reader
 * users through a long announcement on every grid card. See
 * docs/superpowers/specs/2026-04-23-human-descriptions-import-design.md.
 */
export function getAltText(artwork: {
  alt_text: string | null;
  title: string;
  medium: string | null;
}): string {
  if (artwork.alt_text) return artwork.alt_text;
  const parts = [artwork.title];
  if (artwork.medium) parts.push(artwork.medium);
  return parts.join(". ");
}
```

- [ ] **Step 2: Verify no consumers expect the removed field in the signature**

Run: `grep -rn "getAltText" src/ --include="*.ts" --include="*.tsx"`
Expected: callers in `ArtworkCard.tsx` and `artwork/[id]/page.tsx` and `admin/artworks/[id]/page.tsx`. They pass full `artwork` objects so the narrower signature is fine.

---

### Task 11: Update artwork detail page — alt + remove "About This Work"

**Files:**
- Modify: `src/app/artwork/[id]/page.tsx`

- [ ] **Step 1: Switch the `<img alt>` to the long form**

Find this block (around line 162-169):

```tsx
            {imageUrl ? (
              <Image
                src={imageUrl}
                alt={altText}
                fill
                className="object-cover"
                priority
              />
```

Above the JSX `return`, the current code computes `const altText = getAltText(artwork);`. The detail page should use the long form for the image alt, since this is the page where rich description is appropriate.

Replace the `altText` declaration (around line 122):

```typescript
  const altText = getAltText(artwork);
```

with:

```typescript
  const altText = artwork.alt_text_long || getAltText(artwork);
```

This uses the long form when present, falls back to the short via the helper if it's missing.

- [ ] **Step 2: Remove the "About This Work" section**

Find and DELETE this entire block (around lines 273-283):

```tsx
      {/* Description */}
      {artwork.ai_description && (
        <section className="mt-12 pt-12 border-t border-gray-200 max-w-2xl">
          <h2 className="font-serif text-2xl font-bold text-gray-900 mb-4">
            About This Work
          </h2>
          <p className="text-gray-700 leading-relaxed">
            {artwork.ai_description}
          </p>
        </section>
      )}
```

Leave the surrounding `{/* More by Artist */}` block untouched.

- [ ] **Step 3: Sanity check**

Run: `grep -n "ai_description" src/app/artwork/\[id\]/page.tsx`
Expected: no output.

---

### Task 12: Update admin edit page

**Files:**
- Modify: `src/app/admin/artworks/[id]/page.tsx`

- [ ] **Step 1: Rename all field references**

Run a find-and-replace across the file. Every occurrence of `ai_description` must become `alt_text_long` (10 spots: form-state init, DB-fetch destructuring, DB-update payload, copy-button source, label `htmlFor`, `<textarea id>`, `<textarea name>`, `value={formData.ai_description}`, the `formData.ai_description` guard, the `alt_text: prev.ai_description` assignment in the copy-button).

Use the Edit tool with `replace_all: true` for `ai_description` → `alt_text_long`.

- [ ] **Step 2: Update the form labels**

Find the label for what is now `alt_text_long`. The current label text reads something like "AI Description" or "Description". Replace with: `Long alt text (detail page)`.

Find the label for `alt_text`. Replace with: `Short alt text (grid page)`.

- [ ] **Step 3: Fix the copy-button to truncate**

The existing copy button copies `ai_description` (now `alt_text_long`) directly into `alt_text`. After the rename, this would copy a paragraph into the short field — defeating the truncation discipline.

Find this code (formerly used the old name):

```typescript
    if (formData.alt_text_long) {
      setFormData((prev) => ({
        ...prev,
        alt_text: prev.alt_text_long,
      }));
    }
```

Replace with:

```typescript
    if (formData.alt_text_long) {
      setFormData((prev) => ({
        ...prev,
        alt_text: truncateForAlt(prev.alt_text_long || "", 150),
      }));
    }
```

Add the import at the top of the file (the project uses a `@/` alias for `src/`):

```typescript
import { truncateForAlt } from "@/lib/text";
```

If the alias isn't configured (check `tsconfig.json` for `paths`), use the relative path: `../../../../lib/text`.

- [ ] **Step 4: Verify**

Run: `grep -n "ai_description" src/app/admin/artworks/\[id\]/page.tsx`
Expected: no output.

---

### Task 13: Update review SPA

**Files:**
- Modify: `public/review.html`

- [ ] **Step 1: Rename column references**

8 occurrences of `ai_description` need to become `alt_text_long`. They appear in:
- Two SELECT URL strings (lines around 329 and 352)
- Two `=not.is.null` filter strings (same lines)
- Two display elements (`a.ai_description` rendering)
- Two `${a.ai_description}` in textareas
- Two PATCH payload bodies (`ai_description: desc`)
- Four in-memory mutations (`a.ai_description = desc`)

Use the Edit tool with `replace_all: true` for `ai_description` → `alt_text_long`.

- [ ] **Step 2: Verify**

Run: `grep -c "ai_description" public/review.html`
Expected: `0`.

- [ ] **Step 3: Verify internal element IDs survived the find-replace**

Run: `grep -E "descDisplay|descEdit" public/review.html`
Expected: both IDs appear at least once. They're internal labels for the textarea elements — they should NOT have been renamed by the find-replace because they don't contain `ai_description` as a substring.

---

### Task 14: Update generate-descriptions.ts

**Files:**
- Modify: `scripts/generate-descriptions.ts`

- [ ] **Step 1: Rename column references**

4 occurrences of `ai_description` need renaming:
- The TypeScript interface field
- The `select` clause (` ai_description, `)
- The `.is("ai_description", null)` filter
- The update payload key

Use the Edit tool with `replace_all: true` for `ai_description` → `alt_text_long`.

- [ ] **Step 2: Add description_origin to the update payload**

Find the update payload (around line 237):

```typescript
        .update({
          alt_text_long: result.description,
          alt_text: result.alt_text,
        })
```

Replace with:

```typescript
        .update({
          alt_text_long: result.description,
          alt_text: result.alt_text,
          description_origin: "ai",
        })
```

(Note: the JSON output keys from the AI prompt — `result.description`, `result.alt_text` — are unchanged. They're internal to the prompt contract.)

- [ ] **Step 3: Verify**

Run: `grep "ai_description" scripts/generate-descriptions.ts`
Expected: no output.

---

### Task 15: Update migrate-and-describe.ts

**Files:**
- Modify: `scripts/migrate-and-describe.ts`

- [ ] **Step 1: Rename column references**

5 occurrences of `ai_description` need renaming. Use the Edit tool with `replace_all: true` for `ai_description` → `alt_text_long`.

- [ ] **Step 2: Add description_origin to the update payload**

Find the update payload (around line 371):

```typescript
        .update({
          alt_text_long: desc.description,
          alt_text: desc.alt_text,
        })
```

Replace with:

```typescript
        .update({
          alt_text_long: desc.description,
          alt_text: desc.alt_text,
          description_origin: "ai",
        })
```

- [ ] **Step 3: Verify**

Run: `grep "ai_description" scripts/migrate-and-describe.ts`
Expected: no output.

---

### Task 16: Sync the migration SQL with the applied state

**Files:**
- Modify: `supabase/migrations/001_initial.sql`

- [ ] **Step 1: Update the column definition**

Find this block:

```sql
  -- AI-generated accessibility content
  ai_description    TEXT,
  alt_text          TEXT,
```

Replace with:

```sql
  -- Accessibility alt text. alt_text_long is for <img alt> on the artwork
  -- detail page; alt_text is the truncated form for grid pages.
  alt_text          TEXT,
  alt_text_long     TEXT,
  description_origin TEXT CHECK (description_origin IN ('human', 'ai')),
```

- [ ] **Step 2: Update the FTS index**

Find:

```sql
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(medium, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(alt_text, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(ai_description, '')), 'D')
  ) STORED;
```

Replace with:

```sql
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(medium, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(alt_text, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(alt_text_long, '')), 'D')
  ) STORED;
```

- [ ] **Step 3: Verify**

Run: `grep "ai_description" supabase/migrations/001_initial.sql`
Expected: no output.

---

### Task 17: Verify dev server starts and pages render

**Files:** none (verification)

- [ ] **Step 1: Type-check the project**

Run: `npm run lint`
Expected: passes. If type errors appear referencing `ai_description`, you missed a file — grep again across `src/` and fix.

Run: `grep -rn "ai_description" src/ scripts/ public/ supabase/ --include="*.ts" --include="*.tsx" --include="*.html" --include="*.sql"`
Expected: no output.

- [ ] **Step 2: Start the dev server in background**

Run: `npm run dev` (use `run_in_background`).

Wait until you see `Ready in <X>ms` in the output (use Monitor or BashOutput to check).

- [ ] **Step 3: Smoke-test the collection page**

Run: `curl -s http://localhost:3000/collection | grep -o 'alt="[^"]*"' | head -5`
Expected: 5 alt attributes printed. Each should be ≤150 chars (eyeball it). For artworks updated by the import, the alt should end with `…`.

- [ ] **Step 4: Smoke-test a known-overwritten artwork detail page**

Pick a known SKU (e.g., `ABai 1`) and find its UUID:

```bash
npx tsx --env-file=.env.local -e "
import { createClient } from '@supabase/supabase-js';
const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
c.from('artworks').select('id').eq('inventory_number', 'ABai 1').single().then(({data}) => console.log(data?.id));
"
```

Then: `curl -s http://localhost:3000/artwork/<UUID> | grep -E 'alt=|About This Work'`

Expected:
- One `alt="..."` containing the full human paragraph (no `…` — the long form goes here)
- NO occurrence of `About This Work` (section was deleted)

- [ ] **Step 5: Stop the dev server**

Kill the background process.

---

### Task 18: Commit Phase 2

**Files:** none (git only)

- [ ] **Step 1: Stage the rename rollout**

Run:
```bash
git add src/lib/types.ts src/lib/utils.ts src/app/artwork/\[id\]/page.tsx src/app/admin/artworks/\[id\]/page.tsx public/review.html scripts/generate-descriptions.ts scripts/migrate-and-describe.ts supabase/migrations/001_initial.sql
git status
```

Expected: shows the 8 files staged.

- [ ] **Step 2: Create commit**

Run:
```bash
git commit -m "$(cat <<'EOF'
Rename ai_description -> alt_text_long across UI and scripts

Schema migration was applied manually on 2026-04-23 (rename plus new
description_origin column). This commit catches the codebase up:

- Types: rename field, add description_origin
- getAltText: drop the dangerous fallback to the long form, which would
  dump paragraphs into <img alt> on grid pages
- Artwork detail page: <img alt> reads the long form; remove the
  "About This Work" section that was wrongly rendering the alt text
  as visible body content
- Admin edit page: rename refs, relabel fields ("Long alt text /
  detail page" vs "Short alt text / grid page"), make the copy button
  truncate with the same logic as the import script
- Review SPA: rename refs in fetch URLs, PATCH bodies, and renders
- AI generation scripts: rename refs and set description_origin: 'ai'
  on insert
- Migration SQL: sync source-controlled file with applied schema

See docs/superpowers/specs/2026-04-23-human-descriptions-import-design.md
for the full rationale, especially on why the alt-text/long-alt-text
distinction matters for screen-reader users on grid views.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds.

---

## Done

At this point:
- DB has 590 (give or take) human-described artworks with `description_origin='human'`, ~1,500 AI-described with `description_origin='ai'`
- Two CSV artifacts in `tmp/` ready to share with Creative Growth
- Codebase compiles, dev server renders correctly with the new schema
- The misleading "About This Work" section is gone
- Grid pages serve short alts; detail page serves long alts

Hand off the two `tmp/` CSVs to Creative Growth. Open issues for follow-up work flagged in the spec under "Out of scope" if you want them tracked.
