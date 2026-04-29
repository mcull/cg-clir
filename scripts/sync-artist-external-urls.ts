#!/usr/bin/env npx tsx
/**
 * sync-artist-external-urls.ts
 *
 * Fetches creativegrowth.org/sitemap.xml, extracts the artist URLs
 * (pattern: /artist/<slug>), matches them against our artists table by
 * slug, and writes the URL into artists.external_url.
 *
 * Run: npx tsx --env-file=.env.local scripts/sync-artist-external-urls.ts
 *
 * Prerequisite: artists.external_url column must exist (migration in
 * supabase/migrations/001_initial.sql; production may need a manual
 * ALTER TABLE artists ADD COLUMN external_url TEXT;).
 */

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const SITEMAP_URL = "https://creativegrowth.org/sitemap.xml";
const ARTIST_URL_RE = /<loc>(https:\/\/www\.creativegrowth\.org\/artist\/[^<]+)<\/loc>/g;
// Snapshot lives under src/ so the admin Edit Artist page can import it
// directly via the @/ alias. Both this script and the page read/write
// the same source-controlled file.
const SNAPSHOT_FILE = path.join(__dirname, "..", "src", "lib", "data", "cg-artist-urls.json");

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

async function fetchAll<T>(buildQ: () => any): Promise<T[]> {
  const all: T[] = [];
  let off = 0;
  while (true) {
    const { data, error } = await buildQ().range(off, off + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    off += 1000;
  }
  return all;
}

async function main() {
  console.log(`Fetching ${SITEMAP_URL}...`);
  // CG's sitemap returns empty body for the default fetch user-agent;
  // a browser-style UA gets the real XML.
  const res = await fetch(SITEMAP_URL, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) {
    console.error(`Sitemap fetch failed: ${res.status}`);
    process.exit(1);
  }
  const xml = await res.text();
  const urlBySlug = new Map<string, string>();
  for (const m of xml.matchAll(ARTIST_URL_RE)) {
    const url = m[1];
    const slug = url.split("/artist/")[1];
    if (slug) urlBySlug.set(slug, url);
  }
  console.log(`Found ${urlBySlug.size} artist URLs in sitemap`);

  // Write source-controlled snapshot consumed by the admin URL picker.
  // Stored as a sorted slug list for stable diffs.
  const dataDir = path.dirname(SNAPSHOT_FILE);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const snapshot = {
    fetched_at: new Date().toISOString(),
    source: SITEMAP_URL,
    slugs: [...urlBySlug.keys()].sort(),
  };
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(`Snapshot written: ${SNAPSHOT_FILE}`);

  const artists = await fetchAll<{ id: string; first_name: string; last_name: string; slug: string }>(
    () => supabase.from("artists").select("id, first_name, last_name, slug")
  );
  console.log(`Found ${artists.length} artists in DB`);

  // Identify artists with active artworks so the unmatched-but-relevant
  // list is meaningful (we don't care about unmatched artists with zero
  // active artworks — they don't surface in the public UI).
  const activeArt = await fetchAll<{ artist_id: string }>(
    () => supabase.from("artworks").select("artist_id").eq("on_website", true).not("artist_id", "is", null)
  );
  const activeArtistIds = new Set(activeArt.map((a) => a.artist_id));

  const updates: { id: string; external_url: string }[] = [];
  const unmatchedActive: { slug: string; name: string }[] = [];
  for (const a of artists) {
    const url = urlBySlug.get(a.slug);
    if (url) {
      updates.push({ id: a.id, external_url: url });
    } else if (activeArtistIds.has(a.id)) {
      unmatchedActive.push({ slug: a.slug, name: `${a.first_name} ${a.last_name}`.trim() });
    }
  }

  console.log(`\nMatched artists (will update): ${updates.length}`);
  console.log(`Unmatched artists with active artworks: ${unmatchedActive.length}`);
  if (unmatchedActive.length > 0) {
    console.log(`\nUnmatched (artists in our catalog but not in CG's sitemap):`);
    unmatchedActive
      .sort((a, b) => a.slug.localeCompare(b.slug))
      .forEach((u) => console.log(`  ${u.slug.padEnd(28)} | ${u.name}`));
    console.log(`\nThese will fall back to the internal /artists/{slug} link.`);
  }

  // Apply updates one by one. A bulk upsert would be nice but Supabase's
  // upsert requires a unique key and we'd need to re-supply every column.
  // 123 rows is small enough that serial updates are fine.
  console.log(`\nApplying ${updates.length} updates...`);
  let ok = 0, errs = 0;
  for (const u of updates) {
    const { error } = await supabase
      .from("artists")
      .update({ external_url: u.external_url })
      .eq("id", u.id);
    if (error) {
      console.error(`  FAIL ${u.id}: ${error.message}`);
      errs++;
    } else {
      ok++;
    }
  }
  console.log(`Done: ${ok} updated, ${errs} failed`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
