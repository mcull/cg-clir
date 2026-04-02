# Creative Growth CLIR Digital Gallery — Design Document & Project Plan

**Project:** Digitized Art Collection Online Gallery
**Grant:** Council on Library and Information Resources (CLIR)
**Date:** April 2, 2026
**Status:** Design Phase

---

## 1. Problem Statement

Creative Growth Gallery has a CLIR grant to digitize and present 2,000+ artworks online. The current Art Cloud platform fails to meet WCAG accessibility standards and lacks needed functionality. This project replaces Art Cloud with a purpose-built system that the gallery fully controls.

## 2. Data Snapshot

The Art Cloud CSV export (`inventory_2026-04-02.csv`) contains:

- **2,189 artworks** across **90 artists**
- **128 tags** (mix of exhibition names, artist-specific CLIR tags, thematic labels)
- **166 unique mediums** (drawing, painting, fiber, mixed media, etc.)
- Images currently hosted at `cdn.artcld.com`
- 40 columns per record; public-facing fields include: Title, Artist, Date Created, Medium, Height/Width/Depth, Tags, Image URL, Inventory Number

Financial fields (pricing, consignment, insurance) are private and excluded from the public gallery.

## 3. Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                      Vercel (Frontend)                   │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ Public Site  │  │ /admin       │  │ API Routes     │  │
│  │ (SSG + ISR)  │  │ (Google SSO) │  │ /api/download  │  │
│  │              │  │              │  │ /api/import    │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬────────┘  │
│         │                 │                   │           │
└─────────┼─────────────────┼───────────────────┼───────────┘
          │                 │                   │
    ┌─────▼─────────────────▼───────────────────▼──────┐
    │              Supabase (Backend)                   │
    │                                                   │
    │  Postgres DB  │  Auth (Google SSO)  │  RLS        │
    └───────────────────────┬───────────────────────────┘
                            │
    ┌───────────────────────┼───────────────────────────┐
    │         Cloudflare R2 (Image Storage)             │
    │         *.r2.dev or custom subdomain              │
    │         Deep copies of all artwork images         │
    └───────────────────────────────────────────────────┘

    ┌───────────────────────────────────────────────────┐
    │              PostHog (Analytics)                   │
    │         Page views, download tracking,            │
    │         search behavior, filter usage             │
    └───────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS | SSG/ISR for performance, accessibility-first component library |
| Backend/DB | Supabase (Postgres) | Auth, RLS, real-time, generous free tier |
| Image CDN | Cloudflare R2 + Workers | Zero egress fees, global CDN, image transformations via Workers |
| Auth | Supabase Auth w/ Google OAuth | Plugs into Creative Growth's Google Workspace SSO |
| AI Descriptions | Claude Vision API | Museum-quality alt text generation for screen readers |
| Analytics | PostHog | Download tracking, page views, search analytics, 1M events/mo free |
| Hosting | Vercel | Optimal Next.js hosting, automatic previews, free tier |

## 4. Data Model (Supabase Postgres)

### `artists`
```sql
CREATE TABLE artists (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,        -- url-safe: "judith-scott"
  bio           TEXT,                         -- optional, admin-editable
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_artists_slug ON artists(slug);
```

