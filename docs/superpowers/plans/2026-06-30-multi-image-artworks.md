# Multi-image Artworks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each artwork many images with one designated primary — admin reorder/manage, a Met-style detail gallery + carousel, per-image short descriptions for alt/caption, and a URL-based CSV bulk importer.

**Architecture:** A new `artwork_images` table holds the one-to-many images. `artworks.image_url`/`image_original`/`alt_text` are retained as a denormalized mirror of the primary image, kept in sync by a Postgres trigger, so every grid and the FTS index keep working unchanged. The detail page and admin gain image-list UIs; one shared `sharp` variant pipeline serves the admin upload route and the bulk script.

**Tech Stack:** Next.js 14 (App Router), Supabase/Postgres, Cloudflare R2 (S3 SDK), `sharp`, `csv-parse`, vitest.

**Testing note:** This repo's vitest suite covers pure library logic only (no DB/React/integration harness). Tasks therefore apply strict TDD to extracted pure functions (`src/lib/images.ts`, `image-manifest.ts`, `image-processing.ts`, the R2 key builder) and use explicit SQL/build/manual verification for the migration, API routes, and React components — matching existing repo conventions.

**Reference spec:** `docs/superpowers/specs/2026-06-30-multi-image-artworks-design.md`

---

## File structure

**Create:**
- `supabase/migrations/003_artwork_images.sql` — table, partial unique index, RLS, sync trigger, backfill.
- `src/lib/images.ts` — pure helpers (`orderImages`, `pickPrimary`, `imageAlt`, `reorder`, `withPrimary`).
- `src/lib/image-processing.ts` — `IMAGE_VARIANTS`, `generateVariants(buffer)`.
- `src/lib/image-manifest.ts` — `parseBool`, `parseManifestRow`.
- `src/components/ArtworkGallery.tsx` — detail-page hero + thumbnail strip (client).
- `src/app/api/admin/artworks/[id]/images/route.ts` — GET list, POST create (URL or upload).
- `src/app/api/admin/artworks/[id]/images/[imageId]/route.ts` — PATCH (description / make primary), DELETE.
- `src/app/api/admin/artworks/[id]/images/order/route.ts` — PUT reorder.
- `src/components/admin/ImageManager.tsx` — admin image list (drag + keyboard, primary, add, delete).
- `scripts/import-artwork-images.ts` — bulk CSV importer.
- Test files mirroring the pure libs under `tests/lib/`.

**Modify:**
- `src/lib/types.ts` — `ArtworkImage` interface + `Artwork.images?`.
- `src/lib/r2.ts` — add `artworkImageKey`.
- `scripts/run-migration.ts` — accept a migration filename argument.
- `src/app/artwork/[id]/page.tsx` — fetch images, render `ArtworkGallery`.
- `src/components/ImageLightbox.tsx` — extend to a multi-image carousel.
- `src/app/admin/(console)/artworks/[id]/page.tsx` — mount `ImageManager`.
- `scripts/import-csv.ts` — detect `Image 2…N` columns.
- `package.json` — `import:artwork-images` script.

---

## Phase 1 — Data model

### Task 1: Migration runner accepts a filename

**Files:**
- Modify: `scripts/run-migration.ts:14-19`

- [ ] **Step 1: Replace the hardcoded migration path with an argv-driven one**

In `scripts/run-migration.ts`, replace the `MIGRATION_FILE` constant:

```ts
const MIGRATION_FILE = path.join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  process.argv[2] || "001_initial.sql"
);
```

- [ ] **Step 2: Verify it still resolves the default**

Run: `npx tsx -e "process.argv[2]=undefined; require('path')" && node -e "console.log('ok')"`
Expected: prints `ok` (sanity that node runs). The real verification happens in Task 2 when we run the new migration.

- [ ] **Step 3: Commit**

```bash
git add scripts/run-migration.ts
git commit -m "chore(scripts): let run-migration.ts take a migration filename arg"
```

---

### Task 2: `artwork_images` table, index, RLS, sync trigger, backfill

**Files:**
- Create: `supabase/migrations/003_artwork_images.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/003_artwork_images.sql`:

```sql
-- Creative Growth CLIR — multi-image artworks
-- One-to-many artwork→image with a single primary, plus a trigger that
-- mirrors the primary image onto artworks.{image_url,image_original,alt_text}
-- so existing grid queries and the FTS index keep working unchanged.

-- ============================================================
-- TABLE
-- ============================================================
CREATE TABLE artwork_images (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artwork_id         UUID NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  image_url          TEXT,
  image_original     TEXT,
  is_primary         BOOLEAN NOT NULL DEFAULT false,
  sort_order         INT NOT NULL DEFAULT 0,
  -- Per-image short description: drives <img alt> and the visible caption.
  short_description  TEXT,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_artwork_images_artwork ON artwork_images(artwork_id);
-- Exactly one primary per artwork.
CREATE UNIQUE INDEX idx_artwork_images_one_primary
  ON artwork_images(artwork_id) WHERE is_primary;

CREATE TRIGGER artwork_images_updated_at
  BEFORE UPDATE ON artwork_images
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- PRIMARY-IMAGE SYNC TRIGGER
-- ============================================================
-- After any change, recompute the parent artwork's denormalized primary
-- cache. On DELETE of the primary, auto-promote the lowest-sorted survivor.
CREATE OR REPLACE FUNCTION sync_primary_image()
RETURNS TRIGGER AS $$
DECLARE
  target_artwork UUID := COALESCE(NEW.artwork_id, OLD.artwork_id);
  primary_row    artwork_images%ROWTYPE;
BEGIN
  SELECT * INTO primary_row
    FROM artwork_images
    WHERE artwork_id = target_artwork AND is_primary
    LIMIT 1;

  -- No primary left (e.g. primary was deleted): promote lowest sort_order.
  IF NOT FOUND AND TG_OP = 'DELETE' THEN
    UPDATE artwork_images
      SET is_primary = true
      WHERE id = (
        SELECT id FROM artwork_images
          WHERE artwork_id = target_artwork
          ORDER BY sort_order ASC, created_at ASC
          LIMIT 1
      );
    -- The UPDATE above re-fires this trigger and sets the cache; we're done.
    RETURN NULL;
  END IF;

  IF FOUND THEN
    UPDATE artworks SET
      image_url      = primary_row.image_url,
      image_original = primary_row.image_original,
      alt_text       = primary_row.short_description
    WHERE id = target_artwork;
  ELSE
    -- Artwork has no images at all.
    UPDATE artworks SET image_url = NULL, image_original = NULL
      WHERE id = target_artwork;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_primary_image
  AFTER INSERT OR UPDATE OR DELETE ON artwork_images
  FOR EACH ROW EXECUTE FUNCTION sync_primary_image();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE artwork_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view images of published artworks"
  ON artwork_images FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM artworks a
      WHERE a.id = artwork_images.artwork_id AND a.on_website = true
    )
  );

CREATE POLICY "Admins can manage artwork_images"
  ON artwork_images FOR ALL
  USING (auth.jwt() ->> 'email' LIKE '%@creativegrowth.org');

-- ============================================================
-- BACKFILL — one primary image row per existing artwork
-- ============================================================
INSERT INTO artwork_images (artwork_id, image_url, image_original, is_primary, sort_order, short_description)
SELECT a.id, a.image_url, a.image_original, true, 0, a.alt_text
  FROM artworks a
  WHERE a.image_url IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM artwork_images i WHERE i.artwork_id = a.id);
```

