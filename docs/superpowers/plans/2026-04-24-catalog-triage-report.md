# Catalog Triage Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce three timestamped CSVs (per-artwork audit, per-artist summary, tag-frequency comparison) that let Creative Growth triage the artworks DB by comparing two source datasets — `MC APR 2` (the original Art Cloud export) and `1stdibs_clir_picks_2026-03-17` (the curated picks).

**Architecture:** A single read-only `tsx` script that parses both source CSVs into in-memory sets, pages through the DB once for full artwork+artist+theme-count data, computes per-artwork classification + per-artist + per-tag aggregates in memory, and writes three CSVs to `tmp/`. No DB writes, no concurrency, no checkpointing — runtime under a minute on the current ~3,260-row catalog.

**Tech Stack:** TypeScript, Node 20+, `tsx`, `csv-parse/sync`, `@supabase/supabase-js`, Node's built-in `node:test`.

**Spec reference:** `docs/superpowers/specs/2026-04-24-catalog-triage-report-design.md`

---

## File Structure

**New files:**
- `src/lib/dates.ts` — pure utility `extractYear(raw: string | null): number | null`. Lives in `src/lib/` because Project B's decade-dropdown UI will need the same parsing logic.
- `scripts/test-dates.ts` — `node:test` assertions for `extractYear`.
- `scripts/catalog-triage-report.ts` — main script.

**Modified files:**
- `package.json` — add `triage:report` npm script.

---

## Phase 0: Pre-flight

### Task 0: Confirm DB has the expected shape

**Files:** none (read-only verification)

- [ ] **Step 1: Check artworks columns + at least one theme row**

Run:
```bash
npx tsx --env-file=.env.local -e "
import { createClient } from '@supabase/supabase-js';
const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
Promise.all([
  c.from('artworks').select('id, sku, image_url, description_origin, on_website, tags, date_created, medium, title').limit(1),
  c.from('categories').select('id', { count: 'exact', head: true }).eq('kind', 'theme'),
]).then(([a, t]) => {
  if (a.error || t.error) { console.error(a.error || t.error); process.exit(1); }
  console.log('OK - artworks columns:', Object.keys(a.data[0]));
  console.log('OK - theme categories:', t.count);
});
"
```

Expected: prints both artwork columns (must include `sku`, `image_url`, `description_origin`, `on_website`, `tags`) and a non-zero theme category count (should be 8 from the prior PR).

- [ ] **Step 2: Check both source CSVs are readable**

Run:
```bash
ls -la inventory_2026-04-02.csv "tmp/ADD TAGS TO CREATIVE GROWTH PUBLIC ARCHIVE - 1stdibs_clir_picks_2026-03-17.csv"
```

Expected: both files listed with non-zero size.

If either is missing, stop and report.

---

## Phase 1: Code

### Task 1: TDD year extractor — failing tests first

**Files:**
- Create: `scripts/test-dates.ts`

- [ ] **Step 1: Write the test file**

Create `scripts/test-dates.ts`:

```typescript
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { extractYear } from "../src/lib/dates";

test("returns null for null input", () => {
  assert.equal(extractYear(null), null);
});

test("returns null for empty string", () => {
  assert.equal(extractYear(""), null);
  assert.equal(extractYear("   "), null);
});

test("returns null for 'ND' (no date)", () => {
  assert.equal(extractYear("ND"), null);
  assert.equal(extractYear("nd"), null);
});

test("parses a four-digit year", () => {
  assert.equal(extractYear("1992"), 1992);
});

test("parses a four-digit year with surrounding whitespace", () => {
  assert.equal(extractYear("  2007  "), 2007);
});

test("parses a year out of a M/D/YYYY date", () => {
  assert.equal(extractYear("7/20/1987"), 1987);
});

test("parses a year out of an ISO date", () => {
  assert.equal(extractYear("1987-07-20"), 1987);
});

test("parses a year out of a circa string", () => {
  assert.equal(extractYear("c. 1990"), 1990);
  assert.equal(extractYear("circa 2003"), 2003);
});

test("parses a year out of a decade-style string by taking the first valid year", () => {
  assert.equal(extractYear("1990s"), 1990);
});

test("returns null when no four-digit year is present", () => {
  assert.equal(extractYear("nineteen ninety"), null);
  assert.equal(extractYear("?"), null);
});

test("rejects implausibly small or large years (< 1900 or > current year + 1)", () => {
  assert.equal(extractYear("0042"), null);
  assert.equal(extractYear("1850"), null);
  assert.equal(extractYear("9999"), null);
});

test("takes the first 4-digit year if multiple are present", () => {
  assert.equal(extractYear("1985-1990"), 1985);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx tsx --test scripts/test-dates.ts`
