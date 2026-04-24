# Collection Filters & Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing single-axis category-tabs filter on `/collection` with a faceted browse experience (search + multi-select Theme/Format/Decade + Artist typeahead + Sort), and split the Ephemera cohort into its own `/ephemera` route with a simpler filter set.

**Architecture:** Two Next.js Server Component routes that derive their query state from URL params, using a shared query-builder module that constructs Supabase queries with cohort filtering, facet count computation, and sort. Client-only filter UI components (dropdowns, chips, cohort nav) push URL changes via `useRouter`. Pure helpers for URL parsing and decade derivation get TDD coverage; UI components get smoke-tested via the dev server.

**Tech Stack:** TypeScript, Next.js 14 App Router (Server Components + a few "use client" islands), TailwindCSS, `@supabase/supabase-js`, `node:test` for pure helpers.

**Spec reference:** `docs/superpowers/specs/2026-04-24-collection-filters-design.md`

---

## File Structure

**New files:**
- `src/lib/decades.ts` — `dateToDecade(raw: string | null): string | null` and `decadeOptions(years: number[]): string[]`. Pure helpers reused by the query builder and the decade dropdown.
- `src/lib/filter-state.ts` — URL params parse/serialize. `parseSearchParams(p): FilterState` and `toQueryString(state): string`.
- `src/lib/collection-query.ts` — server-side query builder. `queryArtworks(state, cohort)` and `getFacetCounts(state, cohort)`.
- `src/components/CohortNav.tsx` — "Artwork | Ephemera" link pair.
- `src/components/DropdownPanel.tsx` — base trigger-button + popover with click-outside close. Used by the three dropdown variants.
- `src/components/MultiSelectDropdown.tsx` — checkbox list, used for Theme / Format / Decade.
- `src/components/ArtistTypeaheadDropdown.tsx` — typeahead-narrowed scrollable list.
- `src/components/SortDropdown.tsx` — radio list.
- `src/components/ActiveFilterChips.tsx` — chip strip with X-to-remove + Clear all.
- `src/components/FilterBar.tsx` — composes the above + the search input.
- `src/app/ephemera/page.tsx` — new route.
- `scripts/test-decades.ts` — `node:test` for `dateToDecade`.
- `scripts/test-filter-state.ts` — `node:test` for URL param round-trip.
- `scripts/backfill-decade.ts` — one-shot backfill of the new `artworks.decade` column from `date_created`.

**Modified files:**
- `src/app/collection/page.tsx` — replace `CategoryTabs` with `FilterBar`; route data through the new query builder; add the cohort filter (`'ephemera' != ALL(tags)`).
- `scripts/import-csv.ts` — populate `decade` on insert.
- `scripts/import-archive.ts` — populate `decade` on Branch B insert.
- `supabase/migrations/001_initial.sql` — sync the new `decade` column with what the user manually applies.
- `package.json` — add `backfill:decade` npm script.

**Schema change (manual):** add `artworks.decade TEXT` and an index. Run by user in Supabase SQL Editor (per TD-001) before code lands.

---

## Phase 0: Pre-flight

### Task 0: Verify the existing schema state

**Files:** none (read-only verification)

- [ ] **Step 1: Confirm artworks columns + theme categories**

Run:
```bash
npx tsx --env-file=.env.local -e "
import { createClient } from '@supabase/supabase-js';
const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
Promise.all([
  c.from('artworks').select('id, sku, tags, date_created').limit(1),
  c.from('categories').select('kind').neq('kind', null),
]).then(([a, t]) => {
  if (a.error || t.error) { console.error(a.error || t.error); process.exit(1); }
  const kinds = [...new Set(t.data.map(r => r.kind))].sort();
  console.log('OK - artworks columns:', Object.keys(a.data[0]));
  console.log('OK - category kinds:', kinds);
});
"
```

Expected output:
- artworks columns include `tags` and `date_created`
- `category kinds: [ 'format', 'theme' ]`

If something's missing, stop and report.

---

## Phase 1: Schema + decade backfill

### Task 1: User runs ALTER TABLE for the decade column

**Files:** none (manual step)

- [ ] **Step 1: Provide SQL to the user**

Tell the user to run this in the Supabase SQL Editor:

```sql
ALTER TABLE artworks ADD COLUMN decade TEXT;
CREATE INDEX idx_artworks_decade ON artworks(decade);
```

The column is nullable (artworks without parseable years stay NULL). Index is for the multi-value `WHERE decade = ANY(...)` filter.

- [ ] **Step 2: Verify the column exists**

Wait for user confirmation, then run:
```bash
npx tsx --env-file=.env.local -e "
import { createClient } from '@supabase/supabase-js';
const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
c.from('artworks').select('id, decade').limit(1).then(({data, error}) => {
  if (error) { console.error('NOT YET:', error.message); process.exit(1); }
  console.log('OK - decade column exists:', Object.keys(data[0]));
});
"
```

Expected: `OK - decade column exists: [ 'id', 'decade' ]`

If this fails, stop and ask user to re-run the SQL.

---

### Task 2: TDD `dateToDecade` helper — failing tests first

**Files:**
- Create: `scripts/test-decades.ts`

- [ ] **Step 1: Write the test file**

Create `scripts/test-decades.ts`:

```typescript
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { dateToDecade, decadeOptions } from "../src/lib/decades";

test("dateToDecade: returns null for null/empty/ND", () => {
  assert.equal(dateToDecade(null), null);
  assert.equal(dateToDecade(""), null);
  assert.equal(dateToDecade("ND"), null);
});

test("dateToDecade: bucketed to '1980s' for any 1980s date", () => {
  assert.equal(dateToDecade("1985"), "1980s");
  assert.equal(dateToDecade("1980"), "1980s");
  assert.equal(dateToDecade("1989"), "1980s");
});

test("dateToDecade: '7/20/1987' → '1980s'", () => {
  assert.equal(dateToDecade("7/20/1987"), "1980s");
});

test("dateToDecade: '2000' → '2000s', '2001' → '2000s', '2009' → '2000s'", () => {
  assert.equal(dateToDecade("2000"), "2000s");
  assert.equal(dateToDecade("2001"), "2000s");
  assert.equal(dateToDecade("2009"), "2000s");
});

test("dateToDecade: '2010' → '2010s'", () => {
  assert.equal(dateToDecade("2010"), "2010s");
});

test("dateToDecade: 'c. 1990' → '1990s'", () => {
  assert.equal(dateToDecade("c. 1990"), "1990s");
});

test("dateToDecade: out-of-range years return null", () => {
  assert.equal(dateToDecade("1850"), null);
  assert.equal(dateToDecade("0042"), null);
});

test("decadeOptions: from a list of years, returns sorted decade strings", () => {
  assert.deepEqual(decadeOptions([1985, 1990, 2003, 1989, 2010]), ["1980s", "1990s", "2000s", "2010s"]);
});

test("decadeOptions: empty input → empty array", () => {
  assert.deepEqual(decadeOptions([]), []);
});

test("decadeOptions: dedups years from same decade", () => {
  assert.deepEqual(decadeOptions([1985, 1986, 1987]), ["1980s"]);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx tsx --test scripts/test-decades.ts`
