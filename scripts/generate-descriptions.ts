#!/usr/bin/env npx tsx
/**
 * generate-descriptions.ts
 *
 * Uses Claude Vision API to generate museum-quality alt text and descriptions
 * for all artworks that don't have descriptions yet.
 *
 * Run: npx tsx scripts/generate-descriptions.ts
 *
 * Features:
 * - Checkpoints progress to scripts/.description-progress.json
 * - Rate-limits to avoid API throttling
 * - Can be interrupted and resumed safely
 */

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

// ─── Config ───────────────────────────────────────────────────────────────
const CONCURRENCY = parseInt(process.env.DESCRIPTION_CONCURRENCY || "3", 10);
const PROGRESS_FILE = path.join(__dirname, ".description-progress.json");
const MODEL = "claude-sonnet-4-20250514";

// ─── Clients ──────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// ─── System prompt ────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an art museum registrar writing image descriptions for screen reader users. You are describing artworks by artists with disabilities at Creative Growth Art Center in Oakland, California.

For each image, provide a JSON response with two fields:

1. "alt_text": A concise description (under 125 characters) identifying the artwork type, primary visual content, and medium. Be factual, not interpretive. Focus on what a sighted person would see at a glance.
   Example: "Abstract drawing in colored pencil with dense overlapping circular forms in red, blue, and yellow on white paper."

2. "description": 2-4 sentences expanding on composition, color palette, texture, and artistic technique. Note anything distinctive about the work — dominant patterns, spatial arrangement, use of materials. Maintain a respectful, museum-professional tone. Do not speculate about the artist's intent or emotional state.

Respond ONLY with valid JSON. No markdown, no code fences, no extra text.`;

// ─── Progress tracking ───────────────────────────────────────────────────
interface Progress {
  completed: string[]; // artwork IDs that are done
  failed: { id: string; error: string }[];
  startedAt: string;
  lastUpdated: string;
  totalTokens: number;
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
    totalTokens: 0,
  };
}

function saveProgress(progress: Progress) {
  progress.lastUpdated = new Date().toISOString();
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// ─── Image fetching ───────────────────────────────────────────────────────
async function fetchImageAsBase64(
  url: string
): Promise<{ base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "image/jpeg";

  let mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" = "image/jpeg";
  if (contentType.includes("png")) mediaType = "image/png";
  else if (contentType.includes("webp")) mediaType = "image/webp";
  else if (contentType.includes("gif")) mediaType = "image/gif";

  return { base64: buffer.toString("base64"), mediaType };
}

// ─── Description generation ───────────────────────────────────────────────
interface DescriptionResult {
  alt_text: string;
  description: string;
}

async function generateDescription(
  imageUrl: string,
  title: string,
  artistName: string,
  medium: string | null,
  dimensions: string | null
): Promise<{ result: DescriptionResult; tokens: number }> {
  const { base64, mediaType } = await fetchImageAsBase64(imageUrl);

  const contextParts: string[] = [];
  contextParts.push(`Title: ${title}`);
  contextParts.push(`Artist: ${artistName}`);
  if (medium) contextParts.push(`Medium: ${medium}`);
  if (dimensions) contextParts.push(`Dimensions: ${dimensions}`);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64 },
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

  // Parse JSON response
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const parsed: DescriptionResult = JSON.parse(cleaned);

  // Validate
  if (!parsed.alt_text || !parsed.description) {
    throw new Error("Missing alt_text or description in response");
  }

  return { result: parsed, tokens };
}

// ─── Main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log("Fetching artworks needing descriptions...\n");

  // Paginate to get all artworks
  type ArtworkRow = {
    id: string;
    title: string;
    medium: string | null;
    height: number | null;
    width: number | null;
    image_original: string | null;
    image_url: string | null;
    ai_description: string | null;
    artist: { first_name: string; last_name: string } | null;
  };
  let allArtworks: ArtworkRow[] = [];
  let offset = 0;
  const PAGE_SIZE = 1000;

  while (true) {
    const { data, error } = await supabase
      .from("artworks")
      .select("id, title, medium, height, width, image_original, image_url, ai_description, artist:artists(first_name, last_name)")
      .is("ai_description", null)
      .not("image_original", "is", null)
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

  const artworks = allArtworks;
  console.log(`Found ${artworks.length} artworks needing descriptions.`);

  const progress = loadProgress();
  const completedSet = new Set(progress.completed);
  const remaining = artworks.filter((a) => !completedSet.has(a.id));

  console.log(
    `Already described: ${progress.completed.length}. Remaining: ${remaining.length}.\n`
  );

  if (remaining.length === 0) {
    console.log("All artworks already have descriptions!");
    return;
  }

  let successCount = 0;
  let failCount = 0;

  async function processArtwork(artwork: ArtworkRow) {
    const imageUrl = artwork.image_original || artwork.image_url;
    if (!imageUrl) return;

    const artistName = artwork.artist
      ? `${artwork.artist.first_name} ${artwork.artist.last_name}`.trim()
      : "Unknown Artist";

    const dimensions =
      artwork.height && artwork.width
        ? `${artwork.height} × ${artwork.width} in`
        : null;

    try {
      const { result, tokens } = await generateDescription(
        imageUrl,
        artwork.title,
        artistName,
        artwork.medium,
        dimensions
      );

      // Update the artwork record
      const { error: updateErr } = await supabase
        .from("artworks")
        .update({
          ai_description: result.description,
          alt_text: result.alt_text,
        })
        .eq("id", artwork.id);

      if (updateErr) {
        throw new Error(`DB update failed: ${updateErr.message}`);
      }

      progress.completed.push(artwork.id);
      progress.totalTokens += tokens;
      successCount++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      progress.failed.push({ id: artwork.id, error: errorMsg });
      failCount++;
      console.error(`  FAILED [${artwork.title}]: ${errorMsg.substring(0, 80)}`);
    }
  }

  // Process with controlled concurrency
  for (let i = 0; i < remaining.length; i += CONCURRENCY) {
    const batch = remaining.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(processArtwork));
    saveProgress(progress);

    const total = successCount + failCount;
    const pct = ((total / remaining.length) * 100).toFixed(1);
    process.stdout.write(
      `\r  Progress: ${total}/${remaining.length} (${pct}%) — ${successCount} ok, ${failCount} failed — ~${progress.totalTokens.toLocaleString()} tokens`
    );

    // Small delay between batches to avoid rate limiting
    if (i + CONCURRENCY < remaining.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(`\n\n=== Description Generation Complete ===`);
  console.log(`Described: ${successCount}`);
  console.log(`Failed: ${failCount}`);
  console.log(`Total tokens used: ${progress.totalTokens.toLocaleString()}`);
  console.log(`Progress saved to: ${PROGRESS_FILE}`);

  if (failCount > 0) {
    console.log(`\nFailed items (last 10):`);
    for (const f of progress.failed.slice(-10)) {
      console.log(`  ${f.id}: ${f.error.substring(0, 80)}`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
