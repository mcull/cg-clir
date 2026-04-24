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
    const unknownSkus = perArtwork
      .filter((r) => r.bucket === "unknown_source")
      .map((r) => r.sku || `<empty sku, title="${r.title}">`);
    console.log(`\nWARNING: ${unknownSourceCount} artworks in DB but in neither source CSV (bucket='unknown_source'): ${unknownSkus.join(", ")}`);
  }
  console.log(`\nPer-artwork: ${PER_ARTWORK_FILE}`);
  console.log(`Per-artist:  ${PER_ARTIST_FILE}`);
  console.log(`Tag-freq:    ${TAG_FREQ_FILE}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
