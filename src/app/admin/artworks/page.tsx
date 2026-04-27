/* eslint-disable @typescript-eslint/no-explicit-any */
import Image from "next/image";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { formatArtistName, resolveImageUrl } from "@/lib/utils";

async function getArtworks(): Promise<any[]> {
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("artworks")
    .select(
      `
      id,
      title,
      image_url,
      medium,
      on_website,
      artist:artists(id, first_name, last_name),
      categories:artwork_categories(category:categories(id, name))
      `
    )
    .order("sort_order", { ascending: true })
    .limit(50);

  if (error) {
    console.error("Error fetching artworks:", error);
    return [];
  }

  return data || [];
}

export const metadata = {
  title: "Artworks | Admin | Creative Growth Gallery",
};

export default async function AdminArtworksPage() {
  const artworks = await getArtworks();

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Artworks</h1>
        <Link
          href="/admin/artworks/new"
          className="button-primary"
        >
          Add Artwork
        </Link>
      </div>

      {artworks.length > 0 ? (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                  Image
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
          <p className="text-gray-600 mb-4">No artworks yet.</p>
          <Link href="/admin/artworks/new" className="text-blue-600">
            Create the first artwork
          </Link>
        </div>
      )}
    </div>
  );
}
