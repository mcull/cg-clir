/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Collection / Ephemera query builder.
 *
 * Filter strategy by dimension:
 *   - Cohort, on_website, search (FTS), decade, artist: applied inline
 *     on the main query — small, indexed, fast.
 *   - Theme XOR Format (one category dim active): embedded INNER join +
 *     `.eq()` / `.in()` on the embedded path. PostgREST INNER JOIN
 *     filters the parent rows correctly.
 *   - Theme AND Format (both active): pre-resolve the intersected
 *     artwork-id set via `categoryFilteredIds`, then `.in("id", ids)`.
 *     The intersection is bounded by min(theme-pop, format-pop), which
 *     is small enough to fit comfortably in a PostgREST URL.
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
  decades: Record<string, number>;
  availableArtistSlugs: Set<string>;
}

const PAGE_SIZE = 24;
const FETCH_PAGE = 1000;

type ExceptDim = "themes" | "formats" | "decades" | "artist" | "q" | "none";

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
 * Resolve themes + formats to the intersected set of artwork IDs that
 * satisfy both. Used only when BOTH dimensions are active. Returns null
 * sentinel only when caller misuses (neither dim active).
 */
async function categoryFilteredIds(
  supabase: SupabaseClient,
  themes: string[],
  formats: string[]
): Promise<string[]> {
  async function idsFor(slugs: string[], kind: "theme" | "format"): Promise<Set<string>> {
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

  const [themeIds, formatIds] = await Promise.all([
    idsFor(themes, "theme"),
    idsFor(formats, "format"),
  ]);

  return [...themeIds].filter((id) => formatIds.has(id));
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
    const safe = state.q.replace(/[&|!()<>:*]/g, " ").trim();
    if (safe) {
      const tsq = safe.split(/\s+/).join(" & ");
      q = q.textSearch("fts", tsq);
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

function applySingleDimEmbeddedFilter(q: any, themes: string[], formats: string[]): any {
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
  const isOneDim = (themes.length > 0) !== (formats.length > 0);
  const isTwoDim = themes.length > 0 && formats.length > 0;

  let intersectedIds: string[] | null = null;
  if (isTwoDim) {
    intersectedIds = await categoryFilteredIds(supabase, themes, formats);
    if (intersectedIds.length === 0) return { artworks: [], total: 0 };
  }

  const selectStr = buildSelect(isOneDim, "rich");
  let q = supabase.from("artworks").select(selectStr, { count: "exact" });
  q = applyScalarFilters(q, state, cohort, artistId, "none");

  if (isOneDim) {
    q = applySingleDimEmbeddedFilter(q, themes, formats);
  } else if (isTwoDim) {
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

  const [themeIds, formatIds, decadeIds, artistIds] = await Promise.all([
    candidateIdsExcept(supabase, state, cohort, artistId, "themes"),
    candidateIdsExcept(supabase, state, cohort, artistId, "formats"),
    candidateIdsExcept(supabase, state, cohort, artistId, "decades"),
    candidateIdsExcept(supabase, state, cohort, artistId, "artist"),
  ]);

  const [themes, formats, decades, availableArtistSlugs] = await Promise.all([
    countCategoriesForIds(supabase, themeIds, "theme"),
    countCategoriesForIds(supabase, formatIds, "format"),
    countDecadesForIds(supabase, decadeIds),
    artistsForIds(supabase, artistIds),
  ]);

  return { themes, formats, decades, availableArtistSlugs };
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
  const isOneDim = (themes.length > 0) !== (formats.length > 0);
  const isTwoDim = themes.length > 0 && formats.length > 0;

  let intersectedIds: string[] | null = null;
  if (isTwoDim) {
    intersectedIds = await categoryFilteredIds(supabase, themes, formats);
    if (intersectedIds.length === 0) return new Set();
  }

  const selectStr = buildSelect(isOneDim, "id");

  const rows = await fetchAllRows<{ id: string }>(() => {
    let q = supabase.from("artworks").select(selectStr);
    q = applyScalarFilters(q, state, cohort, artistId, except);
    if (isOneDim) {
      q = applySingleDimEmbeddedFilter(q, themes, formats);
    } else if (isTwoDim) {
      q = q.in("id", intersectedIds!);
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
  kind: "theme" | "format"
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
