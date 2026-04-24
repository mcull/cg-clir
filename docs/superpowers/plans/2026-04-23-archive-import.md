# Archive Import & Theme Taxonomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile the artworks DB with `tmp/ADD TAGS TO CREATIVE GROWTH PUBLIC ARCHIVE - 1stdibs_clir_picks_2026-03-17.csv` — upsert theme tags for the 909 SKUs already in the DB and insert + AI-describe the 1,150 SKUs not yet present.

**Architecture:** One main script (`scripts/import-archive.ts`) that pages through the CSV, branches per row on whether the SKU exists in the DB, and dispatches to a small set of helpers (theme normalization extracted as a unit-testable pure function; image download/resize/upload and Claude Vision call copied from `migrate-and-describe.ts` — the spec explicitly accepts duplication for this PR's scope). Concurrency, checkpointing, and idempotency follow the existing `migrate-and-describe.ts` pattern.

**Tech Stack:** TypeScript, Node 20+, `tsx`, `csv-parse/sync`, `@supabase/supabase-js`, `@aws-sdk/client-s3`, `sharp`, `@anthropic-ai/sdk`, Node's built-in test runner.

**Spec reference:** `docs/superpowers/specs/2026-04-23-archive-import-design.md`

---

## File Structure

**New files:**
- `src/lib/themes.ts` — pure function `normalizeThemes(raw: string)` that takes col T's raw string and returns an array of valid theme slugs from the fixed set. Lives in `src/lib/` (not `scripts/lib/`) because Project B's UI work will need it too.
- `scripts/test-themes.ts` — `node:test` assertions for `normalizeThemes`.
- `scripts/import-archive.ts` — main script. Parses CSV, branches per-row, handles new-row insert pipeline, writes log artifact.

**Modified files:**
- `package.json` — add `import:archive` npm script.
- `supabase/migrations/001_initial.sql` — sync source-controlled schema with the applied `kind` column on `categories` (already added by user via SQL Editor).

---

## Phase 0: Pre-flight

### Task 0: Verify the `kind` column exists on `categories`

**Files:** none (read-only verification)

- [ ] **Step 1: Confirm column exists**

Run:
```bash
npx tsx --env-file=.env.local -e "
import { createClient } from '@supabase/supabase-js';
const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
c.from('categories').select('id, name, kind').limit(3).then(({data, error}) => {
  if (error) { console.error('SCHEMA MISMATCH:', error.message); process.exit(1); }
  console.log('OK - kind column exists. Sample:');
  data.forEach(r => console.log('  ', JSON.stringify(r)));
});
"
```

Expected: prints `OK - kind column exists.` followed by 3 sample category rows. The existing categories should show `kind: 'format'` (per the spec's backfill SQL).

If this fails: stop. The user needs to re-run the SQL from the spec's "Schema changes" section.

---

## Phase 1: Code

### Task 1: TDD theme normalization — failing test first

**Files:**
- Create: `scripts/test-themes.ts`

- [ ] **Step 1: Write the test file**

Create `scripts/test-themes.ts`:

```typescript
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { normalizeThemes, VALID_THEMES } from "../src/lib/themes";

test("strips 'clir' prefix and returns the bare slug", () => {
  assert.deepEqual(normalizeThemes("clir abstract"), ["abstract"]);
});

test("strips 'clear' prefix as well as 'clir'", () => {
  assert.deepEqual(normalizeThemes("clear plants"), ["plants"]);
});

test("accepts comma-separated multi-theme strings", () => {
  assert.deepEqual(
    normalizeThemes("clir abstract, clir people"),
    ["abstract", "people"]
  );
});

test("trims whitespace and lowercases", () => {
  assert.deepEqual(normalizeThemes("  CLIR Abstract  "), ["abstract"]);
});

test("preserves multi-word themes ('pop culture')", () => {
  assert.deepEqual(normalizeThemes("clir pop culture"), ["pop culture"]);
});

test("returns empty array for empty input", () => {
  assert.deepEqual(normalizeThemes(""), []);
  assert.deepEqual(normalizeThemes("   "), []);
});

test("dedupes within a single row", () => {
  assert.deepEqual(
    normalizeThemes("clir abstract, clear abstract"),
    ["abstract"]
  );
});

test("drops values not in the fixed VALID_THEMES set", () => {
  // 'date tag' style values should not survive
  assert.deepEqual(normalizeThemes("clir 1980s"), []);
  assert.deepEqual(normalizeThemes("clir music, clir bogus"), ["music"]);
});

test("VALID_THEMES is exactly the 8 expected values", () => {
  assert.deepEqual(
    [...VALID_THEMES].sort(),
    ["abstract", "animals", "food", "music", "other", "people", "plants", "pop culture"]
  );
});

test("returns themes in the order they appear (after dedup)", () => {
  assert.deepEqual(
    normalizeThemes("clir music, clir abstract, clir people"),
    ["music", "abstract", "people"]
  );
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx tsx --test scripts/test-themes.ts`
Expected: All tests fail with `Error: Cannot find module '../src/lib/themes'`.

---

### Task 2: Implement theme normalization

**Files:**
- Create: `src/lib/themes.ts`

- [ ] **Step 1: Write the implementation**

Create `src/lib/themes.ts`:

```typescript
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
```

- [ ] **Step 2: Run the test and verify it passes**

Run: `npx tsx --test scripts/test-themes.ts`
Expected: All 10 tests pass.

---

### Task 3: Implement the main import script

**Files:**
- Create: `scripts/import-archive.ts`

- [ ] **Step 1: Write the script**

Create `scripts/import-archive.ts`:

```typescript
#!/usr/bin/env npx tsx
/**
 * import-archive.ts
 *
 * Reconciles the artworks DB with the 1stDibs picks CSV.
 *
 *   For each CSV row:
 *     - If SKU exists in DB:    upsert theme tags only (no other changes).
 *     - If SKU does NOT exist:  insert artwork from CSV metadata,
 *                                download image, upload R2 variants,
 *                                generate AI alt text via Claude Vision,
 *                                attach themes.
 *
 * SKUs in DB but not in this CSV are LEFT ALONE (no inactive marking).
 * Existing artworks' metadata is NOT refreshed from this CSV.
 *
 * See spec: docs/superpowers/specs/2026-04-23-archive-import-design.md
 *
 * Run: npx tsx --env-file=.env.local scripts/import-archive.ts
 *
 * Resumable: progress checkpointed to scripts/.archive-import-progress.json.
 */

import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";
import { normalizeThemes, VALID_THEMES } from "../src/lib/themes";
import { slugify, parseNumeric } from "../src/lib/utils";

// ─── Config ───────────────────────────────────────────────────────────────
const TMP_DIR = path.join(__dirname, "..", "tmp");
const CSV_PATH = path.join(
  TMP_DIR,
  "ADD TAGS TO CREATIVE GROWTH PUBLIC ARCHIVE - 1stdibs_clir_picks_2026-03-17.csv"
);
const PROGRESS_FILE = path.join(__dirname, ".archive-import-progress.json");
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-");
const LOG_FILE = path.join(TMP_DIR, `archive-import-log_${TIMESTAMP}.csv`);

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Error: Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const R2_ENDPOINT = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const BUCKET = process.env.R2_BUCKET_NAME || "cg-clir";
const PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || process.env.R2_PUBLIC_URL || "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_KEY) {
  console.error("Error: ANTHROPIC_API_KEY is required for Vision calls");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const r2 = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

const CONCURRENCY = parseInt(process.env.CONCURRENCY || "3", 10);
const PAGE_SIZE = 1000;
const VISION_MODEL = "claude-sonnet-4-20250514";
const VARIANTS = [
  { name: "original", maxWidth: null },
  { name: "large_1600", maxWidth: 1600 },
  { name: "medium_800", maxWidth: 800 },
  { name: "thumb_400", maxWidth: 400 },
] as const;

const SYSTEM_PROMPT = `You are an expert museum curator writing accessible image descriptions for visually impaired visitors to an art gallery.

For each image, provide a JSON response with two fields:

1. "alt_text": A concise description (under 125 characters) for the img alt attribute. Identify the artwork type, primary visual content, and medium. Be factual, not interpretive.

2. "description": Two or three sentences describing the artwork for someone who is blind or visually impaired. Start with the most important details — describe the content of the image directly. DO NOT start sentences with "The artwork is...", "This is a picture of...", "Presented is...", or similar framing. Avoid assumptions about gender; if describing gender presentation of a figure, use descriptive terms like fem, femme, or masc. Note composition, color palette, texture, and technique. Maintain a respectful, museum-professional tone. Do not speculate about the artist's intent or emotional state.

Respond ONLY with valid JSON. No markdown, no code fences, no extra text.`;

// ─── Types ────────────────────────────────────────────────────────────────
interface CsvRow {
  "Link 1"?: string;
  SKU?: string;
  "Artist Name"?: string;
  "Title *"?: string;
  "Medium 1 *"?: string;
  "Creation Date (if available)"?: string;
  "Creation Year"?: string;
  "Height *"?: string;
  Width?: string;
  Depth?: string;
  [key: string]: string | undefined;
}

interface DbArtwork {
  id: string;
  sku: string | null;
}

interface ThemeCategory {
  id: string;
  name: string;
}

interface Progress {
  done: string[]; // SKUs that have completed processing (any branch)
}

interface LogRow {
  sku: string;
  branch: string;
  themes_attached: string;
  themes_dropped: string;
  image_status: string;
  ai_status: string;
  artwork_id: string;
  notes: string;
}

// ─── Progress checkpoint ──────────────────────────────────────────────────
function loadProgress(): Progress {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8"));
  }
  return { done: [] };
}
function saveProgress(p: Progress): void {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));
}

// ─── CSV output helpers ───────────────────────────────────────────────────
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

// ─── Image download + R2 upload + Vision (copied from migrate-and-describe) ───
async function downloadImage(url: string, retries = 3): Promise<Buffer> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error("unreachable");
}

async function uploadVariants(baseKey: string, imageBuffer: Buffer): Promise<{ newUrl: string; mediumBuffer: Buffer }> {
  let mediumBuffer: Buffer = imageBuffer;
  for (const variant of VARIANTS) {
    let processed: Buffer;
    if (variant.maxWidth === null) {
      processed = imageBuffer;
    } else {
      processed = await sharp(imageBuffer)
        .resize({ width: variant.maxWidth, withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      if (variant.name === "medium_800") mediumBuffer = processed;
    }
    const key = `${baseKey}/${variant.name}.jpg`;
    await r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: processed,
      ContentType: "image/jpeg",
      CacheControl: "public, max-age=31536000, immutable",
    }));
  }
  const newUrl = PUBLIC_URL ? `${PUBLIC_URL}/${baseKey}/large_1600.jpg` : `${baseKey}/large_1600.jpg`;
  return { newUrl, mediumBuffer };
}

async function generateDescription(
  mediumBuffer: Buffer,
  title: string,
  artistName: string,
  medium: string | null,
  dimensions: string | null
): Promise<{ alt_text: string; description: string }> {
  const base64 = mediumBuffer.toString("base64");
  const contextParts = [`Title: ${title}`, `Artist: ${artistName}`];
  if (medium) contextParts.push(`Medium: ${medium}`);
  if (dimensions) contextParts.push(`Dimensions: ${dimensions}`);

  const response = await anthropic.messages.create({
    model: VISION_MODEL,
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
        { type: "text", text: `Describe this artwork.\n\n${contextParts.join("\n")}` },
      ],
    }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const parsed = JSON.parse(cleaned);
  if (!parsed.alt_text || !parsed.description) throw new Error("Missing alt_text or description in Vision response");
  return { alt_text: parsed.alt_text, description: parsed.description };
}

// ─── Caches + single-flight (concurrency-safe) ────────────────────────────
// With CONCURRENCY > 1, two workers can race on the same theme or artist.
// We cache resolved IDs and gate concurrent resolves through inflight maps
// so only one DB roundtrip per unique key happens, and we use upsert with
// onConflict for the actual write to be defensively safe against any
// race we didn't anticipate.

const themeCategoryCache = new Map<string, string>();
const themeCategoryInflight = new Map<string, Promise<string>>();

async function ensureThemeCategory(name: string): Promise<string> {
  if (themeCategoryCache.has(name)) return themeCategoryCache.get(name)!;
  if (themeCategoryInflight.has(name)) return themeCategoryInflight.get(name)!;

  const promise = (async () => {
    const { data, error } = await supabase
      .from("categories")
      .upsert(
        { name, slug: slugify(name), kind: "theme", ai_suggested: false },
        { onConflict: "slug", ignoreDuplicates: false }
      )
      .select("id")
      .single();
    if (error) throw new Error(`Failed to ensure theme category '${name}': ${error.message}`);
    themeCategoryCache.set(name, data.id);
    return data.id;
  })();
  themeCategoryInflight.set(name, promise);
  try {
    return await promise;
  } finally {
    themeCategoryInflight.delete(name);
  }
}

async function attachThemes(artworkId: string, themes: string[]): Promise<void> {
  for (const theme of themes) {
    const categoryId = await ensureThemeCategory(theme);
    const { error } = await supabase
      .from("artwork_categories")
      .upsert(
        { artwork_id: artworkId, category_id: categoryId },
        { onConflict: "artwork_id,category_id", ignoreDuplicates: true }
      );
    if (error) throw new Error(`Failed to attach theme '${theme}' to artwork ${artworkId}: ${error.message}`);
  }
}

const artistCache = new Map<string, string>(); // slug -> artist id
const artistInflight = new Map<string, Promise<string>>();

async function resolveArtistId(artistName: string): Promise<string | null> {
  const trimmed = artistName.trim();
  if (!trimmed) return null;
  const slug = slugify(trimmed);
  if (artistCache.has(slug)) return artistCache.get(slug)!;
  if (artistInflight.has(slug)) return artistInflight.get(slug)!;

  const parts = trimmed.split(/\s+/);
  const first = parts[0];
  const last = parts.length > 1 ? parts.slice(1).join(" ") : "";

  const promise = (async () => {
    const { data, error } = await supabase
      .from("artists")
      .upsert(
        { first_name: first, last_name: last, slug },
        { onConflict: "slug", ignoreDuplicates: false }
      )
      .select("id")
      .single();
    if (error) throw new Error(`Failed to ensure artist '${trimmed}': ${error.message}`);
    artistCache.set(slug, data.id);
    return data.id;
  })();
  artistInflight.set(slug, promise);
  try {
    return await promise;
  } finally {
    artistInflight.delete(slug);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────
async function main() {
  // 1. Parse CSV
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

  // 2. Load DB SKU set
  console.log("Fetching all artwork SKUs from DB...");
  const dbSkuToId = new Map<string, string>();
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("artworks")
      .select("id, sku")
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) { console.error(error); process.exit(1); }
    if (!data || data.length === 0) break;
    for (const a of data as DbArtwork[]) {
      if (a.sku) dbSkuToId.set(a.sku.trim(), a.id);
    }
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  console.log(`Fetched ${dbSkuToId.size} DB artworks with SKUs`);

  // 3. Load progress checkpoint
  const progress = loadProgress();
  const doneSet = new Set(progress.done);
  console.log(`Already processed in prior runs: ${doneSet.size}`);

  // 4. Build work queue
  const work = rows
    .map((r, idx) => ({ idx, row: r, sku: (r.SKU || "").trim() }))
    .filter(({ sku }) => sku && !doneSet.has(sku));
  console.log(`Remaining rows to process: ${work.length}`);

  if (work.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  // 5. Process with concurrency
  const logs: LogRow[] = [];
  let nextIdx = 0;
  const totalToProcess = work.length;
  let completed = 0;

  async function processRow(item: typeof work[number]): Promise<void> {
    const { row, sku } = item;
    const log: LogRow = {
      sku, branch: "", themes_attached: "", themes_dropped: "",
      image_status: "", ai_status: "", artwork_id: "", notes: "",
    };

    try {
      // Theme normalization (used in both branches)
      const tagsRaw = row["Tags (clir music, clir people, clear plants, clear animals, clear abstract, clear other, clir food, clir pop culture)"]
        // The header may be re-encoded by csv-parse; fall back to scanning all keys for one starting with "Tags"
        || (() => {
          for (const [k, v] of Object.entries(row)) {
            if (k.startsWith("Tags")) return v as string;
          }
          return "";
        })();
      const themes = normalizeThemes(tagsRaw || "");

      // What was dropped? Compare normalized vs raw pieces
      const rawPieces = (tagsRaw || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      const droppedRaw = rawPieces
        .map((p) => p.replace(/^clir\s+/, "").replace(/^clear\s+/, ""))
        .filter((p) => p && !VALID_THEMES.has(p));
      log.themes_dropped = [...new Set(droppedRaw)].join("; ");

      const existingId = dbSkuToId.get(sku);
      if (existingId) {
        // Branch A: theme upsert only
        log.branch = "existing_themed";
        log.artwork_id = existingId;
        await attachThemes(existingId, themes);
        log.themes_attached = themes.join("; ");
      } else {
        // Branch B: full insert + image + AI + themes
        log.branch = "inserted";

        // Resolve artist
        const artistName = (row["Artist Name"] || "").trim();
        const artistId = artistName ? await resolveArtistId(artistName) : null;

        // Insert artwork row first to get a UUID for R2 keying
        const csvImage = (row["Link 1"] || "").trim();
        const dateStr = (row["Creation Date (if available)"] || row["Creation Year"] || "").trim();
        const insertPayload = {
          title: (row["Title *"] || "Untitled").trim(),
          sku,
          artist_id: artistId,
          medium: (row["Medium 1 *"] || "").trim() || null,
          date_created: dateStr || null,
          height: parseNumeric(row["Height *"] || ""),
          width: parseNumeric(row.Width || ""),
          depth: parseNumeric(row.Depth || ""),
          image_url: csvImage || null,
          image_original: csvImage || null,
          on_website: true,
        };
        const { data: inserted, error: insertErr } = await supabase
          .from("artworks")
          .insert(insertPayload)
          .select("id")
          .single();
        if (insertErr) throw new Error(`Insert failed: ${insertErr.message}`);
        const newId = inserted.id;
        log.artwork_id = newId;

        // Download + upload + Vision
        if (!csvImage) {
          log.image_status = "no_url";
          log.ai_status = "skipped_no_image";
        } else {
          let imageBuffer: Buffer;
          try {
            imageBuffer = await downloadImage(csvImage);
            log.image_status = "downloaded";
          } catch (err) {
            log.image_status = `download_failed: ${(err as Error).message}`;
            log.ai_status = "skipped_no_image";
            // Continue to themes anyway — row exists with original URL
            await attachThemes(newId, themes);
            log.themes_attached = themes.join("; ");
            return;
          }

          let mediumBuffer: Buffer;
          try {
            const { newUrl, mediumBuffer: mb } = await uploadVariants(`artworks/${newId}`, imageBuffer);
            mediumBuffer = mb;
            await supabase.from("artworks").update({ image_url: newUrl }).eq("id", newId);
            log.image_status = "uploaded";
          } catch (err) {
            log.image_status = `upload_failed: ${(err as Error).message}`;
            log.ai_status = "skipped_no_image";
            await attachThemes(newId, themes);
            log.themes_attached = themes.join("; ");
            return;
          }

          // AI Vision
          try {
            const dims = [insertPayload.height, insertPayload.width, insertPayload.depth]
              .filter((n) => n != null).join(" x ");
            const desc = await generateDescription(
              mediumBuffer,
              insertPayload.title,
              artistName || "Unknown",
              insertPayload.medium,
              dims || null
            );
            await supabase.from("artworks").update({
              alt_text: desc.alt_text,
              alt_text_long: desc.description,
              description_origin: "ai",
            }).eq("id", newId);
            log.ai_status = "ok";
          } catch (err) {
            log.ai_status = `failed: ${(err as Error).message}`;
            // Row remains without alt text; can be filled by generate-descriptions.ts later
          }
        }

        await attachThemes(newId, themes);
        log.themes_attached = themes.join("; ");
      }

      // Mark done in checkpoint
      progress.done.push(sku);
      saveProgress(progress);
    } catch (err) {
      log.branch = "failed";
      log.notes = (err as Error).message;
    }

    logs.push(log);
    completed++;
    if (completed % 25 === 0 || completed === totalToProcess) {
      console.log(`  [${completed}/${totalToProcess}] processed`);
    }
  }

  // Concurrency runner
  async function worker() {
    while (nextIdx < work.length) {
      const i = nextIdx++;
      await processRow(work[i]);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  // 6. Write log
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  writeCsv(LOG_FILE,
    ["sku", "branch", "themes_attached", "themes_dropped", "image_status", "ai_status", "artwork_id", "notes"],
    logs
  );

  // 7. Summary
  const byBranch = logs.reduce<Record<string, number>>((acc, l) => {
    acc[l.branch] = (acc[l.branch] || 0) + 1;
    return acc;
  }, {});
  console.log("\n=== Summary ===");
  Object.entries(byBranch).forEach(([k, v]) => console.log(`  ${k.padEnd(18)} ${v}`));
  console.log(`\nLog: ${LOG_FILE}`);
  console.log(`Checkpoint: ${PROGRESS_FILE}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify script's modules resolve**

Run:
```bash
HUMAN_CSV_PATH=/dev/null npx tsx --env-file=.env.local -e "
// Dynamically import to surface module errors without running main()
import('./scripts/import-archive.ts')
  .then(() => console.log('imports OK'))
  .catch((e) => { console.error(e); process.exit(1); });
" 2>&1 | head -30
```

Expected: prints `imports OK` (note: this WILL also start running main, which will fail when it can't find the CSV — that's fine, the import resolution is what we're checking).

If the script errors with "module not found" on `../src/lib/themes`, `../src/lib/utils`, or any AWS/Anthropic SDK: investigate which import is broken before continuing.

---

### Task 4: Add npm script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add to scripts block**

In `package.json`, locate the `"scripts"` block (after `"import:descriptions"`), add:

```json
"import:archive": "tsx --env-file=.env.local scripts/import-archive.ts"
```

The block (showing only the addition, preserve all existing scripts):

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
  "migrate:all": "tsx --env-file=.env.local scripts/migrate-and-describe.ts",
  "db:migrate": "tsx scripts/run-migration.ts"
},
```

- [ ] **Step 2: Verify**

Run: `npm run | grep import:archive`
Expected: `import:archive`

---

### Task 5: Sync `supabase/migrations/001_initial.sql`

**Files:**
- Modify: `supabase/migrations/001_initial.sql`

- [ ] **Step 1: Add `kind` column to the categories CREATE TABLE**

In `supabase/migrations/001_initial.sql`, find this block (around line 19-27):

```sql
CREATE TABLE categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,
  description   TEXT,
  sort_order    INT DEFAULT 0,
  ai_suggested  BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

Replace with:

```sql
CREATE TABLE categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,
  description   TEXT,
  sort_order    INT DEFAULT 0,
  ai_suggested  BOOLEAN DEFAULT false,
  -- Discriminator for what kind of category this is. 'format' is the
  -- existing AI-suggested taxonomy (Drawings, Paintings, etc.); 'theme'
  -- is the controlled subject taxonomy added in 2026-04-23.
  kind          TEXT CHECK (kind IN ('format', 'theme')),
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

- [ ] **Step 2: Verify**

Run: `grep -A 12 "CREATE TABLE categories" supabase/migrations/001_initial.sql`
Expected: shows the updated CREATE TABLE block with the `kind` column.

---

### Task 6: Commit Phase 1 code

**Files:** none (git only)

- [ ] **Step 1: Stage and commit**

Run:
```bash
git add src/lib/themes.ts scripts/test-themes.ts scripts/import-archive.ts package.json supabase/migrations/001_initial.sql
git status
```

Expected: 5 files staged. No untracked CSV artifacts (tmp/ is gitignored).

- [ ] **Step 2: Create commit**

Run:
```bash
git commit -m "$(cat <<'EOF'
Add 1stDibs archive import script + theme taxonomy helper

scripts/import-archive.ts reconciles the artworks DB with the 1stDibs
picks CSV. For each row:
  - SKU exists in DB:   upsert theme tags only (no metadata clobber)
  - SKU not in DB:      insert artwork from CSV metadata, download
                        image, upload R2 4-variant pipeline, generate
                        AI alt text via Claude Vision, attach themes

Themes are a controlled vocabulary of 8 (music, people, plants,
animals, abstract, other, food, pop culture) stored in the existing
categories table with the new kind='theme' discriminator. Theme
normalization (clir/clear prefix stripping, case folding, dedup,
fixed-set validation) is extracted to src/lib/themes.ts so Project B
(theme + decade UI dropdowns) can reuse it. node:test coverage on the
normalization function.

Out of scope per spec: image validation for existing artworks,
inactive marking for DB-only SKUs, metadata refresh on existing rows.

Schema migration to add categories.kind was applied manually before
this commit. supabase/migrations/001_initial.sql synced to match.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds.

---

## Phase 2: Run + verify

### Task 7: Pre-run sanity check

**Files:** none (verification)

- [ ] **Step 1: Re-confirm overlap counts**

Run:
```bash
npx tsx --env-file=.env.local -e "
import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const rows = parse(fs.readFileSync('tmp/ADD TAGS TO CREATIVE GROWTH PUBLIC ARCHIVE - 1stdibs_clir_picks_2026-03-17.csv', 'utf-8'), {columns:true, skip_empty_lines:true, relax_quotes:true, relax_column_count:true});
  const csvSkus = new Set(rows.map(r => (r.SKU || '').trim()).filter(Boolean));

  let all = []; let off = 0;
  while (true) {
    const { data } = await c.from('artworks').select('sku').range(off, off+999);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    off += 1000;
  }
  const dbSkus = new Set(all.map(r => r.sku).filter(Boolean));

  const overlap = [...csvSkus].filter(s => dbSkus.has(s)).length;
  const newOnly = [...csvSkus].filter(s => !dbSkus.has(s)).length;
  console.log('CSV unique SKUs:', csvSkus.size);
  console.log('DB unique SKUs: ', dbSkus.size);
  console.log('Branch A (themes only):', overlap);
  console.log('Branch B (insert + image + AI):', newOnly);
}
main();
" 2>&1 | grep -v notice
```

Expected output ballpark (should match the earlier brainstorming numbers):
```
CSV unique SKUs: 2059
DB unique SKUs:  2110
Branch A (themes only): 909
Branch B (insert + image + AI): 1150
```

If the Branch B count is dramatically larger or smaller than ~1,150: STOP and re-read the data with the user before running. The Branch B count drives all the Vision API spend and runtime.

---

### Task 8: Run the import

**Files:** none (execution; produces gitignored artifacts)

- [ ] **Step 1: Kick off the run**

Run: `npm run import:archive`

Expected behavior:
- Prints "Parsed N rows..." then "Fetched M DB artworks..."
- Prints `[25/N], [50/N], ...` progress lines every 25 rows
- Will take ~1-3 hours for the full 2,059 rows (most of the time spent on Branch B's image download + R2 upload + Vision call)
- Resumable: if killed, can re-run; the checkpoint file `scripts/.archive-import-progress.json` lets it skip done rows

If you see frequent failures (more than ~5% of attempts), stop and report to user — likely a config issue (R2, Anthropic, network).

- [ ] **Step 2: Spot-check the log**

After the run completes, run:
```bash
awk -F',' 'NR>1 {print $2}' tmp/archive-import-log_*.csv | sort | uniq -c
```

Expected: counts by branch. Roughly:
- `existing_themed`: ~909
- `inserted`: ~1,150 (or close — some Branch B rows may have failed pieces but still count as `inserted`)
- `failed`: should be small (<50)

Report the actual counts back to the user.

- [ ] **Step 3: Spot-check a Branch A artwork (themes attached, nothing else changed)**

Run:
```bash
npx tsx --env-file=.env.local -e "
import { createClient } from '@supabase/supabase-js';
const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
c.from('artworks').select('sku, title, alt_text, alt_text_long, description_origin, categories:artwork_categories(category:categories(name, kind))').eq('sku', 'RB 25').then(({data, error}) => {
  if (error) { console.error(error); process.exit(1); }
  data.forEach(r => console.log(JSON.stringify(r, null, 2)));
});
"
```

Expected: `RB 25` (or whatever Branch A SKU you pick) should have its existing `alt_text`, `alt_text_long`, `description_origin` UNCHANGED from before the run. The `categories` array should now include a row with `kind: 'theme'` if RB 25 was tagged in the CSV.

- [ ] **Step 4: Spot-check a Branch B artwork (newly inserted)**

Pick any SKU from the Branch B side of the CSV (e.g., one with `inserted` in the log):
```bash
npx tsx --env-file=.env.local -e "
import { createClient } from '@supabase/supabase-js';
const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
c.from('artworks').select('sku, title, image_url, alt_text, alt_text_long, description_origin, on_website, categories:artwork_categories(category:categories(name, kind))').eq('sku', 'DA 109').then(({data, error}) => {
  if (error) { console.error(error); process.exit(1); }
  data.forEach(r => console.log(JSON.stringify(r, null, 2)));
});
"
```

Expected: `DA 109` (or another known new SKU) shows:
- `image_url` is an R2 URL
- `alt_text` and `alt_text_long` are populated
- `description_origin: 'ai'`
- `on_website: true`
- `categories` includes the relevant theme(s) from the CSV

If `description_origin` is null and the log says `ai_status: failed`, that's an acceptable degraded outcome — the row is still inserted and the existing `generate-descriptions.ts` can backfill later.

---

## Done

At this point:
- Existing 909 artworks (matched on SKU) have theme tags attached. Their other fields are untouched.
- ~1,150 new artworks have been inserted with metadata, R2-hosted images, AI-generated alt text, and theme tags. They're live (`on_website = true`).
- Categories table has 8 new `kind = 'theme'` rows.
- Two timestamped artifacts in `tmp/`: the per-row log and the checkpoint file.

Hand off to the user to:
- Spot-check the public site (`/collection`) — should now have ~3,200+ visible artworks.
- Decide what to do with the ~1,200 DB-only artworks (separate project: inactive marking).
- Decide whether to re-run image validation on existing artworks (separate project).
- Move on to Project B: theme + decade UI dropdowns on the collection page.
