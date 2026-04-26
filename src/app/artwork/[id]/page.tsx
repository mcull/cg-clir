/* eslint-disable @typescript-eslint/no-explicit-any */
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Artwork } from "@/lib/types";
import { getAltText, formatArtistName, formatDimensions, resolveImageUrl } from "@/lib/utils";
import DownloadButton from "@/components/DownloadButton";
import ArtworkGrid from "@/components/ArtworkGrid";
import ArtworkCard from "@/components/ArtworkCard";

async function getArtwork(
  id: string
): Promise<
  (Artwork & {
    artist?: { id: string; first_name: string; last_name: string; slug: string };
    categories?: any[];
  })
  | null
> {
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("artworks")
    .select(
      `
      *,
      artist:artists(id, first_name, last_name, slug),
      categories:artwork_categories(category:categories(id, name, slug, kind))
      `
    )
    .eq("id", id)
    .single();

  if (error) {
    console.error("Error fetching artwork:", error);
    return null;
  }

  return data;
}

async function getArtistArtworks(
  artistId: string,
  excludeId: string,
  limit: number = 6
): Promise<{
  items: (Artwork & { artist?: { id: string; first_name: string; last_name: string } })[];
  total: number;
}> {
  const supabase = createServerSupabaseClient();

  const { data, error, count } = await supabase
    .from("artworks")
    .select(
      `
      *,
      artist:artists(id, first_name, last_name)
      `,
      { count: "exact" }
    )
    .eq("artist_id", artistId)
    .eq("on_website", true)
    .neq("id", excludeId)
    .order("sort_order", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("Error fetching artist artworks:", error);
    return { items: [], total: 0 };
  }

  return { items: data || [], total: count || 0 };
}

interface ArtworkPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: ArtworkPageProps) {
  const { id } = await params;
  const artwork = await getArtwork(id);

  if (!artwork) {
    return {
      title: "Artwork Not Found",
    };
  }

  const altText = getAltText(artwork);

  return {
    title: `${artwork.title} | Creative Growth Gallery`,
    description: altText,
    openGraph: {
      title: artwork.title,
      description: altText,
      images: resolveImageUrl(artwork)
        ? [
            {
              url: resolveImageUrl(artwork)!,
              width: 1200,
              height: 1200,
              alt: altText,
            },
          ]
        : [],
    },
  };
}

export default async function ArtworkPage({ params, searchParams }: ArtworkPageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const showAi = sp.ai === "1" || sp.ai === "true";
  const artwork = await getArtwork(id);

  if (!artwork) {
    notFound();
  }

  const showVisualDescription =
    artwork.description_origin === "human" ||
    (showAi && artwork.description_origin === "ai");

  const more = artwork.artist_id
    ? await getArtistArtworks(artwork.artist_id, artwork.id)
    : { items: [], total: 0 };

  const altText = getAltText(artwork);
  const imageUrl = resolveImageUrl(artwork);
  const artistName = artwork.artist
    ? formatArtistName(artwork.artist.first_name, artwork.artist.last_name)
    : "Unknown Artist";
  const dimensions = formatDimensions(
    artwork.height,
    artwork.width,
    artwork.depth
  );

  return (
    <div className="container-max py-12">
      {/* Breadcrumb */}
      <nav
        aria-label="Breadcrumb"
        className="text-sm text-gray-600 mb-8 flex gap-2 flex-wrap"
      >
        <Link href="/" className="hover:text-blue-600">
          CGPA Archive
        </Link>
        <span>/</span>
        <span className="text-gray-900 font-semibold">{artwork.title}</span>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
        {/* Image */}
        <div className="lg:col-span-2">
          <div className="bg-white aspect-square relative">
            {imageUrl ? (
              <Image
                src={imageUrl}
                alt={altText}
                fill
                className="object-contain object-top"
                priority
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-400">
                No image available
              </div>
            )}
          </div>
        </div>

        {/* Metadata */}
        <div>
          <h1 className="font-serif text-3xl font-bold text-gray-900 mb-4">
            {artwork.title}
          </h1>

          {artwork.artist && (
            <div className="mb-6">
              <Link
                href={`/artists/${artwork.artist.slug}`}
                className="link-primary text-lg"
              >
                {artistName}
              </Link>
            </div>
          )}

          {/* Details */}
          <div className="space-y-4 mb-6 pb-6 border-b border-gray-200">
            {artwork.date_created && (
              <div>
                <dt className="text-sm font-semibold text-gray-600">Date</dt>
                <dd className="text-gray-900">{artwork.date_created}</dd>
              </div>
            )}

            {artwork.medium && (
              <div>
                <dt className="text-sm font-semibold text-gray-600">Medium</dt>
                <dd className="text-gray-900">{artwork.medium}</dd>
              </div>
            )}

            {dimensions && (
              <div>
                <dt className="text-sm font-semibold text-gray-600">
                  Dimensions
                </dt>
                <dd className="text-gray-900">{dimensions}</dd>
              </div>
            )}

            {artwork.categories && artwork.categories.length > 0 && (
              <div>
                <dt className="text-sm font-semibold text-gray-600">
                  Categories
                </dt>
                <dd className="flex flex-wrap gap-2">
                  {artwork.categories?.map((cat: any) => {
                    const param = cat.category.kind === "theme" ? "theme" : "format";
                    return (
                      <Link
                        key={cat.category.id}
                        href={`/?${param}=${cat.category.slug}`}
                        className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded transition-colors"
                      >
                        {cat.category.name}
                      </Link>
                    );
                  })}
                </dd>
              </div>
            )}

            {showVisualDescription && (artwork.alt_text || artwork.alt_text_long) && (
              <div>
                <dt className="text-sm font-semibold text-gray-600">
                  Visual description
                </dt>
                {artwork.alt_text && (
                  <dd className="text-gray-900 italic mb-2">{artwork.alt_text}</dd>
                )}
                {artwork.alt_text_long && (
                  <dd className="text-gray-900 leading-relaxed">{artwork.alt_text_long}</dd>
                )}
              </div>
            )}
          </div>

          {/* Download Button */}
          <DownloadButton artworkId={artwork.id} title={artwork.title} />
        </div>
      </div>

      {/* More by Artist */}
      {more.items.length > 0 && (
        <section className="mt-16 pt-16 border-t border-gray-200">
          <h2 className="font-serif text-2xl font-bold text-gray-900 mb-8">
            More by {artistName}
          </h2>
          <ArtworkGrid columns="3">
            {more.items.map((art) => (
              <ArtworkCard key={art.id} artwork={art} />
            ))}
          </ArtworkGrid>
          {more.total > more.items.length && artwork.artist?.slug && (
            <p className="mt-8 text-center">
              <Link
                href={`/?artist=${artwork.artist.slug}`}
                className="text-blue-600 hover:text-blue-800 font-medium"
              >
                …and {more.total - more.items.length} more by {artistName} →
              </Link>
            </p>
          )}
        </section>
      )}
    </div>
  );
}
