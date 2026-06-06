/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import ArtworkGrid from "@/components/ArtworkGrid";
import ArtworkCard from "@/components/ArtworkCard";
import Pagination from "@/components/Pagination";
import CohortNav from "@/components/CohortNav";
import { parseSearchParams } from "@/lib/filter-state";
import { queryArtworks } from "@/lib/collection-query";

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

  const { artworks, total } = await queryArtworks(supabase, state, "ephemera");

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);

  return (
    <div className="container-max py-12">
      <nav
        aria-label="Breadcrumb"
        className="text-sm text-gray-600 mb-6 flex gap-2 flex-wrap"
      >
        <a href="https://www.creativegrowth.org" className="hover:text-blue-600">
          Home
        </a>
        <span>/</span>
        <Link href="/" className="hover:text-blue-600">
          Archive
        </Link>
        <span>/</span>
        <span className="text-gray-900 font-semibold">Ephemera</span>
      </nav>
      <div className="flex items-baseline justify-between gap-6 mb-6 flex-wrap">
        <h1
          className="text-4xl md:text-5xl font-bold text-gray-900 tracking-tight uppercase"
          style={{ fontFamily: '"Borna", sans-serif' }}
        >
          Creative Growth Public Archive
        </h1>
        <CohortNav active="ephemera" />
      </div>

      {artworks.length > 0 ? (
        <>
          <p className="text-gray-600 mb-6 text-sm">
            {total} {total === 1 ? "item" : "items"}
            {state.q && <> for &ldquo;{state.q}&rdquo;</>}
          </p>

          <ArtworkGrid>
            {artworks.map((artwork) => (
              <ArtworkCard key={artwork.id} artwork={artwork as any} imageOnly />
            ))}
          </ArtworkGrid>

          {totalPages > 1 && (
            <Pagination
              currentPage={state.page}
              totalPages={totalPages}
              baseUrl="/ephemera"
              preserveParams={["q", "artist", "sort", "audio"]}
            />
          )}
        </>
      ) : (
        <div className="text-center py-12">
          <p className="text-gray-600 text-lg">No ephemera found.</p>
        </div>
      )}
    </div>
  );
}