Expected: All tests fail with `Error: Cannot find module '../src/lib/dates'`.

---

### Task 2: Implement year extractor

**Files:**
- Create: `src/lib/dates.ts`

- [ ] **Step 1: Write the implementation**

Create `src/lib/dates.ts`:

```typescript
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
```

- [ ] **Step 2: Run the tests and verify they pass**

Run: `npx tsx --test scripts/test-dates.ts`
Expected: All 12 tests pass.

---

### Task 3: Implement the triage report script

**Files:**
- Create: `scripts/catalog-triage-report.ts`

- [ ] **Step 1: Write the script**

Create `scripts/catalog-triage-report.ts`:

```typescript
#!/usr/bin/env npx tsx
/**
 * catalog-triage-report.ts
 *
 * Read-only audit of the artworks catalog. Compares two source
 * datasets — MC APR 2 (inventory_2026-04-02.csv, the original Art
 * Cloud export) and 1stdibs_clir_picks_2026-03-17 (the curated
 * picks) — and produces three CSVs in tmp/:
 *
 *   1. triage-per-artwork_<ts>.csv   one row per DB artwork
 *   2. triage-per-artist_<ts>.csv    one row per artist
 *   3. triage-tag-frequency_<ts>.csv one row per distinct tag
 *
 * Spec: docs/superpowers/specs/2026-04-24-catalog-triage-report-design.md
 *
 * Run: npx tsx --env-file=.env.local scripts/catalog-triage-report.ts
 */

import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";
import { extractYear } from "../src/lib/dates";

// ─── Config ───────────────────────────────────────────────────────────────
const TMP_DIR = path.join(__dirname, "..", "tmp");
const MC_APR_2_PATH = path.join(__dirname, "..", "inventory_2026-04-02.csv");
const ONESTDIBS_PATH = path.join(
  TMP_DIR,
  "ADD TAGS TO CREATIVE GROWTH PUBLIC ARCHIVE - 1stdibs_clir_picks_2026-03-17.csv"
);

const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-");
const PER_ARTWORK_FILE = path.join(TMP_DIR, `triage-per-artwork_${TIMESTAMP}.csv`);
const PER_ARTIST_FILE = path.join(TMP_DIR, `triage-per-artist_${TIMESTAMP}.csv`);
const TAG_FREQ_FILE = path.join(TMP_DIR, `triage-tag-frequency_${TIMESTAMP}.csv`);

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

// ─── Types ────────────────────────────────────────────────────────────────
interface ArtworkRow {
  id: string;
  sku: string | null;
  title: string;
  medium: string | null;
  date_created: string | null;
  image_url: string | null;
  description_origin: "human" | "ai" | null;
  on_website: boolean;
  tags: string[] | null;
  artist: { first_name: string; last_name: string } | null;
  categories: { category: { kind: string | null } | null }[] | null;
}

type Bucket = "both" | "mc_apr_2_only" | "1stdibs_only" | "unknown_source";

interface PerArtworkRow {
  sku: string;
  artist: string;
  title: string;
  medium: string;
  date_created: string;
  bucket: Bucket;
  image_state: "r2" | "artcld" | "null";
  recovery_source: string;
  recovery_url: string;
  description_origin: string;
  theme_count: string;
  tag_count: string;
  tags: string;
  on_website: string;
}

interface PerArtistRow {
  artist: string;
  total_artworks: string;
  mc_apr_2_count: string;
  "1stdibs_count": string;
  both_count: string;
  mc_apr_2_only_count: string;
  mediums: string;
  date_range: string;
  null_image_count: string;
  top_tags: string;
}

interface TagFreqRow {
  tag: string;
  total_count: string;
  mc_apr_2_only_count: string;
  "1stdibs_count": string;
  signal_ratio: string;
}

// ─── CSV helpers ──────────────────────────────────────────────────────────
function csvField(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(filePath: string, columns: string[], rows: Record<string, string>[]): void {
  const header = columns.join(",");
  const body = rows.map((r) => columns.map((c) => csvField(r[c])).join(",")).join("\n");
  fs.writeFileSync(filePath, header + "\n" + body + "\n");
}

// ─── Source-CSV parsing ───────────────────────────────────────────────────
function loadMcApr2Skus(): Set<string> {
  if (!fs.existsSync(MC_APR_2_PATH)) {
    console.error(`MC APR 2 CSV not found: ${MC_APR_2_PATH}`);
    process.exit(1);
  }
  const rows = parse(fs.readFileSync(MC_APR_2_PATH, "utf-8"), {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  }) as { SKU?: string }[];
  const skus = new Set<string>();
  for (const r of rows) {
    const sku = (r.SKU || "").trim();
    if (sku) skus.add(sku);
  }
  return skus;
}

function load1stdibsSkuMap(): Map<string, string> {
  if (!fs.existsSync(ONESTDIBS_PATH)) {
    console.error(`1stdibs picks CSV not found: ${ONESTDIBS_PATH}`);
    process.exit(1);
  }
  const rows = parse(fs.readFileSync(ONESTDIBS_PATH, "utf-8"), {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  }) as { SKU?: string; "Link 1"?: string }[];
  const map = new Map<string, string>();
  for (const r of rows) {
    const sku = (r.SKU || "").trim();
    const link = (r["Link 1"] || "").trim();
    if (sku) map.set(sku, link);
  }
  return map;
}

// ─── Image-state classification ───────────────────────────────────────────
function classifyImage(url: string | null): "r2" | "artcld" | "null" {
  if (!url) return "null";
  if (url.includes("artcld.com")) return "artcld";
  return "r2"; // any non-null, non-artcld URL is treated as R2 / R2-relative
}

// ─── Main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log("Loading source CSVs...");
  const mcApr2 = loadMcApr2Skus();
  const onestdibs = load1stdibsSkuMap();
  console.log(`  MC APR 2: ${mcApr2.size} unique SKUs`);
  console.log(`  1stdibs:  ${onestdibs.size} unique SKUs`);

  console.log("Fetching artworks from DB...");
  const artworks: ArtworkRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("artworks")
      .select(`
        id, sku, title, medium, date_created, image_url,
        description_origin, on_website, tags,
        artist:artists(first_name, last_name),
        categories:artwork_categories(category:categories(kind))
      `)
      .order("sku", { ascending: true, nullsFirst: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      console.error("Error fetching artworks:", error);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    artworks.push(...(data as unknown as ArtworkRow[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  console.log(`  ${artworks.length} artworks fetched`);

  // ── Per-artwork rows ────────────────────────────────────────────────────
  let unknownSourceCount = 0;
  const perArtwork: PerArtworkRow[] = [];
  for (const a of artworks) {
    const sku = (a.sku || "").trim();
    const inMc = sku && mcApr2.has(sku);
    const inOd = sku && onestdibs.has(sku);

    let bucket: Bucket;
    if (inMc && inOd) bucket = "both";
    else if (inMc) bucket = "mc_apr_2_only";
    else if (inOd) bucket = "1stdibs_only";
    else { bucket = "unknown_source"; unknownSourceCount++; }

    const imageState = classifyImage(a.image_url);
    const recovery_source =
      imageState === "null" && inOd && onestdibs.get(sku) ? "1stdibs_link_1_available" : "";
    const recovery_url =
      recovery_source === "1stdibs_link_1_available" ? (onestdibs.get(sku) || "") : "";

    const themeCount = (a.categories || []).filter((c) => c.category?.kind === "theme").length;
    const tagCount = (a.tags || []).length;

    const artistName = a.artist
      ? `${a.artist.first_name} ${a.artist.last_name}`.trim() || "Unknown"
      : "Unknown";

    perArtwork.push({
      sku,
      artist: artistName,
      title: a.title || "",
      medium: a.medium || "",
      date_created: a.date_created || "",
      bucket,
      image_state: imageState,
      recovery_source,
      recovery_url,
      description_origin: a.description_origin || "",
      theme_count: String(themeCount),
      tag_count: String(tagCount),
      tags: (a.tags || []).join("; "),
      on_website: a.on_website ? "true" : "false",
    });
  }

  // Sort: artist, then sku
  perArtwork.sort((x, y) => {
    if (x.artist !== y.artist) return x.artist.localeCompare(y.artist);
    return x.sku.localeCompare(y.sku);
  });

  // ── Per-artist aggregation ──────────────────────────────────────────────
  interface ArtistAgg {
    artist: string;
    total: number;
    inMc: number;
    inOd: number;
    inBoth: number;
    mcOnly: number;
    mediums: Set<string>;
    years: number[];
    nullImages: number;
    tagCounts: Map<string, number>;
  }
  const byArtist = new Map<string, ArtistAgg>();
  for (const r of perArtwork) {
    const agg = byArtist.get(r.artist) || {
      artist: r.artist, total: 0, inMc: 0, inOd: 0, inBoth: 0, mcOnly: 0,
      mediums: new Set(), years: [], nullImages: 0, tagCounts: new Map(),
    };
    agg.total++;
    if (r.bucket === "both") { agg.inMc++; agg.inOd++; agg.inBoth++; }
    else if (r.bucket === "mc_apr_2_only") { agg.inMc++; agg.mcOnly++; }
    else if (r.bucket === "1stdibs_only") { agg.inOd++; }
    if (r.medium) agg.mediums.add(r.medium.toLowerCase().trim());
    const y = extractYear(r.date_created);
    if (y !== null) agg.years.push(y);
    if (r.image_state === "null") agg.nullImages++;
    if (r.tags) {
      for (const t of r.tags.split(";").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
        agg.tagCounts.set(t, (agg.tagCounts.get(t) || 0) + 1);
      }
    }
    byArtist.set(r.artist, agg);
  }

  const perArtist: PerArtistRow[] = [...byArtist.values()]
    .sort((a, b) => b.total - a.total)
    .map((agg) => {
      const dateRange = agg.years.length > 0
        ? `${Math.min(...agg.years)}–${Math.max(...agg.years)}`
        : "";
      const topTags = [...agg.tagCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([t]) => t)
        .join(", ");
      return {
        artist: agg.artist,
        total_artworks: String(agg.total),
        mc_apr_2_count: String(agg.inMc),
        "1stdibs_count": String(agg.inOd),
        both_count: String(agg.inBoth),
        mc_apr_2_only_count: String(agg.mcOnly),
        mediums: [...agg.mediums].sort().join(", "),
        date_range: dateRange,
        null_image_count: String(agg.nullImages),
        top_tags: topTags,
      };
    });

  // ── Tag frequency ───────────────────────────────────────────────────────
  interface TagAgg {
    tag: string;
    total: number;
    mcOnly: number;
    inOd: number;
  }
  const byTag = new Map<string, TagAgg>();
  for (const r of perArtwork) {
    if (!r.tags) continue;
    const tags = r.tags.split(";").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const seen = new Set<string>(); // dedup tags within a single artwork's tag list
    for (const t of tags) {
      if (seen.has(t)) continue;
      seen.add(t);
      const agg = byTag.get(t) || { tag: t, total: 0, mcOnly: 0, inOd: 0 };
      agg.total++;
      if (r.bucket === "mc_apr_2_only") agg.mcOnly++;
      if (r.bucket === "both" || r.bucket === "1stdibs_only") agg.inOd++;
      byTag.set(t, agg);
    }
  }

  const tagFreq: TagFreqRow[] = [...byTag.values()]
    .map((agg) => ({
      tag: agg.tag,
      total_count: String(agg.total),
      mc_apr_2_only_count: String(agg.mcOnly),
      "1stdibs_count": String(agg.inOd),
      signal_ratio: agg.total > 0 ? (agg.mcOnly / agg.total).toFixed(2) : "0.00",
    }))
    .sort((a, b) => parseFloat(b.signal_ratio) - parseFloat(a.signal_ratio));

  // ── Write outputs ───────────────────────────────────────────────────────
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

  writeCsv(PER_ARTWORK_FILE,
    ["sku", "artist", "title", "medium", "date_created", "bucket", "image_state",
     "recovery_source", "recovery_url", "description_origin", "theme_count",
     "tag_count", "tags", "on_website"],
    perArtwork
  );
  writeCsv(PER_ARTIST_FILE,
    ["artist", "total_artworks", "mc_apr_2_count", "1stdibs_count", "both_count",
     "mc_apr_2_only_count", "mediums", "date_range", "null_image_count", "top_tags"],
    perArtist
  );
  writeCsv(TAG_FREQ_FILE,
    ["tag", "total_count", "mc_apr_2_only_count", "1stdibs_count", "signal_ratio"],
    tagFreq
  );

  // ── Summary ─────────────────────────────────────────────────────────────
  const byBucket = perArtwork.reduce<Record<string, number>>((acc, r) => {
    acc[r.bucket] = (acc[r.bucket] || 0) + 1;
    return acc;
  }, {});
  console.log("\n=== Summary ===");
  console.log(`Per-artwork rows: ${perArtwork.length}`);
  Object.entries(byBucket).forEach(([k, v]) => console.log(`  ${k.padEnd(18)} ${v}`));
  console.log(`Per-artist rows:  ${perArtist.length}`);
  console.log(`Tag-freq rows:    ${tagFreq.length}`);
  if (unknownSourceCount > 0) {
    console.log(`\nWARNING: ${unknownSourceCount} artworks in DB but in neither source CSV (bucket='unknown_source'). Investigate.`);
  }
  console.log(`\nPer-artwork: ${PER_ARTWORK_FILE}`);
  console.log(`Per-artist:  ${PER_ARTIST_FILE}`);
  console.log(`Tag-freq:    ${TAG_FREQ_FILE}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Confirm the script's modules resolve**

