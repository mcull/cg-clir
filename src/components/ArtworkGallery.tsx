"use client";

import { useState } from "react";
import { ArtworkImage } from "@/lib/types";
import { resolveImageUrl } from "@/lib/utils";
import { orderImages, imageAlt } from "@/lib/images";
import ImageLightbox from "@/components/ImageLightbox";

/**
 * Detail-page image gallery (Layout A): hero + thumbnail strip below.
 * Clicking the hero opens the carousel lightbox at the current image.
 * A single-image artwork renders just the hero (no strip), as before.
 */
export default function ArtworkGallery({
  images,
  title,
  medium,
}: {
  images: ArtworkImage[];
  title: string;
  medium: string | null;
}) {
  const ordered = orderImages(images);
  const [active, setActive] = useState(0);
  const current = ordered[active];

  const slides = ordered.map((img) => ({
    src: resolveImageUrl(img) || "",
    zoomSrc: img.image_original || resolveImageUrl(img) || "",
    alt: imageAlt(img, { title, medium }),
  }));

  return (
    <figure>
      <ImageLightbox
        images={slides}
        index={active}
        onIndexChange={setActive}
        inlineClassName="block max-w-full max-h-[85vh]"
      />
      {ordered.length > 1 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="More views of this artwork">
          {ordered.map((img, i) => {
            const thumb = resolveImageUrl(img);
            return (
              <li key={img.id}>
                <button
                  type="button"
                  onClick={() => setActive(i)}
                  aria-current={i === active}
                  aria-label={`View ${i + 1} of ${ordered.length}`}
                  className={`block h-16 w-16 overflow-hidden rounded border-2 ${
                    i === active ? "border-blue-600" : "border-transparent"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {thumb && <img src={thumb} alt="" className="h-full w-full object-cover" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {current?.short_description && (
        <figcaption className="text-sm text-gray-600 italic mt-3">
          {current.short_description}
        </figcaption>
      )}
    </figure>
  );
}
