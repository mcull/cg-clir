# Medium Normalization & Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a faceted "Medium" filter to the public collection, backed by an LLM-derived (and human-reviewed) taxonomy of art materials, with each artwork attached to multiple medium tags via the existing `categories` table; future imports consult a persisted lookup map.

**Architecture:** Two-phase script workflow (LLM proposal → CSV review → apply to DB) writes a `kind='medium'` slice of the existing `categories` table and attaches each artwork to one-or-more medium categories via `artwork_categories`. The persisted `scripts/data/medium-buckets.json` lookup map ships in source control so future importers can attach medium categories on insert without another LLM call. UI integration: a fourth multi-select dropdown in `FilterBar`, plumbed through `collection-query.ts` (the existing two-category-dimension filter logic generalizes to three).

**Tech Stack:** TypeScript, Node 20+, `tsx`, `csv-parse/sync`, `@supabase/supabase-js`, `@anthropic-ai/sdk`, Node's built-in `node:test`. No new dependencies.

**Spec reference:** `docs/superpowers/specs/2026-04-25-medium-normalization-design.md`

---

## File Structure

**New files:**
- `scripts/normalize-mediums-propose.ts` — Phase 1 script. Fetches distinct mediums, calls Claude, writes timestamped CSV.
- `scripts/normalize-mediums-apply.ts` — Phase 2 script. Reads (possibly-edited) CSV, validates, upserts medium categories, attaches to artworks, persists JSON lookup map.
- `scripts/data/medium-buckets.json` — produced by Phase 2; consumed by importers. Source-controlled.
- `scripts/lib/medium-buckets.ts` — small helper exporting `loadBucketMap()` and `mediumToCategoryIds(map, medium)`. Used by both apply script and the importer updates so the lookup logic is DRY.
- `scripts/test-medium-buckets.ts` — `node:test` for the helper.

**Modified files:**
- `src/lib/filter-state.ts` — add `mediums: string[]` field + `medium=` URL param.
- `scripts/test-filter-state.ts` — extend tests for the new field.
- `src/lib/collection-query.ts` — extend the category-dimension count from 2 to 3 (themes / formats / mediums); `categoryFilteredIds`, `applySingleDimEmbeddedFilter`, `applyAllFilters`, `getFacetCounts` all touch.
- `src/components/FilterBar.tsx` — add `MultiSelectDropdown` for medium + chip rendering for selected mediums.
- `src/app/page.tsx` — fetch medium category list + pass to FilterBar.
- `src/app/ephemera/page.tsx` — does NOT add medium dropdown (cohort-specific filter set per spec — no change needed beyond confirming).
- `scripts/import-csv.ts` — read bucket map; attach medium categories on insert.
- `scripts/import-archive.ts` — same.
- `package.json` — add `medium:propose` and `medium:apply` npm scripts.
- `supabase/migrations/001_initial.sql` — sync the relaxed `categories.kind` CHECK constraint.

**Schema migration (manual):** extend the `categories.kind` CHECK constraint to allow `'medium'`. User runs the SQL via Supabase SQL Editor (per TD-001) before Phase 2.

---

## Phase 0: Pre-flight

### Task 0: Verify the schema migration is in place

**Files:** none (read-only verification, gated on user-run SQL)

- [ ] **Step 1: Provide SQL to the user**

Tell the user to run this in the Supabase SQL Editor:

```sql
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_kind_check;
ALTER TABLE categories ADD CONSTRAINT categories_kind_check
  CHECK (kind IN ('format', 'theme', 'medium'));
```

- [ ] **Step 2: Confirm by inserting + deleting a probe medium category**

Run:
```bash
npx tsx --env-file=.env.local -e "
import { createClient } from '@supabase/supabase-js';
const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function go() {
  const probe = { name: '__probe__', slug: '__probe__', kind: 'medium', ai_suggested: false };
  const ins = await c.from('categories').insert(probe).select('id').single();
  if (ins.error) { console.error('CONSTRAINT NOT YET RELAXED:', ins.error.message); process.exit(1); }
  await c.from('categories').delete().eq('id', ins.data.id);
  console.log('OK - kind=medium accepted by constraint');
}
go();
"
```

Expected: `OK - kind=medium accepted by constraint`.

If this fails: the SQL hasn't been run; stop and ask the user.

---

## Phase 1: filter-state + helper TDD

### Task 1: Extend filter-state tests for `mediums`

**Files:**
- Modify: `scripts/test-filter-state.ts`

- [ ] **Step 1: Add new tests at the bottom of the file**

Append to `scripts/test-filter-state.ts`:

```typescript
test("parseSearchParams: parses mediums from medium= param", () => {
  const s = parseSearchParams({ medium: "ink,acrylic" });
  assert.deepEqual(s.mediums, ["ink", "acrylic"]);
});

test("parseSearchParams: empty input has empty mediums array", () => {
  const s = parseSearchParams({});
  assert.deepEqual(s.mediums, []);
});

test("toQueryString: serializes mediums to medium= param", () => {
  const state = {
    q: "", themes: [], formats: [], decades: [], artist: null, sort: null, page: 1,
    mediums: ["ink", "acrylic"],
  };
  assert.equal(toQueryString(state), "medium=ink%2Cacrylic");
});

test("toQueryString round-trip preserves mediums", () => {
  const state = {
    q: "x", themes: ["animals"], formats: [], decades: [], artist: null, sort: null, page: 1,
    mediums: ["ink", "acrylic"],
  };
  const re = parseSearchParams(Object.fromEntries(new URLSearchParams(toQueryString(state))));
  assert.deepEqual(re.mediums, state.mediums);
});
```

- [ ] **Step 2: Run the tests and verify the new ones fail**

Run: `npx tsx --test scripts/test-filter-state.ts`
Expected: 4 new test failures with errors mentioning the missing `mediums` field on the parsed object.

---

### Task 2: Add `mediums` to FilterState + parse/serialize

**Files:**
- Modify: `src/lib/filter-state.ts`

- [ ] **Step 1: Update the FilterState interface and parser/serializer**

In `src/lib/filter-state.ts`:

1. Add `mediums: string[];` to the `FilterState` interface (between `formats` and `decades` for alphabetical-ish grouping).

