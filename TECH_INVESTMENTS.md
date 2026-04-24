# Future Tech Investments

Things worth adding to our tooling and infrastructure that we haven't prioritized yet. Distinct from `TECH_DEBT.md` (which catalogs shortcuts already taken) — this file is for "things we'd benefit from building" that someone has flagged as potentially valuable.

---

## TI-001: Playwright test infrastructure for the public site

**Priority:** Medium
**Added:** 2026-04-23

The project already depends on `playwright` (currently used by `scripts/scrape-bios.ts` for headless scraping), but has no test suite. UI changes are currently verified by ad-hoc curl smoke tests during PR review — useful for one-off checks, but they don't run on every change and don't catch regressions when someone refactors a conditional or restructures a layout.

**What we'd build:**
- Playwright test config + an npm test script
- A small fixture / seed-data strategy. Simplest start: hit real Supabase with read-only assertions against known stable SKUs (e.g., `RB 25` for human-described, `JS 5` for AI-described). If staging diverges from prod we can revisit.
- Initial coverage suggestions:
  - Artwork detail page: `<figure>` + visible `<figcaption>` present, `<img alt>` is the short form
  - Artwork detail page: "Visual description" metadata renders only when `description_origin === 'human'`
  - Artwork detail page: Tags and Inventory Number do not appear in metadata
  - Collection grid: image alts are ≤150 chars (no paragraph dumps)
  - Search page returns results for a known query
- Optionally: wire into CI so PRs surface test runs automatically

**Why it'd pay off:** as the gallery grows more conditional UI (storytelling section, admin workflows, additional metadata fields), the cost of silent regressions rises. The figcaption + conditional metadata pattern landed in PR for `feat/artwork-detail-captions` is exactly the kind of thing that breaks silently if the conditional gets restructured.

**Workaround for now:** ad-hoc smoke tests during PRs (curl + grep, dev-server-in-browser).

---

## TI-002: UNIQUE constraint on `artworks.sku`

**Priority:** Medium
**Added:** 2026-04-23

`artworks.sku` was added with an index but not a UNIQUE constraint, intentionally — the source Art Cloud CSV has 2 legitimate duplicates (`DMi 662`, `JS 27`) representing distinct artworks that share an artist code. After running the archive import, our idempotency story for new-row inserts depends on the in-memory SKU map plus the progress checkpoint. If both are out of sync (e.g., a corrupted checkpoint after a crash), Branch B could silently insert duplicates.

**What we'd build:** decide on a uniqueness story for SKU. Options: (a) keep as-is and harden the script's idempotency story (e.g., re-fetch SKU map periodically during long runs), (b) add a partial UNIQUE excluding the 2 known duplicates, (c) accept the duplicates and add UNIQUE on `(sku, inventory_number)` instead.

**Why it'd pay off:** future imports won't have to depend on the right combination of caches + checkpoint files for correctness. DB enforces what it should enforce.

---

## TI-003: Original-variant image MIME type is hard-coded JPEG

**Priority:** Low
**Added:** 2026-04-23

Both `scripts/import-archive.ts` and `scripts/migrate-and-describe.ts` upload the `original` image variant with `ContentType: image/jpeg` regardless of the source format. Sharp re-encodes the resized variants to JPEG, so those are correct, but if the source `Link 1` URL is a PNG or WebP, the original variant is served from R2 with the wrong MIME type.

**What we'd build:** sniff the source bytes' magic numbers (or trust the URL extension) before setting the upload `ContentType`. ~5 lines per script.

**Why it'd pay off:** Some images in our R2 bucket may already be misconfigured. Right now the public site only links to the resized `large_1600.jpg` variant on detail pages, so this is invisible — but if anyone ever links to the `original` variant directly, they'd get a JPEG-typed PNG.
