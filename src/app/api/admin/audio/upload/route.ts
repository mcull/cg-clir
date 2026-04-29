import { NextRequest, NextResponse } from "next/server";
import { uploadToR2 } from "@/lib/r2";
import { requireAdmin, adminSupabase } from "@/lib/admin-auth";

export const maxDuration = 30;

/**
 * POST /api/admin/audio/upload
 * multipart/form-data with `artworkId` and `file` (audio/mpeg).
 *
 * Uploads the MP3 to R2 at audio/{artworkId}/{ISO}-{filename} and writes
 * audio_url + audio_origin='human' on the artwork. Returns the new
 * audio_url.
 */
export async function POST(request: NextRequest) {
  const unauthed = await requireAdmin();
  if (unauthed) return unauthed;

  try {
    const form = await request.formData();
    const artworkId = form.get("artworkId");
    const file = form.get("file");
    if (typeof artworkId !== "string" || !artworkId) {
      return NextResponse.json({ error: "artworkId is required" }, { status: 400 });
    }
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (file.type && !file.type.startsWith("audio/")) {
      return NextResponse.json(
        { error: `Expected audio/*, got ${file.type}` },
        { status: 400 }
      );
    }

    // Use the original filename if the browser supplied one, otherwise default.
    const originalName = (file as File).name || "audio.mp3";
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const key = `audio/${artworkId}/${ts}-${safeName}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    const audioUrl = await uploadToR2(key, buffer, file.type || "audio/mpeg");

    const { error: updateErr } = await adminSupabase()
      .from("artworks")
      .update({ audio_url: audioUrl, audio_origin: "human" })
      .eq("id", artworkId);
    if (updateErr) throw updateErr;

    return NextResponse.json({ audio_url: audioUrl, audio_origin: "human" });
  } catch (err) {
    console.error("audio/upload error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 }
    );
  }
}
