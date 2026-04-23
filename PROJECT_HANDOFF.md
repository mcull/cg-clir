# Project Handoff — Creative Growth CLIR Digital Gallery

**Last updated:** 2026-04-23 (initial handoff: 2026-04-02)
**Repo:** `cg_clir/` (git initialized, not yet pushed to remote)
**Design doc:** `DESIGN.md` — comprehensive architecture, data model, and project plan

> This is a living document. The "Updates Log" section captures changes made since the original 2026-04-02 handoff. Sections below have been edited inline where state has changed; check the log for a summary of what's new.

---

## Updates Log

### 2026-04-09 — Description review SPA, CG header integration, artist bio scraper

**M1 (image migration) and M2 (AI descriptions) appear to have completed** between 2026-04-02 and 2026-04-09 — inferred from:
- Commit `19aae60` ("Add image migration + AI description pipeline, configure Next.js images")
- Commit `f3d498a` ("Fix image URLs: add R2 public domain, resolve relative paths") — adds `resolveImageUrl()` utility, implies R2 is now the canonical image host
- Commit `3ddd6c9` adds a description-review SPA, which would have nothing to review unless descriptions had been generated

> ⚠ Verify exact row counts in `artworks.image_url` (should point to R2), `artworks.alt_text`, and `artworks.ai_description` before assuming 100% coverage. The original handoff reports 1,803 artworks pending image migration; that number is almost certainly stale but should be re-checked.

**New: Description Review SPA** (`public/review.html`, 629 lines, vanilla JS — no React)
- Single-page tool for gallery managers to triage AI-generated alt text + descriptions
- Approve / edit / skip flow with keyboard shortcuts (`a` / `e` / `s` / arrows)
- Search, filter (unreviewed / reviewed / all), inline editing with character count
- localStorage persistence for current position, filter, and search (commit `3ff4521`)
- Served as a static asset by Next.js — accessible at `/review.html`

**New: Real Creative Growth header** (commit `7a160b4`)
- `src/components/cg-header.html` — raw HTML extracted from creativegrowth.org via Playwright
- `public/cg-header.css` — scoped styles for the CG nav (dropdowns, hover states)
- `next.config.mjs` — webpack rule to import `.html` files as raw strings; `src/html.d.ts` for TS types
- `src/components/Header.tsx` — rewritten to inject the real CG header above a CLIR sub-nav, so the gallery feels seamlessly part of creativegrowth.org

**New: Artist bio scraper** (`scripts/scrape-bios.ts`, commit `cc2034a`)
- Playwright crawler over 201 artist pages from the creativegrowth.org sitemap
- Matches website artists to CLIR DB by slug → name → fuzzy match
- Updated 36 CLIR artist rows with biographies; logs all 247+ artists from both sources to `scripts/artist-bios-log.csv` for Creative Growth's review
- CSV updated 2026-04-09 (commit `f4e64d0`) to include admin links, artwork counts, and sort by prolific artists first

**Page fixes** — `collection/page.tsx` and `search/page.tsx` had Supabase type errors fixed via wildcard select (commits `9d08fb4`, `5a2ac8f`); both pages presumably render real data now (verify by running `npm run dev`).

**Not yet recorded in DESIGN.md or original handoff:** the bio scraper, review SPA, and header injection are all post-design additions. Worth eventually folding into DESIGN.md if any of these patterns will inform future work.

---

## What This Project Is

Creative Growth Gallery has a CLIR grant to digitize 2,000+ artworks and present them in an accessible online gallery. We're replacing their current Art Cloud platform (which fails WCAG standards) with a purpose-built system: Next.js frontend, Supabase backend, Cloudflare R2 for image hosting, Claude Vision for accessibility descriptions, PostHog for analytics.

---

## Current State

### What's Done (M0 + M1 partial)

**Infrastructure — fully scaffolded:**
- Next.js 14 project with TypeScript, Tailwind, ESLint
- All route stubs created (public gallery + admin console)
- Supabase client libraries (`src/lib/supabase/client.ts`, `server.ts`, `admin.ts`)
- Cloudflare R2 helpers (`src/lib/r2.ts`) — upload, signed download URLs, presigned upload URLs
- PostHog integration (`src/lib/posthog.ts`) — privacy-first config, memory-only persistence
- Type definitions (`src/lib/types.ts`) and utilities (`src/lib/utils.ts`)
- UI component stubs: ArtworkCard, ArtworkGrid, CategoryTabs, DownloadButton, Footer, Header, Pagination, PostHogProvider, SearchBar, SkipLink

**Database — live and populated:**

| Table | Rows | Status |
|-------|------|--------|
| `artists` | 89 | Complete — all artists from CSV |
| `artworks` | 2,112 | Complete — all artworks from CSV (77 rows skipped, no title) |
| `categories` | 8 | Complete — AI-suggested, flagged for review |
| `artwork_categories` | 4,487 | Complete — artworks mapped to categories |
| `download_events` | 0 | Empty — table ready, populated at runtime |

