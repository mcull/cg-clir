#!/usr/bin/env npx tsx
/**
 * migrate-and-describe.ts
 *
 * Combined script: downloads artwork images from Art Cloud CDN, uploads
 * resized variants to Cloudflare R2, and generates AI descriptions via
 * Claude Vision — all in a single pass per image.
 *
 * The medium_800 variant (already in memory from resizing) is sent to
 * Claude Vision, avoiding a redundant download.
 *
 * Run: npx tsx scripts/migrate-and-describe.ts
 *
 * Features:
 * - Checkpoints progress to scripts/.migrate-describe-progress.json
 * - Can be interrupted and resumed safely
 * - Image migration and description failures are tracked independently
 * - Processes images in parallel (configurable concurrency, default 3)
 */

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import {
  S3Client,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";

// ─── Config ───────────────────────────────────────────────────────────────
const CONCURRENCY = parseInt(process.env.MIGRATION_CONCURRENCY || "3", 10);
const PROGRESS_FILE = path.join(__dirname, ".migrate-describe-progress.json");
const VISION_MODEL = "claude-sonnet-4-20250514";
const SKIP_DESCRIPTIONS = process.env.SKIP_DESCRIPTIONS === "true";

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

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const BUCKET = process.env.R2_BUCKET_NAME || "cg-clir";
const PUBLIC_URL = process.env.R2_PUBLIC_URL || "";

// ─── Progress tracking ───────────────────────────────────────────────────
interface Progress {
  imageDone: string[];       // inventory numbers with images migrated
  descDone: string[];        // artwork IDs with descriptions generated
  imageFailed: { inventoryNumber: string; error: string }[];
  descFailed: { id: string; title: string; error: string }[];
  totalTokens: number;
  startedAt: string;
  lastUpdated: string;
}

function loadProgress(): Progress {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8"));
  }
  return {
    imageDone: [],
    descDone: [],
    imageFailed: [],
    descFailed: [],
    totalTokens: 0,
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
}

function saveProgress(progress: Progress) {
  progress.lastUpdated = new Date().toISOString();
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// ─── Vision prompt ───────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are writing image descriptions for screen reader users at Creative Growth Art Center in Oakland, California — a studio for artists with disabilities.

For each image, provide a JSON response with two fields:

1. "alt_text": A concise description (under 125 characters) for the img alt attribute. Identify the artwork type, primary visual content, and medium. Be factual, not interpretive.

2. "description": Two or three sentences describing the artwork for someone who is blind or visually impaired. Start with the most important details — describe the content of the image directly. DO NOT start sentences with "The artwork is...", "This is a picture of...", "Presented is...", or similar framing. Avoid assumptions about gender; if describing gender presentation of a figure, use descriptive terms like fem, femme, or masc. Note composition, color palette, texture, and technique. Maintain a respectful, museum-professional tone. Do not speculate about the artist's intent or emotional state.

Respond ONLY with valid JSON. No markdown, no code fences, no extra text.`;

// ─── Image download with retry ───────────────────────────────────────────
async function downloadImage(url: string, retries = 3): Promise<Buffer> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} fetching ${url}`);
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error("unreachable");
}

