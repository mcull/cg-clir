/**
 * Create a URL-safe slug from a string.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Format artist name for display.
 */
export function formatArtistName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}

/**
 * Format dimensions for display.
 */
export function formatDimensions(
  height: number | null,
  width: number | null,
  depth: number | null
): string | null {
  const parts: string[] = [];
  if (height) parts.push(`${height}`);
  if (width) parts.push(`${width}`);
  if (depth) parts.push(`${depth}`);

  if (parts.length === 0) return null;
  if (parts.length === 2) return `${parts[0]} × ${parts[1]} in`;
  if (parts.length === 3) return `${parts[0]} × ${parts[1]} × ${parts[2]} in`;
  return `${parts[0]} in`;
}

/**
 * Parse a numeric string, returning null for empty/invalid values.
 */
export function parseNumeric(value: string | undefined): number | null {
  if (!value || value.trim() === "") return null;
  const n = parseFloat(value.replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? null : n;
}

/**
 * Parse tags from a comma-separated string.
 */
export function parseTags(tagString: string | undefined): string[] {
  if (!tagString || tagString.trim() === "") return [];
  return tagString
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Resolve an artwork's display image URL.
 * Handles: absolute URLs (pass through), relative R2 paths (need public URL),
 * and fallback to image_original if needed.
 */
export function resolveImageUrl(artwork: {
  image_url: string | null;
  image_original?: string | null;
}): string | null {
  const url = artwork.image_url;
  if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
    return url;
  }
  // image_url is a relative R2 path — fall back to original Art Cloud URL
  if (artwork.image_original) {
    return artwork.image_original;
  }
  // Last resort: construct absolute R2 URL if public URL is configured
  if (url && process.env.NEXT_PUBLIC_R2_PUBLIC_URL) {
    return `${process.env.NEXT_PUBLIC_R2_PUBLIC_URL}/${url}`;
  }
  return null;
}

/**
 * Get the effective alt text for an artwork (admin-edited takes priority).
 */
export function getAltText(artwork: {
  alt_text: string | null;
  ai_description: string | null;
  title: string;
  medium: string | null;
}): string {
  if (artwork.alt_text) return artwork.alt_text;
  if (artwork.ai_description) return artwork.ai_description;
  // Fallback: title + medium
  const parts = [artwork.title];
  if (artwork.medium) parts.push(artwork.medium);
  return parts.join(". ");
}
