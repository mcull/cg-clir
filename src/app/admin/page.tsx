/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerSupabaseClient } from "@/lib/supabase/server";

async function getStats() {
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

export const metadata = {
  title: "Dashboard | Admin | Creative Growth Gallery",
};

export default async function AdminDashboard() {
  const stats = await getStats();

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Dashboard</h1>

      {/* Catalog snapshot */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
        <StatCard title="Active artworks" value={stats.artworks} color="blue" />
        <StatCard title="Active ephemera" value={stats.ephemera} color="purple" />
        <StatCard title="Artists" value={stats.artists} color="green" />
        <StatCard
          title="Human descriptions"
          value={stats.humanDescriptions}
          color="green"
        />
        <StatCard title="With audio" value={stats.audioPieces} color="orange" />
      </div>

      <div className="bg-white rounded-lg shadow p-6 text-sm text-gray-600">
        Visitor analytics (page views, geography, audio plays, etc.) flow into
        PostHog and aren&apos;t surfaced here yet — see open conversation about
        which vanity stats to add.
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
