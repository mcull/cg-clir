# Collection Filters & Search — Design

**Date:** 2026-04-24
**Status:** Ready for implementation

---

## Goal

Replace the current single-axis category-tabs filter on `/collection` with a faceted browse experience: free-text search plus multi-select Theme / Format / Decade dropdowns, single-select Artist (typeahead), and a Sort control. Lift the Ephemera cohort (208 rows tagged `ephemera`) up into its own route at `/ephemera` so the two collections are disjoint and have purpose-built UX.

The brief is two routes, fully composable URL state, faceted counts on the multi-select dimensions, and a CG-styled top bar that matches the gallery's visual language.

---

## Information architecture

Three top-level pieces:

- **`/collection`** — Artworks. Universe: every DB artwork with `on_website=true` AND `'ephemera' != ALL(tags)` (i.e., NOT tagged ephemera). Expected ~3,052 rows.
- **`/ephemera`** — Ephemera. Universe: every DB artwork with `on_website=true` AND `'ephemera' = ANY(tags)`. Expected ~208 rows. Simpler filter set since theme/format/decade don't carry the same meaning for documentary material.
- **Top-right indicator** — `Artwork | Ephemera`, styled per CG's mockup. These are two real `<Link>`s, not a filter toggle. Active route is bolded + green; inactive is gray. Visually identical to a tab pair, behaves like nav. Switching between routes does NOT preserve filter state — each route starts fresh.

The two cohorts are disjoint sets. Search and filters compose within each cohort independently. There is no unified search results page in v1.

**Acknowledged tradeoff:** Searching "dan miller" on `/collection` won't surface his ephemera. A future enhancement could add a hint at the bottom of empty/short results: "→ See N matches in Ephemera". Not in v1.

---

## Filter sets per route

### `/collection` filter set

| Filter | Type | Source | URL param |
|---|---|---|---|
| Free-text search | string | matches title + medium + alt_text_long + artist full name | `q` |
| Theme | multi-select | `categories` where `kind='theme'` (8 fixed values) | `theme` (comma-separated slugs) |
| Format | multi-select | `categories` where `kind='format'` (8 values: Drawings, Paintings, Mixed Media, etc.) | `format` (comma-separated slugs) |
| Artist | single-select with typeahead | `artists` table (123 entries) | `artist` (single slug) |
| Decade | multi-select | derived from `extractYear(date_created)` bucketed to decades present in data | `decade` (comma-separated, e.g. `1980s,1990s`) |
| Sort | single-select | enum (see below) | `sort` |
| Page | integer | pagination | `page` |

### `/ephemera` filter set

Simpler since the cohort is documentary material:

| Filter | Type | URL param |
|---|---|---|
| Free-text search | string (matches title + medium + alt_text_long + artist full name) | `q` |
| Artist | single-select with typeahead | `artist` |
| Sort | single-select | `sort` |
| Page | integer | `page` |

No theme/format/decade dropdowns on `/ephemera`.

---

## Filter semantics (AND/OR)

Standard faceted search: **OR within a dropdown, AND across dropdowns**. The canonical filter expression for `/collection`:

```
(theme IN selected_themes OR no theme selected) AND
(format IN selected_formats OR no format selected) AND
(decade IN selected_decades OR no decade selected) AND
(artist = selected_artist OR no artist selected) AND
(search matches title|medium|alt_text_long|artist OR q is empty)
```

Empty filter dimension imposes no constraint. All filters are joinable; the URL captures the complete query state and is shareable.

---

## Sort

Six options. **Featured is always a secondary sort** within whatever primary sort is active — this lets curators pin highlights inside any view.

| Sort value | Label | Behavior |
|---|---|---|
| `featured` | Featured | Primary: `sort_order ASC`. Default when search is inactive. |
| `relevance` | Relevance | Primary: Postgres FTS rank descending. Only available (and default) when `q` is non-empty; hidden from the dropdown otherwise. |
| `artist` | Artist (A-Z) | Primary: `artist.last_name ASC, artist.first_name ASC`. Secondary: `sort_order ASC`. |
| `newest` | Newest first | Primary: `extractYear(date_created) DESC NULLS LAST`. Secondary: `sort_order ASC`, then `created_at DESC`. |
| `oldest` | Oldest first | Primary: `extractYear(date_created) ASC NULLS LAST`. Secondary: `sort_order ASC`, then `created_at ASC`. |
| `title` | Title (A-Z) | Primary: `title ASC`. Secondary: `sort_order ASC`. |

URL: `?sort=artist`. Default when `q` is empty: `featured`. Default when `q` is non-empty: `relevance`.

---

## Faceted counts and option-disabling

Each multi-select dropdown shows option counts AND disables zero-count options, so users see what's available before clicking.

**Counting rule:** for the dropdown of dimension X, counts are computed assuming all OTHER filters are applied but X's own filter is NOT. (This lets users switch among X's values without first un-selecting their current X filter.)

