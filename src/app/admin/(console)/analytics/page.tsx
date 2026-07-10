/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { formatArtistName } from "@/lib/utils";
import { Artwork } from "@/lib/types";
import StatCard from "@/components/admin/StatCard";
import SectionHeader from "@/components/admin/SectionHeader";

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

  const maxRecentCount = Math.max(...recentDays.map(([, c]) => c), 1);

  return (
    <div>
      <h1 className="text-[44px] leading-none tracking-[-0.5px]">
        Analytics
      </h1>
      <p className="mt-3 text-sm text-muted">
        Download activity across the digital archive.
      </p>

      {/* Overview */}
      <div className="mt-12 space-y-3.5">
        <SectionHeader title="OVERVIEW" />
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
          <StatCard label="Total downloads" value={totalDownloads} />
          <StatCard
            label="Days with activity"
            value={Object.keys(downloadsByDay).length}
          />
          <StatCard
            label="Top artwork downloads"
            value={topArtworks[0]?.count || 0}
          />
        </div>
      </div>

      {/* Top Artworks */}
      {topArtworks.length > 0 && (
        <div className="mt-12 space-y-3.5">
          <SectionHeader title="MOST DOWNLOADED ARTWORKS" />
          <div className="border border-ink bg-card">
            <ol>
              {topArtworks.map((artwork: DownloadCount, idx) => (
                <li
                  key={artwork.id}
                  className="flex items-center gap-4 border-b border-hairline px-6 py-4 last:border-0"
                >
                  <span className="min-w-[26px] text-[34px] leading-none text-[#D9D3C5]">
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">
                      {artwork.title}
                    </p>
                    {artwork.artist && (
                      <p className="text-xs text-muted">
                        {formatArtistName(
                          artwork.artist.first_name,
                          artwork.artist.last_name
                        )}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-2xl tabular-nums text-green">
                      {artwork.count}
                    </p>
                    <p className="text-[11px] uppercase tracking-[1px] text-faint">
                      downloads
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}

      {/* Download Trend */}
      {recentDays.length > 0 && (
        <div className="mt-12 space-y-3.5">
          <SectionHeader title="DOWNLOADS" qualifier="LAST 30 DAYS" />
          <div className="border border-ink bg-card px-6 py-5">
            <div className="space-y-2.5">
              {recentDays.map(([day, count]) => (
                <div key={day} className="flex items-center gap-4">
                  <span className="w-24 text-xs text-muted">{day}</span>
                  <div className="flex h-8 flex-1 items-center bg-hairline">
                    <div
                      className="flex h-full items-center justify-end bg-green pr-2"
                      style={{
                        width: `${Math.max(
                          (count / maxRecentCount) * 100,
                          3
                        )}%`,
                      }}
                    >
                      {count > 0 && (
                        <span className="text-xs text-paper">{count}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