Run:
```bash
npx tsx scripts/catalog-triage-report.ts 2>&1 | head -3
```

Expected: `Error: Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY` — the script's env-var guard fires before any DB activity, proving imports resolved cleanly.

If you see a "module not found" or syntax error: investigate before continuing.

---

### Task 4: Add npm script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add to scripts block**

In `package.json`, locate the `"scripts"` block. Add this entry after `"import:archive"`:

```json
"triage:report": "tsx --env-file=.env.local scripts/catalog-triage-report.ts"
```

The block (showing only the addition; preserve all existing scripts):

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
  "import:archive": "tsx --env-file=.env.local scripts/import-archive.ts",
  "triage:report": "tsx --env-file=.env.local scripts/catalog-triage-report.ts",
  "migrate:all": "tsx --env-file=.env.local scripts/migrate-and-describe.ts",
  "db:migrate": "tsx scripts/run-migration.ts"
},
```

- [ ] **Step 2: Verify**

Run: `npm run | grep triage:report`
Expected: prints `triage:report`.

---

### Task 5: Commit Phase 1 code

**Files:** none (git only)

- [ ] **Step 1: Stage and commit**

Run:
```bash
git add src/lib/dates.ts scripts/test-dates.ts scripts/catalog-triage-report.ts package.json
git status
```

Expected: 4 files staged. No untracked CSV artifacts (tmp/ is gitignored).

- [ ] **Step 2: Create commit**

Run:
```bash
git commit -m "$(cat <<'EOF'
Add catalog triage report script

