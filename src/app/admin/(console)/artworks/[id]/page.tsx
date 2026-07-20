/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Artist, Artwork } from "@/lib/types";
import { formatArtistName, parseTags } from "@/lib/utils";
import ImageManager from "@/components/admin/ImageManager";
import SectionHeader from "@/components/admin/SectionHeader";

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
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [formData, setFormData] = useState({
    title: "",
    sku: "",
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
  const [audioBusy, setAudioBusy] = useState<null | "upload" | "transcribe" | "tts" | "delete">(null);
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
            sku: artData.sku || "",
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
        sku: formData.sku.trim() || null,
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
      };

      // Route through the admin API (service-role) so RLS doesn't
      // silently drop the write — the browser anon-key client lacks
      // write permission against the artworks table.
      const resp = await fetch(`/api/admin/artworks/${artworkId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      });
      if (!resp.ok) {
        const json = await resp.json().catch(() => ({}));
        throw new Error(json.error || `Save failed: ${resp.status}`);
      }

      // Stay on the page; flash a success banner that auto-clears.
      setSavedAt(Date.now());
      setTimeout(() => {
        setSavedAt((current) => (current && Date.now() - current >= 3000 ? null : current));
      }, 3100);
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

  async function handleAudioDelete() {
    if (!window.confirm("Delete this audio description? This cannot be undone.")) return;
    setAudioBusy("delete");
    setAudioMessage(null);
    try {
      const resp = await fetch("/api/admin/audio", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artworkId }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || `Delete failed: ${resp.status}`);
      setArtwork((a) => (a ? { ...a, audio_url: null, audio_origin: null } : a));
      setAudioMessage("Audio deleted.");
    } catch (err) {
      setAudioMessage(err instanceof Error ? err.message : "Delete failed");
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

  const selectedArtist = artists.find((artist) => artist.id === formData.artist_id);
  const artistDisplayName = selectedArtist
    ? formatArtistName(selectedArtist.first_name, selectedArtist.last_name)
    : artwork.artist
    ? formatArtistName(artwork.artist.first_name, artwork.artist.last_name)
    : "Unassigned";

  return (
    <div>
      <Link
        href="/admin/artworks"
        className="text-xs uppercase tracking-[2px] text-muted hover:text-ink"
      >
        ← ARTWORKS
      </Link>

      <h1 className="mt-3 text-[44px] leading-none tracking-[-0.5px]">
        {formData.title || "Untitled"}
      </h1>
      <p className="mt-3 text-[13px] text-muted">
        <span className="font-mono">{formData.sku || "No SKU"}</span>
        {" · "}
        {artistDisplayName}
        {" · "}
        {formData.on_website ? "live on the site" : "not published"}
      </p>

      <form
        onSubmit={handleSubmit}
        className="mt-8 grid grid-cols-[1fr_320px] gap-3.5 items-start"
      >
        <div className="border border-ink bg-card p-8">
          {error && (
            <div className="mb-6 border border-[#b3261e] bg-card text-[#b3261e] px-4 py-3">
              {error}
            </div>
          )}

          {savedAt && (
            <div className="mb-6 border border-green bg-card text-green px-4 py-3">
              Saved.
            </div>
          )}

          <SectionHeader title="THE PIECE" rule="hairline" className="mb-5 mt-8 first:mt-0" />

          {/* Title */}
          <div className="mb-5">
            <label htmlFor="title" className="block text-[11px] uppercase tracking-[1.5px] text-muted mb-1.5">
              Title
            </label>
            <input
              type="text"
              id="title"
              name="title"
              value={formData.title}
              onChange={handleChange}
              required
              className="admin-field border border-line bg-card px-3.5 py-2.5 text-sm w-full"
            />
          </div>

          {/* SKU + Artist */}
          <div className="mb-5 grid grid-cols-2 gap-5">
            <div>
              <label htmlFor="sku" className="block text-[11px] uppercase tracking-[1.5px] text-muted mb-1.5">
                SKU
              </label>
              <input
                type="text"
                id="sku"
                name="sku"
                value={formData.sku}
                onChange={handleChange}
                placeholder="e.g., JCF 2"
                className="admin-field border border-line bg-card px-3.5 py-2.5 text-sm w-full font-mono"
              />
              <p className="mt-1 text-[11px] text-faint">
                The catalog code. Keep it unique — bulk image uploads match on it.
              </p>
            </div>

            <div>
              <label htmlFor="artist_id" className="block text-[11px] uppercase tracking-[1.5px] text-muted mb-1.5">
                Artist
              </label>
              <select
                id="artist_id"
                name="artist_id"
                value={formData.artist_id}
                onChange={handleChange}
                className="admin-field border border-line bg-card px-3.5 py-2.5 text-sm w-full"
              >
                <option value="">Select an artist</option>
                {artists.map((artist) => (
                  <option key={artist.id} value={artist.id}>
                    {formatArtistName(artist.first_name, artist.last_name)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Date Created + Medium */}
          <div className="mb-5 grid grid-cols-2 gap-5">
            <div>
              <label htmlFor="date_created" className="block text-[11px] uppercase tracking-[1.5px] text-muted mb-1.5">
                Date created
              </label>
              <input
                type="text"
                id="date_created"
                name="date_created"
                value={formData.date_created}
                onChange={handleChange}
                placeholder="e.g., 2023 or 2023-05-15"
                className="admin-field border border-line bg-card px-3.5 py-2.5 text-sm w-full"
              />
            </div>

            <div>
              <label htmlFor="medium" className="block text-[11px] uppercase tracking-[1.5px] text-muted mb-1.5">
                Medium
              </label>
              <input
                type="text"
                id="medium"
                name="medium"
                value={formData.medium}
                onChange={handleChange}
                placeholder="e.g., Oil on canvas"
                className="admin-field border border-line bg-card px-3.5 py-2.5 text-sm w-full"
              />
            </div>
          </div>

          {/* Dimensions */}
          <div className="mb-5 grid grid-cols-3 gap-5">
            <div>
              <label htmlFor="height" className="block text-[11px] uppercase tracking-[1.5px] text-muted mb-1.5">
                Height (in)
              </label>
              <input
                type="number"
                id="height"
                name="height"
                value={formData.height}
                onChange={handleChange}
                step="0.01"
                className="admin-field border border-line bg-card px-3.5 py-2.5 text-sm w-full"
              />
            </div>
            <div>
              <label htmlFor="width" className="block text-[11px] uppercase tracking-[1.5px] text-muted mb-1.5">
                Width (in)
              </label>
              <input
                type="number"
                id="width"
                name="width"
                value={formData.width}
                onChange={handleChange}
                step="0.01"
                className="admin-field border border-line bg-card px-3.5 py-2.5 text-sm w-full"
              />
            </div>
            <div>
              <label htmlFor="depth" className="block text-[11px] uppercase tracking-[1.5px] text-muted mb-1.5">
                Depth (in)
              </label>
              <input
                type="number"
                id="depth"
                name="depth"
                value={formData.depth}
                onChange={handleChange}
                step="0.01"
                className="admin-field border border-line bg-card px-3.5 py-2.5 text-sm w-full"
              />
            </div>
          </div>

          {/* Tags */}
          <div className="mb-5">
            <label htmlFor="tags" className="block text-[11px] uppercase tracking-[1.5px] text-muted mb-1.5">
              Tags
            </label>
            <input
              type="text"
              id="tags"
              name="tags"
              value={formData.tags}
              onChange={handleChange}
              placeholder="Comma-separated tags"
              className="admin-field border border-line bg-card px-3.5 py-2.5 text-sm w-full"
            />
          </div>

          <SectionHeader title="HOW IT READS ALOUD" rule="hairline" className="mb-5 mt-8 first:mt-0" />

          {/* Short alt text - grid page */}
          <div className="mb-5">
            <label htmlFor="alt_text" className="block text-[11px] tracking-[1.5px] text-muted mb-1.5">
              <span className="uppercase">Short alt text</span>{" "}
              <span className="text-faint">— grid page</span>
            </label>
            <textarea
              id="alt_text"
              name="alt_text"
              value={formData.alt_text}
              onChange={handleChange}
              rows={3}
              className="admin-field border border-line bg-card px-3.5 py-2.5 text-sm w-full"
            />
          </div>

          {/* Long alt text - detail page */}
          <div className="mb-5">
            <label htmlFor="alt_text_long" className="block text-[11px] tracking-[1.5px] text-muted mb-1.5">
              <span className="uppercase">Long alt text</span>{" "}
              <span className="text-faint">— detail page</span>
            </label>
            <textarea
              id="alt_text_long"
              name="alt_text_long"
              value={formData.alt_text_long}
              onChange={handleChange}
              rows={4}
              className="admin-field border border-line bg-card px-3.5 py-2.5 text-sm w-full"
            />
          </div>

          {/* Audio description */}
          <div className="mb-5 border border-dashed border-line bg-[#FBFAF7] p-5">
            <label className="block text-[11px] uppercase tracking-[1.5px] text-muted mb-1.5">
              Audio description
            </label>
            <p className="text-xs text-faint mb-3">
              The read-aloud version of the long alt text. Transcribe and Generate keep the two in sync.
            </p>

            {artwork.audio_url ? (
              <div className="mb-3">
                <audio controls preload="metadata" className="w-full" src={artwork.audio_url} />
                <p className="mt-1 text-[11px] text-faint">
                  Source:{" "}
                  <span className="font-mono">
                    {artwork.audio_origin || "(no origin recorded)"}
                  </span>
                </p>
              </div>
            ) : (
              <p className="italic text-muted mb-3">No audio yet.</p>
            )}

            <div className="space-y-3">
              <div>
                <label
                  htmlFor="audio_file"
                  className={`admin-btn admin-btn-secondary px-4 py-2 text-[11px] tracking-[1.5px] ${
                    audioBusy !== null
                      ? "pointer-events-none cursor-not-allowed text-faint border-line"
                      : "cursor-pointer"
                  }`}
                >
                  UPLOAD MP3
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
                  className="hidden"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={audioBusy !== null || !artwork.audio_url}
                  onClick={handleTranscribe}
                  className="admin-btn admin-btn-secondary px-4 py-2 text-[11px] tracking-[1.5px]"
                  title={!artwork.audio_url ? "Upload audio first" : "Transcribe audio → long alt text"}
                >
                  {audioBusy === "transcribe" ? "TRANSCRIBING…" : "TRANSCRIBE → TEXT"}
                </button>
                <button
                  type="button"
                  disabled={audioBusy !== null || !formData.alt_text_long}
                  onClick={handleGenerateTts}
                  className="admin-btn admin-btn-secondary px-4 py-2 text-[11px] tracking-[1.5px]"
                  title={!formData.alt_text_long ? "Long alt text is empty" : "Generate audio from long alt text via ElevenLabs"}
                >
                  {audioBusy === "tts" ? "GENERATING…" : "GENERATE FROM TEXT"}
                </button>
                {artwork.audio_url && (
                  <button
                    type="button"
                    disabled={audioBusy !== null}
                    onClick={handleAudioDelete}
                    className="admin-btn admin-btn-secondary px-4 py-2 text-[11px] tracking-[1.5px] text-red-700 border-red-300 hover:bg-red-50"
                    title="Delete this audio description"
                  >
                    {audioBusy === "delete" ? "DELETING…" : "DELETE AUDIO"}
                  </button>
                )}
              </div>

              {audioBusy === "upload" && (
                <p className="text-sm text-muted">Uploading…</p>
              )}
              {audioMessage && (
                <p className="text-sm text-muted">{audioMessage}</p>
              )}
            </div>
          </div>

          {/* Publish */}
          <div className="mb-5">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                name="on_website"
                checked={formData.on_website}
                onChange={handleChange}
                className="h-4 w-4 accent-green"
              />
              <span className="text-sm text-ink">
                Published on the website
              </span>
            </label>
          </div>

          {/* Actions */}
          <div className="mt-8 flex items-center gap-6">
            <button
              type="submit"
              disabled={saving}
              className="admin-btn admin-btn-primary px-[26px] py-3.5 text-[13px] tracking-[2px]"
            >
              {saving ? "SAVING…" : "SAVE CHANGES"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/admin/artworks")}
              className="text-muted hover:text-ink text-xs uppercase tracking-[1.5px]"
            >
              CANCEL
            </button>
          </div>
        </div>

        {/* Images */}
        <div className="border border-ink bg-card p-6">
          <SectionHeader title="IMAGES" rule="hairline" />
          <p className="mt-4 mb-4 text-[11px] text-faint">
            Drag to reorder. The first image is what visitors meet.
          </p>
          <ImageManager artworkId={artworkId} />
        </div>
      </form>
    </div>
  );
}
