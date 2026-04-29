/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Artist, Artwork } from "@/lib/types";
import { formatArtistName, parseTags, resolveImageUrl } from "@/lib/utils";

export default function EditArtworkPage() {
  const router = useRouter();
  const params = useParams();
  const artworkId = params.id as string;
  const supabase = createClient();

  const [artwork, setArtwork] = useState<
    (Artwork & { artist?: { id: string; first_name: string; last_name: string } }) | null
  >(
    null
  );
  const [artists, setArtists] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    title: "",
    artist_id: "",
    date_created: "",
    medium: "",
    height: "",
    width: "",
    depth: "",
    tags: "",
    alt_text: "",
    alt_text_long: "",
    on_website: true,
  });

  // Audio state lives outside formData because the upload/transcribe/TTS
  // actions persist immediately (no Save Changes round-trip needed). We
  // mirror the latest values onto the artwork object so the player and
  // status text re-render.
  const [audioBusy, setAudioBusy] = useState<null | "upload" | "transcribe" | "tts">(null);
  const [audioMessage, setAudioMessage] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch artwork
        const { data: artData, error: artError } = await supabase
          .from("artworks")
          .select(
            `
            *,
            artist:artists(id, first_name, last_name)
            `
          )
          .eq("id", artworkId)
          .single();

        if (artError) throw artError;
        if (artData) {
          setArtwork(artData);
          setFormData({
            title: artData.title || "",
            artist_id: artData.artist_id || "",
            date_created: artData.date_created || "",
            medium: artData.medium || "",
            height: artData.height?.toString() || "",
            width: artData.width?.toString() || "",
            depth: artData.depth?.toString() || "",
            tags: artData.tags?.join(", ") || "",
            alt_text: artData.alt_text || "",
            alt_text_long: artData.alt_text_long || "",
            on_website: artData.on_website || true,
          });
        }

        // Fetch artists
        const { data: artistData, error: artistError } = await supabase
          .from("artists")
          .select("*")
          .order("last_name", { ascending: true });

        if (artistError) throw artistError;
        setArtists(artistData || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error loading data");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [artworkId, supabase]);

  const handleChange = (e: any) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setError(null);

      const updateData = {
        title: formData.title,
        artist_id: formData.artist_id || null,
        date_created: formData.date_created || null,
        medium: formData.medium || null,
        height: formData.height ? parseFloat(formData.height) : null,
        width: formData.width ? parseFloat(formData.width) : null,
        depth: formData.depth ? parseFloat(formData.depth) : null,
        tags: parseTags(formData.tags),
        alt_text: formData.alt_text || null,
        alt_text_long: formData.alt_text_long || null,
        on_website: formData.on_website,
        updated_at: new Date().toISOString(),
      };

      const { error: updateError } = await supabase
        .from("artworks")
        .update(updateData)
        .eq("id", artworkId);

      if (updateError) throw updateError;

      router.push("/admin/artworks");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error saving artwork");
    } finally {
      setSaving(false);
    }
  };

  async function handleAudioUpload(file: File) {
    setAudioBusy("upload");
    setAudioMessage(null);
    try {
      const fd = new FormData();
      fd.append("artworkId", artworkId);
      fd.append("file", file);
      const resp = await fetch("/api/admin/audio/upload", { method: "POST", body: fd });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || `Upload failed: ${resp.status}`);
      setArtwork((a) => (a ? { ...a, audio_url: json.audio_url, audio_origin: json.audio_origin } : a));
      setAudioMessage("Audio uploaded.");
    } catch (err) {
      setAudioMessage(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setAudioBusy(null);
    }
  }

  async function handleTranscribe() {
    setAudioBusy("transcribe");
    setAudioMessage(null);
    try {
      const resp = await fetch("/api/admin/audio/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artworkId }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || `Transcribe failed: ${resp.status}`);
      setFormData((p) => ({ ...p, alt_text_long: json.alt_text_long }));
      setArtwork((a) => (a ? { ...a, alt_text_long: json.alt_text_long, description_origin: "human" } : a));
      setAudioMessage("Transcript saved to long alt text.");
    } catch (err) {
      setAudioMessage(err instanceof Error ? err.message : "Transcription failed");
    } finally {
      setAudioBusy(null);
    }
  }

  async function handleGenerateTts() {
    setAudioBusy("tts");
    setAudioMessage(null);
    try {
      const resp = await fetch("/api/admin/audio/generate-tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artworkId }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || `TTS failed: ${resp.status}`);
      setArtwork((a) => (a ? { ...a, audio_url: json.audio_url, audio_origin: json.audio_origin } : a));
      setAudioMessage("Generated audio with ElevenLabs.");
    } catch (err) {
      setAudioMessage(err instanceof Error ? err.message : "TTS failed");
    } finally {
      setAudioBusy(null);
    }
  }

  if (loading) {
    return <div className="text-center py-12">Loading...</div>;
  }

  if (!artwork) {
    return <div className="text-center py-12">Artwork not found</div>;
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-8">
        Edit Artwork
      </h1>

      <form onSubmit={handleSubmit} className="max-w-2xl bg-white rounded-lg shadow p-8">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded text-red-800">
            {error}
          </div>
        )}

        {/* Image Preview */}
        {(() => {
          const imageUrl = resolveImageUrl(artwork);
          if (!imageUrl) return null;
          return (
            <div className="mb-6">
              <label className="block text-sm font-bold text-gray-700 mb-2">
                Image Preview
              </label>
              <div className="relative w-48 h-48 rounded bg-gray-100">
                <Image
                  src={imageUrl}
                  alt={artwork.title}
                  fill
                  className="object-cover rounded"
                />
              </div>
            </div>
          );
        })()}

        {/* Title */}
        <div className="mb-6">
          <label htmlFor="title" className="block text-sm font-bold text-gray-700 mb-2">
            Title *
          </label>
          <input
            type="text"
            id="title"
            name="title"
            value={formData.title}
            onChange={handleChange}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Artist */}
        <div className="mb-6">
          <label htmlFor="artist_id" className="block text-sm font-bold text-gray-700 mb-2">
            Artist
          </label>
          <select
            id="artist_id"
            name="artist_id"
            value={formData.artist_id}
            onChange={handleChange}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select an artist</option>
            {artists.map((artist) => (
              <option key={artist.id} value={artist.id}>
                {formatArtistName(artist.first_name, artist.last_name)}
              </option>
            ))}
          </select>
        </div>

        {/* Date Created */}
        <div className="mb-6">
          <label htmlFor="date_created" className="block text-sm font-bold text-gray-700 mb-2">
            Date Created
          </label>
          <input
            type="text"
            id="date_created"
            name="date_created"
            value={formData.date_created}
            onChange={handleChange}
            placeholder="e.g., 2023 or 2023-05-15"
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Medium */}
        <div className="mb-6">
          <label htmlFor="medium" className="block text-sm font-bold text-gray-700 mb-2">
            Medium
          </label>
          <input
            type="text"
            id="medium"
            name="medium"
            value={formData.medium}
            onChange={handleChange}
            placeholder="e.g., Oil on canvas"
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Dimensions */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div>
            <label htmlFor="height" className="block text-sm font-bold text-gray-700 mb-2">
              Height (in)
            </label>
            <input
              type="number"
              id="height"
              name="height"
              value={formData.height}
              onChange={handleChange}
              step="0.01"
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="width" className="block text-sm font-bold text-gray-700 mb-2">
              Width (in)
            </label>
            <input
              type="number"
              id="width"
              name="width"
              value={formData.width}
              onChange={handleChange}
              step="0.01"
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="depth" className="block text-sm font-bold text-gray-700 mb-2">
              Depth (in)
            </label>
            <input
              type="number"
              id="depth"
              name="depth"
              value={formData.depth}
              onChange={handleChange}
              step="0.01"
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Tags */}
        <div className="mb-6">
          <label htmlFor="tags" className="block text-sm font-bold text-gray-700 mb-2">
            Tags
          </label>
          <input
            type="text"
            id="tags"
            name="tags"
            value={formData.tags}
            onChange={handleChange}
            placeholder="Comma-separated tags"
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Long alt text - detail page */}
        <div className="mb-6">
          <label htmlFor="alt_text_long" className="block text-sm font-bold text-gray-700 mb-2">
            Long alt text (detail page)
          </label>
          <textarea
            id="alt_text_long"
            name="alt_text_long"
            value={formData.alt_text_long}
            onChange={handleChange}
            rows={4}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Audio description */}
        <div className="mb-6 p-4 border border-gray-200 rounded bg-gray-50">
          <label className="block text-sm font-bold text-gray-700 mb-2">
            Audio description
          </label>
          <p className="text-xs text-gray-600 mb-3">
            Audio is the read-aloud version of the long alt text. The two
            stay in sync via the Transcribe and Generate buttons below.
          </p>

          {artwork.audio_url ? (
            <div className="mb-3">
              <audio controls preload="metadata" className="w-full" src={artwork.audio_url} />
              <p className="text-xs text-gray-600 mt-1">
                Source:{" "}
                <span className="font-mono">
                  {artwork.audio_origin || "(no origin recorded)"}
                </span>
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-500 italic mb-3">No audio uploaded.</p>
          )}

          <div className="space-y-3">
            <div>
              <label htmlFor="audio_file" className="block text-xs font-semibold text-gray-700 mb-1">
                Upload MP3 (replaces existing audio, marks as human-recorded)
              </label>
              <input
                id="audio_file"
                type="file"
                accept="audio/*"
                disabled={audioBusy !== null}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleAudioUpload(f);
                  e.target.value = ""; // allow re-uploading the same filename
                }}
                className="block text-sm"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={audioBusy !== null || !artwork.audio_url}
                onClick={handleTranscribe}
                className="button-secondary text-sm disabled:opacity-50"
                title={!artwork.audio_url ? "Upload audio first" : "Transcribe audio → long alt text"}
              >
                {audioBusy === "transcribe" ? "Transcribing…" : "Transcribe audio → text"}
              </button>
              <button
                type="button"
                disabled={audioBusy !== null || !formData.alt_text_long}
                onClick={handleGenerateTts}
                className="button-secondary text-sm disabled:opacity-50"
                title={!formData.alt_text_long ? "Long alt text is empty" : "Generate audio from long alt text via ElevenLabs"}
              >
                {audioBusy === "tts" ? "Generating…" : "Generate audio from text (ElevenLabs)"}
              </button>
            </div>

            {audioBusy === "upload" && (
              <p className="text-sm text-gray-600">Uploading…</p>
            )}
            {audioMessage && (
              <p className="text-sm text-gray-700">{audioMessage}</p>
            )}
          </div>
        </div>

        {/* Short alt text - grid page */}
        <div className="mb-6">
          <label htmlFor="alt_text" className="block text-sm font-bold text-gray-700 mb-2">
            Short alt text (grid page)
          </label>
          <textarea
            id="alt_text"
            name="alt_text"
            value={formData.alt_text}
            onChange={handleChange}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Publish */}
        <div className="mb-6">
          <label className="flex items-center">
            <input
              type="checkbox"
              name="on_website"
              checked={formData.on_website}
              onChange={handleChange}
              className="w-4 h-4 border border-gray-300 rounded"
            />
            <span className="ml-3 text-sm text-gray-700">
              Publish on website
            </span>
          </label>
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
            onClick={() => router.push("/admin/artworks")}
            className="button-secondary"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
