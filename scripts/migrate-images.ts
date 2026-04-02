#!/usr/bin/env npx tsx
/**
 * migrate-images.ts
 *
 * Downloads artwork images from Art Cloud CDN and uploads them to Cloudflare R2.
 * Generates thumbnail (400px), medium (800px), large (1600px), and original variants.
 *
 * Run: npx tsx scripts/migrate-images.ts
 *
 * Features:
 * - Checkpoints progress to scripts/.image-migration-progress.json
 * - Can be interrupted and resumed safely
 * - Processes images in parallel (configurable concurrency)
 */

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import sharp from "sharp";

// ─── Config ───────────────────────────────────────────────────────────────
const CONCURRENCY = parseInt(process.env.MIGRATION_CONCURRENCY || "5", 10);
const PROGRESS_FILE = path.join(__dirname, ".image-migration-progress.json");
const VARIANTS = [
  { name: "original", maxWidth: null },
  { name: "large_1600", maxWidth: 1600 },
  { name: "medium_800", maxWidth: 800 },
  { name: "thumb_400", maxWidth: 400 },
] as const;

// ─── Clients ──────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME || "cg-clir";
const PUBLIC_URL = process.env.R2_PUBLIC_URL || "";

// ─── Progress tracking ───────────────────────────────────────────────────
interface Progress {
  completed: string[]; // inventory numbers that are done
  failed: { inventoryNumber: string; error: string }[];
  startedAt: string;
  lastUpdated: string;
}

function loadProgress(): Progress {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8"));
  }
  return {
    completed: [],
    failed: [],
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
}

function saveProgress(progress: Progress) {
  progress.lastUpdated = new Date().toISOString();
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// ─── Image processing ─────────────────────────────────────────────────────
async function downloadImage(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function processAndUploadVariants(
  inventoryNumber: string,
  imageBuffer: Buffer
): Promise<string> {
  const baseKey = `artworks/${inventoryNumber}`;

  for (const variant of VARIANTS) {
    let processed: Buffer;
    if (variant.maxWidth === null) {
      processed = imageBuffer;
    } else {
      processed = await sharp(imageBuffer)
        .resize({ width: variant.maxWidth, withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
    }

    const key = `${baseKey}/${variant.name}.jpg`;

    await r2.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: processed,
        ContentType: "image/jpeg",
        CacheControl: "public, max-age=31536000, immutable",
      })
    );
  }

  // Return the URL for the large variant (used as the primary image_url)
  if (PUBLIC_URL) {
    return `${PUBLIC_URL}/${baseKey}/large_1600.jpg`;
  }
  return `${baseKey}/large_1600.jpg`;
}

// ─── Main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log("Fetching artworks with images from Supabase...");

  const { data: artworks, error } = await supabase
    .from("artworks")
    .select("id, inventory_number, image_original, image_url")
    .not("image_original", "is", null)
    .not("inventory_number", "is", null)
    .order("inventory_number");

  if (error) {
    console.error("Error fetching artworks:", error);
    process.exit(1);
  }

  if (!artworks || artworks.length === 0) {
    console.log("No artworks with images found. Run import-csv.ts first.");
    process.exit(0);
  }

  console.log(`Found ${artworks.length} artworks with images.`);

  const progress = loadProgress();
  const completedSet = new Set(progress.completed);
  const remaining = artworks.filter(
    (a) => a.inventory_number && !completedSet.has(a.inventory_number)
  );

  console.log(
    `Already migrated: ${progress.completed.length}. Remaining: ${remaining.length}.`
  );

  if (remaining.length === 0) {
    console.log("All images already migrated!");
    return;
  }

  let successCount = 0;
  let failCount = 0;

  // Process in parallel with controlled concurrency
  async function processArtwork(artwork: (typeof remaining)[0]) {
    const invNum = artwork.inventory_number!;
    try {
      const imageBuffer = await downloadImage(artwork.image_original!);
      const newUrl = await processAndUploadVariants(invNum, imageBuffer);

      // Update the artwork record with the new R2 URL
      await supabase
        .from("artworks")
        .update({ image_url: newUrl })
        .eq("id", artwork.id);

      progress.completed.push(invNum);
      successCount++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      progress.failed.push({ inventoryNumber: invNum, error: errorMsg });
      failCount++;
      console.error(`  FAILED [${invNum}]: ${errorMsg}`);
    }
  }

  // Batch processing with concurrency limit
  for (let i = 0; i < remaining.length; i += CONCURRENCY) {
    const batch = remaining.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(processArtwork));
    saveProgress(progress);

    const total = successCount + failCount;
    process.stdout.write(
      `\r  Progress: ${total}/${remaining.length} (${successCount} ok, ${failCount} failed)`
    );
  }

  console.log(`\n\n=== Migration Complete ===`);
  console.log(`Migrated: ${successCount}`);
  console.log(`Failed: ${failCount}`);
  console.log(`Progress saved to: ${PROGRESS_FILE}`);

  if (failCount > 0) {
    console.log(`\nFailed items:`);
    for (const f of progress.failed.slice(-20)) {
      console.log(`  ${f.inventoryNumber}: ${f.error}`);
    }
    if (progress.failed.length > 20) {
      console.log(`  ... and ${progress.failed.length - 20} more.`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
