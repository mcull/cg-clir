/* eslint-disable @typescript-eslint/no-explicit-any */
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
