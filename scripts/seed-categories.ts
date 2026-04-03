#!/usr/bin/env npx tsx
/**
 * seed-categories.ts
 *
 * Analyzes artworks in Supabase and creates initial top-level categories
 * based on mediums and tags. All categories are flagged as ai_suggested = true
 * so staff can review and adjust them.
 *
 * Run: npx tsx scripts/seed-categories.ts
 */

import { createClient } from "@supabase/supabase-js";
import { slugify } from "../src/lib/utils";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

/**
 * Category definitions with rules for matching artworks.
 * These are initial AI suggestions — staff can modify via admin.
 */
const CATEGORY_DEFINITIONS = [
  {
    name: "Drawings",
    description: "Works on paper including pencil, ink, crayon, and pastel",
    matchMedium: /\b(pencil|graphite|crayon|ink|pen|marker|charcoal|pastel|color stix|colored pencil|sharpie)\b.*\b(paper|board)\b/i,
    matchMediumSimple: /\b(drawing|pencil|graphite|crayon)\b/i,
  },
  {
    name: "Paintings",
    description: "Works in acrylic, oil, watercolor, and tempera on various surfaces",
    matchMedium: /\b(acrylic|oil|watercolor|tempera|gouache|paint)\b/i,
  },
  {
    name: "Fiber Art & Textiles",
    description: "Works in yarn, wool, fabric, fiber, and textile materials",
    matchMedium: /\b(fiber|yarn|wool|fabric|textile|thread|roving|twine|knit|crochet|weav)/i,
  },
  {
    name: "Sculpture & 3D",
    description: "Three-dimensional works in wood, ceramic, clay, and mixed materials",
    matchMedium: /\b(ceramic|clay|wood|sculpture|carved|plaster|found object)/i,
    matchDepth: true, // Also match artworks that have a depth measurement
  },
  {
    name: "Mixed Media",
    description: "Works combining multiple materials and techniques",
    matchMedium: /\b(mixed media|collage|assemblage)\b/i,
  },
  {
    name: "Prints & Multiples",
    description: "Screenprints, lithographs, monotypes, and other printed works",
    matchMedium: /\b(print|screenprint|lithograph|monotype|etching|woodcut|linocut)\b/i,
  },
  {
    name: "CLIR Collection",
    description: "Works digitized as part of the CLIR grant preservation project",
    matchTag: /\bCLIR\b/,
  },
  {
    name: "Photography & Digital",
    description: "Photographic prints and digital media works",
    matchMedium: /\b(photo|digital|video|film)\b/i,
  },
];

async function main() {
  console.log("Fetching all artworks...");

  // Supabase REST API defaults to 1000 rows — paginate to get all
  let allArtworks: { id: string; medium: string | null; tags: string[] | null; depth: number | null }[] = [];
  let offset = 0;
  const PAGE_SIZE = 1000;

  while (true) {
    const { data, error: fetchErr } = await supabase
      .from("artworks")
      .select("id, medium, tags, depth")
      .range(offset, offset + PAGE_SIZE - 1);

    if (fetchErr) {
      console.error("Error fetching artworks:", fetchErr);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    allArtworks = allArtworks.concat(data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  const artworks = allArtworks;
  const error = null;

  if (error || !artworks) {
    console.error("Error fetching artworks:", error);
    process.exit(1);
  }

  console.log(`Found ${artworks.length} artworks to categorize.\n`);

  // ── Create categories ────────────────────────────────────────────────
  const categoryRecords = CATEGORY_DEFINITIONS.map((def, i) => ({
    name: def.name,
    slug: slugify(def.name),
    description: def.description,
    sort_order: i * 10,
    ai_suggested: true,
  }));

  const { data: categories, error: catError } = await supabase
    .from("categories")
    .upsert(categoryRecords, { onConflict: "slug" })
    .select("id, name, slug");

  if (catError || !categories) {
    console.error("Error creating categories:", catError);
    process.exit(1);
  }

  console.log(`Created/updated ${categories.length} categories.`);

  // ── Match artworks to categories ─────────────────────────────────────
  const assignments: { artwork_id: string; category_id: string }[] = [];
  const catIdBySlug = new Map(categories.map((c) => [c.slug, c.id]));
  const matchCounts = new Map<string, number>();

  for (const artwork of artworks) {
    const medium = (artwork.medium || "").toLowerCase();
    const tags = (artwork.tags || []) as string[];
    const tagStr = tags.join(" ");

    for (const def of CATEGORY_DEFINITIONS) {
      const catSlug = slugify(def.name);
      const catId = catIdBySlug.get(catSlug);
      if (!catId) continue;

      let matched = false;

      if ("matchMedium" in def && def.matchMedium && def.matchMedium.test(medium)) {
        matched = true;
      }
      if (!matched && "matchMediumSimple" in def && def.matchMediumSimple?.test(medium)) {
        matched = true;
      }
      if (!matched && "matchTag" in def && def.matchTag && def.matchTag.test(tagStr)) {
        matched = true;
      }
      if (
        !matched &&
        "matchDepth" in def &&
        def.matchDepth &&
        artwork.depth &&
        artwork.depth > 0
      ) {
        matched = true;
      }

      if (matched) {
        assignments.push({ artwork_id: artwork.id, category_id: catId });
        matchCounts.set(def.name, (matchCounts.get(def.name) || 0) + 1);
      }
    }
  }

  // ── Upsert assignments ───────────────────────────────────────────────
  if (assignments.length > 0) {
    // Clear existing AI-assigned categories first
    const aiCategoryIds = categories
      .map((c) => c.id);

    // Delete in batches
    for (const catId of aiCategoryIds) {
      await supabase
        .from("artwork_categories")
        .delete()
        .eq("category_id", catId);
    }

    // Insert new assignments in batches
    const BATCH_SIZE = 500;
    for (let i = 0; i < assignments.length; i += BATCH_SIZE) {
      const batch = assignments.slice(i, i + BATCH_SIZE);
      const { error: assignError } = await supabase
        .from("artwork_categories")
        .upsert(batch, { onConflict: "artwork_id,category_id" });

      if (assignError) {
        console.error(`Error assigning batch ${i / BATCH_SIZE + 1}:`, assignError);
      }
    }
  }

  // ── Report ───────────────────────────────────────────────────────────
  console.log(`\n=== Category Assignments (AI-suggested) ===`);
  for (const def of CATEGORY_DEFINITIONS) {
    const count = matchCounts.get(def.name) || 0;
    console.log(`  ${def.name}: ${count} artworks`);
  }

  const assignedIds = new Set(assignments.map((a) => a.artwork_id));
  const unassigned = artworks.filter((a) => !assignedIds.has(a.id));
  console.log(`\n  Uncategorized: ${unassigned.length} artworks`);

  if (unassigned.length > 0) {
    // Show sample uncategorized mediums
    const uncatMediums = new Map<string, number>();
    for (const a of unassigned) {
      const m = a.medium || "(no medium)";
      uncatMediums.set(m, (uncatMediums.get(m) || 0) + 1);
    }
    const sorted = [...uncatMediums.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`  Top uncategorized mediums:`);
    for (const [medium, count] of sorted.slice(0, 10)) {
      console.log(`    "${medium}": ${count}`);
    }
  }

  console.log(`\nTotal assignments: ${assignments.length}`);
  console.log(
    `All categories flagged as ai_suggested=true for staff review.`
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
