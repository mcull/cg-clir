#!/usr/bin/env npx tsx
/**
 * normalize-mediums-propose.ts (Phase 1)
 *
 * Fetches every distinct medium string in the catalog, asks Claude to
 * propose a small (~12-18) bucket vocabulary of pure materials and a
 * mapping from each input string to one or more buckets. Writes
 * `tmp/medium-buckets_<ISO>.csv` for human review in Sheets.
 *
 * Run: npx tsx --env-file=.env.local scripts/normalize-mediums-propose.ts
 */

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

const TMP_DIR = path.join(__dirname, "..", "tmp");
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUTPUT_FILE = path.join(TMP_DIR, `medium-buckets_${TIMESTAMP}.csv`);

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY || !ANTHROPIC_KEY) {
  console.error("Error: set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You are an expert museum cataloger normalizing artwork medium descriptions into a small set of material-only buckets, following CDWA (Categories for the Description of Works of Art) conventions.

Goals:
- Propose ~12-18 buckets covering the materials present. Materials only — pigments, drawing tools, sculpture materials, fiber materials. NOT support (paper, canvas, etc.) and NOT technique (drawing, painting). Examples of bucket-worthy material names: Ink, Acrylic, Watercolor, Oil paint, Pastel, Oil pastel, Color Stix, Colored pencil, Pencil/Graphite, Marker, Pen, Crayon, Charcoal, Ceramic, Wood, Fiber/Yarn.
- For each input medium string, return an array of bucket names listing every material present. CDWA prefers enumeration: a 3-material piece gets 3 tags. Common case is 1 tag.
- Use the bucket name "Other" only when you genuinely cannot enumerate (e.g. "Mixed media on paper" with no specifics).
- Combine related materials when sensible (e.g. "Pen on paper" + "Ink on paper" both → "Ink"; "Oil pastel on paper" + "Pastel on paper" — your call whether to keep separate).
- Bucket names should be short and human-readable for a dropdown filter.

Respond ONLY with valid JSON in this shape (no markdown, no fences):
{
  "buckets": ["Ink", "Acrylic", ...],
  "mapping": {
    "Ink on paper": ["Ink"],
    "Color Stix, ink, and colored pencil on paper": ["Color Stix", "Ink", "Colored pencil"],
    ...
  }
}

Every input medium string must appear as a key in "mapping". Every bucket name in "mapping" values must appear in "buckets".`;

interface MediumRow { medium: string; count: number; }

function csvField(v: string | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(filePath: string, columns: string[], rows: Record<string, string>[]): void {
  const header = columns.join(",");
  const body = rows.map((r) => columns.map((c) => csvField(r[c])).join(",")).join("\n");
  fs.writeFileSync(filePath, header + "\n" + body + "\n");
}

async function main() {
  // 1. Fetch all distinct mediums + counts
  console.log("Fetching mediums from DB...");
  const all: { medium: string | null }[] = [];
  let off = 0;
  while (true) {
    const { data, error } = await supabase
      .from("artworks")
      .select("medium")
      .not("medium", "is", null)
      .range(off, off + 999);
    if (error) { console.error(error); process.exit(1); }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    off += 1000;
  }

  const counts = new Map<string, number>();
  for (const r of all) {
    const m = (r.medium || "").trim();
    if (!m) continue;
    counts.set(m, (counts.get(m) || 0) + 1);
  }
  const distinct: MediumRow[] = [...counts.entries()]
    .map(([medium, count]) => ({ medium, count }))
    .sort((a, b) => b.count - a.count);

  console.log(`Found ${distinct.length} distinct medium strings across ${all.length} artworks`);

  // 2. Send to Claude for normalization
  console.log("Calling Claude for bucket proposal + mapping (this may take 10-30s)...");
  const userMessage = `Here are the distinct medium strings from the catalog (with row counts in parentheses):\n\n${distinct
    .map((d) => `${d.medium} (${d.count})`)
    .join("\n")}`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  let parsed: { buckets: string[]; mapping: Record<string, string[]> };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.error("Claude returned non-JSON response. Raw text:");
    console.error(text);
    process.exit(1);
  }

  if (!parsed.buckets || !parsed.mapping) {
    console.error("Claude response missing 'buckets' or 'mapping'. Raw:");
    console.error(text);
    process.exit(1);
  }

  // 3. Write CSV
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  const rows = distinct.map((d) => {
    const buckets = parsed.mapping[d.medium] || [];
    const note = buckets.length === 0 ? "WARNING: not in Claude mapping" : "";
    return {
      medium: d.medium,
      count: String(d.count),
      proposed_buckets: buckets.join("; "),
      notes: note,
    };
  });
  writeCsv(OUTPUT_FILE, ["medium", "count", "proposed_buckets", "notes"], rows);

  // 4. Summary
  const bucketCounts = new Map<string, number>();
  for (const d of distinct) {
    const buckets = parsed.mapping[d.medium] || [];
    for (const b of buckets) bucketCounts.set(b, (bucketCounts.get(b) || 0) + d.count);
  }
  const multiBucketRows = distinct.filter((d) => (parsed.mapping[d.medium] || []).length > 1).length;

  console.log("\n=== Proposed Buckets ===");
  parsed.buckets.forEach((b) => {
    const c = bucketCounts.get(b) || 0;
    console.log(`  ${b.padEnd(24)} ${c} artworks`);
  });
  console.log(`\nMulti-bucket strings (multiple materials): ${multiBucketRows}`);
  console.log(`\nCSV: ${OUTPUT_FILE}`);
  console.log("\nNext: open the CSV in Sheets, edit `proposed_buckets` if needed, save, then:");
  console.log(`  npm run medium:apply -- ${OUTPUT_FILE}`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
