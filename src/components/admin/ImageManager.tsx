"use client";

import { useEffect, useState } from "react";
import { ArtworkImage } from "@/lib/types";
import { resolveImageUrl } from "@/lib/utils";
import { orderImages, reorder, withPrimary } from "@/lib/images";
import { Star, Trash2, ArrowUp, ArrowDown, GripVertical } from "lucide-react";

export default function ImageManager({ artworkId }: { artworkId: string }) {
  const [images, setImages] = useState<ArtworkImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const load = async () => {
    const resp = await fetch(`/api/admin/artworks/${artworkId}/images`);
    const json = await resp.json();
    setImages(orderImages(json.images || []));
    setLoading(false);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artworkId]);

  async function persistOrder(next: ArtworkImage[]) {
    setImages(next);
    await fetch(`/api/admin/artworks/${artworkId}/images/order`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: next.map((i) => i.id) }),
    });
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= images.length) return;
    persistOrder(reorder(images, from, to));
  }

  async function makePrimary(id: string) {
    setImages((cur) => orderImages(withPrimary(cur, id)));
    await fetch(`/api/admin/artworks/${artworkId}/images/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ make_primary: true }),
    });
    load();
  }

  async function saveDescription(id: string, value: string) {
    await fetch(`/api/admin/artworks/${artworkId}/images/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ short_description: value || null }),
    });
  }

  async function remove(id: string) {
    const resp = await fetch(`/api/admin/artworks/${artworkId}/images/${id}`, {
      method: "DELETE",
    });
    if (!resp.ok) {
      const j = await resp.json().catch(() => ({}));
      setMsg(j.error || "Delete failed");
      return;
    }
    load();
  }

  async function addByUrl() {
    if (!url) return;
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("url", url);
      const resp = await fetch(`/api/admin/artworks/${artworkId}/images`, {
        method: "POST",
        body: fd,
      });
      if (!resp.ok) throw new Error((await resp.json()).error || "Add failed");
      setUrl("");
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Add failed");
    } finally {
      setBusy(false);
    }
  }

  async function addByFile(file: File) {
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const resp = await fetch(`/api/admin/artworks/${artworkId}/images`, {
        method: "POST",
        body: fd,
      });
      if (!resp.ok) throw new Error((await resp.json()).error || "Upload failed");
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-gray-500">Loading images…</p>;

  return (
    <div className="mb-6">
      <label className="block text-sm font-bold text-gray-700 mb-2">Images</label>
      <p className="text-xs text-gray-600 mb-3">
        The starred image is the primary (hero) view. Drag the handle or use the
        arrows to reorder the rest. Each image needs a short description — it is
        used as alt text and the caption.
      </p>

      <ul className="space-y-3">
        {images.map((img, i) => {
          const src = resolveImageUrl(img);
          return (
            <li
              key={img.id}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIndex !== null && dragIndex !== i) move(dragIndex, i);
                setDragIndex(null);
              }}
              className="flex items-start gap-3 p-3 border border-gray-200 rounded bg-white"
            >
              <span className="cursor-grab pt-2 text-gray-400" aria-hidden="true">
                <GripVertical size={16} />
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {src && <img src={src} alt="" className="h-20 w-20 object-cover rounded" />}
              <div className="flex-1">
                <input
                  type="text"
                  defaultValue={img.short_description || ""}
                  onBlur={(e) => saveDescription(img.id, e.target.value)}
                  placeholder="Short description (alt + caption)"
                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => makePrimary(img.id)}
                    className={`flex items-center gap-1 text-xs px-2 py-1 rounded ${
                      img.is_primary ? "bg-yellow-100 text-yellow-800" : "bg-gray-100 text-gray-600"
                    }`}
                    aria-pressed={img.is_primary}
                  >
                    <Star size={14} aria-hidden="true" />
                    {img.is_primary ? "Primary" : "Make primary"}
                  </button>
                  <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0}
                    className="p-1 text-gray-500 disabled:opacity-30" aria-label="Move up">
                    <ArrowUp size={14} />
                  </button>
                  <button type="button" onClick={() => move(i, i + 1)} disabled={i === images.length - 1}
                    className="p-1 text-gray-500 disabled:opacity-30" aria-label="Move down">
                    <ArrowDown size={14} />
                  </button>
                  <button type="button" onClick={() => remove(img.id)}
                    className="p-1 text-red-600 ml-auto" aria-label="Delete image">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 space-y-2">
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Add image by URL"
            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded"
          />
          <button type="button" onClick={addByUrl} disabled={busy || !url}
            className="button-secondary text-sm disabled:opacity-50">
            {busy ? "Adding…" : "Add URL"}
          </button>
        </div>
        <div>
          <label htmlFor="image_file" className="block text-xs font-semibold text-gray-700 mb-1">
            Or upload a file
          </label>
          <input
            id="image_file"
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) addByFile(f);
              e.target.value = "";
            }}
            className="block text-sm"
          />
        </div>
        {msg && <p className="text-sm text-red-700">{msg}</p>}
      </div>
    </div>
  );
}
