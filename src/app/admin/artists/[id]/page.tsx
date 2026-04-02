/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Artist } from "@/lib/types";

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
  });

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
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error loading artist");
      } finally {
        setLoading(false);
      }
    };

    fetchArtist();
  }, [artistId, supabase]);

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
