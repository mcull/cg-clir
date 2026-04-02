import Link from "next/link";
import ArtworkGrid from "@/components/ArtworkGrid";
import ArtworkCard from "@/components/ArtworkCard";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Artwork } from "@/lib/types";

async function getFeaturedArtworks(): Promise<
  (Artwork & { artist?: { id: string; first_name: string; last_name: string } })[]
> {
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("artworks")
    .select(
      `
      *,
      artist:artists(id, first_name, last_name)
      `
    )
    .eq("on_website", true)
    .order("sort_order", { ascending: true })
    .limit(12);

  if (error) {
    console.error("Error fetching artworks:", error);
    return [];
  }

  return data || [];
}

export default async function Home() {
  const artworks = await getFeaturedArtworks();

  return (
    <div>
      {/* Hero Section */}
      <section className="bg-gray-50 border-b border-gray-200">
        <div className="container-max py-16 md:py-24">
          <div className="max-w-2xl">
            <h1 className="font-serif text-4xl md:text-5xl font-bold text-gray-900 mb-4">
              Creative Growth Art Collection
            </h1>
            <p className="text-lg text-gray-600 mb-8">
              Explore a carefully curated digital collection of contemporary art
              from the Creative Growth Art Center, digitized with support from
              the Council on Library and Information Resources.
            </p>
            <div className="flex gap-4">
              <Link
                href="/collection"
                className="button-primary"
              >
                Browse Collection
              </Link>
              <Link
                href="/artists"
                className="button-secondary"
              >
                View Artists
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Featured Artworks */}
      <section className="container-max py-16">
        <h2 className="font-serif text-3xl font-bold text-gray-900 mb-8">
          Featured Works
        </h2>

        {artworks.length > 0 ? (
          <>
            <ArtworkGrid>
              {artworks.map((artwork) => (
                <ArtworkCard key={artwork.id} artwork={artwork} />
              ))}
            </ArtworkGrid>

            <div className="mt-12 text-center">
              <Link
                href="/collection"
                className="text-blue-600 hover:text-blue-800 font-medium text-lg"
              >
                View all artworks →
              </Link>
            </div>
          </>
        ) : (
          <div className="text-center py-12">
            <p className="text-gray-600">
              No artworks available yet. Check back soon.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
