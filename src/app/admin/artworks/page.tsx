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

export const metadata = {
  title: "Artworks | Admin | Creative Growth Gallery",
};

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function AdminArtworksPage({ searchParams }: PageProps) {
  const { q = "" } = await searchParams;
  const { rows: artworks, truncated } = await getArtworks(q);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Artworks</h1>
        <Link href="/admin/artworks/new" className="button-primary">
          Add Artwork
        </Link>
      </div>

      <form method="get" className="mb-6 flex items-center gap-3">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search by SKU, title, or artist name…"
          className="flex-1 max-w-md px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button type="submit" className="button-secondary">Search</button>
        {q && (
          <Link href="/admin/artworks" className="text-sm text-gray-600 hover:text-gray-900">
            Clear
          </Link>
        )}
      </form>

      {q && (
        <p className="text-sm text-gray-600 mb-4">
          {artworks.length} {artworks.length === 1 ? "match" : "matches"} for &ldquo;{q}&rdquo;
          {truncated && ` (showing first ${PAGE_LIMIT} — refine your search to narrow further)`}
        </p>
      )}

      {artworks.length > 0 ? (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                  Image
                </th>
                <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                  SKU
                </th>
                <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                  Title
                </th>
                <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                  Artist
                </th>
                <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                  Medium
                </th>
                <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                  Categories
                </th>
                <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                  Published
                </th>
                <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {artworks.map((artwork) => {
                const imageUrl = resolveImageUrl(artwork);
                return (
                <tr key={artwork.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    {imageUrl && (
                      <div className="relative w-12 h-12">
                        <Image
                          src={imageUrl}
                          alt={artwork.title}
                          fill
                          className="object-cover rounded"
                          sizes="48px"
                        />
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 font-mono">
                    {artwork.sku || "—"}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900 font-medium">
                    {artwork.title}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {artwork.artist
                      ? formatArtistName(
                          artwork.artist.first_name,
                          artwork.artist.last_name
                        )
                      : "—"}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {artwork.medium || "—"}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    {artwork.categories && artwork.categories.length > 0
                      ? artwork.categories
                          .map((c: any) => c.category.name)
                          .join(", ")
                      : "—"}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        artwork.on_website
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {artwork.on_website ? "Yes" : "No"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <Link
                      href={`/admin/artworks/${artwork.id}`}
                      className="text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-12 bg-white rounded-lg">
          <p className="text-gray-600 mb-4">
            {q ? `No artworks match “${q}”.` : "No artworks yet."}
          </p>
          {!q && (
            <Link href="/admin/artworks/new" className="text-blue-600">
              Create the first artwork
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