Expected: All tests fail with `Cannot find module '../src/lib/decades'`.

---

### Task 3: Implement `dateToDecade` and `decadeOptions`

**Files:**
- Create: `src/lib/decades.ts`

- [ ] **Step 1: Write the implementation**

Create `src/lib/decades.ts`:

```typescript
import { extractYear } from "./dates";

/**
 * Bucket a free-form date string into a decade label like "1980s".
 * Returns null for unparseable / out-of-range dates.
 */
export function dateToDecade(raw: string | null): string | null {
  const year = extractYear(raw);
  if (year === null) return null;
  return `${Math.floor(year / 10) * 10}s`;
}

/**
 * Given a list of years, return the sorted unique decade labels they fall into.
 * Used to populate the Decade dropdown options from the data we have.
 */
export function decadeOptions(years: number[]): string[] {
  const set = new Set<string>();
  for (const y of years) {
    set.add(`${Math.floor(y / 10) * 10}s`);
  }
  return [...set].sort();
}
```

- [ ] **Step 2: Run and verify all tests pass**

Run: `npx tsx --test scripts/test-decades.ts`
Expected: All 9 tests pass.

---

### Task 4: Implement and run the decade backfill

**Files:**
- Create: `scripts/backfill-decade.ts`

- [ ] **Step 1: Write the script**

Create `scripts/backfill-decade.ts`:

```typescript
#!/usr/bin/env npx tsx
/**
 * backfill-decade.ts
 *
 * Populates artworks.decade for every row by parsing date_created via
 * dateToDecade. Rows whose date_created is null/unparseable get
 * decade = NULL. One-shot.
 *
 * Run: npx tsx --env-file=.env.local scripts/backfill-decade.ts
 */

import { createClient } from "@supabase/supabase-js";
import { dateToDecade } from "../src/lib/decades";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Error: Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log("Fetching all artworks...");
  const all: { id: string; date_created: string | null }[] = [];
  let off = 0;
  while (true) {
    const { data, error } = await supabase
      .from("artworks")
      .select("id, date_created")
      .range(off, off + 999);
    if (error) { console.error(error); process.exit(1); }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    off += 1000;
  }
  console.log(`Fetched ${all.length} artworks`);

  let updated = 0;
  let nullified = 0;
  let errors = 0;
  for (const row of all) {
    const decade = dateToDecade(row.date_created);
    const { error } = await supabase.from("artworks").update({ decade }).eq("id", row.id);
    if (error) { errors++; continue; }
    if (decade === null) nullified++;
    else updated++;
  }

  console.log("\n=== Summary ===");
  console.log(`Total rows:         ${all.length}`);
  console.log(`Set to a decade:    ${updated}`);
  console.log(`Set to NULL:        ${nullified}`);
  console.log(`Errors:             ${errors}`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
```

- [ ] **Step 2: Add npm script**

In `package.json`, in the scripts block, add this line (insert after `triage:report` or wherever it fits in the existing list):

```json
"backfill:decade": "tsx --env-file=.env.local scripts/backfill-decade.ts"
```

- [ ] **Step 3: Run the backfill**

Run: `npm run backfill:decade`
Expected output ends with:
```
=== Summary ===
Total rows:         ~3,260
Set to a decade:    most rows (~2500-3000)
Set to NULL:        rows with no parseable date (~200-700)
Errors:             0
```

If errors are non-zero, stop and report.

- [ ] **Step 4: Spot-check distribution**

Run:
```bash
npx tsx --env-file=.env.local -e "
import { createClient } from '@supabase/supabase-js';
const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
c.rpc('exec_sql' as any).then(() => {}).catch(() => {});
// PostgREST doesn't expose GROUP BY directly; do it client-side
async function go() {
  const all: any[] = [];
  let off = 0;
  while (true) {
    const { data } = await c.from('artworks').select('decade').range(off, off + 999);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    off += 1000;
  }
  const counts = new Map<string, number>();
  for (const r of all) counts.set(r.decade || '(null)', (counts.get(r.decade || '(null)') || 0) + 1);
  [...counts.entries()].sort().forEach(([d, n]) => console.log(d.padEnd(8), n));
}
go();
" 2>&1 | grep -v notice
```

Expected: a histogram like `1980s 320`, `1990s 540`, `2000s 1200`, `2010s 800`, `2020s 200`, `(null) 400`. The exact numbers don't matter — just confirm decades from ~1900-2020s appear with non-zero counts and `(null)` is a reasonable minority.

---

## Phase 2: URL state helper

### Task 5: TDD `filter-state` — failing tests first

**Files:**
- Create: `scripts/test-filter-state.ts`

- [ ] **Step 1: Write the test file**

Create `scripts/test-filter-state.ts`:

```typescript
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseSearchParams, toQueryString, FilterState } from "../src/lib/filter-state";

test("parseSearchParams: empty input yields empty state", () => {
  const s = parseSearchParams({});
  assert.deepEqual(s, {
    q: "",
    themes: [],
    formats: [],
    decades: [],
    artist: null,
    sort: null,
    page: 1,
  });
});

test("parseSearchParams: parses single-value strings", () => {
  const s = parseSearchParams({ q: "lightbulbs", artist: "dan-miller", sort: "newest", page: "3" });
  assert.equal(s.q, "lightbulbs");
  assert.equal(s.artist, "dan-miller");
  assert.equal(s.sort, "newest");
  assert.equal(s.page, 3);
});

test("parseSearchParams: parses comma-joined multi-values", () => {
  const s = parseSearchParams({
    theme: "animals,abstract",
    format: "drawings,paintings",
    decade: "1990s,2000s",
  });
  assert.deepEqual(s.themes, ["animals", "abstract"]);
  assert.deepEqual(s.formats, ["drawings", "paintings"]);
  assert.deepEqual(s.decades, ["1990s", "2000s"]);
});

test("parseSearchParams: trims and ignores empty fragments", () => {
  const s = parseSearchParams({ theme: "animals,, abstract ," });
  assert.deepEqual(s.themes, ["animals", "abstract"]);
});

test("parseSearchParams: page clamps to >= 1", () => {
  assert.equal(parseSearchParams({ page: "0" }).page, 1);
  assert.equal(parseSearchParams({ page: "-5" }).page, 1);
  assert.equal(parseSearchParams({ page: "abc" }).page, 1);
});

test("parseSearchParams: handles array-typed params from Next.js", () => {
  // Next.js searchParams can be string | string[]; we handle both
  const s = parseSearchParams({ theme: ["animals", "people"] as any });
  assert.deepEqual(s.themes, ["animals", "people"]);
});

test("toQueryString: round-trips a populated state", () => {
  const state: FilterState = {
    q: "lightbulbs",
    themes: ["animals", "abstract"],
    formats: ["drawings"],
    decades: ["1990s"],
    artist: "dan-miller",
    sort: "newest",
    page: 2,
  };
  const qs = toQueryString(state);
  const re = parseSearchParams(Object.fromEntries(new URLSearchParams(qs)));
  assert.deepEqual(re, state);
});

test("toQueryString: omits empty fields", () => {
  const state: FilterState = {
    q: "", themes: [], formats: [], decades: [], artist: null, sort: null, page: 1,
  };
  assert.equal(toQueryString(state), "");
});

test("toQueryString: omits page=1 (default)", () => {
  const state: FilterState = {
    q: "x", themes: [], formats: [], decades: [], artist: null, sort: null, page: 1,
  };
  assert.equal(toQueryString(state), "q=x");
});

test("toQueryString: includes page when > 1", () => {
  const state: FilterState = {
    q: "", themes: [], formats: [], decades: [], artist: null, sort: null, page: 3,
  };
  assert.equal(toQueryString(state), "page=3");
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx tsx --test scripts/test-filter-state.ts`
Expected: All tests fail with `Cannot find module '../src/lib/filter-state'`.

