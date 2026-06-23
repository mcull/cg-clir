import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Artist } from "@/lib/types";
import { formatArtistName } from "@/lib/utils";

async function getArtists(): Promise<(Artist & { artwork_count?: number })[]> {
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("artists")
    .select("*")
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true });

  if (error) {
    console.error("Error fetching artists:", error);
    return [];
  }

  // Get artwork counts
  const artistsWithCounts = await Promise.all(
    (data || []).map(async (artist) => {
      const { count } = await supabase
        .from("artworks")
        .select("*", { count: "exact", head: true })
        .eq("artist_id", artist.id);

      return {
        ...artist,
        artwork_count: count || 0,
      };
    })
  );

  return artistsWithCounts;
}

export const metadata = {
  title: "Artists | Admin | Creative Growth Gallery",
};

export default async function AdminArtistsPage() {
  const artists = await getArtists();

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Artists</h1>
        <Link
          href="/admin/artists/new"
          className="button-primary"
        >
          Add Artist
        </Link>
      </div>

      {artists.length > 0 ? (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                  Artworks
                </th>
                <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                  Bio
                </th>
                <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {artists.map((artist) => (
                <tr key={artist.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm text-gray-900 font-medium">
                    {formatArtistName(artist.first_name, artist.last_name)}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {artist.artwork_count || 0}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {artist.bio ? artist.bio.substring(0, 60) + "..." : "—"}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <Link
                      href={`/admin/artists/${artist.id}`}
                      className="text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-12 bg-white rounded-lg">
          <p className="text-gray-600 mb-4">No artists yet.</p>
          <Link href="/admin/artists/new" className="text-blue-600">
            Create the first artist
          </Link>
        </div>
      )}
    </div>
  );
}
