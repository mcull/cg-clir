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
        .eq("id", imageId);
      if (error) throw error;
    }

    if (body.make_primary) {
      // Per-row update keeps exactly one primary, never violating the partial
      // unique index: every row is set to (id = target).
      const { data: rows, error: selErr } = await db
        .from("artwork_images")
        .select("id")
        .eq("artwork_id", artworkId);
      if (selErr) throw selErr;
      for (const r of rows ?? []) {
        const { error } = await db
          .from("artwork_images")
          .update({ is_primary: r.id === imageId })
          .eq("id", r.id);
        if (error) throw error;
      }
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

/** DELETE — remove an image. If it was primary, the DB trigger promotes the next. */
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
    const { error } = await db.from("artwork_images").delete().eq("id", imageId);
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