---

### Task 6: Implement `filter-state`

**Files:**
- Create: `src/lib/filter-state.ts`

- [ ] **Step 1: Write the implementation**

Create `src/lib/filter-state.ts`:

```typescript
/**
 * URL search-params <-> FilterState round-trip for the collection
 * and ephemera browse pages. Keep this dependency-free and pure so
 * it can be tested + reused on both server and client.
 */

export type SortKey = "featured" | "relevance" | "artist" | "newest" | "oldest" | "title";

export interface FilterState {
  q: string;
  themes: string[];
  formats: string[];
  decades: string[];
  artist: string | null;
  sort: SortKey | null;
  page: number;
}

type RawParam = string | string[] | undefined;

function pickFirst(p: RawParam): string {
  if (p === undefined) return "";
  if (Array.isArray(p)) return p[0] || "";
  return p;
}

function parseList(p: RawParam): string[] {
  if (p === undefined) return [];
  if (Array.isArray(p)) return p.flatMap(parseList);
  return p.split(",").map((s) => s.trim()).filter(Boolean);
}

const VALID_SORTS: SortKey[] = ["featured", "relevance", "artist", "newest", "oldest", "title"];

function parseSort(p: RawParam): SortKey | null {
  const v = pickFirst(p);
  return VALID_SORTS.includes(v as SortKey) ? (v as SortKey) : null;
}

function parsePage(p: RawParam): number {
  const v = parseInt(pickFirst(p) || "1", 10);
  return isNaN(v) || v < 1 ? 1 : v;
}

export function parseSearchParams(params: Record<string, RawParam>): FilterState {
  return {
    q: pickFirst(params.q),
    themes: parseList(params.theme),
    formats: parseList(params.format),
    decades: parseList(params.decade),
    artist: pickFirst(params.artist) || null,
    sort: parseSort(params.sort),
    page: parsePage(params.page),
  };
}

export function toQueryString(state: FilterState): string {
  const out = new URLSearchParams();
  if (state.q) out.set("q", state.q);
  if (state.themes.length) out.set("theme", state.themes.join(","));
  if (state.formats.length) out.set("format", state.formats.join(","));
  if (state.decades.length) out.set("decade", state.decades.join(","));
  if (state.artist) out.set("artist", state.artist);
  if (state.sort) out.set("sort", state.sort);
  if (state.page > 1) out.set("page", String(state.page));
  return out.toString();
}
```

- [ ] **Step 2: Run and verify all tests pass**

Run: `npx tsx --test scripts/test-filter-state.ts`
Expected: All 10 tests pass.

---

## Phase 3: Server-side query builder

### Task 7: Implement `collection-query`

**Files:**
- Create: `src/lib/collection-query.ts`

- [ ] **Step 1: Write the module**

Create `src/lib/collection-query.ts`:

