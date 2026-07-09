# Bulk image import (manifest CSV)

Add extra images to existing artworks in bulk from a CSV manifest. Each row is
**one image**; the artwork it attaches to is matched by inventory number. The
script fetches each `image_url`, generates the resized variants, uploads them to
R2, and inserts an `artwork_images` row.

Use this for backfilling additional views (front/back of ephemera, multiple
angles of a sculpture) onto artworks that already exist in the archive. To add
images one at a time, use the image manager on the artwork's admin edit page
instead.

## Running it

```bash
npm run import:artwork-images -- path/to/manifest.csv
```

The run is **resumable**: progress is checkpointed to
`scripts/.artwork-images-progress.json` (keyed on `inventory_number` +
`image_url`), so re-running skips images already imported. Delete that file to
force a full re-import.

## Columns

The first row must be a header with these exact column names (order doesn't
matter, extra columns are ignored):

| Column | Required | Notes |
|---|---|---|
| `inventory_number` | **yes** | Must match an existing artwork's inventory number exactly. Rows that don't match are skipped and listed in the report. |
| `image_url` | **yes** | A publicly fetchable URL to the full-resolution image. The server downloads it, so it must be reachable without authentication (some hosts block requests without a browser user-agent — see Tips). |
| `is_primary` | no | `true` / `yes` / `y` / `1` marks this image as the artwork's primary (hero) view. Anything else (or blank) means non-primary. Setting a new primary automatically demotes the old one. |
| `sort_order` | no | Integer controlling the order of the thumbnail strip. Lower numbers first. Defaults to `0`. The primary always shows as the hero regardless of sort order. |
| `short_description` | no | Per-image short description — used as the image's `alt` text **and** its caption. Strongly recommended for accessibility; images imported without one are flagged in the report. |

## Example

```csv
inventory_number,image_url,is_primary,sort_order,short_description
2021.045,https://example.org/photos/2021-045-front.jpg,true,0,"Front of the postcard, handwritten note in blue ink"
2021.045,https://example.org/photos/2021-045-back.jpg,false,1,"Back of the postcard, printed postmark dated 1974"
2019.112,https://example.org/photos/2019-112-angle1.jpg,false,1,Ceramic figure viewed from the front
2019.112,https://example.org/photos/2019-112-angle2.jpg,false,2,The same figure viewed from the left side
```

Notes on the example:
- Two rows share `2021.045` — that artwork gets two images, with the front set
  as primary.
- The first two descriptions contain a comma, so the whole field is wrapped in
  double quotes. Fields without commas (the `2019.112` rows) don't need quotes.

## Primary rules

- Each artwork has **exactly one** primary image (enforced by the database).
- If you mark more than one row for the same artwork as `is_primary`, the last
  one processed wins.
- If you don't mark any row as primary for an artwork that already has images,
  its existing primary is left unchanged and the new images are added as
  non-primary.

## The report

At the end the script prints:

- **Imported** — how many images were added.
- **Parse errors** — rows missing `inventory_number` or `image_url`.
- **Unmatched inventory numbers** — rows whose `inventory_number` matched no
  artwork (nothing imported for those).
- **Imported without a short_description** — accessibility gaps to fill in later
  via the admin image manager.

## Tips

- **Hosting the images.** Google Drive / Dropbox "share" links often aren't
  direct image URLs — use a direct link that returns the image bytes. If a host
  rejects the server's request (e.g. some CDNs require a browser user-agent),
  re-host the file somewhere that serves it directly.
- **Already-hosted R2/Art Cloud images** work as-is since they're public URLs.
- **Art Cloud multi-image exports.** If your Art Cloud export includes numbered
  `Image 2`, `Image 3`, … columns, the main catalog importer (`npm run
  import:csv`) picks those up automatically as additional images — no manifest
  needed. The manifest is for images that aren't in the Art Cloud export.
