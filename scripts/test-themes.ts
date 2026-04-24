import { strict as assert } from "node:assert";
import { test } from "node:test";
import { normalizeThemes, VALID_THEMES } from "../src/lib/themes";

test("strips 'clir' prefix and returns the bare slug", () => {
  assert.deepEqual(normalizeThemes("clir abstract"), ["abstract"]);
});

test("strips 'clear' prefix as well as 'clir'", () => {
  assert.deepEqual(normalizeThemes("clear plants"), ["plants"]);
});

test("accepts comma-separated multi-theme strings", () => {
  assert.deepEqual(
    normalizeThemes("clir abstract, clir people"),
    ["abstract", "people"]
  );
});

test("trims whitespace and lowercases", () => {
  assert.deepEqual(normalizeThemes("  CLIR Abstract  "), ["abstract"]);
});

test("preserves multi-word themes ('pop culture')", () => {
  assert.deepEqual(normalizeThemes("clir pop culture"), ["pop culture"]);
});

test("returns empty array for empty input", () => {
  assert.deepEqual(normalizeThemes(""), []);
  assert.deepEqual(normalizeThemes("   "), []);
});

test("dedupes within a single row", () => {
  assert.deepEqual(
    normalizeThemes("clir abstract, clear abstract"),
    ["abstract"]
  );
});

test("drops values not in the fixed VALID_THEMES set", () => {
  // 'date tag' style values should not survive
  assert.deepEqual(normalizeThemes("clir 1980s"), []);
  assert.deepEqual(normalizeThemes("clir music, clir bogus"), ["music"]);
});

test("VALID_THEMES is exactly the 8 expected values", () => {
  assert.deepEqual(
    [...VALID_THEMES].sort(),
    ["abstract", "animals", "food", "music", "other", "people", "plants", "pop culture"]
  );
});

test("returns themes in the order they appear (after dedup)", () => {
  assert.deepEqual(
    normalizeThemes("clir music, clir abstract, clir people"),
    ["music", "abstract", "people"]
  );
});
