import { describe, expect, it } from "vitest";
import { orderImages, pickPrimary, imageAlt, reorder, withPrimary } from "../../src/lib/images";

const img = (id: string, is_primary: boolean, sort_order: number) =>
  ({ id, is_primary, sort_order, short_description: null });

describe("orderImages", () => {
  it("puts the primary first, then ascending sort_order", () => {
    const out = orderImages([img("b", false, 2), img("p", true, 5), img("a", false, 1)]);
    expect(out.map((i) => i.id)).toEqual(["p", "a", "b"]);
  });
  it("does not mutate the input", () => {
    const input = [img("a", false, 1)];
    orderImages(input);
    expect(input.length).toBe(1);
  });
});

describe("pickPrimary", () => {
  it("returns the primary image", () => {
    expect(pickPrimary([img("a", false, 0), img("p", true, 9)])?.id).toBe("p");
  });
  it("falls back to the first ordered image when none is primary", () => {
    expect(pickPrimary([img("b", false, 2), img("a", false, 1)])?.id).toBe("a");
  });
  it("returns null for an empty list", () => {
    expect(pickPrimary([])).toBeNull();
  });
});

describe("imageAlt", () => {
  const art = { title: "Untitled", medium: "Ink" };
  it("uses the image's short_description when present", () => {
    expect(imageAlt({ short_description: "Back of postcard" }, art)).toBe("Back of postcard");
  });
  it("falls back to title + medium", () => {
    expect(imageAlt({ short_description: null }, art)).toBe("Untitled. Ink");
    expect(imageAlt(null, art)).toBe("Untitled. Ink");
  });
});

describe("reorder", () => {
  it("moves an item from one index to another", () => {
    expect(reorder(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  });
});

describe("withPrimary", () => {
  it("sets is_primary true for the target id and false for the rest", () => {
    const out = withPrimary([img("a", true, 0), img("b", false, 1)], "b");
    expect(out.find((i) => i.id === "a")!.is_primary).toBe(false);
    expect(out.find((i) => i.id === "b")!.is_primary).toBe(true);
  });
});
