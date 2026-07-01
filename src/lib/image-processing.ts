import sharp from "sharp";

/** Variants generated for every artwork image, widest first. */
export const IMAGE_VARIANTS = [
  { name: "original", maxWidth: null },
  { name: "large_1600", maxWidth: 1600 },
  { name: "medium_800", maxWidth: 800 },
  { name: "thumb_400", maxWidth: 400 },
] as const;

export type VariantName = (typeof IMAGE_VARIANTS)[number]["name"];

/** Resize an input image into all configured JPEG variants. */
export async function generateVariants(
  input: Buffer
): Promise<{ name: VariantName; buffer: Buffer }[]> {
  const out: { name: VariantName; buffer: Buffer }[] = [];
  for (const v of IMAGE_VARIANTS) {
    const pipeline =
      v.maxWidth == null
        ? sharp(input)
        : sharp(input).resize({ width: v.maxWidth, withoutEnlargement: true });
    out.push({ name: v.name, buffer: await pipeline.jpeg({ quality: 85 }).toBuffer() });
  }
  return out;
}
