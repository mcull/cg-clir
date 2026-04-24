#!/usr/bin/env npx tsx
/**
 * backfill-decade.ts
 *
 * Populates artworks.decade for every row by parsing date_created via
 * dateToDecade. Rows whose date_created is null/unparseable get
 * decade = NULL. One-shot.
 *
 * Run: npx tsx --env-file=.env.local scripts/backfill-decade.ts
 */

import { createClient } from "@supabase/supabase-js";
import { dateToDecade } from "../src/lib/decades";

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

async function main() {
  console.log("Fetching all artworks...");
  const all: { id: string; date_created: string | null }[] = [];
  let off = 0;
  while (true) {
    const { data, error } = await supabase
      .from("artworks")
      .select("id, date_created")
      .range(off, off + 999);
    if (error) { console.error(error); process.exit(1); }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    off += 1000;
  }
  console.log(`Fetched ${all.length} artworks`);

  let updated = 0;
  let nullified = 0;
  let errors = 0;
  for (const row of all) {
    const decade = dateToDecade(row.date_created);
    const { error } = await supabase.from("artworks").update({ decade }).eq("id", row.id);
    if (error) { errors++; continue; }
    if (decade === null) nullified++;
    else updated++;
  }

  console.log("\n=== Summary ===");
  console.log(`Total rows:         ${all.length}`);
  console.log(`Set to a decade:    ${updated}`);
  console.log(`Set to NULL:        ${nullified}`);
  console.log(`Errors:             ${errors}`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
