/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Artist } from "@/lib/types";
import cgArtistUrls from "@/lib/data/cg-artist-urls.json";

const CG_ARTIST_BASE = "https://www.creativegrowth.org/artist/";
const CG_SLUGS: string[] = cgArtistUrls.slugs;

// Levenshtein distance for the "Did you mean?" hint. Cheap given that
// our N is ~196 and we only run it once per page load.
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    dp[i][j] = a[i - 1] === b[j - 1]
      ? dp[i - 1][j - 1]
      : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
  }
  return dp[m][n];
}

function suggestSlug(ourSlug: string): string | null {
  if (!ourSlug) return null;
  let best: { slug: string; dist: number } | null = null;
  for (const candidate of CG_SLUGS) {
    const dist = levenshtein(ourSlug, candidate);
    if (!best || dist < best.dist) best = { slug: candidate, dist };
  }
  // Only suggest if the edit distance is small relative to slug length.
  if (best && best.dist > 0 && best.dist <= Math.max(2, Math.floor(ourSlug.length / 4))) {
    return best.slug;
  }
  return null;
}

export default function EditArtistPage() {
  const router = useRouter();
  const params = useParams();
  const artistId = params.id as string;
  const supabase = createClient();

  const [artist, setArtist] = useState<Artist | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    bio: "",
    external_url: "",
  });
  const [urlMode, setUrlMode] = useState<"none" | "preset" | "custom">("none");
  const [customUrl, setCustomUrl] = useState("");

  useEffect(() => {
    const fetchArtist = async () => {
      try {
        const { data, error: fetchError } = await supabase
          .from("artists")
          .select("*")
          .eq("id", artistId)
          .single();

        if (fetchError) throw fetchError;
        if (data) {
          setArtist(data);
          setFormData({
            first_name: data.first_name || "",
            last_name: data.last_name || "",
            bio: data.bio || "",
            external_url: data.external_url || "",
          });
          // Decide which input mode the picker starts in.
          if (!data.external_url) {
            setUrlMode("none");
          } else if (data.external_url.startsWith(CG_ARTIST_BASE)) {
            const slug = data.external_url.slice(CG_ARTIST_BASE.length);
            if (CG_SLUGS.includes(slug)) {
              setUrlMode("preset");
            } else {
              setUrlMode("custom");
              setCustomUrl(data.external_url);
            }
          } else {
            setUrlMode("custom");
            setCustomUrl(data.external_url);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error loading artist");
      } finally {
        setLoading(false);
      }
    };

    fetchArtist();
  }, [artistId, supabase]);

  const suggestedSlug = useMemo(() => {
    if (formData.external_url) return null;
    return artist?.slug ? suggestSlug(artist.slug) : null;
  }, [artist?.slug, formData.external_url]);

  const handleChange = (e: any) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setError(null);

      const { error: updateError } = await supabase
        .from("artists")
        .update({
          first_name: formData.first_name,
          last_name: formData.last_name,
          bio: formData.bio || null,
          external_url: formData.external_url || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", artistId);

      if (updateError) throw updateError;

      router.push("/admin/artists");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error saving artist");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-center py-12">Loading...</div>;
  }

  if (!artist) {
    return <div className="text-center py-12">Artist not found</div>;
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-8">
        Edit Artist
      </h1>

      <form onSubmit={handleSubmit} className="max-w-2xl bg-white rounded-lg shadow p-8">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded text-red-800">
            {error}
          </div>
        )}

        {/* First Name */}
        <div className="mb-6">
          <label htmlFor="first_name" className="block text-sm font-bold text-gray-700 mb-2">
            First Name *
          </label>
          <input
            type="text"
            id="first_name"
            name="first_name"
            value={formData.first_name}
            onChange={handleChange}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Last Name */}
        <div className="mb-6">
          <label htmlFor="last_name" className="block text-sm font-bold text-gray-700 mb-2">
            Last Name *
          </label>
          <input
            type="text"
            id="last_name"
            name="last_name"
            value={formData.last_name}
            onChange={handleChange}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Bio */}
        <div className="mb-6">
          <label htmlFor="bio" className="block text-sm font-bold text-gray-700 mb-2">
            Biography
          </label>
          <textarea
            id="bio"
            name="bio"
            value={formData.bio}
            onChange={handleChange}
            rows={6}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* External URL (creativegrowth.org artist page) */}
        <div className="mb-6">
          <label className="block text-sm font-bold text-gray-700 mb-2">
            Public artist page (creativegrowth.org)
          </label>
          <p className="text-xs text-gray-600 mb-3">
            When set, the artist link on the artwork detail page opens this
            URL in a new tab instead of the internal archive page.
          </p>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="urlMode"
                checked={urlMode === "none"}
                onChange={() => {
                  setUrlMode("none");
                  setFormData((p) => ({ ...p, external_url: "" }));
                }}
              />
              No public page
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="urlMode"
                checked={urlMode === "preset"}
                onChange={() => {
                  setUrlMode("preset");
                  // If there's no preset selected yet, leave external_url
                  // empty until the user picks one in the dropdown.
                  if (!formData.external_url.startsWith(CG_ARTIST_BASE)) {
                    setFormData((p) => ({ ...p, external_url: "" }));
                  }
                }}
              />
              Pick from creativegrowth.org sitemap
            </label>

            {urlMode === "preset" && (
              <div className="ml-6">
                <select
                  value={formData.external_url.startsWith(CG_ARTIST_BASE)
                    ? formData.external_url.slice(CG_ARTIST_BASE.length)
                    : ""}
                  onChange={(e) => {
                    const slug = e.target.value;
                    setFormData((p) => ({
                      ...p,
                      external_url: slug ? `${CG_ARTIST_BASE}${slug}` : "",
                    }));
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">— select an artist slug —</option>
                  {CG_SLUGS.map((slug) => (
                    <option key={slug} value={slug}>{slug}</option>
                  ))}
                </select>
                {suggestedSlug && (
                  <p className="text-xs text-gray-700 mt-2">
                    Did you mean{" "}
                    <button
                      type="button"
                      className="link-primary underline"
                      onClick={() =>
                        setFormData((p) => ({
                          ...p,
                          external_url: `${CG_ARTIST_BASE}${suggestedSlug}`,
                        }))
                      }
                    >
                      {suggestedSlug}
                    </button>
                    ? (closest match to our slug)
                  </p>
                )}
              </div>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="urlMode"
                checked={urlMode === "custom"}
                onChange={() => {
                  setUrlMode("custom");
                  setFormData((p) => ({ ...p, external_url: customUrl }));
                }}
              />
              Custom URL
            </label>

            {urlMode === "custom" && (
              <div className="ml-6">
                <input
                  type="url"
                  value={customUrl}
                  onChange={(e) => {
                    setCustomUrl(e.target.value);
                    setFormData((p) => ({ ...p, external_url: e.target.value }));
                  }}
                  placeholder="https://..."
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-4">
          <button
            type="submit"
            disabled={saving}
            className="button-primary disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/admin/artists")}
            className="button-secondary"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
