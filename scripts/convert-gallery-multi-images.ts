#!/usr/bin/env npx tsx
/**
 * convert-gallery-multi-images.ts
 *
 * Converts a gallery-provided "multiple images" CSV (columns: SKU, Image 1,
 * Image 2, … Image N) into the manifest format consumed by
 * import-artwork-images.ts (inventory_number, image_url, is_primary,
 * sort_order, short_description).
 *
 * SKU is not unique in our DB (junk/unpublished duplicate rows exist), so each
 * SKU is resolved to the single published, inventory-numbered artwork. Rows
 * whose SKU resolves to zero or more-than-one published artwork are skipped and
 * reported. All emitted rows are is_primary=false (we keep each artwork's
 * existing primary; the importer dedups Image 1 when it already matches).
 * short_description is left blank — run describe-artwork-images.ts afterward.
 *
 * Run: npx tsx --env-file=.env.local scripts/convert-gallery-multi-images.ts <input.csv> [output.csv]
 */
import fs from "fs";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const IMAGE_COLS = ["Image 1", "Image 2", "Image 3", "Image 4", "Image 5"];

/** RFC-4180 minimal CSV field escaping. */
function csvField(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

async function main() {
  const input = process.argv[2];
  const output = process.argv[3] || "tmp/artwork-images-manifest.csv";
  if (!input) {
    console.error("Usage: npx tsx --env-file=.env.local scripts/convert-gallery-multi-images.ts <input.csv> [output.csv]");
    process.exit(1);
  }

  const rows = parse(fs.readFileSync(input, "utf-8"), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  const out: string[] = ["inventory_number,image_url,is_primary,sort_order,short_description"];
  const ambiguous: { sku: string; inventories: string[] }[] = [];
  const noMatch: string[] = [];
  let resolvedRows = 0;
  let emitted = 0;

  for (const r of rows) {
    const sku = (r.SKU || "").trim();
    if (!sku) continue;

    const { data: all } = await supabase
      .from("artworks")
      .select("id, inventory_number, on_website")
      .eq("sku", sku);
    const real = (all || []).filter((a) => a.on_website && a.inventory_number);

    if (real.length === 0) {
      noMatch.push(sku);
      continue;
    }
    if (real.length > 1) {
      ambiguous.push({ sku, inventories: real.map((a) => a.inventory_number as string) });
      continue;
    }

    resolvedRows++;
    const inv = real[0].inventory_number as string;
    IMAGE_COLS.forEach((col, idx) => {
      const url = (r[col] || "").trim();
      if (!url) return;
      // sort_order = 1-based column index; primary is kept as the artwork's
      // existing image, so everything here is non-primary.
      out.push([csvField(inv), csvField(url), "false", String(idx + 1), ""].join(","));
      emitted++;
    });
  }

  fs.writeFileSync(output, out.join("\n") + "\n");

  console.log(`Wrote ${emitted} manifest rows for ${resolvedRows} artworks → ${output}`);
  if (noMatch.length) {
    console.log(`\nNo published artwork for SKU (${noMatch.length}):\n  ${noMatch.join(", ")}`);
  }
  if (ambiguous.length) {
    console.log(`\n⚠ Ambiguous SKUs skipped — more than one published artwork (${ambiguous.length}):`);
    for (const a of ambiguous) console.log(`  ${a.sku} → inventory ${a.inventories.join(", ")}`);
  }
}

main().then(() => process.exit(0));
