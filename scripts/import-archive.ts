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
import { dateToDecade } from "../src/lib/decades";
import { mediumToBuckets, BucketMap } from "./lib/medium-buckets";

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

// Load the persisted medium bucket map (from the medium normalization workflow).
const BUCKETS_FILE = path.join(__dirname, "data", "medium-buckets.json");
let bucketMap: BucketMap = {};
const bucketIdByName: Record<string, string> = {};
if (fs.existsSync(BUCKETS_FILE)) {
  const lookup = JSON.parse(fs.readFileSync(BUCKETS_FILE, "utf-8"));
  if (!lookup.map || typeof lookup.map !== "object") {
    console.warn(`WARNING: ${BUCKETS_FILE} is missing a 'map' key — medium attachments disabled.`);
  } else {
    bucketMap = lookup.map;
  }
}

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
  alt_text_long: string | null;
  description_origin: string | null;
  image_url: string | null;
}

interface DbArtworkInfo {
  id: string;
  alt_text_long: string | null;
  description_origin: string | null;
  image_url: string | null;
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

async function attachMediums(artworkId: string, mediumStr: string | null): Promise<void> {
  const buckets = mediumToBuckets(bucketMap, mediumStr);
  if (buckets.length === 0) return;
  const rows: { artwork_id: string; category_id: string }[] = [];
  for (const b of buckets) {
    const categoryId = bucketIdByName[b];
    if (categoryId) rows.push({ artwork_id: artworkId, category_id: categoryId });
  }
  if (rows.length === 0) return;
  const { error } = await supabase
    .from("artwork_categories")
    .upsert(rows, { onConflict: "artwork_id,category_id", ignoreDuplicates: true });
  if (error) throw new Error(`Failed to attach mediums to artwork ${artworkId}: ${error.message}`);
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
  // Resumability caveat: if killed between Branch B's INSERT (line ~430) and
  // the checkpoint write (~end of processRow), the next run will see the new
  // SKU as already-existing, take Branch A, and skip the missing image/AI
  // steps. Branch A flags any existing row that looks partial (no AI alt OR
  // non-R2 image_url) in the log's `notes` column. After a crash, search the
  // log for "WARNING:" and fix those rows manually (or delete them and re-run
  // to let Branch B re-process from scratch).

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
  const dbSkuToId = new Map<string, DbArtworkInfo>();
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("artworks")
      .select("id, sku, alt_text_long, description_origin, image_url")
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) { console.error(error); process.exit(1); }
    if (!data || data.length === 0) break;
    for (const a of data as DbArtwork[]) {
      if (a.sku) {
        dbSkuToId.set(a.sku.trim(), {
          id: a.id,
          alt_text_long: a.alt_text_long,
          description_origin: a.description_origin,
          image_url: a.image_url,
        });
      }
    }
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  console.log(`Fetched ${dbSkuToId.size} DB artworks with SKUs`);

  if (Object.keys(bucketMap).length > 0) {
    const { data: mediumCats } = await supabase
      .from("categories")
      .select("id, name")
      .eq("kind", "medium");
    for (const c of mediumCats || []) bucketIdByName[c.name] = c.id;
    console.log(`Loaded ${Object.keys(bucketIdByName).length} medium category IDs.`);
    if (Object.keys(bucketIdByName).length === 0) {
      console.warn(
        "WARNING: bucket map exists but no kind='medium' categories in the DB. " +
        "Run `npm run medium:apply -- <csv>` first or medium tags will be skipped."
      );
    }
  }

  // 3. Load progress checkpoint
  const progress = loadProgress();
  const doneSet = new Set(progress.done);
  console.log(`Already processed in prior runs: ${doneSet.size}`);

  // 4. Build work queue
  const work = rows
    .map((r) => ({ row: r, sku: (r.SKU || "").trim() }))
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

      const existing = dbSkuToId.get(sku);
      if (existing) {
        // Branch A: theme upsert only
        log.branch = "existing_themed";
        log.artwork_id = existing.id;

        // Surface partial-state rows from prior interrupted runs so the
        // maintainer can spot-check. We don't repair the row here.
        const warnings: string[] = [];
        if (existing.description_origin === null && existing.alt_text_long === null) {
          warnings.push(
            "WARNING: existing row missing AI alt text — likely partial from a prior interrupted run; review manually"
          );
        }
        if (existing.image_url && existing.image_url.includes("artcld.com")) {
          warnings.push(
            "WARNING: image_url not on R2 — may indicate prior interrupted run"
          );
        }
        if (warnings.length > 0) log.notes = warnings.join("; ");

        await attachThemes(existing.id, themes);
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
          decade: dateToDecade(dateStr || null),
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
            await attachMediums(newId, insertPayload.medium);
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
            await attachMediums(newId, insertPayload.medium);
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
        await attachMediums(newId, insertPayload.medium);
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
  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  } finally {
    // Write the log even if a worker rejected
    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
    writeCsv(LOG_FILE,
      ["sku", "branch", "themes_attached", "themes_dropped", "image_status", "ai_status", "artwork_id", "notes"],
      logs
    );
    console.log(`\nLog: ${LOG_FILE}`);
    console.log(`Checkpoint: ${PROGRESS_FILE}`);
  }

  // 7. Summary
  const byBranch = logs.reduce<Record<string, number>>((acc, l) => {
    acc[l.branch] = (acc[l.branch] || 0) + 1;
    return acc;
  }, {});
  console.log("\n=== Summary ===");
  Object.entries(byBranch).forEach(([k, v]) => console.log(`  ${k.padEnd(18)} ${v}`));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