Supabase project: `qvovplzzvfqkzbmvplbu`
Schema migration: `supabase/migrations/001_initial.sql` (run manually via SQL Editor)

**Categories created (all `ai_suggested = true`):**
- Drawings: 1,406 artworks
- Paintings: 773
- Mixed Media: 72
- Sculpture & 3D: 69
- Fiber Art & Textiles: 48
- Prints & Multiples: 6
- CLIR Collection: 2,112 (all works)
- Photography & Digital: 0 (no matches — consider removing)

**Image migration — appears complete (verify counts):**
- R2 bucket `cg-clir` is live and writable
- Variants per artwork: original, large_1600, medium_800, thumb_400
- `R2_PUBLIC_URL` is now configured; `resolveImageUrl()` utility resolves R2 paths with Art Cloud fallback
- 2026-04-02 status was "2 artworks migrated, 1,803 pending" — that is now stale; re-query before relying on a number

**AI descriptions — appears generated for catalog (verify counts):**
- Pipeline added in commit `19aae60`; review SPA at `/review.html` exists, implying descriptions were populated
- Original status said 0 artworks had `ai_description` or `alt_text` — verify current coverage

### What's NOT Done

- ~~**M1 (remaining):** Image migration to R2~~ — appears complete; verify counts
- ~~**M2:** AI description generation via Claude Vision~~ — appears complete; descriptions are now in human-review phase via `/review.html`
- **M3:** Public gallery frontend — partially done. Collection and search pages now render (post type-fix); artwork detail, artist index/detail, about page need verification of completeness
- **M4:** Admin console — route stubs exist (per handoff); CRUD UI status unknown — verify by visiting `/admin` with `NEXT_PUBLIC_AUTH_BYPASS=true`
- **M5:** QA, accessibility audit, performance tuning, launch
- **Post-design adds (not in original plan):** integrate bio scraper output into artist detail pages; productionize the description review workflow (currently a static SPA — could move into `/admin`); finalize CG header styling for mobile

---

## Known Issues & Bugs

### 1. Image migration stalls with SSL errors
The `scripts/migrate-images.ts` script encounters intermittent SSL errors downloading from `cdn.artcld.com`:
```
SSL routines:ssl3_read_bytes:ssl/tls alert bad record mac
```
Retry logic (3 attempts with exponential backoff) is implemented but some images still fail. May need to reduce concurrency from 5 to 2-3, or run from a different network environment (e.g., locally instead of in the sandbox).

### 2. Sandbox cannot make direct Postgres connections
The Cowork sandbox blocks direct TCP connections to Supabase Postgres (both pooler ports 5432 and 6543 connect at TCP level but Supavisor returns "Tenant or user not found"). The REST API works fine. **Implication:** DDL migrations must be run manually via the Supabase SQL Editor, or from a local machine / CI environment. See `TECH_DEBT.md` (TD-001).

### 3. Supabase REST API 1000-row default limit
All scripts that query Supabase must paginate. The `import-csv.ts` script handles this, and `seed-categories.ts` and `migrate-images.ts` have been patched to paginate. Double-check any new queries.

### 4. Artwork_categories seed script needs re-run verification
The seed script reported 4,487 assignments and the table confirms this. However, Photography & Digital has 0 matches — may want to either remove it or broaden its match criteria.

---

## Environment Setup

### Prerequisites
- Node 18+
- npm

### Install & Run
```bash
cd cg_clir
npm install
cp .env.local.example .env.local  # (or use existing .env.local)
npm run dev                        # starts Next.js dev server
```

### Credentials (in `.env.local`)
```
NEXT_PUBLIC_SUPABASE_URL          ✅ Set
NEXT_PUBLIC_SUPABASE_ANON_KEY     ✅ Set
SUPABASE_SERVICE_ROLE_KEY         ✅ Set
SUPABASE_DB_PASSWORD              ✅ Set (for direct PG connections from local machine)
R2_ACCOUNT_ID                     ✅ Set
R2_ACCESS_KEY_ID                  ✅ Set
R2_SECRET_ACCESS_KEY              ✅ Set
R2_BUCKET_NAME                    ✅ Set (cg-clir)
R2_PUBLIC_URL                     ❌ Not set — using R2 default URL for now
ANTHROPIC_API_KEY                 ✅ Set
NEXT_PUBLIC_POSTHOG_KEY           ✅ Set
NEXT_PUBLIC_POSTHOG_HOST          ✅ Set
GOOGLE_CLIENT_ID                  ❌ Not set — waiting on Creative Growth
GOOGLE_CLIENT_SECRET              ❌ Not set — waiting on Creative Growth
NEXT_PUBLIC_AUTH_BYPASS            ✅ Set to "true" (dev mode, no auth)
```