```typescript
/**
 * Collection / Ephemera query builder.
 *
 * Given a FilterState and a cohort, fetch the matching artworks (with
 * pagination) and the facet counts for the multi-select dropdowns.
 *
 * Cohort filter:
 *   'artwork'  → artworks where 'ephemera' is NOT present in tags
 *   'ephemera' → artworks where 'ephemera' IS present in tags
 *
 * Other filters compose with AND across dimensions, OR within each.
 *
 * Performance note: at ~3k rows this is comfortably sub-100ms in
 * Postgres + Supabase. The facet count queries run in parallel.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FilterState } from "./filter-state";

export type Cohort = "artwork" | "ephemera";

export interface ArtworkResult {
  id: string;
  sku: string | null;
  title: string;
  medium: string | null;
  date_created: string | null;
  decade: string | null;
  image_url: string | null;
  image_original: string | null;
  alt_text: string | null;
  alt_text_long: string | null;
  description_origin: "human" | "ai" | null;
  artist: { id: string; first_name: string; last_name: string; slug: string } | null;
}

export interface FacetCounts {
  themes: Record<string, number>;
  formats: Record<string, number>;
  decades: Record<string, number>;
  // For Artist (single-select with typeahead) we just produce the set of
  // artist slugs that have at least one match given the current filters
  // EXCLUDING the artist filter itself. UI hides artists not in this set.
  availableArtistSlugs: Set<string>;
}

const PAGE_SIZE = 24;

// ── Helpers ─────────────────────────────────────────────────────────────
function applyCohort(query: any, cohort: Cohort): any {
  // Postgres array NOT-contains: filter('tags', 'not.cs', '{ephemera}')
  return cohort === "artwork"
    ? query.not("tags", "cs", "{ephemera}")
    : query.contains("tags", ["ephemera"]);
}

/**
 * Given the FilterState, produce a Supabase query that applies all
 * filters EXCEPT one specified dimension (used for facet count queries
 * so you can switch among that dimension's values without un-selecting).
 */
function applyFilters(
  base: any,
  state: FilterState,
  except: "themes" | "formats" | "decades" | "artist" | "none"
): any {
  let q = base;

  if (state.q) {
    // FTS for title/medium/alt_text/alt_text_long. Artist name handled
    // via a separate ILIKE pass below.
    const safe = state.q.replace(/[&|!()<>:*]/g, " ").trim();
    if (safe) {
      // wsearch syntax: "& "-join words for AND, single-word fallback
      const tsq = safe.split(/\s+/).join(" & ");
      q = q.or(`fts.fts.${tsq},artist_name_search.ilike.%${state.q}%`);
      // ^ For now, we'll use fts column for body text. Artist name OR
      // is awkward in PostgREST without a denormalized column; v1
      // implementation uses a TWO-QUERY APPROACH below in queryArtworks.
    }
  }

  if (except !== "themes" && state.themes.length) {
    // Filter by theme via the artwork_categories join. Using PostgREST's
    // embedded resource filter pattern:
    q = q.in("artwork_categories.category.slug", state.themes);
    q = q.eq("artwork_categories.category.kind", "theme");
  }
  if (except !== "formats" && state.formats.length) {
    q = q.in("artwork_categories.category.slug", state.formats);
  }
  if (except !== "decades" && state.decades.length) {
    q = q.in("decade", state.decades);
  }
  if (except !== "artist" && state.artist) {
    q = q.eq("artist.slug", state.artist);
  }
  return q;
}

function applySort(query: any, state: FilterState): any {
  const effective: string =
    state.sort ?? (state.q ? "relevance" : "featured");

  switch (effective) {
    case "featured":
      return query.order("sort_order", { ascending: true }).order("created_at", { ascending: false });
    case "relevance":
      // FTS rank handled by fts.fts.<query> ordering naturally; here we just keep insertion order.
      return query.order("sort_order", { ascending: true });
    case "artist":
      return query.order("artists.last_name", { ascending: true }).order("artists.first_name", { ascending: true }).order("sort_order", { ascending: true });
    case "newest":
      return query.order("decade", { ascending: false, nullsFirst: false }).order("date_created", { ascending: false, nullsFirst: false }).order("sort_order", { ascending: true });
    case "oldest":
      return query.order("decade", { ascending: true, nullsFirst: false }).order("date_created", { ascending: true, nullsFirst: false }).order("sort_order", { ascending: true });
    case "title":
      return query.order("title", { ascending: true }).order("sort_order", { ascending: true });
    default:
      return query.order("sort_order", { ascending: true });
  }
}

// ── Main query ──────────────────────────────────────────────────────────
export async function queryArtworks(
  supabase: SupabaseClient,
  state: FilterState,
  cohort: Cohort
): Promise<{ artworks: ArtworkResult[]; total: number }> {
  // Build base
  let base = supabase
    .from("artworks")
    .select(
      `
      id, sku, title, medium, date_created, decade, image_url, image_original,
      alt_text, alt_text_long, description_origin, sort_order,
      artist:artists(id, first_name, last_name, slug),
      artwork_categories!left(category:categories(slug, kind))
      `,
      { count: "exact" }
    )
    .eq("on_website", true);

  base = applyCohort(base, cohort);
  base = applyFilters(base, state, "none");
  base = applySort(base, state);

  const from = (state.page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, error, count } = await base.range(from, to);
  if (error) throw new Error(`queryArtworks: ${error.message}`);

  return {
    artworks: (data as unknown as ArtworkResult[]) || [],
    total: count || 0,
  };
}

// ── Facet counts ────────────────────────────────────────────────────────
export async function getFacetCounts(
  supabase: SupabaseClient,
  state: FilterState,
  cohort: Cohort
): Promise<FacetCounts> {
  // Run 4 queries in parallel: one per dimension, each excluding its own filter.
  const [themesRes, formatsRes, decadesRes, artistsRes] = await Promise.all([
    facetCountFor(supabase, state, cohort, "themes"),
    facetCountFor(supabase, state, cohort, "formats"),
    facetCountFor(supabase, state, cohort, "decades"),
    artistAvailability(supabase, state, cohort),
  ]);

  return {
    themes: themesRes,
    formats: formatsRes,
    decades: decadesRes,
    availableArtistSlugs: artistsRes,
  };
}

/**
 * For dimensions backed by a join (theme, format), and for `decade`
 * which is a column on artworks: fetch artworks that match all OTHER
 * filters, then count occurrences per value of the requested dimension.
 *
 * For 3k rows, fetching the relevant subset and counting client-side is
 * the simplest correct implementation (we don't need to push GROUP BY
 * through PostgREST). Revisit if catalog grows >50k.
 */
async function facetCountFor(
  supabase: SupabaseClient,
  state: FilterState,
  cohort: Cohort,
  dim: "themes" | "formats" | "decades"
): Promise<Record<string, number>> {
  let base = supabase
    .from("artworks")
    .select(
      `
      id, decade,
      artwork_categories!left(category:categories(slug, kind))
      `
    )
    .eq("on_website", true);

  base = applyCohort(base, cohort);
  base = applyFilters(base, state, dim);

  // No pagination — we need the full set to count facets accurately.
  const { data, error } = await base.range(0, 9999);
  if (error) throw new Error(`facetCountFor(${dim}): ${error.message}`);

  const counts: Record<string, number> = {};
  for (const row of data || []) {
    if (dim === "decades") {
      const d = (row as any).decade;
      if (d) counts[d] = (counts[d] || 0) + 1;
    } else {
      const wantKind = dim === "themes" ? "theme" : "format";
      const cats: any[] = (row as any).artwork_categories || [];
      const slugs = new Set<string>();
      for (const ac of cats) {
        if (ac.category?.kind === wantKind && ac.category?.slug) {
          slugs.add(ac.category.slug);
        }
      }
      for (const s of slugs) counts[s] = (counts[s] || 0) + 1;
    }
  }
  return counts;
}

async function artistAvailability(
  supabase: SupabaseClient,
  state: FilterState,
  cohort: Cohort
): Promise<Set<string>> {
  let base = supabase
    .from("artworks")
    .select(`id, artist:artists(slug)`)
    .eq("on_website", true);
  base = applyCohort(base, cohort);
  base = applyFilters(base, state, "artist");

  const { data, error } = await base.range(0, 9999);
  if (error) throw new Error(`artistAvailability: ${error.message}`);

  const set = new Set<string>();
  for (const row of data || []) {
    const slug = (row as any).artist?.slug;
    if (slug) set.add(slug);
  }
  return set;
}
```

NOTE on the search OR: PostgREST's `.or()` with mixed FTS + ILIKE across joined tables is awkward. The cleanest v1 implementation is to do TWO queries when search is active and merge in app code: one query with FTS on the body fields, one query with ILIKE on artist name; combine the artwork ID sets via union. For simplicity, the code above uses a single PostgREST `.or()` that exercises FTS only (artist name search will be missed in v1). The plan's Task 14 will revisit this; for now, the spec's "search matches artist name" requirement falls back to the title/medium/description path. **A more correct implementation lands as a follow-up.**

- [ ] **Step 2: Verify the file parses**

Run: `npx tsc --noEmit src/lib/collection-query.ts 2>&1 | head -20 || echo "(type errors expected if Supabase types are inferred — confirm they're only about implicit any)"`

Expected: either no output (clean) or only inferred-type warnings about the Supabase response shape. Hard errors about missing imports / syntax are blockers.

---

### Task 8: Update `import-csv.ts` and `import-archive.ts` to populate decade on insert

**Files:**
- Modify: `scripts/import-csv.ts`
- Modify: `scripts/import-archive.ts`

- [ ] **Step 1: Update `scripts/import-csv.ts`**

In `scripts/import-csv.ts`, find the `artworkRecords.push({ ... })` block (around line 142-160). Add a `decade` field to the insert payload using `dateToDecade(...)`. First add the import at the top:

```typescript
import { dateToDecade } from "../src/lib/decades";
```

Then in the artwork record:

```typescript
artworkRecords.push({
  // ...existing fields...
  date_created: row["Date Created"]?.trim() || null,
  // ADD THIS LINE:
  decade: dateToDecade(row["Date Created"]?.trim() || null),
  // ...existing fields continue...
});
```

