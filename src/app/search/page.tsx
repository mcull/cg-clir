/* eslint-disable @typescript-eslint/no-explicit-any */
import ArtworkGrid from "@/components/ArtworkGrid";
import ArtworkCard from "@/components/ArtworkCard";
import Pagination from "@/components/Pagination";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Artwork } from "@/lib/types";

const ITEMS_PER_PAGE = 24;

async function searchArtworks(
  query: string,
  page: number = 1
): Promise<{ artworks: (Artwork & { artist?: any })[]; total: number }> {
  if (!query.trim()) {
    return { artworks: [], total: 0 };
  }

  const supabase = createServerSupabaseClient();

  let searchQuery = supabase
    .from("artworks")
    .select(
      `
      id,
      title,
      image_url,
      artist:artists(id, first_name, last_name)
      `,
      { count: "exact" }
    )
    .eq("on_website", true);

  // Simple text search on title and notes
  searchQuery = searchQuery.or(
    `title.ilike.%${query}%,notes.ilike.%${query}%`
  );

  const from = (page - 1) * ITEMS_PER_PAGE;
  const to = from + ITEMS_PER_PAGE - 1;

  const { data, error, count } = await searchQuery
    .order("title", { ascending: true })
    .range(from, to);

  if (error) {
    console.error("Search error:", error);
    return { artworks: [], total: 0 };
  }

  return {
    artworks: data || [],
    total: count || 0,
  };
}

interface SearchPageProps {
  searchParams: Promise<{
    q?: string;
    page?: string;
  }>;
}

export const metadata = {
  title: "Search | Creative Growth Gallery",
  description: "Search the Creative Growth art collection",
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const query = params.q || "";
  const currentPage = parseInt(params.page || "1", 10);

  const { artworks, total } = await searchArtworks(query, currentPage);
  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);

  return (
    <div className="container-max py-12">
      <div className="mb-8">
        <h1 className="font-serif text-4xl font-bold text-gray-900 mb-4">
          Search Results
        </h1>
        {query && (
          <p className="text-gray-600">
            {total > 0
              ? `Found ${total} result${total !== 1 ? "s" : ""} for "${query}"`
              : `No results found for "${query}"`}
          </p>
        )}
      </div>

      {artworks.length > 0 ? (
        <>
          <ArtworkGrid>
            {artworks.map((artwork) => (
              <ArtworkCard key={artwork.id} artwork={artwork} />
            ))}
          </ArtworkGrid>

          {totalPages > 1 && (
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              baseUrl="/search"
              preserveParams={["q"]}
            />
          )}
        </>
      ) : query ? (
        <div className="text-center py-12">
          <p className="text-gray-600 text-lg mb-4">
            Try searching for different keywords or browse the collection.
          </p>
          <a href="/collection" className="text-blue-600 hover:text-blue-800">
            Browse Collection
          </a>
        </div>
      ) : (
        <div className="text-center py-12">
          <p className="text-gray-600 text-lg">
            Enter a search term above to find artworks.
          </p>
        </div>
      )}
    </div>
  );
}
