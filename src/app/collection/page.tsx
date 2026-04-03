import { createServerSupabaseClient } from "@/lib/supabase/server";
import CategoryTabs from "@/components/CategoryTabs";
import ArtworkGrid from "@/components/ArtworkGrid";
import ArtworkCard from "@/components/ArtworkCard";
import Pagination from "@/components/Pagination";
import { Category, Artwork } from "@/lib/types";

const ITEMS_PER_PAGE = 24;

async function getCategories(): Promise<Category[]> {
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("Error fetching categories:", error);
    return [];
  }

  return data || [];
}

async function getArtworks(
  categorySlug?: string,
  page: number = 1,
  tag?: string
): Promise<{
  artworks: (Artwork & { artist?: { id: string; first_name: string; last_name: string } })[];
  total: number;
}> {
  const supabase = createServerSupabaseClient();

  let query = supabase
    .from("artworks")
    .select(
      `
      id,
      title,
      image_url,
      image_original,
      artist:artists(id, first_name, last_name),
      categories:artwork_categories(category:categories(id, name, slug))
      `,
      { count: "exact" }
    )
    .eq("on_website", true)
    .order("sort_order", { ascending: true });

  if (categorySlug && categorySlug !== "all") {
    query = query.eq("artwork_categories.category.slug", categorySlug);
  }

  if (tag) {
    query = query.contains("tags", [tag]);
  }

  const from = (page - 1) * ITEMS_PER_PAGE;
  const to = from + ITEMS_PER_PAGE - 1;

  const { data, error, count } = await query.range(from, to);

  if (error) {
    console.error("Error fetching artworks:", error);
    return { artworks: [], total: 0 };
  }

  return {
    artworks: data || [],
    total: count || 0,
  };
}

interface CollectionPageProps {
  searchParams: Promise<{
    category?: string;
    page?: string;
    tag?: string;
  }>;
}

export const metadata = {
  title: "Collection | Creative Growth Gallery",
  description: "Browse the complete collection of artworks",
};

export default async function CollectionPage({
  searchParams,
}: CollectionPageProps) {
  const params = await searchParams;
  const categorySlug = params.category || "all";
  const currentPage = parseInt(params.page || "1", 10);
  const tag = params.tag;

  const [categories, { artworks, total }] = await Promise.all([
    getCategories(),
    getArtworks(categorySlug, currentPage, tag),
  ]);

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);

  return (
    <div className="container-max py-12">
      <h1 className="font-serif text-4xl font-bold text-gray-900 mb-8">
        Collection
      </h1>

      {categories.length > 0 && (
        <CategoryTabs categories={categories} />
      )}

      {artworks.length > 0 ? (
        <>
          <div
            role="region"
            aria-live="polite"
            aria-label="Artwork grid"
            id="artwork-grid"
          >
            <p className="text-gray-600 mb-6">
              Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1} to{" "}
              {Math.min(currentPage * ITEMS_PER_PAGE, total)} of {total} works
            </p>

            <ArtworkGrid>
              {artworks.map((artwork) => (
                <ArtworkCard key={artwork.id} artwork={artwork} />
              ))}
            </ArtworkGrid>
          </div>

          {totalPages > 1 && (
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              baseUrl="/collection"
              preserveParams={["category", "tag"]}
            />
          )}
        </>
      ) : (
        <div className="text-center py-12">
          <p className="text-gray-600 text-lg">
            No artworks found. Try a different category or search term.
          </p>
        </div>
      )}
    </div>
  );
}