### npm Scripts
```bash
npm run dev                    # Next.js dev server
npm run build                  # Production build
npm run import:csv             # Parse Art Cloud CSV → Supabase
npm run seed:categories        # AI-suggested category assignments
npm run import:images          # Migrate images Art Cloud → R2
npm run generate:descriptions  # Claude Vision alt text generation
npm run db:migrate             # Outputs migration SQL (run in SQL Editor)
```

---

## File Structure Overview

```
cg_clir/
├── DESIGN.md                      # Full architecture + project plan
├── TECH_DEBT.md                   # Known tech debt items
├── PROJECT_HANDOFF.md             # This file
├── supabase/migrations/           # SQL schema
│   └── 001_initial.sql            # Tables, RLS, indexes, triggers, FTS
├── scripts/
│   ├── import-csv.ts              # CSV → Supabase (DONE)
│   ├── seed-categories.ts         # Category creation + assignment (DONE)
│   ├── migrate-images.ts          # Art Cloud → R2 (RAN; verify completeness)
│   ├── generate-descriptions.ts   # Claude Vision descriptions (RAN; verify completeness)
│   ├── migrate-and-describe.ts    # Combined migration + description pipeline
│   ├── scrape-bios.ts             # NEW (2026-04-03): Playwright scraper for artist bios
│   ├── artist-bios-log.csv        # NEW: review log of scraped bios for CG to vet
│   └── run-migration.ts           # DDL helper (limited by sandbox)
├── public/
│   ├── review.html                # NEW (2026-04-09): description review SPA (vanilla JS)
│   └── cg-header.css              # NEW (2026-04-03): scoped CSS for injected CG header
├── src/
│   ├── html.d.ts                  # NEW: TS declaration for raw .html imports
│   ├── lib/
│   │   ├── supabase/              # Client, server, admin Supabase clients
│   │   ├── r2.ts                  # R2 upload/download/presign helpers
│   │   ├── posthog.ts             # Analytics client
│   │   ├── types.ts               # TypeScript interfaces
│   │   └── utils.ts               # Slugify, formatting, parsing, resolveImageUrl()
│   ├── components/                # React components
│   │   ├── ArtworkCard.tsx
│   │   ├── ArtworkGrid.tsx
│   │   ├── CategoryTabs.tsx
│   │   ├── DownloadButton.tsx
│   │   ├── Header.tsx             # Now injects real CG header + CLIR sub-nav
│   │   ├── cg-header.html         # NEW: raw CG header markup, imported as string
│   │   ├── Footer.tsx
│   │   ├── Pagination.tsx
│   │   ├── PostHogProvider.tsx
│   │   ├── SearchBar.tsx
│   │   └── SkipLink.tsx
│   └── app/
│       ├── page.tsx               # Landing page
│       ├── collection/page.tsx    # Grid view (renders real data post-fix)
│       ├── artwork/[id]/page.tsx  # Detail page
│       ├── artists/               # Index + detail
│       ├── search/page.tsx        # Search (renders real data post-fix)
│       ├── about/page.tsx         # About
│       ├── admin/                 # Admin console (behind AUTH_BYPASS)
│       └── api/download/route.ts  # Download tracking endpoint
└── inventory_2026-04-02.csv       # Source data (gitignored)
```

---

## Recommended Next Steps (in order)

1. ~~**Complete M1 — Image migration.**~~ Appears done (commit `f3d498a`). Verify by querying Supabase for any remaining `cdn.artcld.com` URLs.

2. ~~**Run M2 — AI descriptions.**~~ Appears done. Verify by counting `artworks` rows where `alt_text IS NOT NULL` and `ai_description IS NOT NULL`.

3. ~~**Set up R2 public URL.**~~ Done — `R2_PUBLIC_URL` is wired up via `resolveImageUrl()`.

4. **Finish M3 — Public gallery pages.** Stubs/initial implementations exist. Audit each route against DESIGN.md §7:
   - `/collection` — type-fixed; verify category tabs + filters work
   - `/artwork/[id]` — detail page; verify download button + metadata
   - `/artists` and `/artists/[slug]` — verify scraped bios are surfaced
   - `/search` — type-fixed; verify FTS results
   - Run a WCAG audit (axe DevTools) on each

5. **Build M4 — Admin console.** Protected by `NEXT_PUBLIC_AUTH_BYPASS=true` for now. When Google OAuth creds arrive, flip to Supabase Auth + Google SSO. Consider folding the description review SPA into `/admin/review` so reviewers don't need a separate URL.

6. **Push to GitHub and deploy to Vercel.** Repo is still local-only.

---

## Questions Pending from Creative Growth

1. Custom domain for the gallery
2. Confirm admin SSO domain (`@creativegrowth.org`)
3. Image licensing / Creative Commons notice
4. Featured/highlighted works for homepage
5. Existing artist bios to import
6. Whether to import previously generated descriptions from `creativegrowth/ai_alt_text_output.csv`
