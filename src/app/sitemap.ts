import type { MetadataRoute } from "next";
import { createAdminClient } from "@/lib/supabase/admin";

// Sitemap drives the cg_a11y audit tool (and search engines). Lists
// every public URL we render: home, artists index, ephemera index,
// each artist detail page, and each active artwork detail page.
// Inactive artworks are excluded — they 404 and shouldn't be tested.
//
// Uses the admin (service-role) client because Supabase caps anon
// reads at 1000 rows for exfil protection, and our catalog is ~2.2k.
// The sitemap only emits IDs/slugs that are already publicly readable
// via /artwork/[id] and /artists/[slug] for on_website rows, so this
// doesn't widen the public surface.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const supabase = createAdminClient();

  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/`, lastModified: now, priority: 1.0 },
    { url: `${baseUrl}/artists`, lastModified: now, priority: 0.9 },
    { url: `${baseUrl}/ephemera`, lastModified: now, priority: 0.8 },
  ];

  // Supabase enforces a 1000-row hard cap (db-max-rows in PostgREST)
  // that even service-role respects, so we paginate by 1k.
  const PAGE = 1000;
  const artworks: { id: string; updated_at: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("artworks")
      .select("id, updated_at")
      .eq("on_website", true)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    artworks.push(...data);
    if (data.length < PAGE) break;
  }

  const artists: { slug: string; updated_at: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("artists")
      .select("slug, updated_at")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    artists.push(...data);
    if (data.length < PAGE) break;
  }

  const artworkRoutes: MetadataRoute.Sitemap = artworks.map((a) => ({
    url: `${baseUrl}/artwork/${a.id}`,
    lastModified: a.updated_at ? new Date(a.updated_at) : now,
    priority: 0.6,
  }));

  const artistRoutes: MetadataRoute.Sitemap = artists.map((a) => ({
    url: `${baseUrl}/artists/${a.slug}`,
    lastModified: a.updated_at ? new Date(a.updated_at) : now,
    priority: 0.7,
  }));

  return [...staticRoutes, ...artistRoutes, ...artworkRoutes];
}
