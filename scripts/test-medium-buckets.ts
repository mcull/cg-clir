import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mediumToBuckets, parseProposedBuckets } from "./lib/medium-buckets";

test("mediumToBuckets: returns buckets from the map", () => {
  const map = { "Ink on paper": ["Ink"], "Acrylic and ink on paper": ["Acrylic", "Ink"] };
  assert.deepEqual(mediumToBuckets(map, "Ink on paper"), ["Ink"]);
  assert.deepEqual(mediumToBuckets(map, "Acrylic and ink on paper"), ["Acrylic", "Ink"]);
});

test("mediumToBuckets: returns empty for unknown medium", () => {
  assert.deepEqual(mediumToBuckets({}, "Crayon on bark"), []);
});

test("mediumToBuckets: trims whitespace before lookup", () => {
  const map = { "Ink on paper": ["Ink"] };
  assert.deepEqual(mediumToBuckets(map, "  Ink on paper  "), ["Ink"]);
});

test("mediumToBuckets: returns empty for null/empty input", () => {
  assert.deepEqual(mediumToBuckets({}, ""), []);
  assert.deepEqual(mediumToBuckets({}, null), []);
});

test("parseProposedBuckets: splits semicolon-joined cell, trims, drops empties", () => {
  assert.deepEqual(parseProposedBuckets("Ink"), ["Ink"]);
  assert.deepEqual(parseProposedBuckets("Color Stix; Ink; Colored pencil"), ["Color Stix", "Ink", "Colored pencil"]);
  assert.deepEqual(parseProposedBuckets("  Ink  ;;  Pastel  "), ["Ink", "Pastel"]);
  assert.deepEqual(parseProposedBuckets(""), []);
});
