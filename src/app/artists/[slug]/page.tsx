import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import ArtworkGrid from "@/components/ArtworkGrid";
import ArtworkCard from "@/components/ArtworkCard";
import { Artist, Artwork } from "@/lib/types";
import { formatArtistName } from "@/lib/utils";

const SAMPLE_LIMIT = 6;

type ArtworkRow = Artwork & {
  artist?: { id: string; first_name: string; last_name: string };
};

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

async function getArtistSample(
  artistId: string,
  cohort: "artwork" | "ephemera"
): Promise<{ items: ArtworkRow[]; total: number }> {
  const supabase = createServerSupabaseClient();
  let q = supabase
    .from("artworks")
    .select(
      `
      *,
      artist:artists(id, first_name, last_name)
      `,
      { count: "exact" }
    )
    .eq("artist_id", artistId)
    .eq("on_website", true);

  // Cohort filter — same shape as collection-query so /collection and
  // /ephemera see identical sets when filtered by this artist.
  q =
    cohort === "artwork"
      ? q.or("tags.is.null,tags.not.cs.{ephemera}")
      : q.contains("tags", ["ephemera"]);

  q = q.order("sort_order", { ascending: true }).limit(SAMPLE_LIMIT);

  const { data, error, count } = await q;
  if (error) {
    console.error(`Error fetching artist ${cohort}:`, error);
    return { items: [], total: 0 };
  }
  return { items: (data as ArtworkRow[]) || [], total: count || 0 };
}

interface ArtistPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: ArtistPageProps) {
  const { slug } = await params;
  const artist = await getArtist(slug);
  if (!artist) return { title: "Artist Not Found" };
  const name = formatArtistName(artist.first_name, artist.last_name);
  return {
    title: `${name} | Creative Growth Gallery`,
    description: artist.bio || `Artworks by ${name}`,
  };
}

export default async function ArtistPage({ params }: ArtistPageProps) {
  const { slug } = await params;
  const artist = await getArtist(slug);
  if (!artist) notFound();

  const [works, ephemera] = await Promise.all([
    getArtistSample(artist.id, "artwork"),
    getArtistSample(artist.id, "ephemera"),
  ]);

  const artistName = formatArtistName(artist.first_name, artist.last_name);

  return (
    <div className="container-max py-12">
      {/* Artist info */}
      <div className="mb-12 max-w-3xl">
        <h1 className="font-serif text-4xl font-bold text-gray-900 mb-4">
          {artistName}
        </h1>
        {artist.bio && (
          <p className="text-lg text-gray-700 leading-relaxed">{artist.bio}</p>
        )}
      </div>

      {/* Artworks sample */}
      {works.items.length > 0 ? (
        <section className="mb-16">
          <h2 className="font-serif text-2xl font-bold text-gray-900 mb-8">
            Works ({works.total})
          </h2>
          <ArtworkGrid columns="3">
            {works.items.map((art) => (
              <ArtworkCard key={art.id} artwork={art} />
            ))}
          </ArtworkGrid>
          {works.total > works.items.length && (
            <p className="mt-8 text-center">
              <Link
                href={`/?artist=${artist.slug}`}
                className="text-blue-600 hover:text-blue-800 font-medium"
              >
                …and {works.total - works.items.length} more works by {artistName} →
              </Link>
            </p>
          )}
        </section>
      ) : (
        <section className="mb-16">
          <p className="text-gray-600">No artworks in collection yet.</p>
        </section>
      )}

      {/* Ephemera sample (only if any) */}
      {ephemera.items.length > 0 && (
        <section className="mb-16 pt-12 border-t border-gray-200">
          <h2 className="font-serif text-2xl font-bold text-gray-900 mb-8">
            Ephemera ({ephemera.total})
          </h2>
          <ArtworkGrid columns="3">
            {ephemera.items.map((art) => (
              <ArtworkCard key={art.id} artwork={art} />
            ))}
          </ArtworkGrid>
          {ephemera.total > ephemera.items.length && (
            <p className="mt-8 text-center">
              <Link
                href={`/ephemera?artist=${artist.slug}`}
                className="text-blue-600 hover:text-blue-800 font-medium"
              >
                …and {ephemera.total - ephemera.items.length} more ephemera items →
              </Link>
            </p>
          )}
        </section>
      )}
    </div>
  );
}