2. In `parseSearchParams`, add `mediums: parseList(params.medium),` to the returned object (between `formats` and `decades`).

3. In `toQueryString`, add this block right after the `formats` serialization:

```typescript
if (state.mediums.length) out.set("medium", state.mediums.join(","));
```

The full updated parseSearchParams return becomes:

```typescript
return {
  q: pickFirst(params.q),
  themes: parseList(params.theme),
  formats: parseList(params.format),
  mediums: parseList(params.medium),
  decades: parseList(params.decade),
  artist: pickFirst(params.artist) || null,
  sort: parseSort(params.sort),
  page: parsePage(params.page),
};
```

- [ ] **Step 2: Run tests and verify all pass**

Run: `npx tsx --test scripts/test-filter-state.ts`
Expected: all tests pass (including the 4 new ones plus the existing 10).

---

### Task 3: Add a tiny medium-bucket helper with tests

**Files:**
- Create: `scripts/test-medium-buckets.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-medium-buckets.ts`:

```typescript
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mediumToBuckets, parseProposedBuckets } from "./lib/medium-buckets";

test("mediumToBuckets: returns buckets from the map", () => {
  const map = { "Ink on paper": ["Ink"], "Acrylic and ink on paper": ["Acrylic", "Ink"] };
  assert.deepEqual(mediumToBuckets(map, "Ink on paper"), ["Ink"]);
  assert.deepEqual(mediumToBuckets(map, "Acrylic and ink on paper"), ["Acrylic", "Ink"]);
});

test("mediumToBuckets: returns empty for unknown medium", () => {
  assert.deepEqual(mediumToBuckets({}, "Crayon on bark"), []);
});

test("mediumToBuckets: trims whitespace before lookup", () => {
  const map = { "Ink on paper": ["Ink"] };
  assert.deepEqual(mediumToBuckets(map, "  Ink on paper  "), ["Ink"]);
});

test("mediumToBuckets: returns empty for null/empty input", () => {
  assert.deepEqual(mediumToBuckets({}, ""), []);
  assert.deepEqual(mediumToBuckets({}, null), []);
});

test("parseProposedBuckets: splits semicolon-joined cell, trims, drops empties", () => {
  assert.deepEqual(parseProposedBuckets("Ink"), ["Ink"]);
  assert.deepEqual(parseProposedBuckets("Color Stix; Ink; Colored pencil"), ["Color Stix", "Ink", "Colored pencil"]);
  assert.deepEqual(parseProposedBuckets("  Ink  ;;  Pastel  "), ["Ink", "Pastel"]);
  assert.deepEqual(parseProposedBuckets(""), []);
});
```

- [ ] **Step 2: Verify failure**

Run: `npx tsx --test scripts/test-medium-buckets.ts`
Expected: tests fail with `Cannot find module './lib/medium-buckets'`.

---

### Task 4: Implement the medium-bucket helper

**Files:**
- Create: `scripts/lib/medium-buckets.ts`

- [ ] **Step 1: Write the helper**

Run: `mkdir -p scripts/lib`

Create `scripts/lib/medium-buckets.ts`:

```typescript
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
```

- [ ] **Step 2: Verify all tests pass**

Run: `npx tsx --test scripts/test-medium-buckets.ts`
Expected: all 5 tests pass.

---

## Phase 2: Phase-1 LLM proposal script

### Task 5: Implement `scripts/normalize-mediums-propose.ts`

**Files:**
- Create: `scripts/normalize-mediums-propose.ts`

- [ ] **Step 1: Write the script**

Create `scripts/normalize-mediums-propose.ts`:

```typescript
#!/usr/bin/env npx tsx
/**
 * normalize-mediums-propose.ts (Phase 1)
 *
 * Fetches every distinct medium string in the catalog, asks Claude to
 * propose a small (~12-18) bucket vocabulary of pure materials and a
 * mapping from each input string to one or more buckets. Writes
 * `tmp/medium-buckets_<ISO>.csv` for human review in Sheets.
 *
 * Run: npx tsx --env-file=.env.local scripts/normalize-mediums-propose.ts
 */

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

const TMP_DIR = path.join(__dirname, "..", "tmp");
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUTPUT_FILE = path.join(TMP_DIR, `medium-buckets_${TIMESTAMP}.csv`);

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY || !ANTHROPIC_KEY) {
  console.error("Error: set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You are an expert museum cataloger normalizing artwork medium descriptions into a small set of material-only buckets, following CDWA (Categories for the Description of Works of Art) conventions.

Goals:
- Propose ~12-18 buckets covering the materials present. Materials only — pigments, drawing tools, sculpture materials, fiber materials. NOT support (paper, canvas, etc.) and NOT technique (drawing, painting). Examples of bucket-worthy material names: Ink, Acrylic, Watercolor, Oil paint, Pastel, Oil pastel, Color Stix, Colored pencil, Pencil/Graphite, Marker, Pen, Crayon, Charcoal, Ceramic, Wood, Fiber/Yarn.
- For each input medium string, return an array of bucket names listing every material present. CDWA prefers enumeration: a 3-material piece gets 3 tags. Common case is 1 tag.
- Use the bucket name "Other" only when you genuinely cannot enumerate (e.g. "Mixed media on paper" with no specifics).
- Combine related materials when sensible (e.g. "Pen on paper" + "Ink on paper" both → "Ink"; "Oil pastel on paper" + "Pastel on paper" — your call whether to keep separate).
- Bucket names should be short and human-readable for a dropdown filter.

Respond ONLY with valid JSON in this shape (no markdown, no fences):
{
  "buckets": ["Ink", "Acrylic", ...],
  "mapping": {
    "Ink on paper": ["Ink"],
    "Color Stix, ink, and colored pencil on paper": ["Color Stix", "Ink", "Colored pencil"],
    ...
  }
}

Every input medium string must appear as a key in "mapping". Every bucket name in "mapping" values must appear in "buckets".`;

interface MediumRow { medium: string; count: number; }

