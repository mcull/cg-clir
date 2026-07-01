#!/usr/bin/env npx tsx
/**
 * import-artwork-images.ts
 *
 * Bulk-adds artwork images from a manifest CSV with columns:
 *   inventory_number, image_url, is_primary, sort_order, short_description
 *
 * For each row: match the artwork by inventory_number, fetch the URL, generate
 * variants, upload to R2, and insert an artwork_images row. Resumable via a
 * checkpoint; reports unmatched rows and images missing a short description.
 *
 * Run: npm run import:artwork-images -- path/to/manifest.csv
 */
import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { generateVariants } from "../src/lib/image-processing";
import { artworkImageKey } from "../src/lib/r2";
import { parseManifestRow, ManifestRow } from "../src/lib/image-manifest";

const PROGRESS_FILE = path.join(__dirname, ".artwork-images-progress.json");
const BUCKET = process.env.R2_BUCKET_NAME || "cg-clir";
const PUBLIC_URL = process.env.R2_PUBLIC_URL || "";

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

function loadDone(): Set<string> {
  if (fs.existsSync(PROGRESS_FILE)) {
    return new Set(JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8")).done);
  }
  return new Set();
}
function saveDone(done: Set<string>) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ done: [...done] }, null, 2));
}

async function uploadVariant(key: string, body: Buffer) {
  await r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: "image/jpeg" }));
  return PUBLIC_URL ? `${PUBLIC_URL}/${key}` : key;
}

async function importRow(row: ManifestRow): Promise<"ok" | "unmatched"> {
  const { data: art } = await supabase
    .from("artworks")
    .select("id, inventory_number")
    .eq("inventory_number", row.inventory_number)
    .maybeSingle();
  if (!art) return "unmatched";

  const resp = await fetch(row.image_url);
  if (!resp.ok) throw new Error(`fetch ${row.image_url} → ${resp.status}`);
  const input = Buffer.from(await resp.arrayBuffer());

  const imageId = crypto.randomUUID();
  const folder = art.inventory_number || art.id;
  let displayUrl: string | null = null;
  let originalUrl: string | null = null;
  for (const v of await generateVariants(input)) {
    const url = await uploadVariant(artworkImageKey(folder, imageId, v.name), v.buffer);
    if (v.name === "large_1600") displayUrl = url;
    if (v.name === "original") originalUrl = url;
  }

  await supabase.from("artwork_images").insert({
    id: imageId,
    artwork_id: art.id,
    image_url: displayUrl,
    image_original: originalUrl,
    is_primary: false,
    sort_order: row.sort_order,
    short_description: row.short_description,
  });

  if (row.is_primary) {
    // Set this row primary, clear the rest (one-at-a-time keeps the unique index happy).
    const { data: rows } = await supabase
      .from("artwork_images").select("id").eq("artwork_id", art.id);
    for (const r of rows ?? []) {
      await supabase.from("artwork_images").update({ is_primary: r.id === imageId }).eq("id", r.id);
    }
  }
  return "ok";
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: npm run import:artwork-images -- path/to/manifest.csv");
    process.exit(1);
  }
  const records = parse(fs.readFileSync(file, "utf-8"), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  const done = loadDone();
  const unmatched: string[] = [];
  const missingDesc: string[] = [];
  const parseErrors: string[] = [];
  let ok = 0;

  for (let i = 0; i < records.length; i++) {
    const { row, error } = parseManifestRow(records[i], i + 2);
    if (error) { parseErrors.push(error); continue; }
    const key = `${row!.inventory_number}::${row!.image_url}`;
    if (done.has(key)) continue;
    if (!row!.short_description) missingDesc.push(key);
    try {
      const result = await importRow(row!);
      if (result === "unmatched") { unmatched.push(row!.inventory_number); continue; }
      ok++;
      done.add(key);
      saveDone(done);
    } catch (e) {
      console.error(`Row ${i + 2} failed:`, e instanceof Error ? e.message : e);
    }
  }

  console.log(`\nImported: ${ok}`);
  if (parseErrors.length) console.log(`Parse errors:\n  ${parseErrors.join("\n  ")}`);
  if (unmatched.length) console.log(`Unmatched inventory numbers (${unmatched.length}):\n  ${unmatched.join(", ")}`);
  if (missingDesc.length) console.log(`⚠ Imported without a short_description (${missingDesc.length}):\n  ${missingDesc.join("\n  ")}`);
}

main().then(() => process.exit(0));