| Dimension | UI treatment |
|---|---|
| Theme (multi, 8 opts) | Show count next to each option: `animals (47)`. Greyed-out + non-clickable if count is 0. |
| Format (multi, 8 opts) | Same as Theme. |
| Decade (multi, ~5 opts based on data) | Same as Theme. |
| Artist (single, 123 opts via typeahead) | **Disable-only — no counts.** Artists with 0 matches given other filters are hidden from the typeahead list. The typeahead UI is busy enough; per-artist counts would clutter. |

Performance: at ~3k rows with appropriate indexes, computing 3 facet count queries (theme/format/decade) plus 1 artist availability query in parallel is sub-100ms in Postgres. Server-render on each request; cache HTTP responses if needed later.

---

## URL state

All filter + search + sort + page state is reflected in URL params on both routes. Examples:

- `/collection` — default view, no filters
- `/collection?q=lightbulbs` — search only
- `/collection?theme=animals,abstract&decade=1990s,2000s&artist=dan-miller&sort=newest` — filtered view
- `/ephemera?q=judith+scott&page=2` — search + pagination on ephemera

Pagination resets to page 1 whenever any filter, sort, or search query changes.

---

## Search behavior

- **Submit-on-enter only** in v1. Live typeahead search is deferred — we want to see how Postgres FTS performs at our scale before committing to per-keystroke queries.
- The search input echoes the current `q` value when the page loads. Pressing Enter submits a navigation to the new URL.
- Search matches across `title`, `medium`, `alt_text_long`, and the artist's full name (`artists.first_name || ' ' || artists.last_name`). Implementation note: the existing FTS index covers title/medium/alt_text/alt_text_long; for artist name match, either extend the FTS to include a denormalized artist_name column on `artworks` (cleanest, sub-ms), or compute via a JOIN + ILIKE union (simpler, slightly slower). Plan can choose.
- Magnifier glyph on the right inside the input.

---

## Active filter chips

Below the filter row, render a chips strip whenever any filter is active:

```
Active: [animals ✕] [abstract ✕] [Drawings ✕] [1990s ✕] [Dan Miller ✕]   [Clear all]
```

- One chip per selected value (across all dimensions).
- Clicking the ✕ on a chip removes that single value from its dimension's URL param.
- "Clear all" link resets all filter params (preserves `q` and `sort`).
- Chips wrap to multiple lines if the row exceeds container width.
- Hidden entirely when no filters are active.

The search query is NOT shown as a chip — it's already visible in the search input. Sort is NOT shown as a chip — it's not a filter.

---

## Visual layout

Adapted from CG's mockup (which the team shared and we're honoring with extensions):

```
┌───────────────────────────────────────────────────────────────────┐
│  CGPA ARCHIVE                                                     │
│                                                                   │
│                                          Artwork | Ephemera       │
│                                                                   │
│  [ Search artwork & artists  ⌕ ]  [Theme▾] [Format▾] [Artist▾]   │
│                                   [Decade▾]            [Sort▾]    │
│                                                                   │
│  Active: [animals ✕] [Drawings ✕]  Clear all                     │
│                                                                   │
│  3,052 works                                                      │
│  ┌──┐ ┌──┐ ┌──┐ ┌──┐                                              │
│  │  │ │  │ │  │ │  │                                              │
│  └──┘ └──┘ └──┘ └──┘                                              │
│  Darlene Pesicka  Thelma Gibson  Co-Op  …                         │
│  Untitled, …      Untitled, …    Untitled, …                      │
└───────────────────────────────────────────────────────────────────┘
```

- Page title is large sans-serif, matching CG's "CGPA ARCHIVE" treatment.
- Artwork/Ephemera indicator top-right above the filter row.
- Search input partial-width (~340px on desktop), pill-shape, with magnifier glyph.
- Filter dropdowns are pill-style buttons with thin dark border, rounded corners, inline ▾ glyph. Match each other in height with the search input.
- Sort dropdown right-aligned at the end of the filter row (visually distinct).
- Active filter chips appear below the filter row; only when active.
- Result count printed above the grid: "3,052 works" or "47 works for 'lightbulbs'".
- Grid is 4-col on wide desktop, 3 on tablet, 2 on mobile, 1 on narrow mobile.
- Cards: image (natural aspect ratio), full artist name in bold, italic title (with SKU + date) in gray.

### Mobile

The filter row wraps naturally on small screens — pill buttons stack into multiple rows as needed. No drawer/sidebar treatment in v1. The Artwork/Ephemera indicator stays top-right but may move to its own row above the filter row on narrow viewports.

The active chips strip wraps the same way.

### Open dropdown UX

| Dropdown | Behavior |
|---|---|
| Theme / Format / Decade | Click trigger → panel opens directly below. Lists checkboxes with labels and counts (`☑ animals (47)`). Auto-applies as you check/uncheck (URL updates, page re-renders). Click outside or press Escape to close. Trigger label updates: `Theme (2) ▾` when 2 selected. |
| Artist | Click trigger → panel opens with a small text input at top (`Search 123 artists…`) plus a scrollable list (~6 visible at a time, A-Z order). Type to narrow. Click an artist to select; panel closes; trigger label becomes `Artist: Dan Miller ▾`. The currently-selected artist shows a checkmark in the list when re-opened. |

