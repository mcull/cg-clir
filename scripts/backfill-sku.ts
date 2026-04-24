#!/usr/bin/env npx tsx
/**
 * backfill-sku.ts
 *
 * Reads inventory_2026-04-02.csv, populates artworks.sku from the source
 * SKU column (column 31), keyed on inventory_number (column 28). One-shot.
 *
 * Run: npx tsx --env-file=.env.local scripts/backfill-sku.ts
 */

import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";

const CSV_PATH = path.join(__dirname, "..", "inventory_2026-04-02.csv");

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

interface CsvRow {
  "Inventory Number"?: string;
  SKU?: string;
  [key: string]: string | undefined;
}

async function main() {
  const raw = fs.readFileSync(CSV_PATH, "utf-8");
  const rows: CsvRow[] = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  });
  console.log(`Parsed ${rows.length} rows from ${path.basename(CSV_PATH)}`);

  let updated = 0;
  let skippedNoInv = 0;
  let skippedNoSku = 0;
  let updateErrors = 0;

  for (const row of rows) {
    const inv = (row["Inventory Number"] || "").trim();
    const sku = (row.SKU || "").trim();
    if (!inv) { skippedNoInv++; continue; }
    if (!sku) { skippedNoSku++; continue; }

    const { error, count } = await supabase
      .from("artworks")
      .update({ sku }, { count: "exact" })
      .eq("inventory_number", inv);

    if (error) {
      console.error(`Update error for inv=${inv}: ${error.message}`);
      updateErrors++;
      continue;
    }
    if (count && count > 0) updated++;
  }

  console.log("\n=== Summary ===");
  console.log(`Total CSV rows:           ${rows.length}`);
  console.log(`Skipped (no inv number):  ${skippedNoInv}`);
  console.log(`Skipped (no SKU):         ${skippedNoSku}`);
  console.log(`Update errors:            ${updateErrors}`);
  console.log(`Rows updated in DB:       ${updated}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
