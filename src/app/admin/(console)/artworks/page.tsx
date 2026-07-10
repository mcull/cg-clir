/* eslint-disable @typescript-eslint/no-explicit-any */
import Image from "next/image";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { formatArtistName, resolveImageUrl } from "@/lib/utils";

const PAGE_LIMIT = 100;

async function getArtworks(query: string): Promise<{ rows: any[]; truncated: boolean }> {
  const supabase = createServerSupabaseClient();
  const q = query.trim();

  // For artist-name matches we need to pre-resolve artist IDs because
  // PostgREST can't .ilike across an embedded relation in a single .or().
  let matchingArtistIds: string[] = [];
  if (q) {
    const { data: artistRows } = await supabase
      .from("artists")
      .select("id")
      .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`);
    matchingArtistIds = (artistRows || []).map((a: any) => a.id);
  }

  let builder = supabase
    .from("artworks")
    .select(
      `
      id,
      title,
      sku,
      image_url,
      medium,
      on_website,
      artist:artists(id, first_name, last_name),
      categories:artwork_categories(category:categories(id, name))
      `
    );

  if (q) {
    const orClauses = [`title.ilike.%${q}%`, `sku.ilike.%${q}%`];
    if (matchingArtistIds.length > 0) {
      orClauses.push(`artist_id.in.(${matchingArtistIds.join(",")})`);
    }
    builder = builder.or(orClauses.join(","));
  }

  // Fetch one extra row to detect whether the result was truncated.
  const { data, error } = await builder
    .order("sort_order", { ascending: true })
    .limit(PAGE_LIMIT + 1);

  if (error) {
    console.error("Error fetching artworks:", error);
    return { rows: [], truncated: false };
  }
  const all = data || [];
  return { rows: all.slice(0, PAGE_LIMIT), truncated: all.length > PAGE_LIMIT };
}

// Catalog-wide totals for the header subtitle. Deliberately independent of
// the search query — these describe the whole collection, not the result set.
async function getCatalogCounts(): Promise<{ total: number; live: number }> {
  const supabase = createServerSupabaseClient();
  const [totalRes, liveRes] = await Promise.all([
    supabase.from("artworks").select("*", { count: "exact", head: true }),
    supabase
      .from("artworks")
      .select("*", { count: "exact", head: true })
      .eq("on_website", true),
  ]);
  return { total: totalRes.count || 0, live: liveRes.count || 0 };
}

export const metadata = {
  title: "Artworks | Admin | Creative Growth Gallery",
};

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function AdminArtworksPage({ searchParams }: PageProps) {
  const { q = "" } = await searchParams;
  const [{ rows: artworks }, counts] = await Promise.all([
    getArtworks(q),
    getCatalogCounts(),
  ]);

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[44px] leading-none tracking-[-0.5px]">Artworks</h1>
          <p className="mt-3 text-sm text-muted">
            {counts.total.toLocaleString()} pieces in the catalog — {counts.live.toLocaleString()}{" "}
            live on the site.
          </p>
        </div>
        <Link
          href="/admin/artworks/new"
          className="admin-btn admin-btn-primary px-[22px] py-3 text-xs tracking-[2px]"
        >
          + Add Artwork
        </Link>
      </div>

      <form method="get" className="mt-8 flex items-center gap-3">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search by SKU, title, or artist name…"
          className="admin-field max-w-[440px] w-full border border-ink bg-card px-4 py-3 text-sm"
        />
        <button
          type="submit"
          className="admin-btn admin-btn-secondary px-[22px] py-3 text-xs tracking-[2px]"
        >
          Search
        </button>
        {q && (
          <Link href="/admin/artworks" className="text-xs text-muted hover:text-ink">
            Clear
          </Link>
        )}
      </form>

      {artworks.length > 0 ? (
        <div className="mt-8 border border-ink bg-card">
          <table className="w-full table-fixed">
            <colgroup>
              <col className="w-[72px]" />
              <col className="w-[130px]" />
              <col />
              <col />
              <col />
              <col />
              <col className="w-[90px]" />
              <col className="w-[70px]" />
            </colgroup>
            <thead className="bg-ink text-paper">
              <tr>
                <th className="px-5 py-3 text-left text-[10px] uppercase tracking-[1.8px]">
                  Image
                </th>
                <th className="px-5 py-3 text-left text-[10px] uppercase tracking-[1.8px]">
                  SKU
                </th>
                <th className="px-5 py-3 text-left text-[10px] uppercase tracking-[1.8px]">
                  Title
                </th>
                <th className="px-5 py-3 text-left text-[10px] uppercase tracking-[1.8px]">
                  Artist
                </th>
                <th className="px-5 py-3 text-left text-[10px] uppercase tracking-[1.8px]">
                  Medium
                </th>
                <th className="px-5 py-3 text-left text-[10px] uppercase tracking-[1.8px]">
                  Categories
                </th>
                <th className="px-5 py-3 text-left text-[10px] uppercase tracking-[1.8px]">
                  Published
                </th>
                <th className="px-5 py-3 text-left text-[10px] uppercase tracking-[1.8px]">
                  <span className="sr-only">Edit</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {artworks.map((artwork) => {
                const imageUrl = resolveImageUrl(artwork);
                return (
                  <tr key={artwork.id} className="hover:bg-row-hover">
                    <td className="px-5 py-3 border-b border-hairline">
                      {imageUrl && (
                        <div className="relative h-12 w-12 border border-line">
                          <Image
                            src={imageUrl}
                            alt={artwork.title}
                            fill
                            className="object-cover"
                            sizes="48px"
                          />
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3 border-b border-hairline font-mono text-xs text-muted">
                      {artwork.sku || "—"}
                    </td>
                    <td className="px-5 py-3 border-b border-hairline text-sm text-ink">
                      {artwork.title}
                    </td>
                    <td className="px-5 py-3 border-b border-hairline text-[13px] text-muted truncate">
                      {artwork.artist
                        ? formatArtistName(
                            artwork.artist.first_name,
                            artwork.artist.last_name
                          )
                        : "—"}
                    </td>
                    <td className="px-5 py-3 border-b border-hairline text-[13px] text-muted truncate">
                      {artwork.medium || "—"}
                    </td>
                    <td className="px-5 py-3 border-b border-hairline text-[13px] text-muted truncate">
                      {artwork.categories && artwork.categories.length > 0
                        ? artwork.categories
                            .map((c: any) => c.category.name)
                            .join(", ")
                        : "—"}
                    </td>
                    <td className="px-5 py-3 border-b border-hairline">
                      <span className="inline-flex items-center gap-2 text-xs">
                        <span
                          className={`inline-block h-2 w-2 rounded-full ${
                            artwork.on_website ? "bg-green" : "bg-line"
                          }`}
                        />
                        {artwork.on_website ? "Live" : "Draft"}
                      </span>
                    </td>
                    <td className="px-5 py-3 border-b border-hairline">
                      <Link
                        href={`/admin/artworks/${artwork.id}`}
                        className="text-xs uppercase tracking-[1.5px] text-green hover:underline"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="px-5 py-3.5 text-xs text-faint">
            Showing the first {PAGE_LIMIT}. Search to dig deeper.
          </p>
        </div>
      ) : (
        <div className="mt-8 border border-ink bg-card py-12 text-center">
          <p className="mb-4 text-sm text-muted">
            {q ? `No artworks match “${q}”.` : "No artworks yet."}
          </p>
          {!q && (
            <Link href="/admin/artworks/new" className="text-xs uppercase tracking-[1.5px] text-green hover:underline">
              Create the first artwork
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
