/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { hogql } from "@/lib/posthog-query";
import { formatArtistName } from "@/lib/utils";

// Re-evaluate analytics every 5 minutes so the dashboard stays cheap to
// load and PostHog isn't queried on every refresh.
export const revalidate = 300;

async function getCatalogStats() {
  const supabase = createServerSupabaseClient();

  const [activeArtworksRes, ephemeraRes, artistsRes, humanDescRes, audioRes] =
    await Promise.all([
      supabase
        .from("artworks")
        .select("*", { count: "exact", head: true })
        .eq("on_website", true)
        .or("tags.is.null,tags.not.cs.{ephemera}"),
      supabase
        .from("artworks")
        .select("*", { count: "exact", head: true })
        .eq("on_website", true)
        .contains("tags", ["ephemera"]),
      supabase
        .from("artists")
        .select("*", { count: "exact", head: true }),
      supabase
        .from("artworks")
        .select("*", { count: "exact", head: true })
        .eq("on_website", true)
        .eq("description_origin", "human"),
      supabase
        .from("artworks")
        .select("*", { count: "exact", head: true })
        .eq("on_website", true)
        .not("audio_url", "is", null),
    ]);

  return {
    artworks: activeArtworksRes.count || 0,
    ephemera: ephemeraRes.count || 0,
    artists: artistsRes.count || 0,
    humanDescriptions: humanDescRes.count || 0,
    audioPieces: audioRes.count || 0,
  };
}

async function getDownloadStats() {
  const supabase = createServerSupabaseClient();
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [allTimeRes, last30Res, last7Res, topArtworksRes] = await Promise.all([
    supabase.from("download_events").select("*", { count: "exact", head: true }),
    supabase
      .from("download_events")
      .select("*", { count: "exact", head: true })
      .gte("created_at", since30),
    supabase
      .from("download_events")
      .select("*", { count: "exact", head: true })
      .gte("created_at", since7),
    // Top-downloaded artworks last 30 days. Group client-side because
    // PostgREST aggregates are clunky.
    supabase
      .from("download_events")
      .select("artwork_id, artwork:artworks(id, title, artist:artists(first_name, last_name))")
      .gte("created_at", since30)
      .limit(10000),
  ]);

  const counts = new Map<string, { artwork: any; count: number }>();
  for (const row of (topArtworksRes.data as any[]) || []) {
    const id = row.artwork_id;
    if (!id || !row.artwork) continue;
    const entry = counts.get(id);
    if (entry) entry.count++;
    else counts.set(id, { artwork: row.artwork, count: 1 });
  }
  const topArtworks = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 10);

  return {
    total: allTimeRes.count || 0,
    last30: last30Res.count || 0,
    last7: last7Res.count || 0,
    topArtworks,
  };
}

interface CountRow extends Array<unknown> {
  0: number | string;
}
interface PathCountRow extends Array<unknown> {
  0: string;
  1: number | string;
}
interface CountryRow extends Array<unknown> {
  0: string;
  1: number | string;
}

async function getVisitorStats() {
  // Three queries in parallel: total page views, unique visitors,
  // geography breakdown. Each handles its own null fallback.
  const [pvRes, uniqRes, geoRes] = await Promise.all([
    hogql<CountRow>(
      `SELECT count() FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL 30 DAY`
    ),
    hogql<CountRow>(
      `SELECT uniq(distinct_id) FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL 30 DAY`
    ),
    hogql<CountryRow>(
      `SELECT properties.$geoip_country_name AS country, uniq(distinct_id) AS visitors
       FROM events
       WHERE event = '$pageview' AND timestamp >= now() - INTERVAL 30 DAY
         AND properties.$geoip_country_name != ''
       GROUP BY country ORDER BY visitors DESC LIMIT 10`
    ),
  ]);

  return {
    pageViews: pvRes ? Number(pvRes.results?.[0]?.[0] ?? 0) : null,
    uniqueVisitors: uniqRes ? Number(uniqRes.results?.[0]?.[0] ?? 0) : null,
    geography: geoRes
      ? geoRes.results.map((r) => ({ country: r[0], visitors: Number(r[1]) }))
      : null,
  };
}

async function getTopViewedArtworks() {
  const phRes = await hogql<PathCountRow>(
    `SELECT properties.$pathname AS path, count() AS views
     FROM events
     WHERE event = '$pageview'
       AND timestamp >= now() - INTERVAL 30 DAY
       AND properties.$pathname LIKE '/artwork/%'
     GROUP BY path ORDER BY views DESC LIMIT 10`
  );
  if (!phRes) return null;

  // Resolve UUIDs back to artwork titles.
  const supabase = createServerSupabaseClient();
  const ids = phRes.results
    .map((r) => (typeof r[0] === "string" ? r[0].split("/artwork/")[1] : null))
    .filter((id): id is string => !!id && /^[0-9a-f-]{36}$/i.test(id));
  if (ids.length === 0) return [];

  const { data: artworks } = await supabase
    .from("artworks")
    .select("id, title, artist:artists(first_name, last_name)")
    .in("id", ids);
  const byId = new Map((artworks || []).map((a: any) => [a.id, a]));

  return phRes.results
    .map((r) => {
      const path = String(r[0]);
      const id = path.split("/artwork/")[1];
      const artwork = byId.get(id);
      return artwork
        ? { id, artwork, views: Number(r[1]) }
        : { id, artwork: null, views: Number(r[1]) };
    })
    .filter((row) => row.artwork);
}

