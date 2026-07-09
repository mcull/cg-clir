#!/usr/bin/env npx tsx
/**
 * describe-artwork-images.ts
 *
 * Generates a concise per-image short_description (used as alt text + caption)
 * for every artwork_images row that lacks one, using Claude Vision. Mirrors the
 * approach of generate-descriptions.ts (which describes artworks); this operates
 * at the individual-image level, so additional views (front/back, other angles)
 * each get their own description.
 *
 * Run: npm run describe:artwork-images
 *
 * - Checkpoints to scripts/.artwork-image-descriptions-progress.json
 * - Resumable; skips images already described
 * - Note: updating a PRIMARY image's short_description also updates the parent
 *   artwork's alt_text via the DB trigger. This targets short_description IS
 *   NULL rows, which after a bulk image import are the newly-added non-primary
 *   views, so primaries' alt_text is left untouched.
 */
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

const CONCURRENCY = parseInt(process.env.DESCRIPTION_CONCURRENCY || "3", 10);
const PROGRESS_FILE = path.join(__dirname, ".artwork-image-descriptions-progress.json");
const MODEL = "claude-sonnet-4-6";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const SYSTEM_PROMPT = `You are an art museum registrar writing short image descriptions for screen reader users. You are describing images of artworks by artists with disabilities at Creative Growth Art Center in Oakland, California.

Many of these are additional views of a piece — the back of a work on paper, a detail, or another angle of a sculpture. Describe THIS specific image factually: the view/angle, primary visual content, and medium if evident. Be concise and under 125 characters. Do not speculate about intent or emotion.

Respond with a JSON object with a single field "short_description" (a string). Respond ONLY with valid JSON — no markdown, no code fences.`;

interface Progress {
  completed: string[];
  failed: { id: string; error: string }[];
  totalTokens: number;
}

function loadProgress(): Progress {
  if (fs.existsSync(PROGRESS_FILE)) return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8"));
  return { completed: [], failed: [], totalTokens: 0 };
}
function saveProgress(p: Progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));
}

async function fetchImageAsBase64(
  url: string
): Promise<{ base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "image/jpeg";
  let mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" = "image/jpeg";
  if (contentType.includes("png")) mediaType = "image/png";
  else if (contentType.includes("webp")) mediaType = "image/webp";
  else if (contentType.includes("gif")) mediaType = "image/gif";
  return { base64: buffer.toString("base64"), mediaType };
}

interface ImageRow {
  id: string;
  image_url: string | null;
  image_original: string | null;
  artwork: { title: string; medium: string | null } | null;
}

async function describe(img: ImageRow): Promise<{ text: string; tokens: number }> {
  const url = img.image_url || img.image_original;
  if (!url) throw new Error("no image url");
  const { base64, mediaType } = await fetchImageAsBase64(url);

  const ctx: string[] = [];
  if (img.artwork?.title) ctx.push(`Artwork title: ${img.artwork.title}`);
  if (img.artwork?.medium) ctx.push(`Medium: ${img.artwork.medium}`);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 200,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: `Describe this image (one of possibly several views of the artwork).\n\n${ctx.join("\n")}` },
        ],
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const tokens = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const parsed = JSON.parse(cleaned) as { short_description?: string };
  if (!parsed.short_description) throw new Error("Missing short_description in response");
  return { text: parsed.short_description.trim(), tokens };
}

async function main() {
  const { data: images, error } = await supabase
    .from("artwork_images")
    .select("id, image_url, image_original, artwork:artworks(title, medium)")
    .is("short_description", null)
    .not("image_url", "is", null);
  if (error) throw error;

  const progress = loadProgress();
  const doneSet = new Set(progress.completed);
  const todo = (images || []).filter((i) => !doneSet.has(i.id)) as unknown as ImageRow[];
  console.log(`${todo.length} images need a description (${progress.completed.length} already done).`);

  let processed = 0;
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (img) => {
        try {
          const { text, tokens } = await describe(img);
          const { error: upErr } = await supabase
            .from("artwork_images")
            .update({ short_description: text })
            .eq("id", img.id);
          if (upErr) throw upErr;
          progress.completed.push(img.id);
          progress.totalTokens += tokens;
        } catch (e) {
          progress.failed.push({ id: img.id, error: e instanceof Error ? e.message : String(e) });
          console.error(`  ${img.id} failed:`, e instanceof Error ? e.message : e);
        }
      })
    );
    processed += batch.length;
    saveProgress(progress);
    console.log(`  ${processed}/${todo.length} (tokens: ${progress.totalTokens})`);
  }

  console.log(`\nDone. Described: ${progress.completed.length}, failed: ${progress.failed.length}, tokens: ${progress.totalTokens}`);
}

main().then(() => process.exit(0));
