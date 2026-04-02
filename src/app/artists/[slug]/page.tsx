import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import ArtworkGrid from "@/components/ArtworkGrid";
import ArtworkCard from "@/components/ArtworkCard";
import { Artist, Artwork } from "@/lib/types";
import { formatArtistName } from "@/lib/utils";

async function getArtist(slug: string): Promise<Artist | null> {
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("artists")
    .select("*")
    .eq("slug", slug)
    .single();

  if (error) {
    console.error("Error fetching artist:", error);
    return null;
  }

  return data;
}

async function getArtistArtworks(
  artistId: string
): Promise<
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
    .eq("artist_id", artistId)
    .eq("on_website", true)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("Error fetching artworks:", error);
    return [];
  }

  return data || [];
}

interface ArtistPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: ArtistPageProps) {
  const { slug } = await params;
  const artist = await getArtist(slug);

  if (!artist) {
    return {
      title: "Artist Not Found",
    };
  }

  const name = formatArtistName(artist.first_name, artist.last_name);

  return {
    title: `${name} | Creative Growth Gallery`,
    description: artist.bio || `Artworks by ${name}`,
  };
}

export default async function ArtistPage({ params }: ArtistPageProps) {
  const { slug } = await params;
  const artist = await getArtist(slug);

  if (!artist) {
    notFound();
  }

  const artworks = await getArtistArtworks(artist.id);
  const artistName = formatArtistName(artist.first_name, artist.last_name);

  return (
    <div className="container-max py-12">
      {/* Artist Info */}
      <div className="mb-12">
        <h1 className="font-serif text-4xl font-bold text-gray-900 mb-4">
          {artistName}
        </h1>

        {artist.bio && (
          <div className="max-w-3xl">
            <p className="text-lg text-gray-700 leading-relaxed mb-4">
              {artist.bio}
            </p>
          </div>
        )}

        <p className="text-gray-600">
          {artworks.length} artwork{artworks.length !== 1 ? "s" : ""} in collection
        </p>
      </div>

      {/* Artworks */}
      {artworks.length > 0 ? (
        <div>
          <h2 className="font-serif text-2xl font-bold text-gray-900 mb-8">
            Works
          </h2>
          <ArtworkGrid>
            {artworks.map((artwork) => (
              <ArtworkCard key={artwork.id} artwork={artwork} />
            ))}
          </ArtworkGrid>
        </div>
      ) : (
        <div className="text-center py-12">
          <p className="text-gray-600">
            No artworks available for this artist yet.
          </p>
        </div>
      )}
    </div>
  );
}