### `categories`
Top-level navigation categories (admin-managed, seeded with AI suggestions).
```sql
CREATE TABLE categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,                -- "Drawings", "Fiber Art", etc.
  slug          TEXT UNIQUE NOT NULL,
  description   TEXT,
  sort_order    INT DEFAULT 0,
  ai_suggested  BOOLEAN DEFAULT false,       -- flag AI-generated categories
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

### `artworks`
```sql
CREATE TABLE artworks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id       UUID REFERENCES artists(id),
  title           TEXT NOT NULL,
  date_created    TEXT,                       -- freeform: "1992", "c. 1985-1990"
  medium          TEXT,
  height          NUMERIC,
  width           NUMERIC,
  depth           NUMERIC,
  inventory_number TEXT UNIQUE,

  -- Image
  image_url       TEXT,                       -- Cloudflare R2 URL
  image_original  TEXT,                       -- original Art Cloud URL (reference)

  -- AI-generated accessibility content
  ai_description  TEXT,                       -- Claude Vision alt text
  alt_text        TEXT,                       -- admin-edited final alt text (falls back to ai_description)

  -- Metadata
  tags            TEXT[],                     -- raw tags from Art Cloud
  genre           TEXT,
  on_website      BOOLEAN DEFAULT true,
  sort_order      INT DEFAULT 0,

  -- Timestamps
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_artworks_artist ON artworks(artist_id);
CREATE INDEX idx_artworks_tags ON artworks USING GIN(tags);
```

### `artwork_categories` (junction)
```sql
CREATE TABLE artwork_categories (
  artwork_id   UUID REFERENCES artworks(id) ON DELETE CASCADE,
  category_id  UUID REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (artwork_id, category_id)
);
```

### `download_events`
```sql
CREATE TABLE download_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artwork_id   UUID REFERENCES artworks(id),
  ip_hash      TEXT,                          -- hashed, not raw IP
  user_agent   TEXT,
  referrer     TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_downloads_artwork ON download_events(artwork_id);
CREATE INDEX idx_downloads_date ON download_events(created_at);
```

### Row-Level Security

- **Public (anon):** `SELECT` on `artworks`, `artists`, `categories`, `artwork_categories` where `on_website = true`.
- **Admin (authenticated + Google SSO domain):** Full CRUD on all tables. Auth policy checks `email LIKE '%@creativegrowth.org'`.

## 5. Image Pipeline

### Migration (one-time)

1. Parse CSV, extract all `cdn.artcld.com` image URLs (2,189 records).
2. Download each image at maximum resolution.
3. Upload to Cloudflare R2 bucket, keyed by inventory number: `artworks/{inventory_number}/original.{ext}`.
4. Generate responsive variants via Cloudflare Image Transformations (or a Worker): thumbnail (400px), medium (800px), large (1600px), and original.
5. Update `artworks.image_url` with the R2 URL.

### Ongoing

New artwork images are uploaded through the admin console directly to R2 via presigned URLs (Supabase Edge Function or Next.js API route generates the signed URL; the browser uploads directly to R2).

### URL Pattern
```
https://gallery-cdn.creativegrowth.org/artworks/{inventory_number}/original.jpg
https://gallery-cdn.creativegrowth.org/artworks/{inventory_number}/thumb_400.jpg
https://gallery-cdn.creativegrowth.org/artworks/{inventory_number}/medium_800.jpg
https://gallery-cdn.creativegrowth.org/artworks/{inventory_number}/large_1600.jpg
```

## 6. AI Description Pipeline

### Process

1. For each artwork, send the high-resolution image to the Claude Vision API with a carefully tuned system prompt.
2. The prompt instructs Claude to produce two outputs per image:
   - **`alt_text`** (~125 chars): Concise screen reader text following museum standards — identifies the artwork type, dominant visual elements, and medium.
   - **`ai_description`** (~2-4 sentences): A richer description suitable for an extended description or catalog entry, noting composition, color palette, texture, and artistic technique.
3. Descriptions are stored in the `artworks` table. The `alt_text` field is what screen readers encounter; `ai_description` is available on detail pages.
4. All AI descriptions are flagged as AI-generated in the admin console so staff can review and edit them. The admin-edited `alt_text` field takes priority when present.

### System Prompt (draft)

```
You are an art museum registrar writing image descriptions for screen reader
users. You are describing artworks by artists with disabilities at Creative
Growth Art Center in Oakland, California.

For each image, provide:
1. alt_text: A concise description (under 125 characters) identifying the
   artwork type, primary visual content, and medium. Be factual, not
   interpretive. Example: "Abstract drawing in colored pencil with dense
   overlapping circular forms in red, blue, and yellow on white paper."
