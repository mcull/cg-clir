import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { generateVariants, IMAGE_VARIANTS } from "../../src/lib/image-processing";
import { artworkImageKey } from "../../src/lib/r2";

describe("artworkImageKey", () => {
  it("builds artworks/{folder}/{imageId}/{variant}.jpg", () => {
    expect(artworkImageKey("2021.123", "img-1", "thumb_400")).toBe(
      "artworks/2021.123/img-1/thumb_400.jpg"
    );
  });
  it("url-encodes the folder", () => {
    expect(artworkImageKey("a b/c", "i", "original")).toContain("a%20b%2Fc");
  });
});

describe("generateVariants", () => {
  it("returns one buffer per configured variant, with thumb_400 <= 400px wide", async () => {
    const src = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: "#888" },
    }).jpeg().toBuffer();

    const out = await generateVariants(src);
    expect(out.map((v) => v.name)).toEqual(IMAGE_VARIANTS.map((v) => v.name));

    const thumb = out.find((v) => v.name === "thumb_400")!;
    const meta = await sharp(thumb.buffer).metadata();
    expect(meta.width!).toBeLessThanOrEqual(400);
  });
});
