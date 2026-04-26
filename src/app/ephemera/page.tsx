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
      <div className="flex items-baseline justify-between gap-6 mb-6 flex-wrap">
        <h1 className="font-sans text-5xl font-bold text-gray-900 tracking-tight">CGPA ARCHIVE</h1>
        <CohortNav active="ephemera" />
      </div>

      <FilterBar
        state={state}
        cohort="ephemera"
        themeOptions={[]}
        formatOptions={[]}
        mediumOptions={[]}
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
