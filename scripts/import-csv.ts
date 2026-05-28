#!/usr/bin/env npx tsx
/**
 * import-csv.ts
 *
 * Parses the Art Cloud CSV export and upserts artists + artworks into Supabase.
 * Run: npx tsx scripts/import-csv.ts [path-to-csv] [--unpublish-missing] [--dry-run]
 *
 * Defaults to inventory_2026-04-02.csv in the project root.
 *
 * Flags:
 *   --unpublish-missing  After import, set on_website=false on every row whose
 *                        inventory_number is not in the CSV (and any visible
 *                        row with a NULL inventory_number).
 *   --dry-run            Only meaningful with --unpublish-missing. Reports the
 *                        diff without writing.
 */

import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";
import { slugify, parseNumeric, parseTags } from "../src/lib/utils";
import { dateToDecade } from "../src/lib/decades";
import { mediumToBuckets, BucketMap } from "./lib/medium-buckets";

// ─── Config ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));

const CSV_PATH =
  positional[0] || path.join(__dirname, "..", "inventory_2026-04-02.csv");
const UNPUBLISH_MISSING = flags.has("--unpublish-missing");
const DRY_RUN = flags.has("--dry-run");

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

// Load the persisted medium bucket map (from the medium normalization workflow).
// Importers attach medium categories to new artworks based on this map.
const BUCKETS_FILE = path.join(__dirname, "data", "medium-buckets.json");
let bucketMap: BucketMap = {};
let bucketIdByName: Record<string, string> = {};
if (fs.existsSync(BUCKETS_FILE)) {
  const lookup = JSON.parse(fs.readFileSync(BUCKETS_FILE, "utf-8"));
  if (!lookup.map || typeof lookup.map !== "object") {
    console.warn(`WARNING: ${BUCKETS_FILE} is missing a 'map' key — medium attachments disabled.`);
  } else {
    bucketMap = lookup.map;
  }
  // bucketIdByName is populated below after we resolve category IDs from the DB.
}

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

  // Resolve medium-category IDs (name → id) so we can attach without
  // per-row category lookups during the artwork upsert loop.
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

  // ── Step 2: Upsert artworks ────────────────────────────────────────────
  console.log("\n--- Upserting artworks ---");

  // Process in batches of 100 for Supabase limits
  const BATCH_SIZE = 100;
  let artworkCount = 0;
  let skippedCount = 0;
  const unknownMediums = new Set<string>();

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
        decade: dateToDecade(row["Date Created"]?.trim() || null),
        medium: row.Medium?.trim() || null,
        height: parseNumeric(row.Height),
        width: parseNumeric(row.Width),
        depth: parseNumeric(row.Depth),
        inventory_number: inventoryNumber,
        sku: row.SKU?.trim() || null,
        image_original: row.Image?.trim() || null,
        image_url: row.Image?.trim() || null,
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
        // Split by existence so we can strip image_url / image_original from
        // the update path. PostgREST omits unspecified columns from the
        // ON CONFLICT DO UPDATE SET clause, so existing R2 URLs survive.
        const allInvNumbers = withInventory.map((r) => r.inventory_number!);
        const { data: existing } = await supabase
          .from("artworks")
          .select("inventory_number")
          .in("inventory_number", allInvNumbers);
        const existingSet = new Set(
          (existing || []).map((r) => r.inventory_number)
        );

        const newRecords = withInventory.filter(
          (r) => !existingSet.has(r.inventory_number)
        );
        const updateRecords = withInventory
          .filter((r) => existingSet.has(r.inventory_number))
          .map((r) => {
            const u = { ...r };
            delete u.image_url;
            delete u.image_original;
            return u;
          });

        let batchOk = true;

        if (newRecords.length > 0) {
          const { error } = await supabase
            .from("artworks")
            .upsert(newRecords, { onConflict: "inventory_number" });
          if (error) {
            console.error(
              `Error inserting new artworks batch ${i / BATCH_SIZE + 1}:`,
              error
            );
            batchOk = false;
          } else {
            artworkCount += newRecords.length;
          }
        }

        if (updateRecords.length > 0) {
          const { error } = await supabase
            .from("artworks")
            .upsert(updateRecords, { onConflict: "inventory_number" });
          if (error) {
            console.error(
              `Error updating existing artworks batch ${i / BATCH_SIZE + 1}:`,
              error
            );
            batchOk = false;
          } else {
            artworkCount += updateRecords.length;
          }
        }

        if (batchOk && Object.keys(bucketMap).length > 0) {
          // Attach medium categories from the lookup map for any rows whose
          // medium string is in the bucket map. Single batched select gets
          // ids; then a single upsert applies all attachments for the batch.
          const inventoryNumbers = withInventory.map((r) => r.inventory_number!);
          const { data: artRows } = await supabase
            .from("artworks")
            .select("id, inventory_number, medium")
            .in("inventory_number", inventoryNumbers);

          const acRows: { artwork_id: string; category_id: string }[] = [];
          const unknownInThisBatch = new Set<string>();
          for (const a of artRows || []) {
            const buckets = mediumToBuckets(bucketMap, a.medium);
            if (buckets.length === 0) {
              if (a.medium) unknownInThisBatch.add(a.medium);
              continue;
            }
            for (const b of buckets) {
              const categoryId = bucketIdByName[b];
              if (categoryId) acRows.push({ artwork_id: a.id, category_id: categoryId });
            }
          }
          if (acRows.length > 0) {
            await supabase
              .from("artwork_categories")
              .upsert(acRows, { onConflict: "artwork_id,category_id", ignoreDuplicates: true });
          }
          for (const m of unknownInThisBatch) unknownMediums.add(m);
        }
      }

      // Insert records without inventory numbers (can't upsert without unique key).
      // Note: medium-category attachment is intentionally skipped here — without a
      // stable unique key we can't reliably re-fetch their ids after insert.
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

  if (unknownMediums.size > 0) {
    console.warn(`\nWARNING: ${unknownMediums.size} medium strings not in bucket map (artworks have no medium tag):`);
    [...unknownMediums].sort().forEach((m) => console.warn(`  ${m}`));
    console.warn("Re-run `npm run medium:propose` to absorb these into the vocabulary.");
  }

  // ── Step 3: Unpublish rows not in CSV (opt-in) ─────────────────────────
  if (UNPUBLISH_MISSING) {
    console.log(
      `\n--- Unpublishing rows not in CSV${DRY_RUN ? " (DRY RUN)" : ""} ---`
    );

    const csvInvSet = new Set(
      rows.map((r) => r["Inventory Number"]?.trim()).filter(Boolean)
    );

    // Page through every currently-visible row. We key the update by id so
    // rows with NULL inventory_number are handled with the same code path.
    const currentlyVisible: {
      id: string;
      inventory_number: string | null;
      title: string;
    }[] = [];
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("artworks")
        .select("id, inventory_number, title")
        .eq("on_website", true)
        .range(from, from + PAGE - 1);
      if (error) {
        console.error("Error paging visible rows:", error);
        break;
      }
      if (!data || data.length === 0) break;
      currentlyVisible.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }

    const toUnpublish = currentlyVisible.filter(
      (r) => !r.inventory_number || !csvInvSet.has(r.inventory_number)
    );

    console.log(
      `Currently visible: ${currentlyVisible.length}. CSV provides ${csvInvSet.size} inventory numbers. ` +
        `${toUnpublish.length} rows will be unpublished.`
    );

    const sample = toUnpublish.slice(0, 10);
    if (sample.length > 0) {
      console.log(`Sample (first ${sample.length}):`);
      for (const r of sample) {
        console.log(`  ${r.inventory_number ?? "(no inv)"} — ${r.title}`);
      }
    }

    if (DRY_RUN) {
      console.log("(dry run — no changes made)");
    } else if (toUnpublish.length > 0) {
      const BATCH = 100;
      let updated = 0;
      for (let i = 0; i < toUnpublish.length; i += BATCH) {
        const ids = toUnpublish.slice(i, i + BATCH).map((r) => r.id);
        const { error } = await supabase
          .from("artworks")
          .update({ on_website: false })
          .in("id", ids);
        if (error) {
          console.error(`Error unpublishing batch:`, error);
        } else {
          updated += ids.length;
        }
      }
      console.log(`Unpublished ${updated} rows.`);
    }
  }

  // ── Step 4: Summary ────────────────────────────────────────────────────
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
