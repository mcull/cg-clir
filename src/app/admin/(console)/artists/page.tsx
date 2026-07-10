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
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[44px] leading-none tracking-[-0.5px]">Artists</h1>
          <p className="mt-3 text-sm text-muted">
            {artists.length.toLocaleString()} artist{artists.length === 1 ? "" : "s"} in the archive.
          </p>
        </div>
        <Link
          href="/admin/artists/new"
          className="admin-btn admin-btn-primary px-[22px] py-3 text-xs tracking-[2px]"
        >
          + Add Artist
        </Link>
      </div>

      {artists.length > 0 ? (
        <div className="mt-8 border border-ink bg-card">
          <table className="w-full">
            <thead className="bg-ink text-paper">
              <tr>
                <th className="px-5 py-3 text-left text-[10px] uppercase tracking-[1.8px]">
                  Name
                </th>
                <th className="px-5 py-3 text-left text-[10px] uppercase tracking-[1.8px]">
                  Artworks
                </th>
                <th className="px-5 py-3 text-left text-[10px] uppercase tracking-[1.8px]">
                  Bio
                </th>
                <th className="px-5 py-3 text-left text-[10px] uppercase tracking-[1.8px]">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {artists.map((artist) => (
                <tr key={artist.id} className="hover:bg-row-hover">
                  <td className="px-5 py-3 border-b border-hairline text-sm text-ink">
                    {formatArtistName(artist.first_name, artist.last_name)}
                  </td>
                  <td className="px-5 py-3 border-b border-hairline text-[13px] text-muted">
                    {artist.artwork_count || 0}
                  </td>
                  <td className="px-5 py-3 border-b border-hairline text-[13px] text-muted">
                    {artist.bio ? artist.bio.substring(0, 60) + "..." : "—"}
                  </td>
                  <td className="px-5 py-3 border-b border-hairline">
                    <Link
                      href={`/admin/artists/${artist.id}`}
                      className="text-xs uppercase tracking-[1.5px] text-green hover:underline"
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
        <div className="mt-8 border border-ink bg-card py-12 text-center">
          <p className="mb-4 text-sm text-muted">No artists yet.</p>
          <Link
            href="/admin/artists/new"
            className="text-xs uppercase tracking-[1.5px] text-green hover:underline"
          >
            Create the first artist
          </Link>
        </div>
      )}
    </div>
  );
}
