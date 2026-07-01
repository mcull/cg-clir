import { describe, expect, it } from "vitest";
import { parseBool, parseManifestRow } from "../../src/lib/image-manifest";

describe("parseBool", () => {
  it("treats true/yes/y/1 (any case) as true", () => {
    for (const v of ["true", "TRUE", "Yes", "y", "1"]) expect(parseBool(v)).toBe(true);
  });
  it("treats everything else as false", () => {
    for (const v of ["false", "no", "", "0", undefined]) expect(parseBool(v)).toBe(false);
  });
});

describe("parseManifestRow", () => {
  it("parses a valid row", () => {
    const { row, error } = parseManifestRow(
      { inventory_number: "2021.1", image_url: "https://x/a.jpg", is_primary: "yes", sort_order: "3", short_description: "Front" },
      2
    );
    expect(error).toBeUndefined();
    expect(row).toEqual({
      inventory_number: "2021.1",
      image_url: "https://x/a.jpg",
      is_primary: true,
      sort_order: 3,
      short_description: "Front",
    });
  });
  it("errors when inventory_number is missing", () => {
    expect(parseManifestRow({ image_url: "https://x/a.jpg" }, 5).error).toMatch(/inventory_number/);
  });
  it("errors when image_url is missing", () => {
    expect(parseManifestRow({ inventory_number: "2021.1" }, 5).error).toMatch(/image_url/);
  });
  it("defaults sort_order to 0 and short_description to null", () => {
    const { row } = parseManifestRow({ inventory_number: "a", image_url: "u" }, 1);
    expect(row!.sort_order).toBe(0);
    expect(row!.short_description).toBeNull();
  });
});
