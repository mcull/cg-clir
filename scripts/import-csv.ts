#!/usr/bin/env npx tsx
/**
 * import-csv.ts
 *
 * Parses the Art Cloud CSV export and upserts artists + artworks into Supabase.
 * Run: npx tsx scripts/import-csv.ts [path-to-csv]
 *
 * Defaults to inventory_2026-04-02.csv in the project root.
 */

import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";
import { slugify, parseNumeric, parseTags } from "../src/lib/utils";

// ─── Config ───────────────────────────────────────────────────────────────
const CSV_PATH =
  process.argv[2] || path.join(__dirname, "..", "inventory_2026-04-02.csv");

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    "Error: Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── Types ────────────────────────────────────────────────────────────────
interface CsvRow {
  Image: string;
  Title: string;
  "Artist First Name": string;
  "Artist Last Name": string;
  "Date Created": string;
  Medium: string;
  Height: string;
  Width: string;
  Depth: string;
  "Inventory Number": string;
  SKU: string;
  Tags: string;
  Genre: string;
  Notes: string;
  Active: string;
  "On Website": string;
  [key: string]: string;
}

// ─── Main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Reading CSV from ${CSV_PATH}...`);
  const csvContent = fs.readFileSync(CSV_PATH, "utf-8");
  const rows: CsvRow[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });
  console.log(`Parsed ${rows.length} rows.`);

  // ── Step 1: Deduplicate and upsert artists ─────────────────────────────
  console.log("\n--- Upserting artists ---");
  const artistMap = new Map<
    string,
    { first_name: string; last_name: string; slug: string }
  >();

  for (const row of rows) {
    const first = row["Artist First Name"]?.trim() || "";
    const last = row["Artist Last Name"]?.trim() || "";
    if (!first && !last) continue;

    const key = `${first}|||${last}`.toLowerCase();
    if (!artistMap.has(key)) {
      let slug = slugify(`${first} ${last}`);
      // Handle duplicates by appending a counter
      let baseSlug = slug;
      let counter = 2;
      while (Array.from(artistMap.values()).some((a) => a.slug === slug)) {
        slug = `${baseSlug}-${counter}`;
        counter++;
      }
      artistMap.set(key, { first_name: first, last_name: last, slug });
    }
  }

  console.log(`Found ${artistMap.size} unique artists.`);

  const artistRecords = Array.from(artistMap.values());
  const { data: upsertedArtists, error: artistError } = await supabase
    .from("artists")
    .upsert(artistRecords, { onConflict: "slug" })
    .select("id, first_name, last_name, slug");

  if (artistError) {
    console.error("Error upserting artists:", artistError);
    process.exit(1);
  }

  // Build a lookup: "first|||last" -> artist id
  const artistIdLookup = new Map<string, string>();
  for (const artist of upsertedArtists || []) {
    const key = `${artist.first_name}|||${artist.last_name}`.toLowerCase();
    artistIdLookup.set(key, artist.id);
  }
  console.log(`Upserted ${upsertedArtists?.length || 0} artists.`);

  // ── Step 2: Upsert artworks ────────────────────────────────────────────
  console.log("\n--- Upserting artworks ---");

  // Process in batches of 100 for Supabase limits
  const BATCH_SIZE = 100;
  let artworkCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const artworkRecords = [];

    for (const row of batch) {
      const title = row.Title?.trim();
      if (!title) {
        skippedCount++;
        continue;
      }

      const first = row["Artist First Name"]?.trim() || "";
      const last = row["Artist Last Name"]?.trim() || "";
      const artistKey = `${first}|||${last}`.toLowerCase();
      const artistId = artistIdLookup.get(artistKey) || null;

      const inventoryNumber = row["Inventory Number"]?.trim() || null;

      artworkRecords.push({
        title,
        artist_id: artistId,
        date_created: row["Date Created"]?.trim() || null,
        medium: row.Medium?.trim() || null,
        height: parseNumeric(row.Height),
        width: parseNumeric(row.Width),
        depth: parseNumeric(row.Depth),
        inventory_number: inventoryNumber,
        sku: row.SKU?.trim() || null,
        image_original: row.Image?.trim() || null,
        image_url: row.Image?.trim() || null, // Will be updated after R2 migration
        tags: parseTags(row.Tags),
        genre:
          row.Genre?.trim() && row.Genre.trim() !== "Unselected"
            ? row.Genre.trim()
            : null,
        notes: row.Notes?.trim() || null,
        on_website: true,
      });
    }

    if (artworkRecords.length > 0) {
      // Use inventory_number as the unique key for upsert
      const withInventory = artworkRecords.filter(
        (r) => r.inventory_number
      );
      const withoutInventory = artworkRecords.filter(
        (r) => !r.inventory_number
      );

      if (withInventory.length > 0) {
        const { error } = await supabase
          .from("artworks")
          .upsert(withInventory, { onConflict: "inventory_number" });

        if (error) {
          console.error(
            `Error upserting artworks batch ${i / BATCH_SIZE + 1}:`,
            error
          );
        } else {
          artworkCount += withInventory.length;
        }
      }

      // Insert records without inventory numbers (can't upsert without unique key)
      if (withoutInventory.length > 0) {
        const { error } = await supabase
          .from("artworks")
          .insert(withoutInventory);

        if (error) {
          console.error(
            `Error inserting artworks without inventory number:`,
            error
          );
        } else {
          artworkCount += withoutInventory.length;
        }
      }
    }

    process.stdout.write(
      `\r  Processed ${Math.min(i + BATCH_SIZE, rows.length)} / ${rows.length} rows...`
    );
  }

  console.log(
    `\n\nDone! Imported ${artworkCount} artworks, skipped ${skippedCount} (no title).`
  );

  // ── Step 3: Summary ────────────────────────────────────────────────────
  const { count: totalArtworks } = await supabase
    .from("artworks")
    .select("*", { count: "exact", head: true });
  const { count: totalArtists } = await supabase
    .from("artists")
    .select("*", { count: "exact", head: true });

  console.log(`\n=== Database Summary ===`);
  console.log(`Artists: ${totalArtists}`);
  console.log(`Artworks: ${totalArtworks}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
