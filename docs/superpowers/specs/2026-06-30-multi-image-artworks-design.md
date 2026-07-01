# Multi-image artworks — design

**Date:** 2026-06-30
**Status:** Approved (brainstorm), pending implementation plan

## Problem

Today each artwork has exactly one image, stored denormalized on the
`artworks` row (`image_url`, `image_original`). Much of the collection needs
multiple views: ephemera with a front and back, sculptures photographed from
several angles. We need a one-to-many relationship between artworks and images
with a single designated primary, admin tooling to manage and reorder the
images, a front-end gallery to browse them, accessibility metadata at the right
granularity, and a way to bulk-add images by CSV.

## Goals

- One artwork → many images, with exactly one primary.
- Drag-and-drop (and keyboard-accessible) reordering of the non-primary images
  in the admin.
- Front-end: browse all of a piece's images via a thumbnail strip + a
  full-screen zoom/carousel lightbox, modeled after The Met's online archive.
- Accessibility: every image carries a short description used for both `alt`
  and caption; the long-form visual description and audio description stay at
  the artwork level (tied to the primary view).
- Admin: add images by file upload or by URL.
- Bulk import additional images by CSV manifest.

## Non-goals

- No per-image long description or per-image audio (those stay artwork-level).
- No file-upload machinery for bulk import — bulk sources are URLs (see §5).
- No new front-end page; we extend the existing artwork detail page.

## Decisions locked during brainstorming

- **Detail-page layout: "A" — thumbnail strip below the hero image** (Met
  style). Hero keeps today's width. When an artwork has a single image (most of
  the collection) no strip renders and the page looks exactly as it does now.
- **Bulk import is URL-based.** Staff sources are "links to hosted images" and
  "already in Art Cloud" — both reduce to fetchable URLs. No ZIP/file upload
  flow for bulk.
- **Keep a denormalized primary-image cache on `artworks`** rather than joining
  everywhere (see §1).
- **Reordering offers both drag-and-drop and keyboard up/down buttons** — native
  HTML5 DnD is not keyboard-operable, and accessibility is a core goal.

---

## 1. Data model

### New table: `artwork_images`

| column | type | notes |
|---|---|---|
| `id` | uuid PK, `gen_random_uuid()` | |
| `artwork_id` | uuid → `artworks(id)` ON DELETE CASCADE | |
| `image_url` | text | R2 path or absolute URL — same semantics as today's `artworks.image_url` |
| `image_original` | text | highest-res / source URL — same as today's `artworks.image_original` |
| `is_primary` | bool NOT NULL DEFAULT false | exactly one true per artwork |
| `sort_order` | int NOT NULL DEFAULT 0 | order of the non-primary images |
| `short_description` | text | per-image; drives `alt` + caption |
| `created_at` | timestamptz DEFAULT now() | |
| `updated_at` | timestamptz DEFAULT now() | `update_updated_at` trigger |

Indexes / constraints:

- `CREATE UNIQUE INDEX ON artwork_images (artwork_id) WHERE is_primary;`
  — enforces a single primary per artwork at the DB level.
- `CREATE INDEX ON artwork_images (artwork_id);`
- RLS mirroring the existing tables: public can `SELECT` images of artworks
  that are `on_website`; admins (`@creativegrowth.org` JWT) can do everything.
  Service-role writes (admin API, scripts) bypass RLS as today.

### What stays on `artworks`

- `alt_text_long`, `audio_url`, `audio_origin`, `description_origin` — the
  long-form and audio descriptions remain artwork-level, conceptually attached
  to the primary view.
- `image_url`, `image_original`, `alt_text` — **retained as a denormalized
  mirror of the primary image.**

### Denormalized primary cache + sync trigger

Every grid surface (collection, artist pages, "more by this artist") and the
generated **FTS `tsvector`** already read `artworks.image_url` and
`artworks.alt_text`. To avoid rewriting all of those and to keep grids fast
(no join across the whole collection), we keep those three columns on
`artworks` as a mirror of the current primary `artwork_images` row.

A trigger on `artwork_images` (AFTER INSERT/UPDATE/DELETE) sets, on the parent
artwork:

- `image_url`      ← primary image's `image_url`
- `image_original` ← primary image's `image_original`
- `alt_text`       ← primary image's `short_description`

If the primary image is deleted, the trigger promotes the lowest `sort_order`
remaining image to primary (or nulls the cache if none remain). The FTS column
is `GENERATED ALWAYS` from `alt_text` (among others), so it updates
automatically.

The admin write paths should treat `artworks.image_url/image_original/alt_text`
as read-only/derived going forward; all image edits go through
`artwork_images`.

### Migration (forward)

For each existing artwork with a non-null `image_url`, insert one
`artwork_images` row: `is_primary = true`, `sort_order = 0`,
`image_url`/`image_original` copied from the artwork, `short_description =`
the artwork's current `alt_text`. Idempotent (skip artworks that already have
images). Reversible by dropping the table and the trigger; the cache columns on
`artworks` are untouched by rollback.

---

## 2. Front-end — artwork detail page (Layout A)

File: `src/app/artwork/[id]/page.tsx`, `src/components/ImageLightbox.tsx`,
plus a new gallery client component.

- `getArtwork` additionally selects
  `images:artwork_images(*)` ordered by `is_primary DESC, sort_order ASC`.
