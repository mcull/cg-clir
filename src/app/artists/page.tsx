/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { formatArtistName } from "@/lib/utils";

async function getArtists(): Promise<any[]> {
  const supabase = createServerSupabaseClient();

  const { data: artists, error: artistsError } = await supabase
    .from("artists")
    .select("id, first_name, last_name, slug, bio")
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true });

  if (artistsError) {
    console.error("Error fetching artists:", artistsError);
    return [];
  }

  if (!artists) return [];

  // Re-fetch with proper grouping to get correct counts
  const countsByArtist: Record<string, number> = {};
  for (const artist of artists) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = await (supabase as any)
      .from("artworks")
      .select("*", { count: "exact", head: true })
      .eq("artist_id", artist.id)
      .eq("on_website", true);

    countsByArtist[artist.id] = count || 0;
  }

  return artists.map((artist) => ({
    ...artist,
    artwork_count: countsByArtist[artist.id],
  }));
}

export const metadata = {
  title: "Artists | Creative Growth Gallery",
  description: "Browse artists in the Creative Growth collection",
};

export default async function ArtistsPage() {
  const artists = await getArtists();

  return (
    <div className="container-max py-12">
      <h1 className="font-serif text-4xl font-bold text-gray-900 mb-8">
        Artists
      </h1>

      {artists.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {artists.map((artist) => (
            <Link
              key={artist.id}
              href={`/artists/${artist.slug}`}
              className="group"
            >
              <article className="p-6 border border-gray-200 rounded hover:border-blue-600 hover:shadow-md transition-all">
                <h2 className="font-serif text-lg font-bold text-gray-900 group-hover:text-blue-600 transition-colors">
                  {formatArtistName(artist.first_name, artist.last_name)}
                </h2>
                <p className="text-sm text-gray-600 mt-2">
                  {artist.artwork_count || 0} artwork
                  {artist.artwork_count !== 1 ? "s" : ""}
                </p>
                {artist.bio && (
                  <p className="text-sm text-gray-600 mt-3 line-clamp-2">
                    {artist.bio}
                  </p>
                )}
              </article>
            </Link>
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <p className="text-gray-600">
            No artists available yet. Check back soon.
          </p>
        </div>
      )}
    </div>
  );
}