---

## Empty state

When filters/search return zero results:

```
No artworks match your filters.
[Clear filters]  or try a broader search term.
```

The "Clear filters" button is wired to clear all filter params (preserves `q` if present) — an easy escape hatch.

---

## Schema and data dependencies

No schema changes required. The existing tables already support everything:

- `categories.kind` discriminates 'theme' vs 'format' (added in feat/archive-import)
- `artworks.tags` carries 'ephemera' for cohort routing
- `artworks.sort_order` powers the Featured sort (already exists)
- `artworks.fts` is a generated tsvector covering title/medium/alt_text/alt_text_long (already exists)

**One implementation question for the plan:** how to make artist full name searchable in the same FTS query. Two options:

1. **Denormalize:** add `artworks.artist_name TEXT` column, backfill via UPDATE join, populate on subsequent INSERTs via trigger or app code. Update the FTS generated column to include `setweight(to_tsvector('english', coalesce(artist_name, '')), 'A')`. Cleanest at search time; mild data-management overhead.
2. **Separate query path:** at search time, query for artwork IDs matching FTS in one query AND artwork IDs whose joined artist name ILIKE-matches in another, then UNION + intersect with other filters. No schema change; slightly slower per query.

Spec doesn't pick one; plan can decide. Recommendation: option 1 for clean SQL, but option 2 is fine for a v1 if we want to defer schema work.

---

## Components inventory

New + modified files (high-level — plan will be concrete):

**New:**
- A `FilterBar` component encapsulating search + dropdowns + chips + sort. Probably in `src/components/FilterBar.tsx`.
- One or more dropdown primitives: `MultiSelectDropdown` for theme/format/decade, `ArtistTypeaheadDropdown` for artist, `SortDropdown` for sort. Could share base styling.
- An `ActiveFilterChips` component.
- An `/ephemera` page route at `src/app/ephemera/page.tsx`.
- A new helper `src/lib/collection-query.ts` (or similar) that builds the Supabase query from URL params and returns `{ artworks, total, facetCounts }`.
- A new helper for building decade options dynamically from data: `src/lib/decades.ts` (depends on existing `src/lib/dates.ts`).

**Modified:**
- `src/app/collection/page.tsx` — replace existing `CategoryTabs` use with the new `FilterBar`. Add the cohort filter (`'ephemera' != ALL(tags)`).
- `src/components/Header.tsx` (or a new sub-nav component) — add the Artwork/Ephemera indicator that's positioned per CG's mockup. May live as part of FilterBar's header area instead of in the main Header.
- `supabase/migrations/001_initial.sql` — only if option 1 (denormalized artist_name) is chosen; sync the schema change.

---

## Out of scope (explicit)

- **Live-as-you-type search.** v1 is submit-on-enter; revisit if FTS proves fast enough.
- **Unified `/search` route across both cohorts.** Each cohort searches itself; future enhancement could add a "→ N matches in Ephemera" hint at the bottom of results.
- **Mobile filter drawer.** v1 wraps the filter row; if it gets crowded on real devices we'll add a drawer in a follow-up.
- **Faceted counts on the Artist typeahead.** Disable-only; counts deferred.
- **"Featured by curator" workflow.** The `sort_order` column exists but there's no admin UI for setting it. Not new for this PR.
- **Save / share filter presets.** URL is shareable; saved-search infra is not in scope.
- **Filter analytics.** PostHog is wired up for page views; per-filter usage tracking would be a follow-up.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Postgres FTS doesn't include artist name; first-pass implementation may search artist name via JOIN + ILIKE which can be slow as catalog grows | Plan to start with the JOIN approach for v1 simplicity; if perceptible latency, denormalize artist_name into artworks per the alternative path documented above. |
| Faceted counts add 3-4 extra queries per page render | At ~3k rows with indexes the total stays sub-100ms. Tracked; revisit if catalog grows 10x or if we add complex tag filters. |
| Cohort split (`/collection` vs `/ephemera`) hides ephemera matches from artist-name searches on the collection route | Acknowledged in IA section. Hint affordance deferred to a future PR. |
| Multi-select dropdowns add complexity to the URL state encoding (comma-joined slugs, special characters) | Use slugs (already URL-safe) for theme/format values; for decade the values are simple `1980s` style. Document param shape in the spec. |
| Curators have not yet populated `sort_order` for Featured to be meaningful | Spec acknowledges Featured falls back to `sort_order ASC` (default 0 for all rows currently), so without curation it's effectively undefined order. Acceptable; the dropdown still works, and CG can set sort_order via the existing admin per-artwork. |
| The free-text search may return surprisingly few results because alt_text_long is empty for ~30% of artworks | Acknowledged. Resolves naturally as `generate-descriptions.ts` and the human-descriptions workflow fill in alt_text_long over time. |