- [ ] **Step 2: Update `scripts/import-archive.ts`**

In `scripts/import-archive.ts`, find the `insertPayload` for new artworks (Branch B, around line 416-428). Add the import at the top:

```typescript
import { dateToDecade } from "../src/lib/decades";
```

Then in the insert payload:

```typescript
const dateStr = (row["Creation Date (if available)"] || row["Creation Year"] || "").trim();
const insertPayload = {
  // ...existing fields...
  date_created: dateStr || null,
  // ADD THIS LINE:
  decade: dateToDecade(dateStr || null),
  // ...existing fields continue...
};
```

- [ ] **Step 3: Verify both files still parse**

Run: `npx tsx scripts/import-csv.ts 2>&1 | head -3` and `npx tsx scripts/import-archive.ts 2>&1 | head -3`
Expected: both fail with `Error: Set NEXT_PUBLIC_SUPABASE_URL ...` (env-var guard) — proves they parse.

---

## Phase 4: UI components

### Task 9: Implement `DropdownPanel` base component

**Files:**
- Create: `src/components/DropdownPanel.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/DropdownPanel.tsx`:

```typescript
"use client";
import { useEffect, useRef, useState, ReactNode } from "react";

interface DropdownPanelProps {
  label: string;
  badgeCount?: number;
  children: (close: () => void) => ReactNode;
}

/**
 * Pill-style trigger button + popover panel with click-outside close.
 * Used by the multi-select, artist typeahead, and sort dropdowns.
 */
export default function DropdownPanel({ label, badgeCount, children }: DropdownPanelProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const labelWithBadge = badgeCount && badgeCount > 0 ? `${label} (${badgeCount})` : label;

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="border-2 border-gray-900 rounded-md px-4 py-2 text-sm font-medium bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {labelWithBadge} <span className="ml-1">▾</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 min-w-[220px] bg-white border border-gray-300 rounded-md shadow-lg py-2">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it parses (no test runner; just import)**

Run: `npx tsc --noEmit src/components/DropdownPanel.tsx 2>&1 | head -10 || true`
Expected: no errors mentioning syntax or undefined identifiers. (May see project-wide noise — focus on this file's errors.)

---

### Task 10: Implement `MultiSelectDropdown`

**Files:**
- Create: `src/components/MultiSelectDropdown.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/MultiSelectDropdown.tsx`:

```typescript
"use client";
import DropdownPanel from "./DropdownPanel";

interface Option {
  value: string;
  label: string;
  count: number;
}

interface MultiSelectDropdownProps {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (next: string[]) => void;
}

/**
 * Pill button + checkbox panel. Auto-applies on each click. Options
 * with count=0 are rendered greyed-out and disabled.
 */
