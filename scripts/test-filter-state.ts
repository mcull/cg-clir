import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseSearchParams, toQueryString, FilterState } from "../src/lib/filter-state";

test("parseSearchParams: empty input yields empty state", () => {
  const s = parseSearchParams({});
  assert.deepEqual(s, {
    q: "",
    themes: [],
    formats: [],
    mediums: [],
    decades: [],
    artist: null,
    sort: null,
    page: 1,
  });
});

test("parseSearchParams: parses single-value strings", () => {
  const s = parseSearchParams({ q: "lightbulbs", artist: "dan-miller", sort: "newest", page: "3" });
  assert.equal(s.q, "lightbulbs");
  assert.equal(s.artist, "dan-miller");
  assert.equal(s.sort, "newest");
  assert.equal(s.page, 3);
});

test("parseSearchParams: parses comma-joined multi-values", () => {
  const s = parseSearchParams({
    theme: "animals,abstract",
    format: "drawings,paintings",
    decade: "1990s,2000s",
  });
  assert.deepEqual(s.themes, ["animals", "abstract"]);
  assert.deepEqual(s.formats, ["drawings", "paintings"]);
  assert.deepEqual(s.decades, ["1990s", "2000s"]);
});

test("parseSearchParams: trims and ignores empty fragments", () => {
  const s = parseSearchParams({ theme: "animals,, abstract ," });
  assert.deepEqual(s.themes, ["animals", "abstract"]);
});

test("parseSearchParams: page clamps to >= 1", () => {
  assert.equal(parseSearchParams({ page: "0" }).page, 1);
  assert.equal(parseSearchParams({ page: "-5" }).page, 1);
  assert.equal(parseSearchParams({ page: "abc" }).page, 1);
});

test("parseSearchParams: handles array-typed params from Next.js", () => {
  const s = parseSearchParams({ theme: ["animals", "people"] as any });
  assert.deepEqual(s.themes, ["animals", "people"]);
});

test("toQueryString: round-trips a populated state", () => {
  const state: FilterState = {
    q: "lightbulbs",
    themes: ["animals", "abstract"],
    formats: ["drawings"],
    mediums: [],
    decades: ["1990s"],
    artist: "dan-miller",
    sort: "newest",
    page: 2,
  };
  const qs = toQueryString(state);
  const re = parseSearchParams(Object.fromEntries(new URLSearchParams(qs)));
  assert.deepEqual(re, state);
});

test("toQueryString: omits empty fields", () => {
  const state: FilterState = {
    q: "", themes: [], formats: [], mediums: [], decades: [], artist: null, sort: null, page: 1,
  };
  assert.equal(toQueryString(state), "");
});

test("toQueryString: omits page=1 (default)", () => {
  const state: FilterState = {
    q: "x", themes: [], formats: [], mediums: [], decades: [], artist: null, sort: null, page: 1,
  };
  assert.equal(toQueryString(state), "q=x");
});

test("toQueryString: includes page when > 1", () => {
  const state: FilterState = {
    q: "", themes: [], formats: [], mediums: [], decades: [], artist: null, sort: null, page: 3,
  };
  assert.equal(toQueryString(state), "page=3");
});

test("parseSearchParams: parses mediums from medium= param", () => {
  const s = parseSearchParams({ medium: "ink,acrylic" });
  assert.deepEqual(s.mediums, ["ink", "acrylic"]);
});

test("parseSearchParams: empty input has empty mediums array", () => {
  const s = parseSearchParams({});
  assert.deepEqual(s.mediums, []);
});

test("toQueryString: serializes mediums to medium= param", () => {
  const state = {
    q: "", themes: [], formats: [], decades: [], artist: null, sort: null, page: 1,
    mediums: ["ink", "acrylic"],
  };
  assert.equal(toQueryString(state), "medium=ink%2Cacrylic");
});

test("toQueryString round-trip preserves mediums", () => {
  const state = {
    q: "x", themes: ["animals"], formats: [], decades: [], artist: null, sort: null, page: 1,
    mediums: ["ink", "acrylic"],
  };
  const re = parseSearchParams(Object.fromEntries(new URLSearchParams(toQueryString(state))));
  assert.deepEqual(re.mediums, state.mediums);
});