scripts/catalog-triage-report.ts is a read-only audit that compares
two source datasets — MC APR 2 (the original Art Cloud export) and
1stdibs_clir_picks_2026-03-17 (the curated picks) — against the DB
and produces three timestamped CSVs in tmp/:

  - triage-per-artwork: bucket (both/mc_apr_2_only/1stdibs_only),
                        image_state, recovery_url for null images
                        whose SKU is in the picks
  - triage-per-artist:  total + per-source counts, mediums seen,
                        date range, null_image_count, top tags
  - triage-tag-frequency: signal_ratio surfaces tags that appear
                        disproportionately on mc_apr_2_only artworks
                        (an "ephemera-like" signal)

Pure year-extraction helper at src/lib/dates.ts (will be reused by
Project B's decade dropdown). node:test covers the parser including
"ND", "c. 1990", "7/20/1987", out-of-range filtering.

Read-only; no DB writes, no concurrency. Runtime well under a minute
on the current ~3,260-row catalog.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds.

---

## Phase 2: Run + verify

### Task 6: Run the report and spot-check

**Files:** none (execution only — produces gitignored artifacts)

- [ ] **Step 1: Run it**

Run: `npm run triage:report`

Expected output ends with a summary block:

```
=== Summary ===
Per-artwork rows: ~3260
  both              ~975
  mc_apr_2_only     ~1200
  1stdibs_only      ~1085
Per-artist rows:  ~100
Tag-freq rows:    ~varies (depends on how many distinct tags exist)

Per-artwork: /Users/cullfam/code/cg_clir/tmp/triage-per-artwork_<timestamp>.csv
Per-artist:  /Users/cullfam/code/cg_clir/tmp/triage-per-artist_<timestamp>.csv
Tag-freq:    /Users/cullfam/code/cg_clir/tmp/triage-tag-frequency_<timestamp>.csv
```

Should complete in under 30 seconds. Three CSVs appear in `tmp/`.

If you see `WARNING: N artworks in DB but in neither source CSV`: report the count to the user. The bucket='unknown_source' rows in the per-artwork CSV identify them.

- [ ] **Step 2: Spot-check the per-artwork CSV**

Run: `head -3 tmp/triage-per-artwork_*.csv`
Expected: header row (`sku,artist,title,medium,date_created,bucket,image_state,recovery_source,recovery_url,description_origin,theme_count,tag_count,tags,on_website`) plus 2 sample rows. Sanity-check the first row's bucket and image_state values look plausible.

Run:
```bash
awk -F',' 'NR>1 {print $6}' tmp/triage-per-artwork_*.csv | sort | uniq -c
```
Expected: counts by bucket. Should be roughly `~975 both`, `~1200 mc_apr_2_only`, `~1085 1stdibs_only`, `0 unknown_source`.

- [ ] **Step 3: Spot-check the per-artist CSV**

Run: `head -5 tmp/triage-per-artist_*.csv`
Expected: header row (`artist,total_artworks,mc_apr_2_count,1stdibs_count,both_count,mc_apr_2_only_count,mediums,date_range,null_image_count,top_tags`) plus 4 artist rows, sorted by `total_artworks` descending. The most prolific artists (Judith Scott, Dan Miller, etc., based on prior context) should be at the top.

- [ ] **Step 4: Spot-check the tag-frequency CSV**

Run: `head -10 tmp/triage-tag-frequency_*.csv`
Expected: header row (`tag,total_count,mc_apr_2_only_count,1stdibs_count,signal_ratio`) plus 9 tag rows, sorted by `signal_ratio` descending. The tags at the top (signal_ratio near 1.0) are candidate "this tag mostly appears on triage-cohort artworks" signals — these are what CG should look at first.

If you see something like `ephemera` near the top with a non-trivial `total_count`: that's the kind of signal we hoped to surface. Report any standout tags to the user.

- [ ] **Step 5: Verify a known artwork's row**

The Ron Veasey artwork the user mentioned (`CLIR2024.233`) should appear in the per-artwork CSV with `image_state=null`. Check whether it has a `recovery_url` (only if its SKU is in the 1stdibs picks):

Run:
```bash
grep "^CLIR2024.233," tmp/triage-per-artwork_*.csv
```
Expected: one row showing the artwork's full state. Report whether `recovery_url` is populated (meaning we have a 1stdibs source for the missing image) or empty (meaning we don't, and CG needs to provide one).

---

## Done

At this point:
- Three CSV artifacts in `tmp/` ready to share with Creative Growth.
- The user can open each in Sheets and start triaging:
  - **Per-artist** to make per-artist keep/remove decisions in bulk.
  - **Tag-frequency** to spot triage-signal tags (high `signal_ratio` with non-trivial `total_count`).
  - **Per-artwork** for cross-checking specific SKUs and pulling recovery URLs for null images.
- Follow-up projects can now make data-driven decisions about what to do with the `mc_apr_2_only` cohort (~1,200 artworks), the null-image cohort (~308 artworks), or anything else the report surfaces.