export const metadata = {
  title: "Dashboard | Admin | Creative Growth Gallery",
};

export default async function AdminDashboard() {
  const [stats, downloads, visitors, topViewed] = await Promise.all([
    getCatalogStats(),
    getDownloadStats(),
    getVisitorStats(),
    getTopViewedArtworks(),
  ]);

  const phMissing = visitors.pageViews === null;

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Dashboard</h1>

      {/* Catalog snapshot */}
      <h2 className="text-sm font-bold text-gray-600 uppercase tracking-wider mb-3">Catalog</h2>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
        <StatCard title="Active artworks" value={stats.artworks} color="blue" />
        <StatCard title="Active ephemera" value={stats.ephemera} color="purple" />
        <StatCard title="Artists" value={stats.artists} color="green" />
        <StatCard title="Human descriptions" value={stats.humanDescriptions} color="green" />
        <StatCard title="With audio" value={stats.audioPieces} color="orange" />
      </div>

      {/* Activity */}
      <h2 className="text-sm font-bold text-gray-600 uppercase tracking-wider mb-3">
        Visitor activity (last 30 days)
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          title="Page views"
          value={visitors.pageViews}
          color="blue"
          fallback={phMissing ? "PostHog not configured" : undefined}
        />
        <StatCard
          title="Unique visitors"
          value={visitors.uniqueVisitors}
          color="green"
          fallback={phMissing ? "PostHog not configured" : undefined}
        />
        <StatCard title="Downloads (30d)" value={downloads.last30} color="orange" />
        <StatCard title="Downloads (7d)" value={downloads.last7} color="orange" />
      </div>

      {/* Top tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <Card title="Most-viewed artworks (last 30d)">
          {topViewed === null ? (
            <EmptyNote>Waiting on PostHog data.</EmptyNote>
          ) : topViewed.length === 0 ? (
            <EmptyNote>No artwork pageviews recorded yet.</EmptyNote>
          ) : (
            <RankedList
              items={topViewed.map((row) => ({
                key: row.id,
                primary: row.artwork.title,
                secondary: row.artwork.artist
                  ? formatArtistName(
                      row.artwork.artist.first_name,
                      row.artwork.artist.last_name
                    )
                  : "Unknown",
                value: row.views,
                href: `/artwork/${row.id}`,
              }))}
              valueLabel="views"
            />
          )}
        </Card>

        <Card title="Most-downloaded artworks (last 30d)">
          {downloads.topArtworks.length === 0 ? (
            <EmptyNote>No downloads in the last 30 days.</EmptyNote>
          ) : (
            <RankedList
              items={downloads.topArtworks.map(({ artwork, count }) => ({
                key: artwork.id,
                primary: artwork.title,
                secondary: artwork.artist
                  ? formatArtistName(
                      artwork.artist.first_name,
                      artwork.artist.last_name
                    )
                  : "Unknown",
                value: count,
                href: `/artwork/${artwork.id}`,
              }))}
              valueLabel="downloads"
            />
          )}
        </Card>
      </div>

      {/* Geography */}
      <Card title="Geography (last 30d)">
        {visitors.geography === null ? (
          <EmptyNote>Waiting on PostHog data.</EmptyNote>
        ) : visitors.geography.length === 0 ? (
          <EmptyNote>No geo-located pageviews yet.</EmptyNote>
        ) : (
          <RankedList
            items={visitors.geography.map((row) => ({
              key: row.country,
              primary: row.country,
              value: row.visitors,
            }))}
            valueLabel="visitors"
          />
        )}
      </Card>

      <p className="text-xs text-gray-500 mt-6">
        Visitor stats refresh every 5 minutes. Downloads track instantly.
      </p>
    </div>
  );
}

function StatCard({
  title,
  value,
  color,
  fallback,
}: {
  title: string;
  value: number | null;
  color: "blue" | "green" | "purple" | "orange";
  fallback?: string;
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
      {value === null ? (
        <p className="text-sm mt-2 opacity-60 italic">{fallback || "—"}</p>
      ) : (
        <p className="text-3xl font-bold mt-2">{value.toLocaleString()}</p>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg shadow">
      <div className="p-6 border-b border-gray-200">
        <h3 className="text-lg font-bold text-gray-900">{title}</h3>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-500 italic">{children}</p>;
}

interface RankedItem {
  key: string;
  primary: string;
  secondary?: string;
  value: number;
  href?: string;
}

function RankedList({ items, valueLabel }: { items: RankedItem[]; valueLabel: string }) {
  return (
    <ol className="space-y-2">
      {items.map((item, i) => (
        <li key={item.key} className="flex items-center gap-3 text-sm">
          <span className="w-6 text-right text-gray-400 font-mono">{i + 1}.</span>
          <div className="flex-1 min-w-0">
            {item.href ? (
              <Link
                href={item.href}
                className="text-gray-900 hover:text-blue-600 truncate block"
              >
                {item.primary}
              </Link>
            ) : (
              <span className="text-gray-900">{item.primary}</span>
            )}
            {item.secondary && (
              <span className="text-xs text-gray-500">{item.secondary}</span>
            )}
          </div>
          <span className="text-gray-600 font-medium tabular-nums">
            {item.value.toLocaleString()}{" "}
            <span className="text-xs font-normal text-gray-400">{valueLabel}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
