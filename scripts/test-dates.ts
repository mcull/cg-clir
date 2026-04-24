import { strict as assert } from "node:assert";
import { test } from "node:test";
import { extractYear } from "../src/lib/dates";

test("returns null for null input", () => {
  assert.equal(extractYear(null), null);
});

test("returns null for empty string", () => {
  assert.equal(extractYear(""), null);
  assert.equal(extractYear("   "), null);
});

test("returns null for 'ND' (no date)", () => {
  assert.equal(extractYear("ND"), null);
  assert.equal(extractYear("nd"), null);
});

test("parses a four-digit year", () => {
  assert.equal(extractYear("1992"), 1992);
});

test("parses a four-digit year with surrounding whitespace", () => {
  assert.equal(extractYear("  2007  "), 2007);
});

test("parses a year out of a M/D/YYYY date", () => {
  assert.equal(extractYear("7/20/1987"), 1987);
});

test("parses a year out of an ISO date", () => {
  assert.equal(extractYear("1987-07-20"), 1987);
});

test("parses a year out of a circa string", () => {
  assert.equal(extractYear("c. 1990"), 1990);
  assert.equal(extractYear("circa 2003"), 2003);
});

test("parses a year out of a decade-style string by taking the first valid year", () => {
  assert.equal(extractYear("1990s"), 1990);
});

test("returns null when no four-digit year is present", () => {
  assert.equal(extractYear("nineteen ninety"), null);
  assert.equal(extractYear("?"), null);
});

test("rejects implausibly small or large years (< 1900 or > current year + 1)", () => {
  assert.equal(extractYear("0042"), null);
  assert.equal(extractYear("1850"), null);
  assert.equal(extractYear("9999"), null);
});

test("takes the first 4-digit year if multiple are present", () => {
  assert.equal(extractYear("1985-1990"), 1985);
});
