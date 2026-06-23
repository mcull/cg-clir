import { describe, expect, it } from "vitest";
import { fetchAllPages } from "../../src/lib/paginate";

// A fake page fetcher over an in-memory array that records the ranges asked for.
function makeFetcher(total: number) {
  const data = Array.from({ length: total }, (_, i) => i);
  const calls: Array<[number, number]> = [];
  const fetchPage = async (from: number, to: number) => {
    calls.push([from, to]);
    return data.slice(from, to + 1);
  };
  return { fetchPage, calls };
}

describe("fetchAllPages", () => {
  it("returns all rows when total spans multiple pages (partial last page)", async () => {
    const { fetchPage } = makeFetcher(2573);
    const rows = await fetchAllPages(fetchPage, 1000);
    expect(rows.length).toBe(2573);
    expect(rows[0]).toBe(0);
    expect(rows[2572]).toBe(2572);
  });

  it("requests correct, contiguous ranges", async () => {
    const { fetchPage, calls } = makeFetcher(2573);
    await fetchAllPages(fetchPage, 1000);
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("handles a total that is an exact multiple of the page size", async () => {
    const { fetchPage, calls } = makeFetcher(2000);
    const rows = await fetchAllPages(fetchPage, 1000);
    expect(rows.length).toBe(2000);
    // One extra empty fetch is expected to confirm the end.
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("handles a single short page", async () => {
    const { fetchPage, calls } = makeFetcher(42);
    const rows = await fetchAllPages(fetchPage, 1000);
    expect(rows.length).toBe(42);
    expect(calls).toEqual([[0, 999]]);
  });

  it("handles empty results", async () => {
    const { fetchPage, calls } = makeFetcher(0);
    const rows = await fetchAllPages(fetchPage, 1000);
    expect(rows).toEqual([]);
    expect(calls).toEqual([[0, 999]]);
  });
});
