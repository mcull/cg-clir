#!/usr/bin/env npx tsx
/**
 * backfill-titles.ts
 *
 * Strips the SKU suffix from artwork titles. The original Art Cloud
 * import gave us titles like "Untitled, CLIR2023.472" — now that SKU
 * is its own field, the title should just read "Untitled".
 *
 * Algorithm: split title by ", ", drop any segment that exactly matches
 * the row's sku, rejoin. Preserves other segments (e.g. date strings):
 *   "Untitled, ABai 1, ND"  + sku="ABai 1"  →  "Untitled, ND"
 *   "Untitled, CLIR2023.472" + sku="CLIR2023.472" → "Untitled"
 *   "JS 5"                   + sku="JS 5"   →  "JS 5"  (would empty out — left alone)
 *
 * Run: npx tsx --env-file=.env.local scripts/backfill-titles.ts
 */

import { createClient } from "@supabase/supabase-js";

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

function stripSkuFromTitle(title: string, sku: string): string {
  const segments = title.split(",").map((s) => s.trim());
  const remaining = segments.filter((s) => s.length > 0 && s !== sku);
  if (remaining.length === 0) return title; // would fully empty — leave alone
  return remaining.join(", ");
}

async function main() {
  console.log("Fetching artworks with sku set...");
  const all: { id: string; title: string; sku: string }[] = [];
  let off = 0;
  while (true) {
    const { data, error } = await supabase
      .from("artworks")
      .select("id, title, sku")
      .not("sku", "is", null)
      .range(off, off + 999);
    if (error) { console.error(error); process.exit(1); }
    if (!data || data.length === 0) break;
    all.push(...(data as any));
    if (data.length < 1000) break;
    off += 1000;
  }
  console.log(`Fetched ${all.length} artworks with sku`);

  let changed = 0;
  let unchanged = 0;
  let errors = 0;
  for (const row of all) {
    if (!row.title || !row.sku) { unchanged++; continue; }
    const newTitle = stripSkuFromTitle(row.title, row.sku);
    if (newTitle === row.title) { unchanged++; continue; }

    const { error } = await supabase.from("artworks").update({ title: newTitle }).eq("id", row.id);
    if (error) { errors++; continue; }
    changed++;
  }

  console.log("\n=== Summary ===");
  console.log(`Total scanned: ${all.length}`);
  console.log(`Title changed: ${changed}`);
  console.log(`Unchanged:     ${unchanged}`);
  console.log(`Errors:        ${errors}`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
