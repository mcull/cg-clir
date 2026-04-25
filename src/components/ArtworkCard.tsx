import Link from "next/link";
import Image from "next/image";
import { Artwork } from "@/lib/types";
import { getAltText, formatArtistName, resolveImageUrl } from "@/lib/utils";

interface ArtworkCardProps {
  artwork: Artwork & { artist?: { first_name: string; last_name: string } };
}

export default function ArtworkCard({ artwork }: ArtworkCardProps) {
  const altText = getAltText(artwork);
  const imageUrl = resolveImageUrl(artwork);
  const artistName = artwork.artist
    ? formatArtistName(artwork.artist.first_name, artwork.artist.last_name)
    : "Unknown Artist";

  return (
    <Link href={`/artwork/${artwork.id}`}>
      <article className="group cursor-pointer">
        <div className="aspect-square relative bg-white overflow-hidden rounded-sm mb-3">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={altText}
              fill
              className="object-contain group-hover:opacity-90 transition-opacity"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400 bg-gray-100">
              No image available
            </div>
          )}
        </div>

        <h3 className="font-serif font-semibold text-gray-900 group-hover:text-blue-600 transition-colors line-clamp-2">
          {artwork.title}
        </h3>
        <p className="text-sm text-gray-600 mt-1">{artistName}</p>
      </article>
    </Link>
  );
}
