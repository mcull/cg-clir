/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { formatArtistName } from "@/lib/utils";

async function getStats() {
  const supabase = createServerSupabaseClient();

  const [artworksRes, artistsRes, categoriesRes, downloadsRes] =
    await Promise.all([
      supabase
        .from("artworks")
        .select("*", { count: "exact", head: true })
        .eq("on_website", true),
      supabase
        .from("artists")
        .select("*", { count: "exact", head: true }),
      supabase
        .from("categories")
        .select("*", { count: "exact", head: true }),
      supabase
        .from("download_events")
        .select("*", { count: "exact", head: true }),
    ]);

  return {
    artworks: artworksRes.count || 0,
    artists: artistsRes.count || 0,
    categories: categoriesRes.count || 0,
    downloads: downloadsRes.count || 0,
  };
}

async function getRecentDownloads() {
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("download_events")
    .select(
      `
      id,
      created_at,
      user_agent,
      artwork:artworks(id, title, artist_id, artist:artists(first_name, last_name))
      `
    )
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error("Error fetching downloads:", error);
    return [];
  }

  return data || [];
}

export const metadata = {
  title: "Dashboard | Admin | Creative Growth Gallery",
};

export default async function AdminDashboard() {
  const [stats, recentDownloads] = await Promise.all([
    getStats(),
    getRecentDownloads(),
  ]);

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Dashboard</h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          title="Total Artworks"
          value={stats.artworks}
          color="blue"
        />
        <StatCard
          title="Total Artists"
          value={stats.artists}
          color="green"
        />
        <StatCard
          title="Categories"
          value={stats.categories}
          color="purple"
        />
        <StatCard
          title="Downloads"
          value={stats.downloads}
          color="orange"
        />
      </div>

      {/* Recent Downloads */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Recent Downloads</h2>
        </div>

        {recentDownloads.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                    Artwork
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                    Artist
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                    Downloaded
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                    Device
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {recentDownloads.map((event: any) => {
                  const artwork = event.artwork as any;
                  return (
                    <tr key={event.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {artwork?.title || "Unknown"}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {artwork?.artist
                        ? formatArtistName(
                            artwork.artist.first_name,
                            artwork.artist.last_name
                          )
                        : "Unknown"}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {new Date(event.created_at).toLocaleDateString(
                        "en-US",
                        {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        }
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      <span className="text-xs bg-gray-100 px-2 py-1 rounded">
                        {event.user_agent
                          ? event.user_agent.substring(0, 40) + "..."
                          : "Unknown"}
                      </span>
                    </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-6 text-center text-gray-600">
            No downloads yet.
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  color,
}: {
  title: string;
  value: number;
  color: "blue" | "green" | "purple" | "orange";
}) {
  const colorClasses = {
    blue: "bg-blue-50 text-blue-900 border-blue-200",
    green: "bg-green-50 text-green-900 border-green-200",
    purple: "bg-purple-50 text-purple-900 border-purple-200",
    orange: "bg-orange-50 text-orange-900 border-orange-200",
  };

  return (
    <div className={`${colorClasses[color]} p-6 rounded-lg border`}>
      <p className="text-sm font-medium opacity-75">{title}</p>
      <p className="text-3xl font-bold mt-2">{value}</p>
    </div>
  );
}
