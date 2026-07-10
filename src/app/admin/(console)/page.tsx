/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { hogql } from "@/lib/posthog-query";
import { formatArtistName } from "@/lib/utils";
import StatCard from "@/components/admin/StatCard";
import SectionHeader from "@/components/admin/SectionHeader";

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
      <h1 className="text-[44px] leading-none tracking-[-0.5px]">Dashboard</h1>
      <p className="mt-3 text-sm text-muted">The collection, counted.</p>

      {/* Catalog snapshot */}
      <div className="mt-12 space-y-3.5">
        <SectionHeader title="CATALOG" />
        <div className="grid grid-cols-5 gap-3.5">
          <StatCard
            label="Active artworks"
            value={stats.artworks}
            swatch="oklch(0.62 0.13 145)"
          />
          <StatCard
            label="Active ephemera"
            value={stats.ephemera}
            swatch="oklch(0.62 0.13 300)"
          />
          <StatCard label="Artists" value={stats.artists} swatch="oklch(0.62 0.13 250)" />
          <StatCard
            label="Human descriptions"
            value={stats.humanDescriptions}
            swatch="oklch(0.62 0.13 85)"
          />
          <StatCard
            label="With audio"
            value={stats.audioPieces}
            swatch="oklch(0.62 0.13 25)"
          />
        </div>
      </div>

      {/* Activity */}
      <div className="mt-12 space-y-3.5">
        <SectionHeader title="VISITOR ACTIVITY" qualifier="LAST 30 DAYS" />
        <div className="grid grid-cols-4 gap-3.5">
          <StatCard label="Page views" value={phMissing ? "—" : (visitors.pageViews as number)} />
          <StatCard
            label="Unique visitors"
            value={phMissing ? "—" : (visitors.uniqueVisitors as number)}
          />
          <StatCard label="Downloads · 30d" value={downloads.last30} />
          <StatCard label="Downloads · 7d" value={downloads.last7} />
        </div>
      </div>

      {/* Top tables */}
      <div className="mt-12 grid grid-cols-2 gap-3.5">
        <RankedCard title="Most-viewed">
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
        </RankedCard>

        <RankedCard title="Most-downloaded">
          {downloads.topArtworks.length === 0 ? (
            <p className="px-6 py-5 text-sm text-muted">
              No downloads in the last 30 days. The art is playing hard to get.
            </p>
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
        </RankedCard>
      </div>

      {/* Geography */}
      <div className="mt-12">
        <RankedCard title="Geography">
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
        </RankedCard>
      </div>

      <p className="mt-10 text-xs text-faint">
        Visitor stats refresh every 5 minutes. Downloads brag instantly.
      </p>
    </div>
  );
}

function RankedCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-ink bg-card">
      <div className="flex items-center justify-between px-6 py-5 border-b border-ink">
        <h3 className="text-base">{title}</h3>
        <span className="text-[11px] uppercase tracking-[1px] text-muted">30D</span>
      </div>
      <div className="px-6">{children}</div>
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="py-5 text-sm text-muted">{children}</p>;
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
    <ol>
      {items.map((item, i) => (
        <li
          key={item.key}
          className="flex items-center gap-4 py-3.5 border-b border-hairline last:border-0"
        >
          <span className="min-w-[26px] text-[34px] text-[#D9D3C5]">{i + 1}</span>
          <div className="min-w-0 flex-1">
            {item.href ? (
              <Link
                href={item.href}
                className="block truncate text-sm text-ink hover:text-green hover:underline"
              >
                {item.primary}
              </Link>
            ) : (
              <span className="block truncate text-sm text-ink">{item.primary}</span>
            )}
            {item.secondary && <span className="text-xs text-muted">{item.secondary}</span>}
          </div>
          <span className="ml-auto text-sm tabular-nums text-ink">
            {item.value.toLocaleString()}{" "}
            <span className="text-[11px] text-faint">{valueLabel}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