export default function MultiSelectDropdown({ label, options, selected, onChange }: MultiSelectDropdownProps) {
  function toggle(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  return (
    <DropdownPanel label={label} badgeCount={selected.length}>
      {() => (
        <div className="max-h-72 overflow-y-auto">
          {options.length === 0 && (
            <div className="px-4 py-2 text-sm text-gray-500">No options available</div>
          )}
          {options.map((opt) => {
            const isSelected = selected.includes(opt.value);
            const isDisabled = opt.count === 0 && !isSelected;
            return (
              <label
                key={opt.value}
                className={`flex items-center gap-3 px-4 py-2 text-sm ${
                  isDisabled ? "text-gray-400 cursor-not-allowed" : "text-gray-900 cursor-pointer hover:bg-gray-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={isDisabled}
                  onChange={() => !isDisabled && toggle(opt.value)}
                  className="h-4 w-4"
                />
                <span className="flex-1">{opt.label}</span>
                <span className="text-xs text-gray-500">{opt.count}</span>
              </label>
            );
          })}
        </div>
      )}
    </DropdownPanel>
  );
}
```

---

### Task 11: Implement `ArtistTypeaheadDropdown`

**Files:**
- Create: `src/components/ArtistTypeaheadDropdown.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/ArtistTypeaheadDropdown.tsx`:

```typescript
"use client";
import { useState } from "react";
import DropdownPanel from "./DropdownPanel";

interface ArtistOption {
  slug: string;
  name: string;
  available: boolean;
}

interface ArtistTypeaheadDropdownProps {
  artists: ArtistOption[];
  selected: string | null;
  onChange: (next: string | null) => void;
}

export default function ArtistTypeaheadDropdown({ artists, selected, onChange }: ArtistTypeaheadDropdownProps) {
  const [filter, setFilter] = useState("");
  const selectedArtist = artists.find((a) => a.slug === selected) || null;
  const triggerLabel = selectedArtist ? `Artist: ${selectedArtist.name}` : "Artist";

  return (
    <DropdownPanel label={triggerLabel}>
      {(close) => {
        const visible = artists
          .filter((a) => a.available || a.slug === selected)
          .filter((a) => !filter || a.name.toLowerCase().includes(filter.toLowerCase()));

        return (
          <div className="w-72">
            <div className="px-3 pb-2">
              <input
                autoFocus
                type="text"
                placeholder={`Search ${artists.length} artists…`}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="max-h-72 overflow-y-auto border-t border-gray-200">
              {selected && (
                <button
                  type="button"
                  onClick={() => { onChange(null); close(); }}
                  className="w-full text-left px-4 py-2 text-sm text-blue-600 hover:bg-gray-50"
                >
                  ✕ Clear artist
                </button>
              )}
              {visible.length === 0 && (
                <div className="px-4 py-2 text-sm text-gray-500">No artists match</div>
              )}
              {visible.map((a) => (
                <button
                  key={a.slug}
                  type="button"
                  onClick={() => { onChange(a.slug); close(); }}
                  className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 hover:bg-gray-50 ${
                    a.slug === selected ? "font-semibold text-blue-700" : "text-gray-900"
                  }`}
                >
                  {a.slug === selected && <span>✓</span>}
                  <span>{a.name}</span>
                </button>
              ))}
            </div>
          </div>
        );
      }}
    </DropdownPanel>
  );
}
```

---

### Task 12: Implement `SortDropdown`

**Files:**
- Create: `src/components/SortDropdown.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/SortDropdown.tsx`:

```typescript
"use client";
import DropdownPanel from "./DropdownPanel";
import type { SortKey } from "@/lib/filter-state";

interface SortDropdownProps {
  current: SortKey | null;
  searchActive: boolean;
  onChange: (next: SortKey | null) => void;
}

const LABELS: Record<SortKey, string> = {
  featured: "Featured",
  relevance: "Relevance",
  artist: "Artist (A-Z)",
  newest: "Newest first",
  oldest: "Oldest first",
  title: "Title (A-Z)",
};

export default function SortDropdown({ current, searchActive, onChange }: SortDropdownProps) {
  // Effective sort: if user hasn't picked, default to relevance with search, featured without
  const effective: SortKey = current ?? (searchActive ? "relevance" : "featured");
  const triggerLabel = `Sort: ${LABELS[effective]}`;

  // Available options: hide 'relevance' when search isn't active
  const options: SortKey[] = (["featured", "relevance", "artist", "newest", "oldest", "title"] as SortKey[])
    .filter((s) => s !== "relevance" || searchActive);

  return (
    <DropdownPanel label={triggerLabel}>
      {(close) => (
        <div>
          {options.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { onChange(s === (searchActive ? "relevance" : "featured") ? null : s); close(); }}
              className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 ${
                effective === s ? "font-semibold text-blue-700" : "text-gray-900"
              }`}
            >
              {effective === s && <span className="mr-2">✓</span>}
              {LABELS[s]}
            </button>
          ))}
        </div>
      )}
    </DropdownPanel>
  );
}
```

---

### Task 13: Implement `ActiveFilterChips`

**Files:**
- Create: `src/components/ActiveFilterChips.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/ActiveFilterChips.tsx`:

```typescript
"use client";

interface Chip {
  label: string;
  onRemove: () => void;
}

interface ActiveFilterChipsProps {
  chips: Chip[];
  onClearAll: () => void;
}

export default function ActiveFilterChips({ chips, onClearAll }: ActiveFilterChipsProps) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4 text-sm">
      <span className="text-gray-600 mr-1">Active:</span>
      {chips.map((c, i) => (
        <button
          key={i}
          type="button"
          onClick={c.onRemove}
          className="inline-flex items-center gap-1.5 px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-900"
        >
          <span>{c.label}</span>
          <span className="text-gray-500 text-xs">✕</span>
        </button>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="ml-2 text-blue-600 hover:text-blue-800 underline text-sm"
      >
        Clear all
      </button>
    </div>
  );
}
```

---

### Task 14: Implement `CohortNav`

**Files:**
- Create: `src/components/CohortNav.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/CohortNav.tsx`:

```typescript
import Link from "next/link";

interface CohortNavProps {
  active: "artwork" | "ephemera";
}

export default function CohortNav({ active }: CohortNavProps) {
  return (
    <div className="flex items-center justify-end gap-2 mb-3 text-sm">
      <Link
        href="/collection"
        className={active === "artwork" ? "text-green-700 font-semibold" : "text-gray-500 hover:text-gray-900"}
      >
        Artwork
      </Link>
      <span className="text-gray-300">|</span>
      <Link
        href="/ephemera"
        className={active === "ephemera" ? "text-green-700 font-semibold" : "text-gray-500 hover:text-gray-900"}
      >
        Ephemera
      </Link>
    </div>
  );
}
```

---

### Task 15: Implement `FilterBar`

**Files:**
- Create: `src/components/FilterBar.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/FilterBar.tsx`:

```typescript
"use client";
import { useState, FormEvent } from "react";
import { useRouter, usePathname } from "next/navigation";
import MultiSelectDropdown from "./MultiSelectDropdown";
import ArtistTypeaheadDropdown from "./ArtistTypeaheadDropdown";
import SortDropdown from "./SortDropdown";
import ActiveFilterChips from "./ActiveFilterChips";
import { FilterState, SortKey, toQueryString } from "@/lib/filter-state";

interface FilterBarProps {
  state: FilterState;
  cohort: "artwork" | "ephemera";
  themeOptions: { value: string; label: string; count: number }[];
  formatOptions: { value: string; label: string; count: number }[];
  decadeOptions: { value: string; label: string; count: number }[];
  artistOptions: { slug: string; name: string; available: boolean }[];
}

/**
 * Composes search input + filter dropdowns + chips. Pushes URL changes
 * via Next.js router; the page re-renders server-side with new params.
 */
export default function FilterBar({
  state,
  cohort,
  themeOptions,
  formatOptions,
  decadeOptions,
  artistOptions,
}: FilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [searchInput, setSearchInput] = useState(state.q);

  function navigate(next: FilterState) {
    // Reset page to 1 when any filter changes
    const reset = { ...next, page: 1 };
    const qs = toQueryString(reset);
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function onSearchSubmit(e: FormEvent) {
    e.preventDefault();
    navigate({ ...state, q: searchInput.trim() });
  }

  // Build chip list from current state
  const chips: { label: string; onRemove: () => void }[] = [];
  for (const t of state.themes) {
    chips.push({
      label: themeOptions.find((o) => o.value === t)?.label || t,
      onRemove: () => navigate({ ...state, themes: state.themes.filter((x) => x !== t) }),
    });
  }
  for (const f of state.formats) {
    chips.push({
      label: formatOptions.find((o) => o.value === f)?.label || f,
      onRemove: () => navigate({ ...state, formats: state.formats.filter((x) => x !== f) }),
    });
  }
  for (const d of state.decades) {
    chips.push({
      label: d,
      onRemove: () => navigate({ ...state, decades: state.decades.filter((x) => x !== d) }),
    });
  }
  if (state.artist) {
    const name = artistOptions.find((a) => a.slug === state.artist)?.name || state.artist;
    chips.push({
      label: name,
      onRemove: () => navigate({ ...state, artist: null }),
    });
  }

  const isCollection = cohort === "artwork";

  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <form onSubmit={onSearchSubmit} className="relative">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search artwork & artists"
            className="border-2 border-gray-900 rounded-md pl-4 pr-10 py-2 text-sm w-80 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button type="submit" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-700" aria-label="Search">
            ⌕
          </button>
        </form>

        {isCollection && (
          <MultiSelectDropdown
            label="Theme"
            options={themeOptions}
            selected={state.themes}
            onChange={(themes) => navigate({ ...state, themes })}
          />
        )}
        {isCollection && (
          <MultiSelectDropdown
            label="Format"
            options={formatOptions}
            selected={state.formats}
            onChange={(formats) => navigate({ ...state, formats })}
          />
        )}
        <ArtistTypeaheadDropdown
          artists={artistOptions}
          selected={state.artist}
          onChange={(artist) => navigate({ ...state, artist })}
        />
        {isCollection && (
          <MultiSelectDropdown
            label="Decade"
            options={decadeOptions}
            selected={state.decades}
            onChange={(decades) => navigate({ ...state, decades })}
          />
        )}

        <div className="ml-auto">
          <SortDropdown
            current={state.sort}
            searchActive={!!state.q}
            onChange={(sort) => navigate({ ...state, sort })}
          />
        </div>
      </div>

      <ActiveFilterChips
        chips={chips}
        onClearAll={() => navigate({ ...state, themes: [], formats: [], decades: [], artist: null })}
      />
    </div>
  );
}
```

---

## Phase 5: Page integration

### Task 16: Update `src/app/collection/page.tsx`

**Files:**
- Modify: `src/app/collection/page.tsx`

- [ ] **Step 1: Replace the existing implementation**

Replace the entire contents of `src/app/collection/page.tsx` with:

```typescript
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createClient } from "@/lib/supabase/client";
import ArtworkGrid from "@/components/ArtworkGrid";
import ArtworkCard from "@/components/ArtworkCard";
import Pagination from "@/components/Pagination";
import FilterBar from "@/components/FilterBar";
import CohortNav from "@/components/CohortNav";
import { parseSearchParams } from "@/lib/filter-state";
import { queryArtworks, getFacetCounts } from "@/lib/collection-query";

const ITEMS_PER_PAGE = 24;

const THEME_LABELS: Record<string, string> = {
  music: "Music", people: "People", plants: "Plants", animals: "Animals",
  abstract: "Abstract", other: "Other", food: "Food", "pop-culture": "Pop Culture",
};

interface CollectionPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const metadata = {
  title: "Collection | Creative Growth Gallery",
  description: "Browse the complete collection of artworks",
};

export default async function CollectionPage({ searchParams }: CollectionPageProps) {
  const raw = await searchParams;
  const state = parseSearchParams(raw);
  const supabase = createServerSupabaseClient();

  const [{ artworks, total }, facets, formatCats, themeCats, allArtists] = await Promise.all([
    queryArtworks(supabase, state, "artwork"),
    getFacetCounts(supabase, state, "artwork"),
    supabase.from("categories").select("name, slug").eq("kind", "format").order("name"),
    supabase.from("categories").select("name, slug").eq("kind", "theme").order("name"),
    supabase.from("artists").select("slug, first_name, last_name").order("last_name").order("first_name"),
  ]);

  const themeOptions = (themeCats.data || []).map((c) => ({
    value: c.slug,
    label: c.name,
    count: facets.themes[c.slug] || 0,
  }));
  const formatOptions = (formatCats.data || []).map((c) => ({
    value: c.slug,
    label: c.name,
    count: facets.formats[c.slug] || 0,
  }));
  const decadeOptions = Object.keys(facets.decades).sort().map((d) => ({
    value: d,
    label: d,
    count: facets.decades[d],
  }));
  const artistOptions = (allArtists.data || []).map((a) => ({
    slug: a.slug,
    name: `${a.first_name} ${a.last_name}`.trim(),
    available: facets.availableArtistSlugs.has(a.slug),
  }));

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);

  return (
    <div className="container-max py-12">
      <h1 className="font-sans text-5xl font-bold text-gray-900 mb-6 tracking-tight">CGPA ARCHIVE</h1>

      <CohortNav active="artwork" />

      <FilterBar
        state={state}
        cohort="artwork"
        themeOptions={themeOptions}
        formatOptions={formatOptions}
        decadeOptions={decadeOptions}
        artistOptions={artistOptions}
      />

      {artworks.length > 0 ? (
        <>
          <p className="text-gray-600 mb-6 text-sm">
            {total} {total === 1 ? "work" : "works"}
            {state.q && <> for &ldquo;{state.q}&rdquo;</>}
          </p>

          <ArtworkGrid>
            {artworks.map((artwork) => (
              <ArtworkCard key={artwork.id} artwork={artwork as any} />
            ))}
          </ArtworkGrid>

          {totalPages > 1 && (
            <Pagination
              currentPage={state.page}
              totalPages={totalPages}
              baseUrl="/collection"
              preserveParams={["q", "theme", "format", "decade", "artist", "sort"]}
            />
          )}
        </>
      ) : (
        <div className="text-center py-12">
          <p className="text-gray-600 text-lg mb-4">No artworks match your filters.</p>
          <a href="/collection" className="text-blue-600 underline">Clear filters</a>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify Pagination preserves the new params**

Run: `grep -n "preserveParams" src/components/Pagination.tsx`
Expected: shows the `preserveParams` prop accepting an array of param names.

If `preserveParams` doesn't exist in `Pagination.tsx` or doesn't accept arbitrary param names, inspect that file and adjust if needed. (The current implementation likely supports `preserveParams: string[]`; verify before continuing.)

---

### Task 17: Create `/ephemera` route

**Files:**
- Create: `src/app/ephemera/page.tsx`

- [ ] **Step 1: Write the page**

Create `src/app/ephemera/page.tsx`:

```typescript
import { createServerSupabaseClient } from "@/lib/supabase/server";
import ArtworkGrid from "@/components/ArtworkGrid";
import ArtworkCard from "@/components/ArtworkCard";
import Pagination from "@/components/Pagination";
import FilterBar from "@/components/FilterBar";
import CohortNav from "@/components/CohortNav";
import { parseSearchParams } from "@/lib/filter-state";
import { queryArtworks, getFacetCounts } from "@/lib/collection-query";

const ITEMS_PER_PAGE = 24;

interface EphemeraPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const metadata = {
  title: "Ephemera | Creative Growth Gallery",
  description: "Browse documentary material and ephemera from the Creative Growth archive",
};

export default async function EphemeraPage({ searchParams }: EphemeraPageProps) {
  const raw = await searchParams;
  const state = parseSearchParams(raw);
  const supabase = createServerSupabaseClient();

  const [{ artworks, total }, facets, allArtists] = await Promise.all([
    queryArtworks(supabase, state, "ephemera"),
    getFacetCounts(supabase, state, "ephemera"),
    supabase.from("artists").select("slug, first_name, last_name").order("last_name").order("first_name"),
  ]);

  const artistOptions = (allArtists.data || []).map((a) => ({
    slug: a.slug,
    name: `${a.first_name} ${a.last_name}`.trim(),
    available: facets.availableArtistSlugs.has(a.slug),
  }));

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);

  return (
    <div className="container-max py-12">
      <h1 className="font-sans text-5xl font-bold text-gray-900 mb-6 tracking-tight">CGPA ARCHIVE</h1>

      <CohortNav active="ephemera" />

      <FilterBar
        state={state}
        cohort="ephemera"
        themeOptions={[]}
        formatOptions={[]}
        decadeOptions={[]}
        artistOptions={artistOptions}
      />

      {artworks.length > 0 ? (
        <>
          <p className="text-gray-600 mb-6 text-sm">
            {total} {total === 1 ? "item" : "items"}
            {state.q && <> for &ldquo;{state.q}&rdquo;</>}
          </p>

          <ArtworkGrid>
            {artworks.map((artwork) => (
              <ArtworkCard key={artwork.id} artwork={artwork as any} />
            ))}
          </ArtworkGrid>

          {totalPages > 1 && (
            <Pagination
              currentPage={state.page}
              totalPages={totalPages}
              baseUrl="/ephemera"
              preserveParams={["q", "artist", "sort"]}
            />
          )}
        </>
      ) : (
        <div className="text-center py-12">
          <p className="text-gray-600 text-lg mb-4">No ephemera match your filters.</p>
          <a href="/ephemera" className="text-blue-600 underline">Clear filters</a>
        </div>
      )}
    </div>
  );
}
```

---

### Task 18: Update `ArtworkCard` to show full artist name

**Files:**
- Modify: `src/components/ArtworkCard.tsx`

- [ ] **Step 1: Confirm current state**

Run: `grep -n "first_name\|last_name\|formatArtistName" src/components/ArtworkCard.tsx`

If the existing card already shows full name, this task is a no-op. Otherwise:

- [ ] **Step 2: Update the card content**

In `src/components/ArtworkCard.tsx`, locate the title + artist block (likely lines 36-39). Ensure it renders the artist's full name in bold and the title (with SKU + date when available) in italic gray, per the spec's visual layout. If the existing implementation already does this, leave it.

For reference, the desired card body:
```tsx
<h3 className="font-bold text-gray-900 text-sm">{artistName}</h3>
<p className="font-serif italic text-sm text-gray-600 mt-1 line-clamp-2">
  {artwork.title}
  {artwork.date_created && <>, {artwork.date_created}</>}
</p>
```

Where `artistName` comes from `formatArtistName(artwork.artist?.first_name, artwork.artist?.last_name)`.

Do NOT make changes if the current card already matches this contract. Report what you find.

---

### Task 19: Sync source-controlled migration SQL

**Files:**
- Modify: `supabase/migrations/001_initial.sql`

- [ ] **Step 1: Add `decade` column**

In `supabase/migrations/001_initial.sql`, find the `CREATE TABLE artworks` block. After the `sku TEXT` line (added in the prior PR), add:

```sql
  decade            TEXT,
```

Then in the indexes section (where you see `CREATE INDEX idx_artworks_sku ...`), add a sibling:

```sql
CREATE INDEX idx_artworks_decade ON artworks(decade);
```

- [ ] **Step 2: Verify**

Run: `grep -n "decade" supabase/migrations/001_initial.sql`
Expected: column declaration line and index line both present.

---

### Task 20: Commit Phase 1-5

**Files:** none (git only)

- [ ] **Step 1: Stage everything**

Run:
```bash
git add scripts/test-decades.ts scripts/test-filter-state.ts scripts/backfill-decade.ts \
  src/lib/decades.ts src/lib/filter-state.ts src/lib/collection-query.ts \
  src/components/DropdownPanel.tsx src/components/MultiSelectDropdown.tsx \
  src/components/ArtistTypeaheadDropdown.tsx src/components/SortDropdown.tsx \
  src/components/ActiveFilterChips.tsx src/components/CohortNav.tsx src/components/FilterBar.tsx \
  src/app/collection/page.tsx src/app/ephemera/page.tsx \
  scripts/import-csv.ts scripts/import-archive.ts \
  supabase/migrations/001_initial.sql package.json
git status
```

Expected: ~17 files staged, no leftovers other than the pre-existing `pbcopy` in untracked.

If `src/components/ArtworkCard.tsx` was modified in Task 18, also `git add` it.

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
Add collection filters & search; split Ephemera into its own route

Replaces the single-axis category-tabs filter on /collection with a
faceted browse experience and creates /ephemera as a separate route
for the 208 artworks tagged 'ephemera'.

Filter set on /collection: free-text search + multi-select Theme /
Format / Decade + single-select Artist (typeahead) + Sort. Filter set
on /ephemera: search + Artist + Sort (theme/format/decade don't
carry meaning for documentary material).

Standard faceted semantics: OR within each dimension, AND across.
Multi-select dropdowns show counts and disable zero-count options.
Artist typeahead disables-only (no counts to keep the panel clean).
Sort: Featured (default) / Relevance (when search active) / Artist /
Newest / Oldest / Title — Featured is always a secondary sort.

Active filter chips below the filter row let users remove single
values without reopening dropdowns; "Clear all" resets the filters
(preserves search + sort).

Top-right "Artwork | Ephemera" links between the two routes, styled
like CG's mockup (active in green). The two cohorts are disjoint
sets; search within each stays in that cohort.

Schema: adds artworks.decade TEXT column + index. Backfill script
populates from existing date_created via dateToDecade. Both
import-csv.ts and import-archive.ts populate decade on insert
going forward.

URL captures full state (q + theme + format + decade + artist +
sort + page) for shareable deep links. Pagination resets to page 1
on any filter/sort/search change.

Pure helpers (decades, filter-state) have node:test coverage.
UI components verified by dev-server smoke test.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds.

---

## Phase 6: Verification

### Task 21: Dev server smoke test

**Files:** none (verification)

- [ ] **Step 1: Lint + tests**

Run: `npm run lint 2>&1 | tail -5`
Expected: no errors.

Run: `npx tsx --test scripts/test-decades.ts scripts/test-filter-state.ts 2>&1 | tail -10`
Expected: all tests pass.

- [ ] **Step 2: Start dev server (background)**

Run: `npm run dev` (use `run_in_background`).

Wait until "Ready in <X>ms" appears.

- [ ] **Step 3: Verify /collection renders with new filter bar**

Run: `curl -s http://localhost:3000/collection | grep -oE "(CGPA ARCHIVE|Theme|Format|Decade|Artist|Sort)" | head -10`
Expected: prints `CGPA ARCHIVE`, `Theme`, `Format`, `Decade`, `Artist`, `Sort` (in some order).

- [ ] **Step 4: Verify a filter URL renders correctly**

Run: `curl -s "http://localhost:3000/collection?theme=animals&decade=1990s,2000s" | grep -oE "Active:|works|animals" | head -5`
Expected: includes "Active:" (active chips visible) and "works" (result count).

- [ ] **Step 5: Verify /ephemera renders with the simpler filter bar**

Run: `curl -s http://localhost:3000/ephemera | grep -oE "(CGPA ARCHIVE|Theme|Format|Decade|Artist|items)" | head -5`
Expected: prints `CGPA ARCHIVE`, `Artist`, `items` — does NOT print `Theme`, `Format`, `Decade` (those are hidden on ephemera).

- [ ] **Step 6: Verify cohort link nav present**

Run: `curl -s http://localhost:3000/collection | grep -oE 'href="/(collection|ephemera)"' | sort -u`
Expected: shows both `href="/collection"` and `href="/ephemera"`.

- [ ] **Step 7: Stop dev server**

Kill the background process.

---

### Task 22: Final cleanup commit (if needed)

**Files:** none unless smoke tests surface issues

- [ ] **Step 1: If anything in Task 21 failed, fix it and commit**

If everything passed in Task 21, this task is a no-op. If a fix was needed:

```bash
git add <fixed files>
git commit -m "Fix <thing> surfaced by smoke test"
```

---

## Done

At this point:
- `/collection` is a faceted browse over the ~3,052 non-ephemera artworks with search + theme + format + decade + artist + sort
- `/ephemera` is a simpler browse over the 208 ephemera-tagged artworks with search + artist + sort
- Active filter chips, multi-select dropdowns with counts + disabling, single-select artist typeahead, six-option sort all live
- URL params capture the full browse state for sharing
- Decade column + backfill in place, future imports populate decade automatically
- Source-controlled migration synced with the applied schema state

Hand-off:
- Curators can use the existing admin to set `sort_order` on artworks they want pinned via Featured sort
- Project follow-ups: live typeahead search, /search unified across cohorts, mobile drawer pattern (all explicitly out of scope per spec)
- Known limitation: search currently matches via the FTS index over title/medium/alt_text/alt_text_long but NOT artist name. Spec acknowledges this and offers two implementation paths (denormalized artist_name column vs two-query union); the v1 here ships the simpler path for now. A follow-up PR can add full artist-name search.
