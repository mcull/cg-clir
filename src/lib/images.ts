/** Pure helpers for ordering and labeling an artwork's images. */

type OrderableImage = { is_primary: boolean; sort_order: number };

/** Primary first, then ascending sort_order. Returns a new array. */
export function orderImages<T extends OrderableImage>(images: T[]): T[] {
  return [...images].sort((a, b) => {
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    return a.sort_order - b.sort_order;
  });
}

/** The primary image, or the first ordered image, or null if empty. */
export function pickPrimary<T extends OrderableImage>(images: T[]): T | null {
  if (images.length === 0) return null;
  return orderImages(images)[0];
}

/** Short alt/caption text for an image, falling back to title + medium. */
export function imageAlt(
  image: { short_description: string | null } | null,
  artwork: { title: string; medium: string | null }
): string {
  if (image?.short_description) return image.short_description;
  const parts = [artwork.title];
  if (artwork.medium) parts.push(artwork.medium);
  return parts.join(". ");
}

/** Move an array item from one index to another. Returns a new array. */
export function reorder<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  const result = [...items];
  const [moved] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, moved);
  return result;
}

/** Mark one id primary and the rest not (client-side optimistic update). */
export function withPrimary<T extends { id: string; is_primary: boolean }>(
  images: T[],
  primaryId: string
): T[] {
  return images.map((im) => ({ ...im, is_primary: im.id === primaryId }));
}
