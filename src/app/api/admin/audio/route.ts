import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminSupabase } from "@/lib/admin-auth";

/**
 * DELETE /api/admin/audio
 * JSON body: { artworkId }
 *
 * Clears audio_url + audio_origin on the artwork so the recording no longer
 * shows up in the admin or on the website.
 *
 * Note: like image deletion, this intentionally clears only the DB reference,
 * not the audio's R2 object. Orphaned R2 objects are an accepted tradeoff for
 * now; add an R2 delete here if storage cleanup becomes necessary.
 */
export async function DELETE(request: NextRequest) {
  const unauthed = await requireAdmin();
  if (unauthed) return unauthed;

  try {
    const { artworkId } = await request.json();
    if (typeof artworkId !== "string" || !artworkId) {
      return NextResponse.json({ error: "artworkId is required" }, { status: 400 });
    }

    const { error: updateErr } = await adminSupabase()
      .from("artworks")
      .update({ audio_url: null, audio_origin: null })
      .eq("id", artworkId);
    if (updateErr) throw updateErr;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("audio DELETE error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Delete failed" },
      { status: 500 }
    );
  }
}
