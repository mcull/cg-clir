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

  // Surface any bucket name that didn't land in the lookup (e.g. slug collision
  // collapsed two names into one row, leaving the second name unresolved).
  const missingBucketNames = bucketList.filter((name) => !bucketIdByName[name]);
  if (missingBucketNames.length > 0) {
    console.error(`\nERROR: ${missingBucketNames.length} bucket name(s) did not resolve to a category id:`);
    missingBucketNames.forEach((n) => console.error(`  ${n} (slug: ${slugify(n)})`));
    console.error("This usually means two bucket names slugify to the same value. Rename one in the CSV.");
    process.exit(1);
  }

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

  // Pre-fetch existing medium-category attachments per artwork. Paginate
  // through results — PostgREST caps responses at 1000 rows by default,
  // and re-runs of this script can easily exceed that.
  const existingAcs: { artwork_id: string; category: { id: string; kind: string } }[] = [];
  let acOff = 0;
  while (true) {
    const { data, error } = await supabase
      .from("artwork_categories")
      .select("artwork_id, category:categories!inner(id, kind)")
      .eq("category.kind", "medium")
      .range(acOff, acOff + 999);
    if (error) { console.error(error); process.exit(1); }
    if (!data || data.length === 0) break;
    existingAcs.push(...(data as any));
    if (data.length < 1000) break;
    acOff += 1000;
  }
  const existingByArtwork = new Map<string, Set<string>>();
  for (const ac of existingAcs) {
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
      console.error(`  ERR ${art.id}: ${rowError}`);
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
