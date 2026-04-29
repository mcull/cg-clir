import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminSupabase } from "@/lib/admin-auth";

export const maxDuration = 60;

/**
 * POST /api/admin/audio/transcribe
 * { artworkId: string }
 *
 * Looks up the artwork's audio_url, sends the audio to OpenAI Whisper,
 * and writes the transcription to alt_text_long with description_origin
 * set to 'human' (the audio captures human narration; the text is the
 * derived transcript). Returns the updated text.
 */
export async function POST(request: NextRequest) {
  const unauthed = await requireAdmin();
  if (unauthed) return unauthed;

  try {
    const { artworkId } = (await request.json()) as { artworkId?: string };
    if (!artworkId) {
      return NextResponse.json({ error: "artworkId is required" }, { status: 400 });
    }
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });
    }

    const supabase = adminSupabase();
    const { data: artwork, error: lookupErr } = await supabase
      .from("artworks")
      .select("id, audio_url")
      .eq("id", artworkId)
      .single();
    if (lookupErr || !artwork) {
      return NextResponse.json({ error: "Artwork not found" }, { status: 404 });
    }
    if (!artwork.audio_url) {
      return NextResponse.json({ error: "Artwork has no audio_url to transcribe" }, { status: 400 });
    }

    // Pull the MP3 from R2 (public bucket) and forward to Whisper as a Blob.
    const audioResp = await fetch(artwork.audio_url);
    if (!audioResp.ok) {
      return NextResponse.json(
        { error: `Could not fetch audio: ${audioResp.status}` },
        { status: 502 }
      );
    }
    const audioBlob = await audioResp.blob();

    const whisperForm = new FormData();
    whisperForm.append("file", audioBlob, "audio.mp3");
    whisperForm.append("model", "whisper-1");
    whisperForm.append("response_format", "text");

    const whisperResp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: whisperForm,
    });
    if (!whisperResp.ok) {
      const detail = await whisperResp.text();
      return NextResponse.json(
        { error: `Whisper failed: ${whisperResp.status}`, detail: detail.slice(0, 500) },
        { status: 502 }
      );
    }
    const transcript = (await whisperResp.text()).trim();
    if (!transcript) {
      return NextResponse.json({ error: "Whisper returned empty transcript" }, { status: 502 });
    }

    const { error: updateErr } = await supabase
      .from("artworks")
      .update({ alt_text_long: transcript, description_origin: "human" })
      .eq("id", artworkId);
    if (updateErr) throw updateErr;

    return NextResponse.json({ alt_text_long: transcript, description_origin: "human" });
  } catch (err) {
    console.error("audio/transcribe error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Transcription failed" },
      { status: 500 }
    );
  }
}
