/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Collection / Ephemera query builder.
 *
 * Filter strategy by dimension:
 *   - Cohort, on_website, search (FTS), decade, artist: applied inline
 *     on the main query — small, indexed, fast.
 *   - Exactly one category dim active (theme XOR format XOR medium):
 *     embedded INNER join + `.eq()` / `.in()` on the embedded path.
 *     PostgREST INNER JOIN filters the parent rows correctly.
 *   - ≥2 category dims active: pre-resolve the intersected artwork-id
 *     set via `categoryFilteredIds`, then `.in("id", ids)`. The
 *     intersection is bounded by min(active-dim populations), which is
 *     small enough to fit comfortably in a PostgREST URL.
 *   - We avoid `.in("id", hugeSet)` patterns (e.g., 1,400-id Drawings
 *     filter), which exceed PostgREST's URI length limit.
 *
 * Filters compose with AND across dimensions, OR within each.
 *
 * Cohort:
 *   'artwork'  → tags does NOT contain 'ephemera'
 *   'ephemera' → tags contains 'ephemera'
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
  mediums: Record<string, number>;
  decades: Record<string, number>;
  availableArtistSlugs: Set<string>;
}

const PAGE_SIZE = 24;
const FETCH_PAGE = 1000;

type ExceptDim = "themes" | "formats" | "mediums" | "decades" | "artist" | "q" | "none";

/**
 * Page through all matching rows. PostgREST has a default `max-rows`
 * limit of 1,000 per request, so a single `.range(0, 9999)` silently
 * truncates. The caller passes a builder factory because Supabase
 * query builders are single-use.
 */
async function fetchAllRows<T>(buildQuery: () => any): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  while (true) {
    const q = buildQuery().range(offset, offset + FETCH_PAGE - 1);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < FETCH_PAGE) break;
    offset += FETCH_PAGE;
  }
  return all;
}

// ─── Cohort + artist resolution ─────────────────────────────────────────
function applyCohort(query: any, cohort: Cohort): any {
  // For 'artwork' we include rows with NULL tags too — Postgres's
  // NOT(NULL @> '{ephemera}') is NULL, not TRUE, so a plain
  // .not("tags", "cs", ...) would drop them.
  return cohort === "artwork"
    ? query.or("tags.is.null,tags.not.cs.{ephemera}")
    : query.contains("tags", ["ephemera"]);
}

async function resolveArtistId(
  supabase: SupabaseClient,
  slug: string | null
): Promise<string | null> {
  if (!slug) return null;
  const { data, error } = await supabase
    .from("artists")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data) return null;
  return data.id;
}

/**
 * Resolve themes + formats + mediums to the intersected set of artwork IDs
 * that satisfy all active dimensions. Used only when ≥2 dimensions are active.
 */
async function categoryFilteredIds(
  supabase: SupabaseClient,
  themes: string[],
  formats: string[],
  mediums: string[]
): Promise<string[]> {
  async function idsFor(slugs: string[], kind: "theme" | "format" | "medium"): Promise<Set<string>> {
    if (slugs.length === 0) return new Set();
    const rows = await fetchAllRows<{ artwork_id: string }>(() =>
      supabase
        .from("artwork_categories")
        .select("artwork_id, category:categories!inner(slug, kind)")
        .eq("category.kind", kind)
        .in("category.slug", slugs)
    );
    return new Set(rows.map((r: any) => r.artwork_id));
  }

  const [themeIds, formatIds, mediumIds] = await Promise.all([
    idsFor(themes, "theme"),
    idsFor(formats, "format"),
    idsFor(mediums, "medium"),
  ]);

  // Intersect only the active sets; an inactive dim doesn't constrain.
  const sets: Set<string>[] = [];
  if (themes.length > 0) sets.push(themeIds);
  if (formats.length > 0) sets.push(formatIds);
  if (mediums.length > 0) sets.push(mediumIds);
  if (sets.length === 0) return []; // shouldn't be called in this case
  if (sets.length === 1) return [...sets[0]];
  // Iterate the smallest set; cost is O(|smallest| * (sets.length - 1)) lookups.
  sets.sort((a, b) => a.size - b.size);
  return [...sets[0]].filter((id) => sets.slice(1).every((s) => s.has(id)));
}

// ─── Scalar + category filter application (sync; no thenable trap) ──────
function applyScalarFilters(
  query: any,
  state: FilterState,
  cohort: Cohort,
  artistId: string | null,
  except: ExceptDim
): any {
  let q = query.eq("on_website", true);
  q = applyCohort(q, cohort);

  if (except !== "q" && state.q) {
    // Strip tsquery operators and the comma we use as the .or()
    // clause separator below.
    const safe = state.q.replace(/[&|!()<>:*,]/g, " ").trim();
    if (safe) {
      const tsq = safe.split(/\s+/).join(" & ");
      // Match either the FTS index (title / medium / alt_text /
      // alt_text_long) OR an SKU substring. SKU isn't in the
      // tsvector and visitors often paste "NS 399"-style codes
      // straight into the search box.
      q = q.or(`fts.fts.${tsq},sku.ilike.%${safe}%`);
    }
  }
  if (except !== "decades" && state.decades.length) {
    q = q.in("decade", state.decades);
  }
  if (except !== "artist" && state.artist) {
    if (artistId) {
      q = q.eq("artist_id", artistId);
    } else {
      q = q.eq("id", "00000000-0000-0000-0000-000000000000");
    }
  }
  return q;
}

