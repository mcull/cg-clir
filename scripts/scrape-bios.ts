#!/usr/bin/env npx tsx
/**
 * scrape-bios.ts
 *
 * Scrapes artist biographies from creativegrowth.org using Playwright
 * (headless browser) and matches them to artists in the CLIR Supabase
 * database. Outputs a CSV log of results.
 *
 * Run: npx tsx --env-file=.env.local scripts/scrape-bios.ts
 */

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { chromium, Browser, Page } from "playwright";

// ─── Config ───────────────────────────────────────────────────────────────
const CONCURRENCY = 2; // browser tabs in parallel
const DELAY_MS = 1000; // polite delay between batches
const LOG_FILE = path.join(__dirname, "artist-bios-log.csv");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ─── Artist slugs from sitemap ───────────────────────────────────────────
const ARTIST_SLUGS = [
  "judith-scott", "aurie-ramirez", "cedric-johnson", "gail-lewis",
  "donald-mitchell", "jay-daley", "jessica-rodriguez", "franna-lusson",
  "susan-janow", "dan-miller", "john-hiltunen", "john-mullins",
  "lulu-sotelo", "tony-pedemonte", "ron-veasey", "daniel-gardiner",
  "dinah-shapiro", "ying-ge-zhou", "peter-salsman", "alice-wong",
  "latefa-noorzai", "rosa-giron", "paul-fields", "marion-bolton",
  "natascha-haehlen", "maureen-clay", "william-tyler", "zina-hall",
  "ray-vickers", "john-martin", "jack-lahaderne", "barry-regan",
  "casey-byrnes", "david-albertsen", "terri-bowden", "gerone-spruill",
  "kim-clark", "jorge-gomez", "dan-hamilton", "sherry-stanley",
  "dlisa-fort", "dwight-mackintosh", "allan-lofberg", "jason-jackson",
  "luis-aguilera", "carlos-fernandez", "larry-randolph", "george-wilson",
  "joseph-alef", "valerie-tribble", "barbara-guhl", "barbara-mealey",
  "monica-valentine", "rickie-algarva", "ruth-stafford", "ricardo-gaitan",
  "christine-szeto", "carrie-oyama", "paulino-martin", "lauren-dare",
  "edwin-zalenski", "theresa-lambert", "angela-villalobos", "shayla-weber",
  "william-scott", "brian-nakahara", "sherrie-aradanas", "heather-edgar",
  "nicole-storm", "mayra-gonzalez", "chris-corr-barberis", "james-davis",
  "lynn-pisco", "stephanie-hill", "carlos-perez", "madison-bandy",
  "david-parsons", "juan-aguilera", "meyshe-shapiro-nygren", "kristian-cheek",
  "rosena-finister", "sher-ron-freeman", "sallie-williams", "julie-swartout",
  "stephanie-nguyen", "jordan-king", "gina-damerell", "raydell-early",
  "gregory-stoper", "betty-hinman", "alice-ung", "katrina-taylor",
  "angela-archuleta", "andrea-leber", "jo-beal", "shirley-chiu",
  "jane-kassner", "lawrence-choy", "bruce-howell", "tanisha-warren",
  "kathy-zhong", "diana-lo", "susan-glikbarg", "nancy-weigen",
  "emily-dunster-farey", "isaiah-jackson", "jamie-ghilardi", "debra-crider",
  "lena-saavedra", "avery-babon", "lena-salk", "ana-alegre",
  "amid-ehsani", "robbie-erion", "walter-baldwin", "shui-wah-poon",
  "nathaniel-jackson", "lisa-craib", "james-freid", "henry-trockle",
  "janis-danker", "eli-cooper", "elizabeth-rangel", "carol-fullen",
  "donna-kurtz", "ryan-williams", "carmen-quinones", "lisa-lipton",
  "jack-starbuck", "aj-herzfeld", "jade-saren", "julian-ou",
  "reginald-burton", "trinity-joseph", "karen-ridge", "emily-witkin",
  "emmanuel-gonzalez", "kathleen-miller", "jordan-evans", "melissa-poe",
  "gregg-nakanishi", "tristram-day-schott", "joe-spears-iii",
  "akasha-cananizado", "emma-holbrook", "malia-ramsey", "steven-pho",
  "hyo-ju-mims", "adumasa-ayinde", "isaac-bar-zeev", "brenda-estrada",
  "oliver-santana", "isabel-gallegos", "oscar-bomse", "erik-kodono",
  "peter-ahn", "zachary-barber", "maya-rogers", "alex-schaffer",
  "angel-love", "ernest-spears", "eva-garrett", "cathy-sampson",
  "anthony-baio", "james-ferrell", "maria-lopez", "charles-nagle",
  "paul-gee", "pharroh-mosely-katakanga", "victoria-sisneros",
  "zar-shepard", "peter-landau", "jean-paul-vallence", "robert-lauricella",
  "andre-keenan", "jarren-samuel", "pharroh-mosley-katakanga",
  "charles-brown", "yolanda-vallance", "benjamin-lew", "calista-novenario",
  "daniel-vallance", "katherine-miller", "elizabeth-rangel-i",
  "darrel-davis", "emily-hessenauer", "kerry-damianakes", "moises-martinez",
  "jorge-vargas", "amaya-lee", "hope-hendricks", "dania-leyva",
  "jorge-rodriguez-vargas", "rey-rivero", "camille-mcfarlane",
  "comic-woodall", "ben-lieberman-i", "jason-monzon", "jose-pena-i",
  "andy-banchero", "jerren-rylee-samuel",
];