// ─── Resize and upload variants to R2 ────────────────────────────────────
async function uploadVariants(
  inventoryNumber: string,
  imageBuffer: Buffer
): Promise<{ newUrl: string; mediumBuffer: Buffer }> {
  const baseKey = `artworks/${inventoryNumber}`;
  let mediumBuffer: Buffer = imageBuffer; // fallback to original

  for (const variant of VARIANTS) {
    let processed: Buffer;
    if (variant.maxWidth === null) {
      processed = imageBuffer;
    } else {
      processed = await sharp(imageBuffer)
        .resize({ width: variant.maxWidth, withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      if (variant.name === "medium_800") {
        mediumBuffer = processed;
      }
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

  const newUrl = PUBLIC_URL
    ? `${PUBLIC_URL}/${baseKey}/large_1600.jpg`
    : `${baseKey}/large_1600.jpg`;

  return { newUrl, mediumBuffer };
}

// ─── Generate description from already-resized buffer ────────────────────
async function generateDescription(
  mediumBuffer: Buffer,
  title: string,
  artistName: string,
  medium: string | null,
  dimensions: string | null
): Promise<{ alt_text: string; description: string; tokens: number }> {
  const base64 = mediumBuffer.toString("base64");

  const contextParts: string[] = [];
  contextParts.push(`Title: ${title}`);
  contextParts.push(`Artist: ${artistName}`);
  if (medium) contextParts.push(`Medium: ${medium}`);
  if (dimensions) contextParts.push(`Dimensions: ${dimensions}`);

  const response = await anthropic.messages.create({
    model: VISION_MODEL,
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: base64 },
          },
          {
            type: "text",
            text: `Describe this artwork.\n\n${contextParts.join("\n")}`,
          },
        ],
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const tokens =
    (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const parsed = JSON.parse(cleaned);

  if (!parsed.alt_text || !parsed.description) {
    throw new Error("Missing alt_text or description in response");
  }

  return { alt_text: parsed.alt_text, description: parsed.description, tokens };
}

// ─── Main ─────────────────────────────────────────────────────────────────
type ArtworkRow = {
  id: string;
  inventory_number: string | null;
  title: string;
  medium: string | null;
  height: number | null;
  width: number | null;
  image_original: string | null;
  image_url: string | null;
  alt_text_long: string | null;
  artist: { first_name: string; last_name: string } | null;
};

async function main() {
  console.log("Fetching artworks from Supabase...\n");

  let allArtworks: ArtworkRow[] = [];
  let offset = 0;
  const PAGE_SIZE = 1000;

  while (true) {
    const { data, error } = await supabase
      .from("artworks")
      .select(
        "id, inventory_number, title, medium, height, width, image_original, image_url, alt_text_long, artist:artists(first_name, last_name)"
      )
      .not("image_original", "is", null)
      .not("inventory_number", "is", null)
      .order("inventory_number")
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error("Error fetching artworks:", error);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    allArtworks = allArtworks.concat(data as unknown as ArtworkRow[]);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  if (allArtworks.length === 0) {
    console.log("No artworks with images found.");
    process.exit(0);
  }

  const progress = loadProgress();
  const imageDoneSet = new Set(progress.imageDone);
  const descDoneSet = new Set(progress.descDone);

  // An artwork needs processing if either its image or description isn't done
  const remaining = allArtworks.filter(
    (a) =>
      !imageDoneSet.has(a.inventory_number!) ||
      (!descDoneSet.has(a.id) && !a.alt_text_long)
  );

  console.log(`Total artworks with images: ${allArtworks.length}`);
  console.log(`Images migrated: ${progress.imageDone.length}`);
  console.log(`Descriptions generated: ${progress.descDone.length}`);
  console.log(`Remaining to process: ${remaining.length}\n`);

  if (remaining.length === 0) {
    console.log("All artworks fully migrated and described!");
    return;
  }

  let imageOk = 0;
  let imageFail = 0;
  let descOk = 0;
  let descFail = 0;

  async function processArtwork(artwork: ArtworkRow) {
    const invNum = artwork.inventory_number!;
    const needsImage = !imageDoneSet.has(invNum);
    const needsDesc = !SKIP_DESCRIPTIONS && !descDoneSet.has(artwork.id) && !artwork.alt_text_long;

    // If we only need a description but the image is already migrated,
    // we still need to download the image for Claude Vision
    let mediumBuffer: Buffer | null = null;
    let newUrl: string | null = null;

    // Step 1: Download the image (needed for either task)
    let imageBuffer: Buffer;
    try {
      imageBuffer = await downloadImage(artwork.image_original!);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (needsImage) {
        progress.imageFailed.push({ inventoryNumber: invNum, error: msg });
        imageFail++;
      }
      if (needsDesc) {
        progress.descFailed.push({ id: artwork.id, title: artwork.title, error: `Download failed: ${msg}` });
        descFail++;
      }
      console.error(`  DOWNLOAD FAILED [${invNum}]: ${msg}`);
      return;
    }

    // Step 2: Upload variants to R2 (if needed)
    if (needsImage) {
      try {
        const result = await uploadVariants(invNum, imageBuffer);
        newUrl = result.newUrl;
        mediumBuffer = result.mediumBuffer;
        progress.imageDone.push(invNum);
        imageDoneSet.add(invNum);
        imageOk++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        progress.imageFailed.push({ inventoryNumber: invNum, error: msg });
        imageFail++;
        console.error(`  UPLOAD FAILED [${invNum}]: ${msg}`);
        // Still try description — we have the buffer
      }
    }

    // Step 3: Generate description (if needed)
    if (needsDesc) {
      // If we didn't produce a medium buffer from upload, create one now
      if (!mediumBuffer) {
        try {
          mediumBuffer = await sharp(imageBuffer)
            .resize({ width: 800, withoutEnlargement: true })
            .jpeg({ quality: 85 })
            .toBuffer();
        } catch {
          mediumBuffer = imageBuffer;
        }
      }

      const artistName = artwork.artist
        ? `${artwork.artist.first_name} ${artwork.artist.last_name}`.trim()
        : "Unknown Artist";
      const dimensions =
        artwork.height && artwork.width
          ? `${artwork.height} × ${artwork.width} in`
          : null;

      try {
        const desc = await generateDescription(
          mediumBuffer,
          artwork.title,
          artistName,
          artwork.medium,
          dimensions
        );

        // Build the DB update — include image_url if we also migrated
        const update: Record<string, string> = {
          alt_text_long: desc.description,
          alt_text: desc.alt_text,
          description_origin: "ai",
        };
        if (newUrl) {
          update.image_url = newUrl;
        }

        const { error: updateErr } = await supabase
          .from("artworks")
          .update(update)
          .eq("id", artwork.id);

        if (updateErr) {
          throw new Error(`DB update failed: ${updateErr.message}`);
        }

        progress.descDone.push(artwork.id);
        descDoneSet.add(artwork.id);
        progress.totalTokens += desc.tokens;
        descOk++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        progress.descFailed.push({ id: artwork.id, title: artwork.title, error: msg });
        descFail++;
        console.error(`  DESC FAILED [${artwork.title}]: ${msg.substring(0, 80)}`);

        // Still update image_url if we migrated successfully
        if (newUrl) {
          await supabase
            .from("artworks")
            .update({ image_url: newUrl })
            .eq("id", artwork.id);
        }
      }
    } else if (newUrl) {
      // Only image migration needed, no description — just update URL
      await supabase
        .from("artworks")
        .update({ image_url: newUrl })
        .eq("id", artwork.id);
    }
  }

  // Process with controlled concurrency
  for (let i = 0; i < remaining.length; i += CONCURRENCY) {
    const batch = remaining.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(processArtwork));
    saveProgress(progress);

    const total = imageOk + imageFail + descOk + descFail;
    const pct = (((i + batch.length) / remaining.length) * 100).toFixed(1);
    process.stdout.write(
      `\r  ${pct}% — images: ${imageOk} ok/${imageFail} fail — desc: ${descOk} ok/${descFail} fail — ~${progress.totalTokens.toLocaleString()} tokens`
    );

    // Small delay between batches to avoid API rate limiting
    if (i + CONCURRENCY < remaining.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(`\n\n=== Migration + Description Complete ===`);
  console.log(`Images migrated: ${imageOk} (${imageFail} failed)`);
  console.log(`Descriptions generated: ${descOk} (${descFail} failed)`);
  console.log(`Total tokens used: ${progress.totalTokens.toLocaleString()}`);
  console.log(`Progress saved to: ${PROGRESS_FILE}`);

  if (progress.imageFailed.length > 0) {
    console.log(`\nFailed image migrations (last 10):`);
    for (const f of progress.imageFailed.slice(-10)) {
      console.log(`  ${f.inventoryNumber}: ${f.error.substring(0, 80)}`);
    }
  }
  if (progress.descFailed.length > 0) {
    console.log(`\nFailed descriptions (last 10):`);
    for (const f of progress.descFailed.slice(-10)) {
      console.log(`  ${f.title}: ${f.error.substring(0, 80)}`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
