#!/usr/bin/env npx tsx
/**
 * import-human-descriptions.ts
 *
 * Reads the human-authored description CSV at HUMAN_CSV_PATH (default:
 * tmp/CLIR Image Descriptions Sheet - Brief Descriptions.csv), updates
 * matched artworks (alt_text_long, description_origin='human'), and
 * writes two timestamped CSV artifacts to tmp/:
 *   - import-human-descriptions-log_<ISO>.csv  per-row update log
 *   - descriptions-export_<ISO>.csv             full catalog snapshot
 *
 * The short alt_text is intentionally NOT modified — see the spec at
 * docs/superpowers/specs/2026-04-23-human-descriptions-import-design.md.
 *
 * Run: npx tsx --env-file=.env.local scripts/import-human-descriptions.ts
 */

import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";
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

// ─── Types ────────────────────────────────────────────────────────────────
interface CsvRow {
  SKU?: string;
  "Item Description *"?: string;
  [key: string]: string | undefined;
}

interface ArtworkRow {
  id: string;
  sku: string | null;
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
  new_alt_text_long: string;
}

interface ExportEntry {
  sku: string;
  inventory_number: string;
  image_url: string;
  description_origin: string;
  alt_text_long: string;
  alt_text: string;
  prior_ai_alt_text_long: string;
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
      .select("id, sku, inventory_number, image_url, image_original, alt_text, alt_text_long, description_origin")
      .order("sku", { ascending: true, nullsFirst: false })
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
    const sku = (art.sku || "").trim();
    const inv = art.inventory_number || "";
    const priorLong = art.alt_text_long || "";
    const currentShort = art.alt_text || "";
    const imageUrl = resolveImageUrl(art) || "";

    if (sku && skuMap.has(sku)) {
      const desc = skuMap.get(sku)!;
      matchedSkus.add(sku);

      if (!desc) {
        logEntries.push({
          sku, status: "fail", reason: "empty description",
          artwork_id: art.id,
          prior_alt_text_long: priorLong,
          new_alt_text_long: "",
        });
        failCount++;
        exportEntries.push({
          sku, inventory_number: inv, image_url: imageUrl,
          description_origin: art.description_origin || "",
          alt_text_long: priorLong,
          alt_text: currentShort,
          prior_ai_alt_text_long: "",
        });
        continue;
      }

      const newLong = desc;

      const { error: updateErr } = await supabase
        .from("artworks")
        .update({
          alt_text_long: newLong,
          description_origin: "human",
        })
        .eq("id", art.id);

      if (updateErr) {
        logEntries.push({
          sku, status: "fail", reason: `update error: ${updateErr.message}`,
          artwork_id: art.id,
          prior_alt_text_long: priorLong,
          new_alt_text_long: newLong,
        });
        failCount++;
        exportEntries.push({
          sku, inventory_number: inv, image_url: imageUrl,
          description_origin: art.description_origin || "",
          alt_text_long: priorLong,
          alt_text: currentShort,
          prior_ai_alt_text_long: "",
        });
        continue;
      }

      logEntries.push({
        sku, status: "success", reason: "",
        artwork_id: art.id,
        prior_alt_text_long: priorLong,
        new_alt_text_long: newLong,
      });
      successCount++;

      exportEntries.push({
        sku, inventory_number: inv, image_url: imageUrl,
        description_origin: "human",
        alt_text_long: newLong,
        alt_text: currentShort,
        prior_ai_alt_text_long: priorLong,
      });
    } else {
      // Not in human CSV - export current state, no prior_ai_alt_text_long
      exportEntries.push({
        sku, inventory_number: inv, image_url: imageUrl,
        description_origin: art.description_origin || "",
        alt_text_long: priorLong,
        alt_text: currentShort,
        prior_ai_alt_text_long: "",
      });
    }
  }

  // 5. Log fails for CSV SKUs that didn't match any DB row
  for (const sku of skuMap.keys()) {
    if (!matchedSkus.has(sku)) {
      logEntries.push({
        sku, status: "fail", reason: "sku not found in db",
        artwork_id: "",
        prior_alt_text_long: "",
        new_alt_text_long: "",
      });
      failCount++;
    }
  }

  // 6. Log fails for duplicate SKUs (earlier occurrences superseded by later ones)
  for (const sku of duplicateSkus) {
    logEntries.push({
      sku, status: "fail", reason: "superseded by later row in csv",
      artwork_id: "",
      prior_alt_text_long: "",
      new_alt_text_long: "",
    });
  }

  // 7. Write artifacts
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

  writeCsv(LOG_FILE,
    ["sku", "status", "reason", "artwork_id", "prior_alt_text_long", "new_alt_text_long"],
    logEntries
  );

  writeCsv(EXPORT_FILE,
    ["sku", "inventory_number", "image_url", "description_origin", "alt_text_long", "alt_text", "prior_ai_alt_text_long"],
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
