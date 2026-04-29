import { NextRequest, NextResponse } from "next/server";
import { uploadToR2 } from "@/lib/r2";
import { requireAdmin, adminSupabase } from "@/lib/admin-auth";

export const maxDuration = 90;

// Default to ElevenLabs's "Rachel" voice. Override via ELEVENLABS_VOICE_ID
// to standardize the catalog on a different narrator.
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

/**
 * POST /api/admin/audio/generate-tts
 * { artworkId: string }
 *
 * Reads alt_text_long from the artwork, sends it to ElevenLabs, uploads
 * the resulting MP3 to R2, and writes audio_url + audio_origin='tts' on
 * the artwork. Returns the new audio_url.
 */
export async function POST(request: NextRequest) {
  const unauthed = await requireAdmin();
  if (unauthed) return unauthed;

  try {
    const { artworkId } = (await request.json()) as { artworkId?: string };
    if (!artworkId) {
      return NextResponse.json({ error: "artworkId is required" }, { status: 400 });
    }
    if (!process.env.ELEVENLABS_API_KEY) {
      return NextResponse.json({ error: "ELEVENLABS_API_KEY not configured" }, { status: 500 });
    }
    const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;

    const supabase = adminSupabase();
    const { data: artwork, error: lookupErr } = await supabase
      .from("artworks")
      .select("id, alt_text_long")
      .eq("id", artworkId)
      .single();
    if (lookupErr || !artwork) {
      return NextResponse.json({ error: "Artwork not found" }, { status: 404 });
    }
    const text = (artwork.alt_text_long || "").trim();
    if (!text) {
      return NextResponse.json(
        { error: "Artwork has no alt_text_long to read" },
        { status: 400 }
      );
    }

    const ttsResp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
        }),
      }
    );
    if (!ttsResp.ok) {
      const detail = await ttsResp.text();
      return NextResponse.json(
        { error: `ElevenLabs failed: ${ttsResp.status}`, detail: detail.slice(0, 500) },
        { status: 502 }
      );
    }

    const audioBuffer = Buffer.from(await ttsResp.arrayBuffer());
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const key = `audio/${artworkId}/tts-${ts}.mp3`;
    const audioUrl = await uploadToR2(key, audioBuffer, "audio/mpeg");

    const { error: updateErr } = await supabase
      .from("artworks")
      .update({ audio_url: audioUrl, audio_origin: "tts" })
      .eq("id", artworkId);
    if (updateErr) throw updateErr;

    return NextResponse.json({ audio_url: audioUrl, audio_origin: "tts" });
  } catch (err) {
    console.error("audio/generate-tts error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "TTS generation failed" },
      { status: 500 }
    );
  }
}