function applySingleDimEmbeddedFilter(
  q: any,
  themes: string[],
  formats: string[],
  mediums: string[]
): any {
  if (themes.length > 0) {
    return q
      .eq("artwork_categories.category.kind", "theme")
      .in("artwork_categories.category.slug", themes);
  }
  if (formats.length > 0) {
    return q
      .eq("artwork_categories.category.kind", "format")
      .in("artwork_categories.category.slug", formats);
  }
  if (mediums.length > 0) {
    return q
      .eq("artwork_categories.category.kind", "medium")
      .in("artwork_categories.category.slug", mediums);
  }
  return q;
}

function buildSelect(hasCategoryEmbed: boolean, fields: "rich" | "id"): string {
  const richFields = `id, sku, title, medium, date_created, decade, image_url, image_original, alt_text, alt_text_long, description_origin, sort_order, artist:artists(id, first_name, last_name, slug)`;
  const base = fields === "rich" ? richFields : "id";
  if (!hasCategoryEmbed) return base;
  return `${base}, artwork_categories!inner(category:categories!inner(slug, kind))`;
}

// ─── Sort ───────────────────────────────────────────────────────────────
function applySort(query: any, state: FilterState): any {
  const effective: string = state.sort ?? (state.q ? "relevance" : "featured");

  switch (effective) {
    case "featured":
      return query
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });
    case "relevance":
      // Postgres FTS rank ordering would need an explicit function call;
      // v1 falls through to insertion-order. Worth revisiting.
      return query.order("sort_order", { ascending: true });
    case "artist":
      // PostgREST syntax for ordering PARENT rows by an embedded resource
      // is `?order=artist(last_name).asc`. Supabase JS's `referencedTable`
      // / `foreignTable` option generates `artist.order=last_name.asc`
      // instead, which orders the EMBED, not the parent rows. So we
      // pass the embed-as-column form directly.
      return query
        .order("artist(last_name)", { ascending: true })
        .order("artist(first_name)", { ascending: true })
        .order("sort_order", { ascending: true });
    case "newest":
      return query
        .order("decade", { ascending: false, nullsFirst: false })
        .order("date_created", { ascending: false, nullsFirst: false })
        .order("sort_order", { ascending: true });
    case "oldest":
      return query
        .order("decade", { ascending: true, nullsFirst: false })
        .order("date_created", { ascending: true, nullsFirst: false })
        .order("sort_order", { ascending: true });
    case "title":
      return query
        .order("title", { ascending: true })
        .order("sort_order", { ascending: true });
    default:
      return query.order("sort_order", { ascending: true });
  }
}

// ─── Main query ─────────────────────────────────────────────────────────
export async function queryArtworks(
  supabase: SupabaseClient,
  state: FilterState,
  cohort: Cohort
): Promise<{ artworks: ArtworkResult[]; total: number }> {
  const artistId = await resolveArtistId(supabase, state.artist);
  const themes = state.themes;
  const formats = state.formats;
  const mediums = state.mediums;
  const activeCatDims = [themes.length > 0, formats.length > 0, mediums.length > 0].filter(Boolean).length;
  const isOneDim = activeCatDims === 1;
  const isMultiDim = activeCatDims >= 2;

  let intersectedIds: string[] | null = null;
  if (isMultiDim) {
    intersectedIds = await categoryFilteredIds(supabase, themes, formats, mediums);
    if (intersectedIds.length === 0) return { artworks: [], total: 0 };
  }

  const selectStr = buildSelect(isOneDim, "rich");
  let q = supabase.from("artworks").select(selectStr, { count: "exact" });
  q = applyScalarFilters(q, state, cohort, artistId, "none");

  if (isOneDim) {
    q = applySingleDimEmbeddedFilter(q, themes, formats, mediums);
  } else if (isMultiDim) {
    q = q.in("id", intersectedIds!);
  }

  q = applySort(q, state);

  const from = (state.page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, error, count } = await q.range(from, to);
  if (error) throw new Error(`queryArtworks: ${error.message}`);

  return {
    artworks: (data as unknown as ArtworkResult[]) || [],
    total: count || 0,
  };
}