2. description: 2-4 sentences expanding on composition, color, texture, and
   technique. Note anything distinctive about the work. Maintain a respectful,
   museum-professional tone.

Context provided: title, artist name, medium, dimensions.
```

### Rate Limiting & Cost

At ~2,200 images with Claude Vision, estimated cost is approximately $15-25 for the full batch (depending on image sizes). The script should process in batches of 10 with rate limiting to stay within API limits, and checkpoint progress so it can resume after interruptions.

## 7. Public Website

### Design Reference

Modeled after the Met's Open Access collection (metmuseum.org/art/collection): clean grid layout, minimal chrome, artwork-forward design, highly accessible.

### Routes

| Route | Description |
|-------|-------------|
| `/` | Landing page with featured artworks and navigation to categories |
| `/collection` | Default collection view; grid of all artworks |
| `/collection?category={slug}` | Filtered by category |
| `/collection?tag={tag}` | Filtered by raw tag |
| `/artwork/{inventory_number}` | Individual artwork detail page |
| `/artists` | Alphabetical list of all artists with artwork counts |
| `/artists/{slug}` | Artist page with bio and all their artworks |
| `/about` | About the CLIR project and Creative Growth |
| `/search` | Full-text search across titles, artists, mediums, tags |

### Navigation Structure

```
[Home] [Collection ▾] [Artists] [About] [Search 🔍]
                |
                ├── All Works
                ├── Drawings
                ├── Paintings
                ├── Fiber Art & Sculpture
                ├── Mixed Media
                ├── CLIR Collection
                └── ... (admin-managed categories)