- **Hero** = primary image, rendered as today. **Thumbnail strip** appears
  below the hero only when `images.length > 1`. Clicking a thumbnail swaps the
  hero inline (no lightbox) and updates the caption.
- **Caption / alt:** the visible `<figcaption>` and the `alt` come from the
  currently shown image's `short_description` (falling back to title+medium via
  `getAltText` when absent). Same double-announce avoidance as today (figure
  semantics carry the description; `alt=""` when a caption is present).
- **Lightbox → carousel:** extend `ImageLightbox` to accept an ordered list of
  images and a starting index. Adds: left/right arrow buttons, ←/→ keyboard
  navigation, touch swipe, an "n / N" counter, and per-image zoom/pan (current
  behavior preserved). Remains a focus-trapped `role="dialog"`.
- **Artwork-level description block** (long visual description + audio player)
  renders once under the metadata, unchanged — it is not per-image.
- Single-image artworks: no strip, lightbox still opens on the hero with a
  one-item carousel (arrows hidden).

`ArtworkCard` / grids are unchanged — they read the denormalized primary
`image_url`/`alt_text`.

---

## 3. Admin — image manager on the artwork edit page

File: `src/app/admin/(console)/artworks/[id]/page.tsx` + new API routes.

Replace the static "Image Preview" block with a **managed image list**:

- Each row: thumbnail, inline **short-description** text field, a **Primary**
  toggle (star), reorder controls, and delete.
- **Reordering:** drag-and-drop (native HTML5 DnD, no new dependency) **and**
  keyboard-accessible **up / down** buttons. Persists `sort_order`.
- **Set primary:** clicking the star sets `is_primary` on that row (and clears
  the others); the sync trigger updates the artwork's cached primary fields.
- **Add image — two ways, one server pipeline:**
  - *Upload a file:* POST to a new admin API route that runs `sharp` to
    generate the four variants (`original`, `large_1600`, `medium_800`,
    `thumb_400`) and uploads them to R2 under a per-image key, then inserts an
    `artwork_images` row. (Mirrors the existing audio-upload route pattern;
    very large originals may instead use a presigned direct-to-R2 upload — to
    be settled in the plan.)
  - *Add by URL:* POST a URL; server fetches, runs the same variant pipeline,
    inserts the row.
- **Delete guard:** cannot delete the only/primary image without first
  promoting another; deleting a primary auto-promotes via the trigger.
- Short-description edits save through the admin artworks API (service-role),
  consistent with the current edit form.

R2 key convention for multi-image: `artworks/{inventory_number}/{image_id}/{variant}.jpg`
(extends today's `artworks/{inventory_number}/{variant}.jpg`; the migrated
primary may keep its existing keys).

---

## 4. Accessibility summary

- **Per image:** `short_description` → `alt` + `<figcaption>` (front end) and
  the inline field (admin). Bulk/Art-Cloud images without one are flagged, not
  blocked (see §5).
- **Per artwork (primary view):** `alt_text_long` (long visual description) and
  `audio_url`/`audio_origin` — unchanged location and UI.
- Carousel: labeled dialog, focus trap, keyboard arrows; thumbnail strip is a
  keyboard-navigable list. Reorder controls are keyboard-operable.

---

## 5. Bulk import — manifest CSV

New script (`scripts/import-artwork-images.ts`, wired as an npm script) and an
admin import screen.

- **Manifest columns:** `inventory_number, image_url, is_primary, sort_order,
  short_description`.
- For each row: match the artwork by `inventory_number`; fetch `image_url`;
  generate the four variants (reusing the `migrate-images.ts` sharp/R2 logic);
  insert an `artwork_images` row with the given primary/order/description.
- **Resumable + idempotent** via a progress checkpoint file, like the existing
  migration scripts. Re-running skips already-imported (artwork, image) pairs.
- **Report** at the end (mirrors `catalog-triage-report.ts`): rows whose
  `inventory_number` didn't match any artwork, and imported images **missing a
  `short_description`** so accessibility gaps are surfaced rather than silently
  shipped.
- **Art Cloud extension:** `scripts/import-csv.ts` gains optional detection of
  extra `Image 2 … Image N` columns; when present, each maps to an additional
  `artwork_images` row through the same pipeline. Contingent on Art Cloud being
  able to export those columns — verified before we depend on it. The current
  export has only a single `Image` column, so until then the manifest path is
  how "already in Art Cloud" views get in (staff paste the URLs into a
  manifest).

---

## Surfaces changed (summary)

- **DB:** new migration — `artwork_images` table, partial unique index, RLS,
  sync trigger, data backfill.
- **Types:** `src/lib/types.ts` — `ArtworkImage` interface; `Artwork.images?`.
- **Front end:** `artwork/[id]/page.tsx`, `ImageLightbox.tsx` (+ new gallery
  component). Grids unchanged.
- **Admin UI:** `admin/(console)/artworks/[id]/page.tsx` image manager.
- **Admin API:** new image-create (upload + URL), reorder, set-primary,
  delete, update-description routes under `api/admin/artworks/[id]/images`.
- **Scripts:** `import-artwork-images.ts` (+ npm script), `import-csv.ts`
  extension, backfill migration.

## Open implementation details (defer to plan)

- File upload through API vs. presigned direct-to-R2 for large originals.
- Exact reorder/primary API shape (single batch PATCH vs. per-row).
- Whether the migration backfill runs as SQL or a TS script (consistent with
  existing `scripts/run-migration.ts` conventions).