// ─── Scrape bio using Playwright ─────────────────────────────────────────
async function scrapeBio(page: Page, slug: string): Promise<string | null> {
  const url = `https://www.creativegrowth.org/artist/${slug}`;
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

    // Try multiple selectors for the biography
    const selectors = [
      '[token="ARTIST_BIOGRAPHY"]',
      '[data-testid*="biography" i]',
      '[class*="biography" i]',
    ];

    for (const selector of selectors) {
      const el = await page.$(selector);
      if (el) {
        const text = await el.textContent();
        if (text && text.trim().length > 20) {
          return text.trim();
        }
      }
    }

    // Fallback: look for paragraphs with biographical content
    const paragraphs = await page.$$eval("p", (els) =>
      els.map((el) => el.textContent?.trim() || "")
    );

    for (const p of paragraphs) {
      if (
        p.length > 100 &&
        /creative growth|born in|practiced at|entered the|studio/i.test(p)
      ) {
        return p;
      }
    }

    // Try combining all paragraph text in a biographical section
    const allText = paragraphs.filter((p) => p.length > 50).join("\n\n");
    if (
      allText.length > 100 &&
      /creative growth|born|practiced/i.test(allText)
    ) {
      return allText;
    }

    return null;
  } catch (err) {
    console.error(
      `  Error scraping ${slug}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────
interface LogEntry {
  website_slug: string;
  clir_slug: string;
  clir_name: string;
  has_bio: boolean;
  bio_length: number;
  match_type: string;
  updated_db: boolean;
}

async function main() {
  console.log("Fetching CLIR artists from database...\n");

  const { data: clirArtists, error } = await supabase
    .from("artists")
    .select("id, first_name, last_name, slug, bio")
    .order("slug");

  if (error || !clirArtists) {
    console.error("Error fetching artists:", error);
    process.exit(1);
  }

  console.log(`CLIR artists in database: ${clirArtists.length}`);
  console.log(`Artist pages to scrape: ${ARTIST_SLUGS.length}\n`);

  // Build maps for matching
  const clirBySlug = new Map(clirArtists.map((a) => [a.slug, a]));
  const clirByName = new Map(
    clirArtists.map((a) => [
      `${a.first_name} ${a.last_name}`.toLowerCase().trim(),
      a,
    ])
  );

  // Launch browser
  console.log("Launching browser...\n");
  const browser: Browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  });

  // Create pages for concurrency
  const pages: Page[] = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    pages.push(await context.newPage());
  }

  const log: LogEntry[] = [];
  const matchedClirSlugs = new Set<string>();
  let scraped = 0;
  let biosFound = 0;
  let dbUpdates = 0;

  function findClirMatch(slug: string): {
    artist: (typeof clirArtists)[0] | null;
    matchType: string;
  } {
    // Exact slug match
    let artist = clirBySlug.get(slug) || null;
    if (artist) return { artist, matchType: "exact_slug" };

    // Name-based match
    const nameFromSlug = slug.replace(/-/g, " ").toLowerCase();
    artist = clirByName.get(nameFromSlug) || null;
    if (artist) return { artist, matchType: "name_match" };

    // Fuzzy match — same last name, similar first name
    for (const [, a] of clirBySlug) {
      const clirName = `${a.first_name} ${a.last_name}`.toLowerCase().trim();
      const clirParts = clirName.split(" ");
      const scrapedParts = nameFromSlug.split(" ");
      if (
        clirParts.length >= 2 &&
        scrapedParts.length >= 2 &&
        clirParts[clirParts.length - 1] ===
          scrapedParts[scrapedParts.length - 1] &&
        (clirParts[0].startsWith(scrapedParts[0]) ||
          scrapedParts[0].startsWith(clirParts[0]))
      ) {
        return { artist: a, matchType: "fuzzy_match" };
      }
    }

    return { artist: null, matchType: "no_match" };
  }

  // Process in batches
  for (let i = 0; i < ARTIST_SLUGS.length; i += CONCURRENCY) {
    const batch = ARTIST_SLUGS.slice(i, i + CONCURRENCY);

    const results = await Promise.all(
      batch.map((slug, idx) => scrapeBio(pages[idx], slug).then((bio) => ({ slug, bio })))
    );

    for (const { slug, bio } of results) {
      scraped++;
      const { artist: clirArtist, matchType } = findClirMatch(slug);
      const hasBio = bio !== null && bio.length > 0;
      if (hasBio) biosFound++;

      const entry: LogEntry = {
        website_slug: slug,
        clir_slug: clirArtist?.slug || "",
        clir_name: clirArtist
          ? `${clirArtist.first_name} ${clirArtist.last_name}`.trim()
          : "",
        has_bio: hasBio,
        bio_length: bio?.length || 0,
        match_type: clirArtist ? matchType : "no_match",
        updated_db: false,
      };

      if (clirArtist && hasBio) {
        const { error: updateErr } = await supabase
          .from("artists")
          .update({ bio })
          .eq("id", clirArtist.id);

        if (updateErr) {
          console.error(`  DB update failed for ${slug}: ${updateErr.message}`);
        } else {
          entry.updated_db = true;
          dbUpdates++;
        }
        matchedClirSlugs.add(clirArtist.slug);
      } else if (clirArtist) {
        matchedClirSlugs.add(clirArtist.slug);
      }

      log.push(entry);

      const status = hasBio
        ? `✓ bio (${bio!.length} chars)`
        : "✗ no bio";
      const dbStatus = entry.updated_db ? " → DB updated" : "";
      const matchStatus =
        matchType === "no_match"
          ? " [NOT IN CLIR]"
          : matchType === "fuzzy_match"
          ? ` [fuzzy → ${clirArtist!.slug}]`
          : "";

      process.stdout.write(
        `\r  ${scraped}/${ARTIST_SLUGS.length} ${slug}: ${status}${matchStatus}${dbStatus}\n`
      );
    }

    if (i + CONCURRENCY < ARTIST_SLUGS.length) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  // Add CLIR artists not found on the website
  for (const artist of clirArtists) {
    if (!matchedClirSlugs.has(artist.slug)) {
      log.push({
        website_slug: "",
        clir_slug: artist.slug,
        clir_name: `${artist.first_name} ${artist.last_name}`.trim(),
        has_bio: false,
        bio_length: 0,
        match_type: "clir_only",
        updated_db: false,
      });
    }
  }

  // Write CSV log
  const csvHeader =
    "website_slug,clir_slug,clir_name,has_bio,bio_length,match_type,updated_db";
  const csvRows = log.map(
    (e) =>
      `"${e.website_slug}","${e.clir_slug}","${e.clir_name.replace(/"/g, '""')}",${e.has_bio},${e.bio_length},"${e.match_type}",${e.updated_db}`
  );
  fs.writeFileSync(LOG_FILE, [csvHeader, ...csvRows].join("\n"));

  await browser.close();

  // Summary
  console.log(`\n=== Summary ===`);
  console.log(`Pages scraped: ${scraped}`);
  console.log(`Biographies found: ${biosFound}`);
  console.log(`Database updates: ${dbUpdates}`);
  console.log(`CLIR artists matched: ${matchedClirSlugs.size} / ${clirArtists.length}`);
  console.log(
    `CLIR artists NOT on website: ${clirArtists.length - matchedClirSlugs.size}`
  );
  console.log(
    `Website artists NOT in CLIR: ${log.filter((e) => e.match_type === "no_match").length}`
  );
  console.log(`\nCSV log: ${LOG_FILE}`);
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