// ─── Facet counts ───────────────────────────────────────────────────────
export async function getFacetCounts(
  supabase: SupabaseClient,
  state: FilterState,
  cohort: Cohort
): Promise<FacetCounts> {
  const artistId = await resolveArtistId(supabase, state.artist);

  const [themeIds, formatIds, mediumIds, decadeIds, artistIds] = await Promise.all([
    candidateIdsExcept(supabase, state, cohort, artistId, "themes"),
    candidateIdsExcept(supabase, state, cohort, artistId, "formats"),
    candidateIdsExcept(supabase, state, cohort, artistId, "mediums"),
    candidateIdsExcept(supabase, state, cohort, artistId, "decades"),
    candidateIdsExcept(supabase, state, cohort, artistId, "artist"),
  ]);

  const [themes, formats, mediums, decades, availableArtistSlugs] = await Promise.all([
    countCategoriesForIds(supabase, themeIds, "theme"),
    countCategoriesForIds(supabase, formatIds, "format"),
    countCategoriesForIds(supabase, mediumIds, "medium"),
    countDecadesForIds(supabase, decadeIds),
    artistsForIds(supabase, artistIds),
  ]);

  return { themes, formats, mediums, decades, availableArtistSlugs };
}

async function candidateIdsExcept(
  supabase: SupabaseClient,
  state: FilterState,
  cohort: Cohort,
  artistId: string | null,
  except: ExceptDim
): Promise<Set<string>> {
  const themes = except === "themes" ? [] : state.themes;
  const formats = except === "formats" ? [] : state.formats;
  const mediums = except === "mediums" ? [] : state.mediums;
  const activeCatDims = [themes.length > 0, formats.length > 0, mediums.length > 0].filter(Boolean).length;
  const isOneDim = activeCatDims === 1;
  const isMultiDim = activeCatDims >= 2;

  let intersectedIds: string[] | null = null;
  if (isMultiDim) {
    intersectedIds = await categoryFilteredIds(supabase, themes, formats, mediums);
    if (intersectedIds.length === 0) return new Set();
  }

  const selectStr = buildSelect(isOneDim, "id");

  // Multi-dim path: a stripped facet (e.g. formats∩mediums while computing
  // the themes facet) can produce 700+ intersected IDs. Passing those through
  // `.in("id", ids)` blows PostgREST's URL length limit, so for multi-dim we
  // fetch candidates matching the scalar filters and intersect client-side
  // — the same pattern as countCategoriesForIds / artistsForIds below.
  if (isMultiDim) {
    const intersectedSet = new Set(intersectedIds!);
    const rows = await fetchAllRows<{ id: string }>(() => {
      let q = supabase.from("artworks").select("id");
      q = applyScalarFilters(q, state, cohort, artistId, except);
      return q;
    });
    return new Set(rows.filter((r: any) => intersectedSet.has(r.id)).map((r: any) => r.id));
  }

  const rows = await fetchAllRows<{ id: string }>(() => {
    let q = supabase.from("artworks").select(selectStr);
    q = applyScalarFilters(q, state, cohort, artistId, except);
    if (isOneDim) {
      q = applySingleDimEmbeddedFilter(q, themes, formats, mediums);
    }
    return q;
  });

  return new Set(rows.map((r: any) => r.id));
}

/**
 * Count category-attachment slugs of a given kind, intersected with a
 * candidate ID set. We fetch ALL attachments of that kind (~6,800 rows)
 * and filter client-side via Set lookup — avoids passing the candidate
 * set through `.in()` which can blow URL limits.
 */
async function countCategoriesForIds(
  supabase: SupabaseClient,
  candidateIds: Set<string>,
  kind: "theme" | "format" | "medium"
): Promise<Record<string, number>> {
  if (candidateIds.size === 0) return {};
  const rows = await fetchAllRows<any>(() =>
    supabase
      .from("artwork_categories")
      .select("artwork_id, category:categories!inner(slug, kind)")
      .eq("category.kind", kind)
  );

  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (!candidateIds.has(row.artwork_id)) continue;
    const slug = row.category?.slug;
    if (slug) counts[slug] = (counts[slug] || 0) + 1;
  }
  return counts;
}

async function countDecadesForIds(
  supabase: SupabaseClient,
  candidateIds: Set<string>
): Promise<Record<string, number>> {
  if (candidateIds.size === 0) return {};
  const rows = await fetchAllRows<any>(() =>
    supabase.from("artworks").select("id, decade").not("decade", "is", null)
  );

  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (!candidateIds.has(row.id)) continue;
    if (row.decade) counts[row.decade] = (counts[row.decade] || 0) + 1;
  }
  return counts;
}

async function artistsForIds(
  supabase: SupabaseClient,
  candidateIds: Set<string>
): Promise<Set<string>> {
  if (candidateIds.size === 0) return new Set();
  const rows = await fetchAllRows<any>(() =>
    supabase.from("artworks").select("id, artist:artists(slug)")
  );

  const set = new Set<string>();
  for (const row of rows) {
    if (!candidateIds.has(row.id)) continue;
    const slug = row.artist?.slug;
    if (slug) set.add(slug);
  }
  return set;
}