function csvField(v: string | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(filePath: string, columns: string[], rows: Record<string, string>[]): void {
  const header = columns.join(",");
  const body = rows.map((r) => columns.map((c) => csvField(r[c])).join(",")).join("\n");
  fs.writeFileSync(filePath, header + "\n" + body + "\n");
}

async function main() {
  // 1. Fetch all distinct mediums + counts
  console.log("Fetching mediums from DB...");
  const all: { medium: string | null }[] = [];
  let off = 0;
  while (true) {
    const { data, error } = await supabase
      .from("artworks")
      .select("medium")
      .not("medium", "is", null)
      .range(off, off + 999);
    if (error) { console.error(error); process.exit(1); }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    off += 1000;
  }

  const counts = new Map<string, number>();
  for (const r of all) {
    const m = (r.medium || "").trim();
    if (!m) continue;
    counts.set(m, (counts.get(m) || 0) + 1);
  }
  const distinct: MediumRow[] = [...counts.entries()]
    .map(([medium, count]) => ({ medium, count }))
    .sort((a, b) => b.count - a.count);

  console.log(`Found ${distinct.length} distinct medium strings across ${all.length} artworks`);

  // 2. Send to Claude for normalization
  console.log("Calling Claude for bucket proposal + mapping (this may take 10-30s)...");
  const userMessage = `Here are the distinct medium strings from the catalog (with row counts in parentheses):\n\n${distinct
    .map((d) => `${d.medium} (${d.count})`)
    .join("\n")}`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  let parsed: { buckets: string[]; mapping: Record<string, string[]> };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.error("Claude returned non-JSON response. Raw text:");
    console.error(text);
    process.exit(1);
  }

  if (!parsed.buckets || !parsed.mapping) {
    console.error("Claude response missing 'buckets' or 'mapping'. Raw:");
    console.error(text);
    process.exit(1);
  }

  // 3. Write CSV
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  const rows = distinct.map((d) => {
    const buckets = parsed.mapping[d.medium] || [];
    const note = buckets.length === 0 ? "WARNING: not in Claude mapping" : "";
    return {
      medium: d.medium,
      count: String(d.count),
      proposed_buckets: buckets.join("; "),
      notes: note,
    };
  });
  writeCsv(OUTPUT_FILE, ["medium", "count", "proposed_buckets", "notes"], rows);

  // 4. Summary
  const bucketCounts = new Map<string, number>();
  for (const d of distinct) {
    const buckets = parsed.mapping[d.medium] || [];
    for (const b of buckets) bucketCounts.set(b, (bucketCounts.get(b) || 0) + d.count);
  }
  const multiBucketRows = distinct.filter((d) => (parsed.mapping[d.medium] || []).length > 1).length;

  console.log("\n=== Proposed Buckets ===");
  parsed.buckets.forEach((b) => {
    const c = bucketCounts.get(b) || 0;
    console.log(`  ${b.padEnd(24)} ${c} artworks`);
  });
  console.log(`\nMulti-bucket strings (multiple materials): ${multiBucketRows}`);
  console.log(`\nCSV: ${OUTPUT_FILE}`);
  console.log("\nNext: open the CSV in Sheets, edit `proposed_buckets` if needed, save, then:");
  console.log(`  npm run medium:apply -- ${OUTPUT_FILE}`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
```

- [ ] **Step 2: Verify modules resolve**

Run: `npx tsx scripts/normalize-mediums-propose.ts 2>&1 | head -3`
Expected: prints `Error: set NEXT_PUBLIC_SUPABASE_URL ...` (env-var guard fires; proves the file parses).

---

## Phase 3: Phase-2 apply script

### Task 6: Implement `scripts/normalize-mediums-apply.ts`

**Files:**
- Create: `scripts/normalize-mediums-apply.ts`

- [ ] **Step 1: Write the script**

Create `scripts/normalize-mediums-apply.ts`:

```typescript
#!/usr/bin/env npx tsx
/**
 * normalize-mediums-apply.ts (Phase 2)
 *
 * Reads the (possibly-edited) CSV from Phase 1 and applies the
 * normalized bucket assignments to the DB:
 *   - Upserts kind='medium' rows in the categories table
 *   - For each artwork, diffs its medium-category attachments against
 *     what the CSV says it should have (adding missing, removing extra)
 *   - Persists scripts/data/medium-buckets.json for the importers
 *   - Writes per-row log to tmp/medium-apply-log_<ts>.csv
 *
 * Run: npx tsx --env-file=.env.local scripts/normalize-mediums-apply.ts <path-to-csv>
 */

import fs from "fs";
import path from "path";
import readline from "readline";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";
import { slugify } from "../src/lib/utils";
import { parseProposedBuckets, BucketMap } from "./lib/medium-buckets";

const TMP_DIR = path.join(__dirname, "..", "tmp");
const DATA_DIR = path.join(__dirname, "data");
const LOOKUP_FILE = path.join(DATA_DIR, "medium-buckets.json");
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-");
const LOG_FILE = path.join(TMP_DIR, `medium-apply-log_${TIMESTAMP}.csv`);

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Error: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface CsvRow {
  medium: string;
  count: string;
  proposed_buckets: string;
  notes: string;
}

function csvField(v: string | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(filePath: string, columns: string[], rows: Record<string, string>[]): void {
  const header = columns.join(",");
  const body = rows.map((r) => columns.map((c) => csvField(r[c])).join(",")).join("\n");
  fs.writeFileSync(filePath, header + "\n" + body + "\n");
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt + " [y/N] ", (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("Usage: npx tsx scripts/normalize-mediums-apply.ts <path-to-csv>");
    process.exit(1);
  }
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`);
    process.exit(1);
  }

  // 1. Parse CSV → bucket map
  const raw = fs.readFileSync(csvPath, "utf-8");
  const rows: CsvRow[] = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  });
  console.log(`Parsed ${rows.length} medium-row entries from ${path.basename(csvPath)}`);

  const map: BucketMap = {};
  const uniqueBuckets = new Set<string>();
  for (const row of rows) {
    const medium = (row.medium || "").trim();
    if (!medium) continue;
    const buckets = parseProposedBuckets(row.proposed_buckets);
    map[medium] = buckets;
    for (const b of buckets) uniqueBuckets.add(b);
  }
  const bucketList = [...uniqueBuckets].sort();
  console.log(`\nDetected ${bucketList.length} unique buckets:`);
  bucketList.forEach((b) => console.log(`  ${b}`));

  const ok = await confirm("\nProceed to upsert these buckets and apply attachments?");
  if (!ok) { console.log("Aborted."); process.exit(0); }

  // 2. Upsert bucket categories
  console.log("\nUpserting kind='medium' categories...");
  const bucketRows = bucketList.map((name) => ({
    name,
    slug: slugify(name),
    kind: "medium" as const,
    ai_suggested: false,
  }));
  const { data: upserted, error: upsertErr } = await supabase
    .from("categories")
    .upsert(bucketRows, { onConflict: "slug", ignoreDuplicates: false })
    .select("id, name, slug, kind");
  if (upsertErr) { console.error("Upsert failed:", upsertErr); process.exit(1); }
  const bucketIdByName: Record<string, string> = {};
  for (const c of upserted || []) bucketIdByName[c.name] = c.id;
  console.log(`  ${(upserted || []).length} bucket categories ensured`);

  // 3. Page through artworks; diff and apply
  console.log("\nFetching all artworks with non-null medium...");
  const allArt: { id: string; medium: string }[] = [];
  let off = 0;
  while (true) {
    const { data, error } = await supabase
      .from("artworks")
      .select("id, medium")
      .not("medium", "is", null)
      .range(off, off + 999);
    if (error) { console.error(error); process.exit(1); }
    if (!data || data.length === 0) break;
    allArt.push(...(data as any));
    if (data.length < 1000) break;
    off += 1000;
  }
  console.log(`Found ${allArt.length} artworks with medium`);

  // Pre-fetch existing medium-category attachments per artwork (one query)
  const { data: existingAcs, error: acErr } = await supabase
    .from("artwork_categories")
    .select("artwork_id, category:categories!inner(id, kind)")
    .eq("category.kind", "medium");
  if (acErr) { console.error(acErr); process.exit(1); }
  const existingByArtwork = new Map<string, Set<string>>();
  for (const ac of (existingAcs || []) as any[]) {
    if (!existingByArtwork.has(ac.artwork_id)) existingByArtwork.set(ac.artwork_id, new Set());
    existingByArtwork.get(ac.artwork_id)!.add(ac.category.id);
  }

  // Apply diffs
  const log: Record<string, string>[] = [];
  let updated = 0;
  let unchanged = 0;
  let errors = 0;

  for (const art of allArt) {
    const medium = (art.medium || "").trim();
    const desiredBuckets = map[medium] || [];
    const desiredIds = new Set(
      desiredBuckets.map((b) => bucketIdByName[b]).filter((id): id is string => !!id)
    );
    const currentIds = existingByArtwork.get(art.id) || new Set<string>();

    const toAdd = [...desiredIds].filter((id) => !currentIds.has(id));
    const toRemove = [...currentIds].filter((id) => !desiredIds.has(id));

    if (toAdd.length === 0 && toRemove.length === 0) {
      unchanged++;
      continue;
    }

    let rowError = "";
    if (toRemove.length > 0) {
      const { error } = await supabase
        .from("artwork_categories")
        .delete()
        .eq("artwork_id", art.id)
        .in("category_id", toRemove);
      if (error) rowError = `delete: ${error.message}`;
    }
    if (!rowError && toAdd.length > 0) {
      const { error } = await supabase
        .from("artwork_categories")
        .upsert(
          toAdd.map((category_id) => ({ artwork_id: art.id, category_id })),
          { onConflict: "artwork_id,category_id", ignoreDuplicates: true }
        );
      if (error) rowError = `insert: ${error.message}`;
    }

    if (rowError) {
      errors++;
      log.push({
        artwork_id: art.id,
        medium,
        applied_buckets: desiredBuckets.join("; "),
        status: `error: ${rowError}`,
      });
    } else {
      updated++;
      log.push({
        artwork_id: art.id,
        medium,
        applied_buckets: desiredBuckets.join("; "),
        status: "ok",
      });
    }
  }

  // 4. Persist lookup map
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const lookup = {
    version: TIMESTAMP,
    buckets: bucketList,
    map,
  };
  fs.writeFileSync(LOOKUP_FILE, JSON.stringify(lookup, null, 2) + "\n");

  // 5. Write log
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  writeCsv(LOG_FILE, ["artwork_id", "medium", "applied_buckets", "status"], log);

  // 6. Summary
  console.log("\n=== Summary ===");
  console.log(`Artworks scanned:  ${allArt.length}`);
  console.log(`Tag updates:       ${updated}`);
  console.log(`Unchanged:         ${unchanged}`);
  console.log(`Errors:            ${errors}`);
  console.log(`\nLookup map: ${LOOKUP_FILE}`);
  console.log(`Log:        ${LOG_FILE}`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
```

- [ ] **Step 2: Add npm scripts**

In `package.json`, add to the `"scripts"` block (near the other normalization-style scripts):

```json
"medium:propose": "tsx --env-file=.env.local scripts/normalize-mediums-propose.ts",
"medium:apply": "tsx --env-file=.env.local scripts/normalize-mediums-apply.ts",
```

Verify with `npm run | grep medium:`
Expected: prints both scripts.

- [ ] **Step 3: Verify both scripts parse**

Run: `npx tsx scripts/normalize-mediums-apply.ts 2>&1 | head -3`
Expected: prints `Usage: npx tsx scripts/normalize-mediums-apply.ts <path-to-csv>` (the missing-arg guard, proving the file parses).

---

## Phase 4: Run the workflow on production

### Task 7: Run Phase 1 (LLM proposal)

**Files:** none (execution; produces gitignored CSV in `tmp/`)

- [ ] **Step 1: Run the propose script**

Run: `npm run medium:propose`

Expected output ends with:
```
=== Proposed Buckets ===
  Ink                      ~600 artworks
  Acrylic                  ~250 artworks
  ...

Multi-bucket strings (multiple materials): ~50

CSV: /Users/cullfam/code/cg_clir/tmp/medium-buckets_<timestamp>.csv

Next: open the CSV in Sheets, edit `proposed_buckets` if needed, save, then:
  npm run medium:apply -- /Users/cullfam/code/cg_clir/tmp/medium-buckets_<timestamp>.csv
```

Cost: ~$0.05 in Claude API.

If the script errors with non-JSON or schema-mismatch errors: report the raw response to the user; the prompt may need a tweak.

- [ ] **Step 2: Show the user the bucket vocabulary**

After the script completes, print the proposed bucket list to the chat for the user's review. Tell them to open the CSV in Sheets, edit if needed (rename, merge, split, fix specific assignments), and confirm when ready to apply.

---

### Task 8: User reviews CSV, then run Phase 2

**Files:** none (execution)

- [ ] **Step 1: Wait for user confirmation**

Once the user says the CSV is ready (whether they edited it or not), run:

```bash
npm run medium:apply -- <path-from-task-7-output>
```

The script prints the bucket list it parsed from the CSV and asks for `[y/N]` confirmation. Type `y` to proceed.

Expected output ends with:
```
=== Summary ===
Artworks scanned:  ~2710
Tag updates:       ~2710
Unchanged:         0
Errors:            0

Lookup map: /Users/cullfam/code/cg_clir/scripts/data/medium-buckets.json
Log:        /Users/cullfam/code/cg_clir/tmp/medium-apply-log_<timestamp>.csv
```

If errors > 0: report to the user. The log CSV has per-row details.

- [ ] **Step 2: Spot-check a few artworks**

Run:
```bash
npx tsx --env-file=.env.local -e "
import { createClient } from '@supabase/supabase-js';
const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function check(sku) {
  const { data } = await c.from('artworks').select('sku, medium, categories:artwork_categories(category:categories!inner(name, kind))').eq('sku', sku).maybeSingle();
  if (!data) return console.log(sku, '→ not found');
  const mediums = (data.categories || []).filter(c => c.category.kind === 'medium').map(c => c.category.name);
  console.log(sku, '|', data.medium, '|', mediums.join(', '));
}
async function go() {
  await check('RB 25');
  await check('JS 5');
  await check('CLIR2024.233');
  await check('DA 109');
}
go();
"
```

Expected: each row prints with `sku | original medium | attached medium-category names`. Verify the attachments make semantic sense given the original medium string.

---

## Phase 5: Importer integration

### Task 9: Update import-csv.ts to attach mediums

**Files:**
- Modify: `scripts/import-csv.ts`

- [ ] **Step 1: Add helper imports + load the lookup map**

At the top of `scripts/import-csv.ts`, add (alongside the existing imports):

```typescript
import { mediumToBuckets, BucketMap } from "./lib/medium-buckets";
```

After the `supabase` client is constructed (around line 30), add:

```typescript
// Load the persisted medium bucket map (from the medium normalization workflow).
// Importers attach medium categories to new artworks based on this map.
const BUCKETS_FILE = path.join(__dirname, "data", "medium-buckets.json");
let bucketMap: BucketMap = {};
let bucketIdByName: Record<string, string> = {};
if (fs.existsSync(BUCKETS_FILE)) {
  const lookup = JSON.parse(fs.readFileSync(BUCKETS_FILE, "utf-8"));
  bucketMap = lookup.map || {};
  // bucketIdByName is populated below after we resolve category IDs from the DB.
}
```

- [ ] **Step 2: Resolve bucket IDs from DB before the artwork upsert loop**

Find the place where artists are resolved (the `artistIdLookup` construction). After that block, add:

```typescript
// Resolve medium-category IDs (slug → id) so we can attach without
// per-row category lookups during the artwork upsert loop.
if (Object.keys(bucketMap).length > 0) {
  const { data: mediumCats } = await supabase
    .from("categories")
    .select("id, name")
    .eq("kind", "medium");
  for (const c of mediumCats || []) bucketIdByName[c.name] = c.id;
}
```

- [ ] **Step 3: After artwork upsert, attach medium categories**

After the `withInventory` upsert returns and `artworkCount` is incremented, add a follow-up pass that attaches medium categories. The artwork row has been upserted on `inventory_number`; we need its `id` to insert into `artwork_categories`.

Insert this block right after the existing upsert success path (after `artworkCount += withInventory.length;`):

```typescript
// Attach medium categories for any rows whose medium is in the lookup map.
const unknownMediums = new Set<string>();
for (const r of withInventory) {
  const buckets = mediumToBuckets(bucketMap, r.medium);
  if (buckets.length === 0) {
    if (r.medium) unknownMediums.add(r.medium);
    continue;
  }
  const categoryIds = buckets.map((b) => bucketIdByName[b]).filter(Boolean);
  if (categoryIds.length === 0) continue;

  // Need the artwork id — look up by inventory_number (just upserted)
  const { data: art } = await supabase
    .from("artworks")
    .select("id")
    .eq("inventory_number", r.inventory_number!)
    .single();
  if (!art) continue;

  await supabase
    .from("artwork_categories")
    .upsert(
      categoryIds.map((category_id) => ({ artwork_id: art.id, category_id })),
      { onConflict: "artwork_id,category_id", ignoreDuplicates: true }
    );
}
if (unknownMediums.size > 0) {
  console.warn(`\nWARNING: ${unknownMediums.size} medium strings not in bucket map (artworks have no medium tag):`);
  [...unknownMediums].sort().forEach((m) => console.warn(`  ${m}`));
  console.warn("Re-run `npm run medium:propose` to absorb these into the vocabulary.");
}
```

- [ ] **Step 4: Verify the script still parses**

Run: `npx tsx scripts/import-csv.ts 2>&1 | head -3`
Expected: prints the env-var error or the existing CSV-not-found error. Either way, no syntax/import errors.

---

### Task 10: Update import-archive.ts to attach mediums

**Files:**
- Modify: `scripts/import-archive.ts`

- [ ] **Step 1: Add helper imports + load lookup at top**

Near the existing `import` lines (the script imports `dateToDecade` from `../src/lib/decades` already), add:

```typescript
import { mediumToBuckets, BucketMap } from "./lib/medium-buckets";
```

After the `anthropic` client is constructed (around line 70), add:

```typescript
const BUCKETS_FILE = path.join(__dirname, "data", "medium-buckets.json");
let bucketMap: BucketMap = {};
let bucketIdByName: Record<string, string> = {};
if (fs.existsSync(BUCKETS_FILE)) {
  const lookup = JSON.parse(fs.readFileSync(BUCKETS_FILE, "utf-8"));
  bucketMap = lookup.map || {};
}
```

- [ ] **Step 2: Resolve bucket IDs once at script start**

Inside the `main()` function, after the artworks are fetched but before the worker loop starts, add:

```typescript
if (Object.keys(bucketMap).length > 0) {
  const { data: mediumCats } = await supabase
    .from("categories")
    .select("id, name")
    .eq("kind", "medium");
  for (const c of mediumCats || []) bucketIdByName[c.name] = c.id;
}
```

- [ ] **Step 3: Attach mediums in Branch B insert path**

In the Branch B handler (the path that creates a new artwork with image + Vision + themes), after `attachThemes(newId, themes)` is called, add:

```typescript
// Attach medium categories from the lookup map
const mediumStr = (insertPayload.medium || "").trim();
const buckets = mediumToBuckets(bucketMap, mediumStr);
if (buckets.length > 0) {
  const categoryIds = buckets.map((b) => bucketIdByName[b]).filter(Boolean);
  if (categoryIds.length > 0) {
    await supabase
      .from("artwork_categories")
      .upsert(
        categoryIds.map((category_id) => ({ artwork_id: newId, category_id })),
        { onConflict: "artwork_id,category_id", ignoreDuplicates: true }
      );
  }
} else if (mediumStr) {
  // Track unknown mediums in the log (we'll need to pipe this through)
  log.notes = log.notes
    ? `${log.notes}; medium not in bucket map: ${mediumStr}`
    : `medium not in bucket map: ${mediumStr}`;
}
```

- [ ] **Step 4: Verify the script still parses**

Run: `npx tsx scripts/import-archive.ts 2>&1 | head -3`
Expected: prints `Error: Set NEXT_PUBLIC_SUPABASE_URL ...` (env-var guard).

---

## Phase 6: UI integration

### Task 11: Extend collection-query.ts to handle 3 category dimensions

**Files:**
- Modify: `src/lib/collection-query.ts`

- [ ] **Step 1: Update categoryFilteredIds signature**

Find `categoryFilteredIds` (around line 80). Add a third parameter for mediums and extend the intersection:

```typescript
async function categoryFilteredIds(
  supabase: SupabaseClient,
  themes: string[],
  formats: string[],
  mediums: string[]
): Promise<string[]> {
  async function idsFor(slugs: string[], kind: "theme" | "format" | "medium"): Promise<Set<string>> {
    if (slugs.length === 0) return new Set();
    const rows = await fetchAllRows<{ artwork_id: string }>(() =>
      supabase
        .from("artwork_categories")
        .select("artwork_id, category:categories!inner(slug, kind)")
        .eq("category.kind", kind)
        .in("category.slug", slugs)
    );
    return new Set(rows.map((r: any) => r.artwork_id));
  }

  const [themeIds, formatIds, mediumIds] = await Promise.all([
    idsFor(themes, "theme"),
    idsFor(formats, "format"),
    idsFor(mediums, "medium"),
  ]);

  // Intersect only the active sets; if one dim isn't filtered, it doesn't constrain.
  const sets: Set<string>[] = [];
  if (themes.length > 0) sets.push(themeIds);
  if (formats.length > 0) sets.push(formatIds);
  if (mediums.length > 0) sets.push(mediumIds);
  if (sets.length === 0) return []; // shouldn't be called in this case
  if (sets.length === 1) return [...sets[0]];
  return [...sets[0]].filter((id) => sets.slice(1).every((s) => s.has(id)));
}
```

- [ ] **Step 2: Extend applySingleDimEmbeddedFilter for mediums**

Replace the existing `applySingleDimEmbeddedFilter`:

```typescript
function applySingleDimEmbeddedFilter(
  q: any,
  themes: string[],
  formats: string[],
  mediums: string[]
): any {
  if (themes.length > 0) {
    return q
      .eq("artwork_categories.category.kind", "theme")
      .in("artwork_categories.category.slug", themes);
  }
  if (formats.length > 0) {
    return q
      .eq("artwork_categories.category.kind", "format")
      .in("artwork_categories.category.slug", formats);
  }
  if (mediums.length > 0) {
    return q
      .eq("artwork_categories.category.kind", "medium")
      .in("artwork_categories.category.slug", mediums);
  }
  return q;
}
```

- [ ] **Step 3: Update ExceptDim type**

Find the `ExceptDim` type (near the top, after constants). Update to include `"mediums"`:

```typescript
type ExceptDim = "themes" | "formats" | "mediums" | "decades" | "artist" | "q" | "none";
```

- [ ] **Step 4: Update queryArtworks to pass mediums through**

In `queryArtworks`, replace the existing `themes` / `formats` / `isOneDim` / `isTwoDim` block (around line 230) with:

```typescript
  const themes = state.themes;
  const formats = state.formats;
  const mediums = state.mediums;
  const activeCatDims = [themes.length > 0, formats.length > 0, mediums.length > 0].filter(Boolean).length;
  const isOneDim = activeCatDims === 1;
  const isMultiDim = activeCatDims >= 2;

  let intersectedIds: string[] | null = null;
  if (isMultiDim) {
    intersectedIds = await categoryFilteredIds(supabase, themes, formats, mediums);
    if (intersectedIds.length === 0) return { artworks: [], total: 0 };
  }
```

Then in the same function, change the `applySingleDimEmbeddedFilter` call to pass mediums:

```typescript
  if (isOneDim) {
    q = applySingleDimEmbeddedFilter(q, themes, formats, mediums);
  } else if (isMultiDim) {
    q = q.in("id", intersectedIds!);
  }
```

(Replace `isTwoDim` references with `isMultiDim` in this function.)

- [ ] **Step 5: Update candidateIdsExcept the same way**

In `candidateIdsExcept`, find:

```typescript
  const themes = except === "themes" ? [] : state.themes;
  const formats = except === "formats" ? [] : state.formats;
  const isOneDim = (themes.length > 0) !== (formats.length > 0);
  const isTwoDim = themes.length > 0 && formats.length > 0;
```

Replace with:

```typescript
  const themes = except === "themes" ? [] : state.themes;
  const formats = except === "formats" ? [] : state.formats;
  const mediums = except === "mediums" ? [] : state.mediums;
  const activeCatDims = [themes.length > 0, formats.length > 0, mediums.length > 0].filter(Boolean).length;
  const isOneDim = activeCatDims === 1;
  const isMultiDim = activeCatDims >= 2;

  let intersectedIds: string[] | null = null;
  if (isMultiDim) {
    intersectedIds = await categoryFilteredIds(supabase, themes, formats, mediums);
    if (intersectedIds.length === 0) return new Set();
  }
```

And in the same function change `applySingleDimEmbeddedFilter(q, themes, formats)` to `applySingleDimEmbeddedFilter(q, themes, formats, mediums)`, and `isTwoDim` to `isMultiDim`.

- [ ] **Step 6: Add mediums facet to getFacetCounts + FacetCounts interface**

Update the `FacetCounts` interface near the top:

```typescript
export interface FacetCounts {
  themes: Record<string, number>;
  formats: Record<string, number>;
  mediums: Record<string, number>;
  decades: Record<string, number>;
  availableArtistSlugs: Set<string>;
}
```

Update `getFacetCounts` to compute mediums in parallel:

```typescript
export async function getFacetCounts(
  supabase: SupabaseClient,
  state: FilterState,
  cohort: Cohort
): Promise<FacetCounts> {
  const artistId = await resolveArtistId(supabase, state.artist);

  const [themeIds, formatIds, mediumIds, decadeIds, artistIds] = await Promise.all([
    candidateIdsExcept(supabase, state, cohort, artistId, "themes"),
    candidateIdsExcept(supabase, state, cohort, artistId, "formats"),
    candidateIdsExcept(supabase, state, cohort, artistId, "mediums"),
    candidateIdsExcept(supabase, state, cohort, artistId, "decades"),
    candidateIdsExcept(supabase, state, cohort, artistId, "artist"),
  ]);

  const [themes, formats, mediums, decades, availableArtistSlugs] = await Promise.all([
    countCategoriesForIds(supabase, themeIds, "theme"),
    countCategoriesForIds(supabase, formatIds, "format"),
    countCategoriesForIds(supabase, mediumIds, "medium"),
    countDecadesForIds(supabase, decadeIds),
    artistsForIds(supabase, artistIds),
  ]);

  return { themes, formats, mediums, decades, availableArtistSlugs };
}
```

Update the `countCategoriesForIds` signature to accept `medium` as a kind value:

```typescript
async function countCategoriesForIds(
  supabase: SupabaseClient,
  candidateIds: Set<string>,
  kind: "theme" | "format" | "medium"
): Promise<Record<string, number>> {
```

(Body unchanged.)

- [ ] **Step 7: Verify type-check still passes**

Run: `npm run lint 2>&1 | tail -5`
Expected: no errors.

---

### Task 12: Add Medium dropdown to FilterBar

**Files:**
- Modify: `src/components/FilterBar.tsx`

- [ ] **Step 1: Add `mediumOptions` prop**

In `FilterBarProps`, add after `formatOptions`:

```typescript
  mediumOptions: { value: string; label: string; count: number }[];
```

- [ ] **Step 2: Render the Medium dropdown after Format**

In the JSX, find the Format dropdown block (the one wrapped in `{isCollection && (`). After it, before the Artist dropdown, add:

```tsx
        {isCollection && (
          <MultiSelectDropdown
            label="Medium"
            options={mediumOptions}
            selected={state.mediums}
            onChange={(mediums) => navigate({ ...state, mediums })}
          />
        )}
```

- [ ] **Step 3: Add medium chips to the active-filter row**

In the `chips` array construction (near where theme/format chips are pushed), add:

```typescript
  for (const m of state.mediums) {
    chips.push({
      label: mediumOptions.find((o) => o.value === m)?.label || m,
      onRemove: () => navigate({ ...state, mediums: state.mediums.filter((x) => x !== m) }),
    });
  }
```

- [ ] **Step 4: Update Clear all to also clear mediums**

Find the `onClearAll` prop on `<ActiveFilterChips>`. Update to include mediums in the clear:

```tsx
        onClearAll={() => navigate({ ...state, themes: [], formats: [], mediums: [], decades: [], artist: null })}
```

- [ ] **Step 5: Destructure the new prop in the function signature**

The function signature should now read:

```typescript
export default function FilterBar({
  state,
  cohort,
  themeOptions,
  formatOptions,
  mediumOptions,
  decadeOptions,
  artistOptions,
}: FilterBarProps) {
```

- [ ] **Step 6: Lint**

Run: `npm run lint 2>&1 | tail -3`
Expected: no errors.

---

### Task 13: Plumb medium options through the home page

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Fetch medium categories alongside themes/formats**

Find the existing `Promise.all` at the top of `HomePage` (~line 27). It currently fetches artworks, facets, formatCats, themeCats, allArtists. Add a `mediumCats` fetch:

```typescript
  const [{ artworks, total }, facets, formatCats, themeCats, mediumCats, allArtists] = await Promise.all([
    queryArtworks(supabase, state, "artwork"),
    getFacetCounts(supabase, state, "artwork"),
    supabase.from("categories").select("name, slug").eq("kind", "format").order("name"),
    supabase.from("categories").select("name, slug").eq("kind", "theme").order("name"),
    supabase.from("categories").select("name, slug").eq("kind", "medium").order("name"),
    supabase.from("artists").select("slug, first_name, last_name").order("last_name").order("first_name"),
  ]);
```

- [ ] **Step 2: Build mediumOptions and pass to FilterBar**

After the existing `decadeOptions` construction, add:

```typescript
  const mediumOptions = (mediumCats.data || []).map((c) => ({
    value: c.slug,
    label: c.name,
    count: facets.mediums[c.slug] || 0,
  }));
```

In the `<FilterBar ... />` JSX, add the new prop between `formatOptions` and `decadeOptions`:

```tsx
        formatOptions={formatOptions}
        mediumOptions={mediumOptions}
        decadeOptions={decadeOptions}
```

- [ ] **Step 3: Update preserveParams in Pagination**

In the `<Pagination>` element, update the `preserveParams` to include `medium`:

```tsx
              preserveParams={["q", "theme", "format", "medium", "decade", "artist", "sort"]}
```

- [ ] **Step 4: Lint**

Run: `npm run lint 2>&1 | tail -3`
Expected: no errors.

---

### Task 14: Update ephemera page to pass empty mediumOptions

**Files:**
- Modify: `src/app/ephemera/page.tsx`

- [ ] **Step 1: Add the missing prop**

In the `<FilterBar>` JSX in `src/app/ephemera/page.tsx`, add `mediumOptions={[]}` alongside the existing empty `themeOptions={[]} formatOptions={[]} decadeOptions={[]}`. The cohort doesn't surface medium dropdowns (it's skipped via `isCollection` in FilterBar) but the prop is required.

```tsx
      <FilterBar
        state={state}
        cohort="ephemera"
        themeOptions={[]}
        formatOptions={[]}
        mediumOptions={[]}
        decadeOptions={[]}
        artistOptions={artistOptions}
      />
```

- [ ] **Step 2: Lint**

Run: `npm run lint 2>&1 | tail -3`
Expected: no errors.

---

### Task 15: Sync the migration SQL

**Files:**
- Modify: `supabase/migrations/001_initial.sql`

- [ ] **Step 1: Update the kind CHECK constraint to allow medium**

Find the `categories` table definition. Update the `kind` column's CHECK to include `'medium'`:

```sql
  kind          TEXT CHECK (kind IN ('format', 'theme', 'medium')),
```

- [ ] **Step 2: Verify**

Run: `grep "kind.*CHECK" supabase/migrations/001_initial.sql`
Expected: shows the line with all three kinds listed.

---

### Task 16: Smoke test the UI

**Files:** none (verification)

- [ ] **Step 1: Run lint + tests**

Run: `npm run lint 2>&1 | tail -3`
Expected: clean.

Run: `npx tsx --test scripts/test-filter-state.ts scripts/test-medium-buckets.ts 2>&1 | tail -5`
Expected: all tests pass (14 in filter-state, 5 in medium-buckets).

- [ ] **Step 2: Start dev server**

Run: `npm run dev` (use `run_in_background`).

Wait until `Ready in <X>ms`.

- [ ] **Step 3: Verify Medium dropdown appears**

Run: `curl -s http://localhost:3000/ | grep -oE '"children":"Medium[^"]*"' | head -3`
Expected: prints `"children":"Medium ▾"` (or `"children":"Medium (N) ▾"` if pre-selected).

- [ ] **Step 4: Verify a medium-filtered URL works**

Pick a known medium bucket (e.g., `ink` if that slug was created by Phase 2). Then:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/?medium=ink"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/?medium=ink,acrylic"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/?medium=ink&theme=animals"
```

Expected: all `200`.

- [ ] **Step 5: Verify Medium does NOT appear on /ephemera**

Run: `curl -s "http://localhost:3000/ephemera" | grep -oE '"children":"Medium[^"]*"' | head -3`
Expected: no output (Medium dropdown is hidden on the ephemera cohort).

- [ ] **Step 6: Stop dev server**

Kill the background process.

---

### Task 17: Commit Phase 6 + final cleanup

**Files:** none (git only)

- [ ] **Step 1: Stage all changes**

Run:
```bash
git add scripts/test-filter-state.ts scripts/test-medium-buckets.ts \
  scripts/lib/medium-buckets.ts \
  scripts/normalize-mediums-propose.ts scripts/normalize-mediums-apply.ts \
  scripts/data/medium-buckets.json \
  scripts/import-csv.ts scripts/import-archive.ts \
  src/lib/filter-state.ts src/lib/collection-query.ts \
  src/components/FilterBar.tsx \
  src/app/page.tsx src/app/ephemera/page.tsx \
  supabase/migrations/001_initial.sql \
  package.json
git status
```

Expected: ~12 files staged.

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
Add Medium normalization workflow + Medium filter dropdown

Two-phase LLM workflow normalizes the catalog's 283 free-text medium
strings into a small (~12-18) bucket vocabulary of pure materials,
following CDWA conventions:

- scripts/normalize-mediums-propose.ts: Phase 1. Calls Claude with the
  distinct medium strings, gets back a bucket vocabulary + per-string
  mapping (multi-tag where the medium describes multiple materials).
  Writes tmp/medium-buckets_<ts>.csv for human review in Sheets.

- scripts/normalize-mediums-apply.ts: Phase 2. Reads the
  (possibly-edited) CSV, upserts kind='medium' rows in the categories
  table, diffs each artwork's medium-category attachments against
  the desired set, persists scripts/data/medium-buckets.json for the
  importers.

- scripts/data/medium-buckets.json: source-controlled lookup map
  consumed by import-csv.ts and import-archive.ts on insert. Unknown
  mediums are logged as warnings; affected artworks land with no
  medium tag until the next normalization pass.

UI: new "Medium" multi-select dropdown in FilterBar (after Format).
collection-query.ts generalized from 2 to 3 category dimensions —
the 1-dim embedded filter and 2+-dim catIds intersection paths
extend cleanly via a small refactor of the active-dim count.

Schema: extended the categories.kind CHECK constraint to allow
'medium' (manually applied via Supabase SQL Editor; source-controlled
migration file synced).

Spec: docs/superpowers/specs/2026-04-25-medium-normalization-design.md
Plan: docs/superpowers/plans/2026-04-25-medium-normalization.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds.

---

## Done

At this point:
- The DB has a `kind='medium'` taxonomy with ~12-18 buckets and ~2,710 artworks attached to one or more medium categories.
- The home page has a working Medium dropdown with facet counts that compose correctly with theme / format / decade / artist / search.
- `scripts/data/medium-buckets.json` ships in source control. Future imports automatically attach medium categories on insert.
- Unknown mediums in future imports surface as console warnings (action item: re-run `npm run medium:propose`).

Hand-off:
- The bucket vocabulary is editable: re-run Phase 1, edit the CSV, run Phase 2 again — the diff-based apply handles add/remove/reassign cleanly.
- A future enhancement could surface medium tags on the artwork detail page or as small chips on cards. Both are out of scope for v1.