- [ ] **Step 2: Run the migration**

Run: `npx tsx --env-file=.env.local scripts/run-migration.ts 003_artwork_images.sql`
Expected: connects, runs without error, prints completion.

- [ ] **Step 3: Verify the backfill and the single-primary invariant**

Run this query (via the same pg connection, e.g. a throwaway `psql` or a `tsx -e` snippet) — expect zero rows, meaning no artwork has ≠1 primary among artworks that have images:

```sql
SELECT artwork_id, count(*) FILTER (WHERE is_primary) AS primaries
FROM artwork_images GROUP BY artwork_id HAVING count(*) FILTER (WHERE is_primary) <> 1;
```
Expected: 0 rows.

- [ ] **Step 4: Verify the trigger mirrors a description edit**

```sql
-- pick any backfilled image, change its short_description, confirm artworks.alt_text follows
UPDATE artwork_images SET short_description = 'TRIGGER TEST'
  WHERE is_primary = true AND artwork_id = (SELECT id FROM artworks WHERE image_url IS NOT NULL LIMIT 1);
SELECT a.alt_text FROM artworks a
  WHERE a.id = (SELECT artwork_id FROM artwork_images WHERE short_description = 'TRIGGER TEST');
```
Expected: `alt_text` = `TRIGGER TEST`. (Revert it afterward.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/003_artwork_images.sql
git commit -m "feat(db): artwork_images table with primary-sync trigger and backfill"
```

---

### Task 3: Types

**Files:**
- Modify: `src/lib/types.ts:25-53`

- [ ] **Step 1: Add the `ArtworkImage` interface and `images?` field**

In `src/lib/types.ts`, add before the `Artwork` interface:

```ts
export interface ArtworkImage {
  id: string;
  artwork_id: string;
  image_url: string | null;
  image_original: string | null;
  is_primary: boolean;
  sort_order: number;
  short_description: string | null;
  created_at: string;
  updated_at: string;
}
```

Then add to the `Artwork` interface's "Joined fields" block (after `categories?: Category[];`):

```ts
  images?: ArtworkImage[];
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(types): add ArtworkImage and Artwork.images"
```

---

## Phase 2 — Pure logic (TDD)

### Task 4: `src/lib/images.ts` ordering / primary / alt / reorder helpers

**Files:**
- Create: `src/lib/images.ts`
- Test: `tests/lib/images.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/images.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { orderImages, pickPrimary, imageAlt, reorder, withPrimary } from "../../src/lib/images";

const img = (id: string, is_primary: boolean, sort_order: number) =>
  ({ id, is_primary, sort_order, short_description: null });

describe("orderImages", () => {
  it("puts the primary first, then ascending sort_order", () => {
    const out = orderImages([img("b", false, 2), img("p", true, 5), img("a", false, 1)]);
    expect(out.map((i) => i.id)).toEqual(["p", "a", "b"]);
  });
  it("does not mutate the input", () => {
    const input = [img("a", false, 1)];
    orderImages(input);
    expect(input.length).toBe(1);
  });
});

describe("pickPrimary", () => {
  it("returns the primary image", () => {
    expect(pickPrimary([img("a", false, 0), img("p", true, 9)])?.id).toBe("p");
  });
  it("falls back to the first ordered image when none is primary", () => {
    expect(pickPrimary([img("b", false, 2), img("a", false, 1)])?.id).toBe("a");
  });
  it("returns null for an empty list", () => {
    expect(pickPrimary([])).toBeNull();
  });
});

describe("imageAlt", () => {
  const art = { title: "Untitled", medium: "Ink" };
  it("uses the image's short_description when present", () => {
    expect(imageAlt({ short_description: "Back of postcard" }, art)).toBe("Back of postcard");
  });
  it("falls back to title + medium", () => {
    expect(imageAlt({ short_description: null }, art)).toBe("Untitled. Ink");
    expect(imageAlt(null, art)).toBe("Untitled. Ink");
  });
});

describe("reorder", () => {
  it("moves an item from one index to another", () => {
    expect(reorder(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  });
});

describe("withPrimary", () => {
  it("sets is_primary true for the target id and false for the rest", () => {
    const out = withPrimary([img("a", true, 0), img("b", false, 1)], "b");
    expect(out.find((i) => i.id === "a")!.is_primary).toBe(false);
    expect(out.find((i) => i.id === "b")!.is_primary).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm failure**

Run: `npx vitest run tests/lib/images.test.ts`
Expected: FAIL — cannot find module `../../src/lib/images`.

- [ ] **Step 3: Implement `src/lib/images.ts`**

```ts
/** Pure helpers for ordering and labeling an artwork's images. */

type OrderableImage = { is_primary: boolean; sort_order: number };

/** Primary first, then ascending sort_order. Returns a new array. */
export function orderImages<T extends OrderableImage>(images: T[]): T[] {
  return [...images].sort((a, b) => {
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    return a.sort_order - b.sort_order;
  });
}

/** The primary image, or the first ordered image, or null if empty. */
export function pickPrimary<T extends OrderableImage>(images: T[]): T | null {
  if (images.length === 0) return null;
  return orderImages(images)[0];
}

/** Short alt/caption text for an image, falling back to title + medium. */
export function imageAlt(
  image: { short_description: string | null } | null,
  artwork: { title: string; medium: string | null }
): string {
  if (image?.short_description) return image.short_description;
  const parts = [artwork.title];
  if (artwork.medium) parts.push(artwork.medium);
  return parts.join(". ");
}

/** Move an array item from one index to another. Returns a new array. */
export function reorder<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  const result = [...items];
  const [moved] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, moved);
  return result;
}

/** Mark one id primary and the rest not (client-side optimistic update). */
export function withPrimary<T extends { id: string; is_primary: boolean }>(
  images: T[],
  primaryId: string
): T[] {
  return images.map((im) => ({ ...im, is_primary: im.id === primaryId }));
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/lib/images.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/images.ts tests/lib/images.test.ts
git commit -m "feat(lib): pure image ordering/primary/alt/reorder helpers"
```

---

### Task 5: R2 key builder + shared `sharp` variant pipeline

**Files:**
- Modify: `src/lib/r2.ts:108`
- Create: `src/lib/image-processing.ts`
- Test: `tests/lib/image-processing.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/image-processing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { generateVariants, IMAGE_VARIANTS } from "../../src/lib/image-processing";
import { artworkImageKey } from "../../src/lib/r2";

describe("artworkImageKey", () => {
  it("builds artworks/{folder}/{imageId}/{variant}.jpg", () => {
    expect(artworkImageKey("2021.123", "img-1", "thumb_400")).toBe(
      "artworks/2021.123/img-1/thumb_400.jpg"
    );
  });
  it("url-encodes the folder", () => {
    expect(artworkImageKey("a b/c", "i", "original")).toContain("a%20b%2Fc");
  });
});

describe("generateVariants", () => {
  it("returns one buffer per configured variant, with thumb_400 <= 400px wide", async () => {
    const src = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: "#888" },
    }).jpeg().toBuffer();

    const out = await generateVariants(src);
    expect(out.map((v) => v.name)).toEqual(IMAGE_VARIANTS.map((v) => v.name));

    const thumb = out.find((v) => v.name === "thumb_400")!;
    const meta = await sharp(thumb.buffer).metadata();
    expect(meta.width!).toBeLessThanOrEqual(400);
  });
});
```

- [ ] **Step 2: Run it and confirm failure**

Run: `npx vitest run tests/lib/image-processing.test.ts`
Expected: FAIL — modules/exports not found.

- [ ] **Step 3: Add `artworkImageKey` to `src/lib/r2.ts`**

Append to `src/lib/r2.ts`:

```ts
/**
 * R2 object key for one variant of one artwork image.
 * `folder` is the artwork's inventory_number (or id when no inventory number).
 */
export function artworkImageKey(
  folder: string,
  imageId: string,
  variant: string
): string {
  return `artworks/${encodeURIComponent(folder)}/${imageId}/${variant}.jpg`;
}
```

- [ ] **Step 4: Implement `src/lib/image-processing.ts`**

```ts
import sharp from "sharp";

/** Variants generated for every artwork image, widest first. */
export const IMAGE_VARIANTS = [
  { name: "original", maxWidth: null },
  { name: "large_1600", maxWidth: 1600 },
  { name: "medium_800", maxWidth: 800 },
  { name: "thumb_400", maxWidth: 400 },
] as const;

export type VariantName = (typeof IMAGE_VARIANTS)[number]["name"];

/** Resize an input image into all configured JPEG variants. */
export async function generateVariants(
  input: Buffer
): Promise<{ name: VariantName; buffer: Buffer }[]> {
  const out: { name: VariantName; buffer: Buffer }[] = [];
  for (const v of IMAGE_VARIANTS) {
    const pipeline =
      v.maxWidth == null
        ? sharp(input)
        : sharp(input).resize({ width: v.maxWidth, withoutEnlargement: true });
    out.push({ name: v.name, buffer: await pipeline.jpeg({ quality: 85 }).toBuffer() });
  }
  return out;
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run tests/lib/image-processing.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/r2.ts src/lib/image-processing.ts tests/lib/image-processing.test.ts
git commit -m "feat(lib): R2 image-key builder and shared sharp variant pipeline"
```

---

### Task 6: Manifest CSV row parsing (TDD)

**Files:**
- Create: `src/lib/image-manifest.ts`
- Test: `tests/lib/image-manifest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/image-manifest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseBool, parseManifestRow } from "../../src/lib/image-manifest";

describe("parseBool", () => {
  it("treats true/yes/y/1 (any case) as true", () => {
    for (const v of ["true", "TRUE", "Yes", "y", "1"]) expect(parseBool(v)).toBe(true);
  });
  it("treats everything else as false", () => {
    for (const v of ["false", "no", "", "0", undefined]) expect(parseBool(v)).toBe(false);
  });
});

describe("parseManifestRow", () => {
  it("parses a valid row", () => {
    const { row, error } = parseManifestRow(
      { inventory_number: "2021.1", image_url: "https://x/a.jpg", is_primary: "yes", sort_order: "3", short_description: "Front" },
      2
    );
    expect(error).toBeUndefined();
    expect(row).toEqual({
      inventory_number: "2021.1",
      image_url: "https://x/a.jpg",
      is_primary: true,
      sort_order: 3,
      short_description: "Front",
    });
  });
  it("errors when inventory_number is missing", () => {
    expect(parseManifestRow({ image_url: "https://x/a.jpg" }, 5).error).toMatch(/inventory_number/);
  });
  it("errors when image_url is missing", () => {
    expect(parseManifestRow({ inventory_number: "2021.1" }, 5).error).toMatch(/image_url/);
  });
  it("defaults sort_order to 0 and short_description to null", () => {
    const { row } = parseManifestRow({ inventory_number: "a", image_url: "u" }, 1);
    expect(row!.sort_order).toBe(0);
    expect(row!.short_description).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm failure**

Run: `npx vitest run tests/lib/image-manifest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/image-manifest.ts`**

```ts
export interface ManifestRow {
  inventory_number: string;
  image_url: string;
  is_primary: boolean;
  sort_order: number;
  short_description: string | null;
}

/** Loose truthy parse for CSV booleans. */
export function parseBool(v: string | undefined): boolean {
  return /^(true|yes|y|1)$/i.test((v ?? "").trim());
}

/** Validate and normalize one raw CSV record. Returns either a row or an error. */
export function parseManifestRow(
  raw: Record<string, string>,
  line: number
): { row?: ManifestRow; error?: string } {
  const inventory_number = (raw.inventory_number ?? "").trim();
  const image_url = (raw.image_url ?? "").trim();
  if (!inventory_number) return { error: `line ${line}: missing inventory_number` };
  if (!image_url) return { error: `line ${line}: missing image_url` };

  const sortRaw = parseInt((raw.sort_order ?? "0").trim(), 10);
  return {
    row: {
      inventory_number,
      image_url,
      is_primary: parseBool(raw.is_primary),
      sort_order: Number.isFinite(sortRaw) ? sortRaw : 0,
      short_description: (raw.short_description ?? "").trim() || null,
    },
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/lib/image-manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/image-manifest.ts tests/lib/image-manifest.test.ts
git commit -m "feat(lib): artwork-image manifest CSV row parser"
```

---

## Phase 3 — Admin API

> All routes are gated by `requireAdmin()` and write via `adminSupabase()` (service role), mirroring `src/app/api/admin/artworks/[id]/route.ts`. The shared create logic fetches/decodes image bytes, runs `generateVariants`, uploads each to R2 with `artworkImageKey`, and inserts an `artwork_images` row.

### Task 7: List + create image route (URL or file upload)

**Files:**
- Create: `src/app/api/admin/artworks/[id]/images/route.ts`

- [ ] **Step 1: Implement the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminSupabase } from "@/lib/admin-auth";
import { uploadToR2, artworkImageKey } from "@/lib/r2";
import { generateVariants } from "@/lib/image-processing";

export const maxDuration = 60;

/** GET — list an artwork's images, primary first. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthed = await requireAdmin();
  if (unauthed) return unauthed;
  const { id } = await params;
  const { data, error } = await adminSupabase()
    .from("artwork_images")
    .select("*")
    .eq("artwork_id", id)
    .order("is_primary", { ascending: false })
    .order("sort_order", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ images: data });
}

/**
 * POST — add an image, multipart/form-data:
 *   file?: Blob | url?: string   (one required)
 *   short_description?: string
 *   make_primary?: "true"
 * Generates variants, uploads to R2, inserts the row. If it's the artwork's
 * first image or make_primary is set, it becomes primary.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthed = await requireAdmin();
  if (unauthed) return unauthed;
  const { id: artworkId } = await params;
  const db = adminSupabase();

  try {
    const form = await request.formData();
    const file = form.get("file");
    const url = form.get("url");
    const shortDescription = (form.get("short_description") as string) || null;
    const makePrimaryRequested = form.get("make_primary") === "true";

    let input: Buffer;
    let sourceUrl: string | null = null;
    if (file instanceof Blob) {
      input = Buffer.from(await file.arrayBuffer());
    } else if (typeof url === "string" && url) {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
      input = Buffer.from(await resp.arrayBuffer());
      sourceUrl = url;
    } else {
      return NextResponse.json({ error: "Provide a file or a url" }, { status: 400 });
    }

    // Folder = inventory_number when available, else the artwork id.
    const { data: art } = await db
      .from("artworks")
      .select("inventory_number")
      .eq("id", artworkId)
      .single();
    const folder = art?.inventory_number || artworkId;

    // Reserve the row id up front so the R2 key can use it.
    const imageId = crypto.randomUUID();
    const variants = await generateVariants(input);
    let displayUrl: string | null = sourceUrl;
    let originalUrl: string | null = sourceUrl;
    for (const v of variants) {
      const key = artworkImageKey(folder, imageId, v.name);
      const publicUrl = await uploadToR2(key, v.buffer, "image/jpeg");
      if (v.name === "large_1600") displayUrl = publicUrl;
      if (v.name === "original") originalUrl = publicUrl;
    }

    // Next sort_order = max + 1.
    const { data: maxRow } = await db
      .from("artwork_images")
      .select("sort_order")
      .eq("artwork_id", artworkId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { count } = await db
      .from("artwork_images")
      .select("id", { count: "exact", head: true })
      .eq("artwork_id", artworkId);

    const { data: inserted, error: insErr } = await db
      .from("artwork_images")
      .insert({
        id: imageId,
        artwork_id: artworkId,
        image_url: displayUrl,
        image_original: originalUrl,
        short_description: shortDescription,
        sort_order: (maxRow?.sort_order ?? -1) + 1,
        is_primary: false,
      })
      .select()
      .single();
    if (insErr) throw insErr;

    // First image, or explicitly requested: make it the single primary.
    if (makePrimaryRequested || (count ?? 0) === 0) {
      const { error: pErr } = await db
        .from("artwork_images")
        .update({ is_primary: false })
        .eq("artwork_id", artworkId)
        .neq("id", imageId);
      if (pErr) throw pErr;
      const { error: p2Err } = await db
        .from("artwork_images")
        .update({ is_primary: true })
        .eq("id", imageId);
      if (p2Err) throw p2Err;
    }

    return NextResponse.json({ image: inserted });
  } catch (err) {
    console.error("images POST error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Create failed" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Verify build/lint**

Run: `npm run lint && npx tsc --noEmit`
Expected: no errors for the new file.

- [ ] **Step 3: Manual smoke (dev server, AUTH_BYPASS)**

Run: `npm run dev`, then from another shell add an image by URL:
```bash
curl -s -X POST "http://localhost:3000/api/admin/artworks/<ARTWORK_ID>/images" \
  -F "url=https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png" \
  -F "short_description=Test view"
```
Expected: JSON with an `image` object; the artwork now has a second `artwork_images` row.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/admin/artworks/[id]/images/route.ts"
git commit -m "feat(api): list + create artwork images (url or upload)"
```

---

### Task 8: Update-description / make-primary / delete route

**Files:**
- Create: `src/app/api/admin/artworks/[id]/images/[imageId]/route.ts`

- [ ] **Step 1: Implement the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminSupabase } from "@/lib/admin-auth";

export const maxDuration = 30;

/**
 * PATCH — body may include:
 *   short_description?: string | null
 *   make_primary?: true            (sets this row primary, clears the rest)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; imageId: string }> }
) {
  const unauthed = await requireAdmin();
  if (unauthed) return unauthed;
  const { id: artworkId, imageId } = await params;
  const db = adminSupabase();

  try {
    const body = (await request.json()) as {
      short_description?: string | null;
      make_primary?: boolean;
    };

    if (body.short_description !== undefined) {
      const { error } = await db
        .from("artwork_images")
        .update({ short_description: body.short_description })
        .eq("id", imageId);
      if (error) throw error;
    }

    if (body.make_primary) {
      // Single statement keeps exactly one primary, never violating the
      // partial unique index: every row in the artwork is set to (id = target).
      const { data: rows, error: selErr } = await db
        .from("artwork_images")
        .select("id")
        .eq("artwork_id", artworkId);
      if (selErr) throw selErr;
      for (const r of rows ?? []) {
        const { error } = await db
          .from("artwork_images")
          .update({ is_primary: r.id === imageId })
          .eq("id", r.id);
        if (error) throw error;
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("image PATCH error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 500 }
    );
  }
}

/** DELETE — remove an image. If it was primary, the DB trigger promotes the next. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; imageId: string }> }
) {
  const unauthed = await requireAdmin();
  if (unauthed) return unauthed;
  const { id: artworkId, imageId } = await params;
  const db = adminSupabase();

  try {
    // Guard: don't delete the last remaining image.
    const { count } = await db
      .from("artwork_images")
      .select("id", { count: "exact", head: true })
      .eq("artwork_id", artworkId);
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "Cannot delete the only image of an artwork" },
        { status: 400 }
      );
    }
    const { error } = await db.from("artwork_images").delete().eq("id", imageId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("image DELETE error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Delete failed" },
      { status: 500 }
    );
  }
}
```

> **Note on make-primary:** clearing all rows then setting one (two passes above) momentarily leaves zero primaries, which is allowed by the partial unique index (it only forbids *two* trues). The per-row loop avoids ever setting a second true before clearing the old one.

- [ ] **Step 2: Verify build/lint**

Run: `npm run lint && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual smoke**

With the dev server running, set a different image primary and confirm `artworks.image_url` follows (trigger), then delete a non-primary image:
```bash
curl -s -X PATCH "http://localhost:3000/api/admin/artworks/<A>/images/<IMG>" \
  -H 'Content-Type: application/json' -d '{"make_primary":true}'
curl -s -X DELETE "http://localhost:3000/api/admin/artworks/<A>/images/<IMG2>"
```
Expected: `{"ok":true}`; the unique-primary query from Task 2 Step 3 still returns 0 rows.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/admin/artworks/[id]/images/[imageId]/route.ts"
git commit -m "feat(api): update description, set primary, delete artwork image"
```

---

### Task 9: Reorder route

**Files:**
- Create: `src/app/api/admin/artworks/[id]/images/order/route.ts`

- [ ] **Step 1: Implement the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminSupabase } from "@/lib/admin-auth";

export const maxDuration = 30;

/**
 * PUT — body: { order: string[] } (image ids in the desired display order).
 * Writes sort_order = index for each. Does not change is_primary; the detail
 * query still floats the primary to the hero via `is_primary DESC`.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthed = await requireAdmin();
  if (unauthed) return unauthed;
  const { id: artworkId } = await params;
  const db = adminSupabase();

  try {
    const { order } = (await request.json()) as { order: string[] };
    if (!Array.isArray(order)) {
      return NextResponse.json({ error: "order must be an array" }, { status: 400 });
    }
    for (let i = 0; i < order.length; i++) {
      const { error } = await db
        .from("artwork_images")
        .update({ sort_order: i })
        .eq("id", order[i])
        .eq("artwork_id", artworkId);
      if (error) throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("images order PUT error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Reorder failed" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Verify build/lint**

Run: `npm run lint && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/admin/artworks/[id]/images/order/route.ts"
git commit -m "feat(api): reorder artwork images"
```

---

## Phase 4 — Admin UI

### Task 10: `ImageManager` component + mount on edit page

**Files:**
- Create: `src/components/admin/ImageManager.tsx`
- Modify: `src/app/admin/(console)/artworks/[id]/page.tsx:240-259` (replace the static Image Preview block)

- [ ] **Step 1: Implement `src/components/admin/ImageManager.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { ArtworkImage } from "@/lib/types";
import { resolveImageUrl } from "@/lib/utils";
import { orderImages, reorder, withPrimary } from "@/lib/images";
import { Star, Trash2, ArrowUp, ArrowDown, GripVertical } from "lucide-react";

export default function ImageManager({ artworkId }: { artworkId: string }) {
  const [images, setImages] = useState<ArtworkImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const load = async () => {
    const resp = await fetch(`/api/admin/artworks/${artworkId}/images`);
    const json = await resp.json();
    setImages(orderImages(json.images || []));
    setLoading(false);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artworkId]);

  async function persistOrder(next: ArtworkImage[]) {
    setImages(next);
    await fetch(`/api/admin/artworks/${artworkId}/images/order`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: next.map((i) => i.id) }),
    });
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= images.length) return;
    persistOrder(reorder(images, from, to));
  }

  async function makePrimary(id: string) {
    setImages((cur) => orderImages(withPrimary(cur, id)));
    await fetch(`/api/admin/artworks/${artworkId}/images/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ make_primary: true }),
    });
    load();
  }

  async function saveDescription(id: string, value: string) {
    await fetch(`/api/admin/artworks/${artworkId}/images/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ short_description: value || null }),
    });
  }

  async function remove(id: string) {
    const resp = await fetch(`/api/admin/artworks/${artworkId}/images/${id}`, {
      method: "DELETE",
    });
    if (!resp.ok) {
      const j = await resp.json().catch(() => ({}));
      setMsg(j.error || "Delete failed");
      return;
    }
    load();
  }

  async function addByUrl() {
    if (!url) return;
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("url", url);
      const resp = await fetch(`/api/admin/artworks/${artworkId}/images`, {
        method: "POST",
        body: fd,
      });
      if (!resp.ok) throw new Error((await resp.json()).error || "Add failed");
      setUrl("");
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Add failed");
    } finally {
      setBusy(false);
    }
  }

  async function addByFile(file: File) {
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const resp = await fetch(`/api/admin/artworks/${artworkId}/images`, {
        method: "POST",
        body: fd,
      });
      if (!resp.ok) throw new Error((await resp.json()).error || "Upload failed");
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-gray-500">Loading images…</p>;

  return (
    <div className="mb-6">
      <label className="block text-sm font-bold text-gray-700 mb-2">Images</label>
      <p className="text-xs text-gray-600 mb-3">
        The starred image is the primary (hero) view. Drag the handle or use the
        arrows to reorder the rest. Each image needs a short description — it is
        used as alt text and the caption.
      </p>

      <ul className="space-y-3">
        {images.map((img, i) => {
          const src = resolveImageUrl(img);
          return (
            <li
              key={img.id}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIndex !== null && dragIndex !== i) move(dragIndex, i);
                setDragIndex(null);
              }}
              className="flex items-start gap-3 p-3 border border-gray-200 rounded bg-white"
            >
              <span className="cursor-grab pt-2 text-gray-400" aria-hidden="true">
                <GripVertical size={16} />
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {src && <img src={src} alt="" className="h-20 w-20 object-cover rounded" />}
              <div className="flex-1">
                <input
                  type="text"
                  defaultValue={img.short_description || ""}
                  onBlur={(e) => saveDescription(img.id, e.target.value)}
                  placeholder="Short description (alt + caption)"
                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => makePrimary(img.id)}
                    className={`flex items-center gap-1 text-xs px-2 py-1 rounded ${
                      img.is_primary ? "bg-yellow-100 text-yellow-800" : "bg-gray-100 text-gray-600"
                    }`}
                    aria-pressed={img.is_primary}
                  >
                    <Star size={14} aria-hidden="true" />
                    {img.is_primary ? "Primary" : "Make primary"}
                  </button>
                  <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0}
                    className="p-1 text-gray-500 disabled:opacity-30" aria-label="Move up">
                    <ArrowUp size={14} />
                  </button>
                  <button type="button" onClick={() => move(i, i + 1)} disabled={i === images.length - 1}
                    className="p-1 text-gray-500 disabled:opacity-30" aria-label="Move down">
                    <ArrowDown size={14} />
                  </button>
                  <button type="button" onClick={() => remove(img.id)}
                    className="p-1 text-red-600 ml-auto" aria-label="Delete image">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 space-y-2">
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Add image by URL"
            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded"
          />
          <button type="button" onClick={addByUrl} disabled={busy || !url}
            className="button-secondary text-sm disabled:opacity-50">
            {busy ? "Adding…" : "Add URL"}
          </button>
        </div>
        <div>
          <label htmlFor="image_file" className="block text-xs font-semibold text-gray-700 mb-1">
            Or upload a file
          </label>
          <input
            id="image_file"
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) addByFile(f);
              e.target.value = "";
            }}
            className="block text-sm"
          />
        </div>
        {msg && <p className="text-sm text-red-700">{msg}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount it on the edit page**

In `src/app/admin/(console)/artworks/[id]/page.tsx`, add the import near the top:

```tsx
import ImageManager from "@/components/admin/ImageManager";
```

Then replace the entire "Image Preview" IIFE block (the `{(() => { const imageUrl = resolveImageUrl(artwork); ... })()}` at lines ~240-259) with:

```tsx
        {/* Images */}
        <ImageManager artworkId={artworkId} />
```

(The page still imports `resolveImageUrl`; it remains used elsewhere — leave the import. If `npm run lint` flags it as unused after this change, remove `resolveImageUrl` from the import on line 9.)

- [ ] **Step 3: Verify build/lint**

Run: `npm run lint && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual verification**

`npm run dev`, open `/admin/artworks/<id>`. Confirm: images list loads, you can add by URL and by file, edit a description (blur saves), star a different image (it becomes Primary and reorders to top), drag/arrow reorder persists across reload, delete works and is blocked on the last image.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/ImageManager.tsx "src/app/admin/(console)/artworks/[id]/page.tsx"
git commit -m "feat(admin): artwork image manager (add/reorder/primary/delete)"
```

---

## Phase 5 — Front end

### Task 11: Detail page fetches images and renders the gallery

**Files:**
- Modify: `src/app/artwork/[id]/page.tsx:23-33` (select), `:179-208` (figure block)
- Create: `src/components/ArtworkGallery.tsx`

- [ ] **Step 1: Add `images` to the detail query**

In `getArtwork`'s `.select(...)` string, add the images relation:

```ts
    .select(
      `
      *,
      artist:artists(id, first_name, last_name, slug, external_url),
      categories:artwork_categories(category:categories(id, name, slug, kind)),
      images:artwork_images(*)
      `
    )
```

- [ ] **Step 2: Implement `src/components/ArtworkGallery.tsx`**

```tsx
"use client";

import { useState } from "react";
import { ArtworkImage } from "@/lib/types";
import { resolveImageUrl } from "@/lib/utils";
import { orderImages, imageAlt } from "@/lib/images";
import ImageLightbox from "@/components/ImageLightbox";

/**
 * Detail-page image gallery (Layout A): hero + thumbnail strip below.
 * Clicking the hero opens the carousel lightbox at the current image.
 * A single-image artwork renders just the hero (no strip), as before.
 */
export default function ArtworkGallery({
  images,
  title,
  medium,
}: {
  images: ArtworkImage[];
  title: string;
  medium: string | null;
}) {
  const ordered = orderImages(images);
  const [active, setActive] = useState(0);
  const current = ordered[active];

  const slides = ordered.map((img) => ({
    src: resolveImageUrl(img) || "",
    zoomSrc: img.image_original || resolveImageUrl(img) || "",
    alt: imageAlt(img, { title, medium }),
  }));

  return (
    <figure>
      <ImageLightbox
        images={slides}
        index={active}
        onIndexChange={setActive}
        inlineClassName="block max-w-full max-h-[85vh]"
      />
      {ordered.length > 1 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="More views of this artwork">
          {ordered.map((img, i) => {
            const thumb = resolveImageUrl(img);
            return (
              <li key={img.id}>
                <button
                  type="button"
                  onClick={() => setActive(i)}
                  aria-current={i === active}
                  aria-label={`View ${i + 1} of ${ordered.length}`}
                  className={`block h-16 w-16 overflow-hidden rounded border-2 ${
                    i === active ? "border-blue-600" : "border-transparent"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {thumb && <img src={thumb} alt="" className="h-full w-full object-cover" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {current?.short_description && (
        <figcaption className="text-sm text-gray-600 italic mt-3">
          {current.short_description}
        </figcaption>
      )}
    </figure>
  );
}
```

- [ ] **Step 3: Use the gallery in the page**

In `src/app/artwork/[id]/page.tsx`, replace the `<figure>…</figure>` block (lines ~182-207) inside the image column with:

```tsx
          {imageUrl ? (
            <ArtworkGallery
              images={
                artwork.images && artwork.images.length > 0
                  ? artwork.images
                  : [
                      {
                        id: "primary",
                        artwork_id: artwork.id,
                        image_url: artwork.image_url,
                        image_original: artwork.image_original,
                        is_primary: true,
                        sort_order: 0,
                        short_description: artwork.alt_text,
                        created_at: artwork.created_at,
                        updated_at: artwork.updated_at,
                      },
                    ]
              }
              title={artwork.title}
              medium={artwork.medium}
            />
          ) : (
            <figure>
              <div className="bg-white aspect-square flex items-center justify-center text-gray-400">
                No image available
              </div>
            </figure>
          )}
```

Add the import at the top:

```tsx
import ArtworkGallery from "@/components/ArtworkGallery";
```

(`ImageLightbox` is now used inside `ArtworkGallery`; remove its direct import from `page.tsx` if lint flags it as unused.)

- [ ] **Step 4: Verify build/lint**

Run: `npm run lint && npx tsc --noEmit`
Expected: no new errors. (This step depends on Task 12's new `ImageLightbox` props; if running tasks out of order, do Task 12 first.)

- [ ] **Step 5: Commit**

```bash
git add "src/app/artwork/[id]/page.tsx" src/components/ArtworkGallery.tsx
git commit -m "feat(detail): multi-image gallery with thumbnail strip"
```

---

### Task 12: Extend `ImageLightbox` into a carousel

**Files:**
- Modify: `src/components/ImageLightbox.tsx`

- [ ] **Step 1: Replace the component's props and inline trigger with a multi-image API**

Change the props interface and the controlled-index handling. Replace the `ImageLightboxProps` interface (lines 7-15) with:

```tsx
interface Slide {
  src: string;
  zoomSrc: string;
  alt: string;
}

interface ImageLightboxProps {
  /** Ordered slides. */
  images: Slide[];
  /** Currently shown index (controlled by the parent gallery). */
  index: number;
  /** Notify parent when the carousel advances. */
  onIndexChange: (i: number) => void;
  /** Classes applied to the inline hero <img>. */
  inlineClassName?: string;
}
```

Change the component signature (line 41) to:

```tsx
export default function ImageLightbox({ images, index, onIndexChange, inlineClassName }: ImageLightboxProps) {
```

After the existing `const [view, setView] = useState<View>(RESET);` line, add carousel navigation that resets zoom when the slide changes:

```tsx
  const count = images.length;
  const current = images[index] ?? images[0];

  const go = useCallback(
    (delta: number) => {
      if (count <= 1) return;
      const next = (index + delta + count) % count;
      onIndexChange(next);
      setView(RESET);
    },
    [count, index, onIndexChange]
  );
```

- [ ] **Step 2: Wire ←/→ keys into the existing key handler**

In the `useEffect` that wires `Escape` (lines 83-95), extend `onKey`:

```tsx
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
```

Add `go` to that effect's dependency array: `}, [open, close, go]);`

- [ ] **Step 3: Use `current` for the overlay image and add prev/next + counter**

In the overlay JSX, change the zoomable `<img>` `src`/`alt` to the current slide:

```tsx
      <img
        src={current.zoomSrc}
        alt={current.alt}
```

Add, just inside the overlay `<div>` (before the controls cluster), previous/next buttons and a counter when `count > 1`:

```tsx
      {count > 1 && (
        <>
          <button type="button" className={`${ctrlBtn} absolute left-4 top-1/2 -translate-y-1/2`}
            onClick={() => go(-1)} aria-label="Previous image">‹</button>
          <button type="button" className={`${ctrlBtn} absolute right-4 top-1/2 -translate-y-1/2`}
            onClick={() => go(1)} aria-label="Next image">›</button>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded bg-black/60 px-3 py-1 text-xs text-white">
            {index + 1} / {count}
          </div>
        </>
      )}
```

- [ ] **Step 4: Update the inline trigger button to show the current hero**

Replace the inline trigger `<img>` (lines ~187-188) so it renders the current slide:

```tsx
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current.src} alt={current.alt} className={inlineClassName} />
```

- [ ] **Step 5: Verify build/lint**

Run: `npm run lint && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Manual verification**

On an artwork with multiple images: hero shows the primary; clicking a thumbnail swaps the hero and caption; clicking the hero opens the lightbox at that image; ←/→ and the on-screen arrows cycle; counter reads "n / N"; zoom/pan still works per image; single-image artworks show no arrows.

- [ ] **Step 7: Commit**

```bash
git add src/components/ImageLightbox.tsx
git commit -m "feat(lightbox): multi-image carousel with arrows, keys, counter"
```

---

## Phase 6 — Bulk import

### Task 13: `import-artwork-images.ts` bulk CSV importer

**Files:**
- Create: `scripts/import-artwork-images.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Implement the script**

Create `scripts/import-artwork-images.ts`:

```ts
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
```

- [ ] **Step 2: Add the npm script**

In `package.json` `scripts`, add:

```json
    "import:artwork-images": "tsx --env-file=.env.local scripts/import-artwork-images.ts",
```

- [ ] **Step 3: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual dry verification with a tiny manifest**

Create `/tmp/manifest.csv`:
```
inventory_number,image_url,is_primary,sort_order,short_description
<REAL_INV>,https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png,false,1,Second view
NOPE.999,https://example.com/x.jpg,false,2,
```
Run: `npm run import:artwork-images -- /tmp/manifest.csv`
Expected: `Imported: 1`; `NOPE.999` listed under unmatched; the empty-description row listed under the missing-description warning. Re-running reports `Imported: 0` (checkpoint skips the done row).

- [ ] **Step 5: Commit**

```bash
git add scripts/import-artwork-images.ts package.json
git commit -m "feat(scripts): bulk artwork-image importer from manifest CSV"
```

---

### Task 14: Art Cloud `Image 2…N` column extension

**Files:**
- Modify: `scripts/import-csv.ts:200-260` (the artwork upsert region)

- [ ] **Step 1: After an artwork is upserted, import any extra image columns**

In `scripts/import-csv.ts`, locate where each artwork row is upserted and its id is known. After that, add a helper call that scans the raw CSV row for `Image 2`, `Image 3`, … columns and inserts additional `artwork_images` rows for any that the artwork doesn't already have. Add this function near the other helpers in the file:

```ts
/**
 * Art Cloud's standard export has a single `Image` column (handled as the
 * primary). If a custom export adds `Image 2`, `Image 3`, … columns, import
 * each as an additional, non-primary artwork_images row. Idempotent on
 * (artwork_id, image_original).
 */
async function importExtraImages(
  supabase: ReturnType<typeof createClient>,
  artworkId: string,
  row: Record<string, string>
) {
  const extraKeys = Object.keys(row)
    .filter((k) => /^Image\s+\d+$/i.test(k))
    .sort();
  let order = 1;
  for (const k of extraKeys) {
    const url = (row[k] || "").trim();
    if (!url) continue;
    const { data: existing } = await supabase
      .from("artwork_images")
      .select("id")
      .eq("artwork_id", artworkId)
      .eq("image_original", url)
      .maybeSingle();
    if (existing) continue;
    await supabase.from("artwork_images").insert({
      artwork_id: artworkId,
      image_url: url,
      image_original: url,
      is_primary: false,
      sort_order: order++,
      short_description: null,
    });
  }
}
```

Then call it right after the artwork upsert resolves an `artworkId` (inside the same loop that processes each row):

```ts
        await importExtraImages(supabase, artworkId, row as unknown as Record<string, string>);
```

> Note: these rows store the source URL only (no R2 variants). Run `npm run import:images` (the existing migrator) or the bulk importer afterward if you want R2-hosted variants for them. The single `Image` column continues to flow through the existing primary path and the backfill/trigger unchanged.

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no new errors. (If `artworkId`'s variable name differs in the file, match the local name used after upsert.)

- [ ] **Step 3: Commit**

```bash
git add scripts/import-csv.ts
git commit -m "feat(import): ingest Art Cloud Image 2..N columns as extra images"
```

---

## Final verification

- [ ] **Step 1: Full test suite**

Run: `npm run test`
Expected: all pure-logic tests pass, including the four new files.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: production build succeeds.

- [ ] **Step 3: End-to-end manual pass**

With `npm run dev`: pick an artwork, add two images (one URL, one upload), set descriptions, reorder, change primary; load the public `/artwork/<id>` page and confirm the strip + carousel + captions behave; confirm a single-image artwork is visually unchanged from before.

- [ ] **Step 4: Finalize**

Use the superpowers:finishing-a-development-branch skill to open the PR.

---

## Self-review (completed during authoring)

- **Spec §1 data model** → Tasks 2, 3. Denormalized cache + trigger + backfill in Task 2; types in Task 3. ✓
- **Spec §2 detail page (Layout A)** → Tasks 11, 12. Strip + hero swap + carousel + captions. ✓
- **Spec §3 admin manager** → Tasks 7-10. Add (URL/upload), reorder (drag + keyboard), primary, delete guard, description edits. ✓
- **Spec §4 accessibility** → per-image `short_description` drives alt/caption (Tasks 10, 11); artwork-level long/audio untouched on the page (Task 11 leaves that block intact). ✓
- **Spec §5 bulk import** → Tasks 13 (manifest, resumable, missing-desc + unmatched report), 14 (Art Cloud `Image N`). ✓
- **Type consistency:** `ArtworkImage`, `generateVariants`, `IMAGE_VARIANTS`, `artworkImageKey`, `parseManifestRow`/`ManifestRow`, `orderImages`/`imageAlt`/`reorder`/`withPrimary` referenced with identical signatures across tasks. ✓
- **Single-primary invariant** preserved across create/make-primary/delete/bulk via the partial unique index + per-row update pattern + DELETE auto-promotion trigger. ✓
