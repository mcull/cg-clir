# Project Handoff — Creative Growth CLIR Digital Gallery

**Date:** 2026-04-02
**Repo:** `cg_clir/` (git initialized, not yet pushed to remote)
**Design doc:** `DESIGN.md` — comprehensive architecture, data model, and project plan

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

**Image migration — barely started:**
- R2 bucket `cg-clir` is live and writable
- 2 artworks fully migrated (4 variants each: original, large_1600, medium_800, thumb_400)
- 1,803 artworks have images that need migrating
- The remaining `image_url` values still point to `cdn.artcld.com`

**AI descriptions — not started:**
- Script is written (`scripts/generate-descriptions.ts`) but has not been run
- 0 artworks have `ai_description` or `alt_text` populated

### What's NOT Done

- **M1 (remaining):** Image migration to R2 — needs to complete for all 1,803 images
- **M2:** AI description generation via Claude Vision — script ready, needs to run
- **M3:** Public gallery frontend — route stubs exist, pages need real implementation
- **M4:** Admin console — route stubs exist, needs full CRUD UI
- **M5:** QA, accessibility audit, performance tuning, launch

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
│   ├── import-csv.ts              # CSV → Supabase (DONE, works)
│   ├── seed-categories.ts         # Category creation + assignment (DONE, works)
│   ├── migrate-images.ts          # Art Cloud → R2 (HAS SSL ISSUES)
│   ├── generate-descriptions.ts   # Claude Vision descriptions (NOT YET RUN)
│   └── run-migration.ts           # DDL helper (limited by sandbox)
├── src/
│   ├── lib/
│   │   ├── supabase/              # Client, server, admin Supabase clients
│   │   ├── r2.ts                  # R2 upload/download/presign helpers
│   │   ├── posthog.ts             # Analytics client
│   │   ├── types.ts               # TypeScript interfaces
│   │   └── utils.ts               # Slugify, formatting, parsing
│   ├── components/                # React components (stubs)
│   │   ├── ArtworkCard.tsx
│   │   ├── ArtworkGrid.tsx
│   │   ├── CategoryTabs.tsx
│   │   ├── DownloadButton.tsx
│   │   ├── Header.tsx / Footer.tsx
│   │   ├── Pagination.tsx
│   │   ├── SearchBar.tsx
│   │   └── SkipLink.tsx
│   └── app/
│       ├── page.tsx               # Landing page (stub)
│       ├── collection/page.tsx    # Grid view (stub)
│       ├── artwork/[id]/page.tsx  # Detail page (stub)
│       ├── artists/               # Index + detail (stubs)
│       ├── search/page.tsx        # Search (stub)
│       ├── about/page.tsx         # About (stub)
│       ├── admin/                 # Admin console (stubs, behind AUTH_BYPASS)
│       └── api/download/route.ts  # Download tracking endpoint
└── inventory_2026-04-02.csv       # Source data (gitignored)
```

---

## Recommended Next Steps (in order)

1. **Complete M1 — Image migration.** Run `npm run import:images` from a local machine (not the sandbox) to avoid SSL issues. The script checkpoints progress and can resume. Once done, all `artworks.image_url` values will point to R2 instead of `cdn.artcld.com`.

2. **Run M2 — AI descriptions.** Run `npm run generate:descriptions` (also best from local). This calls Claude Vision for each artwork, generating `alt_text` (≤125 chars) and `ai_description` (2-4 sentences). Estimated cost: ~$15-25 for all 2,112 images. The script checkpoints and resumes.

3. **Set up R2 public URL.** Either enable the R2 bucket's public access (generates a `*.r2.dev` URL) or configure a custom domain. Put the URL in `R2_PUBLIC_URL` env var. Update `artworks.image_url` values to use it.

4. **Build M3 — Public gallery pages.** The route stubs and components exist. Key pages to implement:
   - `/collection` — artwork grid with category tabs and filters
   - `/artwork/[id]` — detail page with image, metadata, download button
   - `/artists` — alphabetical artist index
   - `/artists/[slug]` — artist detail with their works
   - `/search` — full-text search (Supabase FTS index already exists)
   - Refer to DESIGN.md §7 for full specs and WCAG requirements

5. **Build M4 — Admin console.** Protected by `NEXT_PUBLIC_AUTH_BYPASS=true` for now. When Google OAuth creds arrive, flip to Supabase Auth + Google SSO.

6. **Push to GitHub and deploy to Vercel.**

---

## Questions Pending from Creative Growth

1. Custom domain for the gallery
2. Confirm admin SSO domain (`@creativegrowth.org`)
3. Image licensing / Creative Commons notice
4. Featured/highlighted works for homepage
5. Existing artist bios to import
6. Whether to import previously generated descriptions from `creativegrowth/ai_alt_text_output.csv`