```

Top-level tabs are driven by the `categories` table. Each is admin-editable. The initial seed categories are generated by analyzing the existing tags and mediums in the CSV, flagged as `ai_suggested = true`.

### Artwork Detail Page

```
┌──────────────────────────────────────────────┐
│  ← Back to Collection                        │
│                                              │
│  ┌────────────────────────────┐              │
│  │                            │              │
│  │      Artwork Image         │   Title      │
│  │      (zoomable)            │   Artist     │
│  │                            │   Date       │
│  │                            │   Medium     │
│  │                            │   Dimensions │
│  └────────────────────────────┘   Tags       │
│                                              │
│  Description (ai_description)                │
│                                              │
│  [Download High-Res ↓]                       │
│                                              │
│  ── More by this artist ──                   │
│  [thumb] [thumb] [thumb] [thumb]             │
└──────────────────────────────────────────────┘
```

### WCAG 2.1 AA Compliance

The site targets WCAG 2.1 AA at minimum. Key implementation details:

- **Semantic HTML:** All pages use `<main>`, `<nav>`, `<article>`, `<header>`, `<footer>`, headings in order.
- **Skip links:** "Skip to main content" link as first focusable element.
- **Keyboard navigation:** All interactive elements reachable and operable via keyboard. Visible focus indicators on all elements. Arrow key navigation within the grid.
- **Images:** Every artwork `<img>` has the `alt_text` field. A "Long description" expandable section provides `ai_description`.
- **Color contrast:** Minimum 4.5:1 for normal text, 3:1 for large text. No information conveyed by color alone.
- **Responsive:** Mobile-first, reflows to single column. No horizontal scrolling below 320px.
- **ARIA:** `aria-live` for dynamic filter results, `aria-current` for active navigation, proper `role` attributes on the image grid.
- **Forms:** All inputs have visible labels, error messages are associated via `aria-describedby`.
- **Motion:** `prefers-reduced-motion` respected, no auto-playing animations.
- **Text resize:** Content functional at 200% zoom.

### Download Tracking

The download button does not link directly to the R2 image. Instead:

1. User clicks "Download High-Res."
2. Client fires a `POST /api/download` with the artwork ID.
3. The API route logs the event to `download_events` in Supabase and fires a PostHog `artwork_downloaded` event.
4. The API returns a short-lived signed R2 URL (or streams the image).
5. The browser initiates the download.

This approach tracks every download without requiring user accounts.

## 8. Admin Console (`/admin`)

### Authentication

- Supabase Auth configured with Google OAuth provider.
- Restricted to `@creativegrowth.org` email domain via RLS policy.
- Session-based with Supabase's built-in JWT handling.

### Admin Routes

| Route | Description |
|-------|-------------|
| `/admin` | Dashboard: artwork count, recent edits, download stats |
| `/admin/artworks` | Paginated table of all artworks with search/filter |
| `/admin/artworks/{id}` | Edit form for a single artwork |
| `/admin/artists` | Manage artist list and bios |
| `/admin/categories` | Create, edit, reorder, and delete categories; assign artworks |
| `/admin/import` | CSV import/export tool for batch updates |
| `/admin/analytics` | Embedded PostHog dashboard or custom download stats view |

### CSV Import/Export for Batch Updates

Since the team needs to make batch updates easily:

- **Export:** Download current catalog as CSV (all public fields + category assignments).
- **Import:** Upload a modified CSV. The system diffs against current data, shows a preview of changes, and applies on confirmation. Supports adding new artworks, updating existing ones (matched by inventory number), and bulk category assignment.
- This addresses the need for easy batch tag/category management without requiring row-by-row editing.

### Artwork Edit Form Fields

Title, Artist (dropdown), Date Created, Medium, Dimensions (H/W/D), Tags (multi-select/freeform), Categories (multi-select), Image (upload with preview), Alt Text (with AI suggestion shown for reference), Description (with AI suggestion shown for reference), On Website (toggle).

## 9. Analytics (PostHog)

### Tracked Events

| Event | Properties |
|-------|-----------|
| `page_viewed` | path, referrer, category, artist_slug |
| `artwork_viewed` | artwork_id, artist_slug, category |
| `artwork_downloaded` | artwork_id, artist_slug, format |
| `search_performed` | query, result_count |
| `filter_applied` | filter_type, filter_value |
| `category_navigated` | category_slug |

PostHog is initialized client-side with the JS SDK. The `artwork_downloaded` event is also fired server-side from the API route for reliability. PostHog's autocapture is enabled for general interaction data (clicks, pageviews).

## 10. Project Plan

The project is organized into 6 milestones. Each milestone is designed to be independently deployable and testable.

### M0: Infrastructure Setup (Est. 2-3 hours)

1. Create Supabase project; run schema migrations (all tables above).
2. Configure Supabase Auth with Google OAuth, restrict to `@creativegrowth.org`.
3. Create Cloudflare R2 bucket; configure custom domain (`gallery-cdn.creativegrowth.org`) or use the default `*.r2.dev` URL.
4. Set up R2 API credentials (for upload scripts and presigned URLs).
5. Scaffold Next.js 14 project with TypeScript, Tailwind, ESLint, Prettier.
6. Configure Vercel project with environment variables (Supabase URL/keys, R2 credentials, PostHog key).
7. Set up PostHog project and install JS SDK.

**Deliverable:** Empty but deployed app at a Vercel preview URL, Supabase schema ready, R2 bucket accessible.

### M1: Data Import Pipeline (Est. 4-6 hours)

1. Write CSV parser script (`scripts/import-csv.ts`) that:
   - Reads the Art Cloud CSV export.
   - Deduplicates and normalizes artist names; upserts into `artists` table.
   - Maps each row to an `artworks` record; upserts into `artworks` table.
   - Preserves raw tags as `TEXT[]`.
2. Write image migration script (`scripts/migrate-images.ts`) that:
   - Downloads each image from `cdn.artcld.com`.
   - Uploads to R2 with the naming convention above.
   - Updates `artworks.image_url` with the new R2 URL.
   - Checkpoints progress (writes a JSON log so it can resume).
   - Generates thumbnail/medium variants (via sharp or Cloudflare Worker).
3. Write category seeding script (`scripts/seed-categories.ts`) that:
   - Analyzes tags and mediums across all artworks.
   - Proposes ~10 top-level categories with `ai_suggested = true`.
   - Assigns artworks to categories based on tag/medium matching.

**Deliverable:** Full catalog in Supabase, all images on R2, initial categories seeded.

### M2: AI Description Generation (Est. 3-4 hours)

1. Write description script (`scripts/generate-descriptions.ts`) that:
   - Iterates all artworks without descriptions.
   - Sends image + metadata to Claude Vision API.
   - Stores `alt_text` and `ai_description` on each artwork record.
   - Rate-limits to 10 concurrent requests; checkpoints progress.
   - Logs failures for manual review.
2. QA pass: Export descriptions to CSV for Creative Growth staff review.

**Deliverable:** All 2,189 artworks have AI-generated descriptions. Staff can review via CSV export.

### M3: Public Gallery Website (Est. 8-12 hours)

1. Implement layout: header with skip link, navigation tabs (from `categories` table), footer.
2. Build `/collection` grid page with:
   - Responsive image grid (CSS Grid, lazy-loaded `<Image>` with blur placeholder).
   - Category tabs as top-level navigation.
   - Tag and medium filters as secondary sidebar/dropdown filters.
   - Pagination or infinite scroll with `aria-live` announcements.
3. Build `/artwork/{inventory_number}` detail page with:
   - High-res image with zoom (CSS `object-fit` + lightbox).
   - All metadata fields, `alt_text` on image, expandable `ai_description`.
   - Download button wired to `/api/download`.
   - "More by this artist" section.
4. Build `/artists` index page (alphabetical grid with artwork counts).
5. Build `/artists/{slug}` page (artist bio + artwork grid).
6. Build `/search` with full-text search (Supabase `ts_vector` or client-side).
7. Build `/about` page.
8. Integrate PostHog tracking on all pages and events.
9. Run axe-core automated accessibility audit on all routes; fix all AA violations.

**Deliverable:** Fully functional, WCAG AA-compliant public gallery.

### M4: Admin Console (Est. 6-8 hours)

1. Implement `/admin` layout with auth guard (redirect to Google SSO if unauthenticated).
2. Build artwork list page with search, filter, pagination.
3. Build artwork edit form with image upload (presigned R2 URL), AI description display, and all public fields.
4. Build artist management page (CRUD + bio editing).
5. Build category management page (create, edit, reorder, delete, bulk assign).
6. Build CSV import/export page:
   - Export: generate CSV from current Supabase data.
   - Import: parse uploaded CSV, diff against DB, preview changes, apply.
7. Build analytics dashboard page (embedded PostHog iframe or custom download stats from `download_events`).

**Deliverable:** Fully functional admin console behind Google SSO.

### M5: QA, Performance & Launch (Est. 4-6 hours)

1. Full WCAG 2.1 AA audit using axe-core, Lighthouse, and manual keyboard/screen reader testing (VoiceOver, NVDA).
2. Performance audit: target Lighthouse score > 90 on all metrics. Optimize image loading, implement ISR for collection pages.
3. Security review: verify RLS policies, test that admin routes are inaccessible without auth, confirm no financial data leaks.
4. Cross-browser testing: Chrome, Firefox, Safari, Edge, iOS Safari, Android Chrome.
5. Load testing: verify R2 CDN handles concurrent image requests.
6. DNS configuration: point custom domain to Vercel, configure R2 custom domain.
7. Final data review with Creative Growth staff.
8. Launch.

**Deliverable:** Production-ready, audited, launched gallery.

## 11. File Structure

```
cg_clir/
├── app/
│   ├── layout.tsx              # Root layout, skip link, nav, footer
│   ├── page.tsx                # Landing page
│   ├── collection/
│   │   └── page.tsx            # Grid view with category tabs + filters
│   ├── artwork/
│   │   └── [id]/page.tsx       # Artwork detail
│   ├── artists/
│   │   ├── page.tsx            # Artist index
│   │   └── [slug]/page.tsx     # Artist detail
│   ├── search/
│   │   └── page.tsx            # Search results
│   ├── about/
│   │   └── page.tsx            # About page
│   ├── admin/
│   │   ├── layout.tsx          # Auth guard + admin nav
│   │   ├── page.tsx            # Dashboard
│   │   ├── artworks/
│   │   │   ├── page.tsx        # Artwork list
│   │   │   └── [id]/page.tsx   # Artwork edit
│   │   ├── artists/page.tsx
│   │   ├── categories/page.tsx
│   │   ├── import/page.tsx
│   │   └── analytics/page.tsx
│   └── api/
│       ├── download/route.ts   # Download tracking + signed URL
│       └── import/route.ts     # CSV import endpoint
├── components/
│   ├── ArtworkCard.tsx
│   ├── ArtworkGrid.tsx
│   ├── CategoryTabs.tsx
│   ├── FilterSidebar.tsx
│   ├── SearchBar.tsx
│   ├── SkipLink.tsx
│   └── ...
├── lib/
│   ├── supabase/
│   │   ├── client.ts           # Browser client
│   │   ├── server.ts           # Server client
│   │   └── admin.ts            # Service role client (scripts only)
│   ├── r2.ts                   # R2 upload/signed URL helpers
│   ├── posthog.ts              # PostHog initialization
│   └── utils.ts
├── scripts/
│   ├── import-csv.ts           # CSV → Supabase
│   ├── migrate-images.ts       # Art Cloud → R2
│   ├── seed-categories.ts      # AI category suggestions
│   └── generate-descriptions.ts # Claude Vision descriptions
├── supabase/
│   └── migrations/
│       └── 001_initial.sql     # All tables, indexes, RLS policies
├── public/
├── tailwind.config.ts
├── next.config.js
├── tsconfig.json
├── package.json
└── .env.local                  # Supabase, R2, Claude, PostHog keys
```

## 12. Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=          # scripts only, never in browser

# Cloudflare R2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_URL=                       # https://gallery-cdn.creativegrowth.org

# Claude API
ANTHROPIC_API_KEY=                   # for description generation script

# PostHog
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=            # https://us.i.posthog.com

# Auth
GOOGLE_CLIENT_ID=                    # for Supabase Google OAuth
GOOGLE_CLIENT_SECRET=
```

