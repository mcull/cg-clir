/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { formatArtistName } from "@/lib/utils";
import { Artwork } from "@/lib/types";

interface DownloadCount extends Artwork {
  count: number;
}

async function getAnalytics() {
  const supabase = createServerSupabaseClient();

  // Get top downloaded artworks
  const { data: topDownloads, error: downloadsError } = await supabase
    .from("download_events")
    .select(
      `
      artwork_id,
      artwork:artworks(id, title, artist_id, artist:artists(first_name, last_name))
      `
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (downloadsError) {
    console.error("Error fetching downloads:", downloadsError);
  }

  // Count downloads by artwork
  const downloadCounts: { [key: string]: DownloadCount } = {};
  (topDownloads || []).forEach((event: any) => {
    if (event.artwork_id) {
      if (!downloadCounts[event.artwork_id]) {
        downloadCounts[event.artwork_id] = {
          ...event.artwork,
          count: 0,
        };
      }
      downloadCounts[event.artwork_id].count += 1;
    }
  });

  const topArtworks = Object.values(downloadCounts)
    .sort((a: DownloadCount, b: DownloadCount) => b.count - a.count)
    .slice(0, 10);

  // Get download trend over time
  const { data: allDownloads, error: trendError } = await supabase
    .from("download_events")
    .select("created_at")
    .order("created_at", { ascending: true });

  if (trendError) {
    console.error("Error fetching trend:", trendError);
  }

  const downloadsByDay: { [key: string]: number } = {};
  (allDownloads || []).forEach((event: { created_at: string }) => {
    const day = event.created_at.split("T")[0];
    downloadsByDay[day] = (downloadsByDay[day] || 0) + 1;
  });

  return {
    topArtworks,
    downloadsByDay,
    totalDownloads: allDownloads?.length || 0,
  };
}

export const metadata = {
  title: "Analytics | Admin | Creative Growth Gallery",
};

export default async function AnalyticsPage() {
  const { topArtworks, downloadsByDay, totalDownloads } =
    await getAnalytics();

  const recentDays = Object.entries(downloadsByDay)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 30);

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Analytics</h1>

      {/* Overview */}
      <div className="bg-white rounded-lg shadow p-8 mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-4">Overview</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <p className="text-sm text-gray-600">Total Downloads</p>
            <p className="text-3xl font-bold text-gray-900">{totalDownloads}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Days with Activity</p>
            <p className="text-3xl font-bold text-gray-900">
              {Object.keys(downloadsByDay).length}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Top Artwork Downloads</p>
            <p className="text-3xl font-bold text-gray-900">
              {topArtworks[0]?.count || 0}
            </p>
          </div>
        </div>
      </div>

      {/* Top Artworks */}
      {topArtworks.length > 0 && (
        <div className="bg-white rounded-lg shadow p-8 mb-8">
          <h2 className="text-lg font-bold text-gray-900 mb-4">
            Most Downloaded Artworks
          </h2>
          <div className="space-y-4">
            {topArtworks.map((artwork: DownloadCount, idx) => (
              <div
                key={artwork.id}
                className="flex items-center justify-between p-4 border border-gray-200 rounded"
              >
                <div className="flex-1">
                  <p className="font-medium text-gray-900">
                    {idx + 1}. {artwork.title}
                  </p>
                  {artwork.artist && (
                    <p className="text-sm text-gray-600">
                      {formatArtistName(
                        artwork.artist.first_name,
                        artwork.artist.last_name
                      )}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-blue-600">
                    {artwork.count}
                  </p>
                  <p className="text-xs text-gray-600">downloads</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Download Trend */}
      {recentDays.length > 0 && (
        <div className="bg-white rounded-lg shadow p-8">
          <h2 className="text-lg font-bold text-gray-900 mb-4">
            Downloads Last 30 Days
          </h2>
          <div className="space-y-2">
            {recentDays.map(([day, count]) => (
              <div key={day} className="flex items-center gap-4">
                <span className="w-24 text-sm text-gray-600">{day}</span>
                <div className="flex-1 bg-gray-200 rounded h-8 flex items-center">
                  <div
                    className="bg-blue-600 h-full rounded flex items-center justify-end pr-2"
                    style={{
                      width: `${Math.max(
                        (count / (Math.max(...recentDays.map(([, c]) => c)) || 1)) *
                          100,
                        3
                      )}%`,
                    }}
                  >
                    {count > 0 && (
                      <span className="text-xs font-bold text-white">{count}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
