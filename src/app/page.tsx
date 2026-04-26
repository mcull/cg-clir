/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerSupabaseClient } from "@/lib/supabase/server";
import ArtworkGrid from "@/components/ArtworkGrid";
import ArtworkCard from "@/components/ArtworkCard";
import Pagination from "@/components/Pagination";
import FilterBar from "@/components/FilterBar";
import CohortNav from "@/components/CohortNav";
import { parseSearchParams } from "@/lib/filter-state";
import { queryArtworks, getFacetCounts } from "@/lib/collection-query";

const ITEMS_PER_PAGE = 24;

interface HomePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const metadata = {
  title: "CGPA Archive | Creative Growth Gallery",
  description: "Browse the complete collection of artworks",
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const raw = await searchParams;
  const state = parseSearchParams(raw);
  const supabase = createServerSupabaseClient();

  const [{ artworks, total }, facets, formatCats, themeCats, mediumCats, allArtists] = await Promise.all([
    queryArtworks(supabase, state, "artwork"),
    getFacetCounts(supabase, state, "artwork"),
    supabase.from("categories").select("name, slug").eq("kind", "format").order("name"),
    supabase.from("categories").select("name, slug").eq("kind", "theme").order("name"),
    supabase.from("categories").select("name, slug").eq("kind", "medium").order("name"),
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
  const mediumOptions = (mediumCats.data || []).map((c) => ({
    value: c.slug,
    label: c.name,
    count: facets.mediums[c.slug] || 0,
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
      <div className="flex items-baseline justify-between gap-6 mb-6 flex-wrap">
        <h1 className="font-sans text-5xl font-bold text-gray-900 tracking-tight">CGPA ARCHIVE</h1>
        <CohortNav active="artwork" />
      </div>

      <FilterBar
        state={state}
        cohort="artwork"
        themeOptions={themeOptions}
        formatOptions={formatOptions}
        mediumOptions={mediumOptions}
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
              baseUrl="/"
              preserveParams={["q", "theme", "format", "medium", "decade", "artist", "sort"]}
            />
          )}
        </>
      ) : (
        <div className="text-center py-12">
          <p className="text-gray-600 text-lg mb-4">No artworks match your filters.</p>
          <a href="/" className="text-blue-600 underline">Clear filters</a>
        </div>
      )}
    </div>
  );
}
