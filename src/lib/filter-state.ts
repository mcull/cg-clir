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
  mediums: string[];
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
    mediums: parseList(params.medium),
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
  if (state.mediums.length) out.set("medium", state.mediums.join(","));
  if (state.decades.length) out.set("decade", state.decades.join(","));
  if (state.artist) out.set("artist", state.artist);
  if (state.sort) out.set("sort", state.sort);
  if (state.page > 1) out.set("page", String(state.page));
  return out.toString();
}
