/**
 * Fetch every row across Supabase/PostgREST's 1000-row page cap by walking
 * ranges until a short page signals the end. Pass a `fetchPage(from, to)`
 * that runs `.range(from, to)` for one page; results are concatenated.
 *
 * Framework-free and dependency-injected so the pagination logic (where
 * off-by-one bugs hide) can be unit-tested without a live database.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  pageSize = 1000
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const page = await fetchPage(from, from + pageSize - 1);
    all.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return all;
}
