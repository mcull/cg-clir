import { strict as assert } from "node:assert";
import { test } from "node:test";
import { dateToDecade, decadeOptions } from "../src/lib/decades";

test("dateToDecade: returns null for null/empty/ND", () => {
  assert.equal(dateToDecade(null), null);
  assert.equal(dateToDecade(""), null);
  assert.equal(dateToDecade("ND"), null);
});

test("dateToDecade: bucketed to '1980s' for any 1980s date", () => {
  assert.equal(dateToDecade("1985"), "1980s");
  assert.equal(dateToDecade("1980"), "1980s");
  assert.equal(dateToDecade("1989"), "1980s");
});

test("dateToDecade: '7/20/1987' → '1980s'", () => {
  assert.equal(dateToDecade("7/20/1987"), "1980s");
});

test("dateToDecade: '2000' → '2000s', '2001' → '2000s', '2009' → '2000s'", () => {
  assert.equal(dateToDecade("2000"), "2000s");
  assert.equal(dateToDecade("2001"), "2000s");
  assert.equal(dateToDecade("2009"), "2000s");
});

test("dateToDecade: '2010' → '2010s'", () => {
  assert.equal(dateToDecade("2010"), "2010s");
});

test("dateToDecade: 'c. 1990' → '1990s'", () => {
  assert.equal(dateToDecade("c. 1990"), "1990s");
});

test("dateToDecade: out-of-range years return null", () => {
  assert.equal(dateToDecade("1850"), null);
  assert.equal(dateToDecade("0042"), null);
});

test("decadeOptions: from a list of years, returns sorted decade strings", () => {
  assert.deepEqual(decadeOptions([1985, 1990, 2003, 1989, 2010]), ["1980s", "1990s", "2000s", "2010s"]);
});

test("decadeOptions: empty input → empty array", () => {
  assert.deepEqual(decadeOptions([]), []);
});

test("decadeOptions: dedups years from same decade", () => {
  assert.deepEqual(decadeOptions([1985, 1986, 1987]), ["1980s"]);
});
