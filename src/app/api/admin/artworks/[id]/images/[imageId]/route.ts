import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminSupabase } from "@/lib/admin-auth";

export const maxDuration = 30;

/**
 * PATCH — body may include:
 *   short_description?: string | null
 *   make_primary?: true            (sets this row primary, clears the rest)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; imageId: string }> }
) {
  const unauthed = await requireAdmin();
  if (unauthed) return unauthed;
  const { id: artworkId, imageId } = await params;
  const db = adminSupabase();

  try {
    const body = (await request.json()) as {
      short_description?: string | null;
      make_primary?: boolean;
    };

    if (body.short_description !== undefined) {
      const { error } = await db
        .from("artwork_images")
        .update({ short_description: body.short_description })
        .eq("id", imageId)
        .eq("artwork_id", artworkId);
      if (error) throw error;
    }

    if (body.make_primary) {
      // Clear the old primary FIRST, then set the new one. The partial unique
      // index (one is_primary per artwork) is checked per-statement, so setting
      // the target true while another row is still true would fail — order
      // matters. Zero primaries momentarily is allowed.
      const { error: clearErr } = await db
        .from("artwork_images")
        .update({ is_primary: false })
        .eq("artwork_id", artworkId)
        .neq("id", imageId);
      if (clearErr) throw clearErr;
      const { error: setErr } = await db
        .from("artwork_images")
        .update({ is_primary: true })
        .eq("id", imageId)
        .eq("artwork_id", artworkId);
      if (setErr) throw setErr;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("image PATCH error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 500 }
    );
  }
}

/**
 * DELETE — remove an image. If it was primary, the DB trigger promotes the next.
 * Note: this intentionally deletes only the DB row, not the image's R2 objects
 * (the 4 variants). Orphaned R2 objects are an accepted tradeoff for now; add an
 * R2 delete here if storage cleanup becomes necessary.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; imageId: string }> }
) {
  const unauthed = await requireAdmin();
  if (unauthed) return unauthed;
  const { id: artworkId, imageId } = await params;
  const db = adminSupabase();

  try {
    // Guard: don't delete the last remaining image.
    const { count } = await db
      .from("artwork_images")
      .select("id", { count: "exact", head: true })
      .eq("artwork_id", artworkId);
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "Cannot delete the only image of an artwork" },
        { status: 400 }
      );
    }
    const { error } = await db
      .from("artwork_images")
      .delete()
      .eq("id", imageId)
      .eq("artwork_id", artworkId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("image DELETE error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Delete failed" },
      { status: 500 }
    );
  }
}
