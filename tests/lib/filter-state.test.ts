import { describe, expect, it } from "vitest";
import { parseSearchParams, toQueryString } from "../../src/lib/filter-state";

const baseState = {
  q: "",
  themes: [],
  formats: [],
  mediums: [],
  decades: [],
  artist: null,
  sort: null,
  audio: false,
  page: 1,
} as const;

describe("filter-state audio param", () => {
  it("parses audio=1 as true", () => {
    expect(parseSearchParams({ audio: "1" }).audio).toBe(true);
  });

  it("parses audio=true as true", () => {
    expect(parseSearchParams({ audio: "true" }).audio).toBe(true);
  });

  it("parses audio=yes (case-insensitive) as true", () => {
    expect(parseSearchParams({ audio: "YES" }).audio).toBe(true);
  });

  it("parses absence as false", () => {
    expect(parseSearchParams({}).audio).toBe(false);
  });

  it("parses audio=0 as false", () => {
    expect(parseSearchParams({ audio: "0" }).audio).toBe(false);
  });

  it("parses audio=garbage as false", () => {
    expect(parseSearchParams({ audio: "lol" }).audio).toBe(false);
  });

  it("emits audio=1 when true", () => {
    const qs = toQueryString({ ...baseState, audio: true });
    expect(qs).toBe("audio=1");
  });

  it("omits audio when false", () => {
    const qs = toQueryString({ ...baseState, audio: false });
    expect(qs).toBe("");
  });

  it("composes with other params", () => {
    const qs = toQueryString({ ...baseState, q: "scott", themes: ["animals"], audio: true });
    const params = new URLSearchParams(qs);
    expect(params.get("q")).toBe("scott");
    expect(params.get("theme")).toBe("animals");
    expect(params.get("audio")).toBe("1");
  });
});