## 13. Key Decisions & Trade-offs

**Why not a headless CMS (Sanity, Contentful, etc.)?** The data is highly structured and relational (artists ↔ artworks ↔ categories). A relational database with a custom admin UI is more natural than a document-oriented CMS. Supabase provides the admin auth and API layer for free.

**Why Cloudflare R2 over Supabase Storage?** R2 has zero egress fees and Cloudflare's global CDN is best-in-class for image delivery. For a public gallery serving high-resolution artwork images, egress costs matter. Supabase Storage would work but costs more at scale and has less CDN flexibility.

**Why SSG/ISR over SSR?** The artwork catalog changes infrequently (admin edits, not real-time). SSG with ISR (revalidate every 60 seconds) gives the best performance — pages are served from Vercel's edge CDN and regenerated in the background when data changes.

**Why not a SPA?** Server-rendered HTML is critical for accessibility and SEO. Screen readers and search engines need real HTML content, not a JavaScript-dependent shell.

## 14. Open Questions for Creative Growth

1. **Custom domain:** What domain will the gallery live on? (e.g., `gallery.creativegrowth.org`, `collection.creativegrowth.org`)
2. **Google Workspace domain:** Confirm the admin SSO domain is `@creativegrowth.org`.
3. **Image licensing:** Should a Creative Commons license or usage notice appear on artwork detail pages and in downloaded files?
4. **Featured/highlighted works:** Should the homepage feature curated artworks, or show a rotating selection?
5. **Artist bios:** Does Creative Growth have existing artist bios to import, or should those be written as part of this project?
6. **Existing descriptions:** The `creativegrowth/ai_alt_text_output.csv` file appears to contain previously generated descriptions for some works. Should these be imported as a starting point?
