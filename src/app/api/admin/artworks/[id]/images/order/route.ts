import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminSupabase } from "@/lib/admin-auth";

export const maxDuration = 30;

/**
 * PUT — body: { order: string[] } (image ids in the desired display order).
 * Writes sort_order = index for each. Does not change is_primary; the detail
 * query still floats the primary to the hero via `is_primary DESC`.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthed = await requireAdmin();
  if (unauthed) return unauthed;
  const { id: artworkId } = await params;
  const db = adminSupabase();

  try {
    const { order } = (await request.json()) as { order: string[] };
    if (!Array.isArray(order)) {
      return NextResponse.json({ error: "order must be an array" }, { status: 400 });
    }
    for (let i = 0; i < order.length; i++) {
      const { error } = await db
        .from("artwork_images")
        .update({ sort_order: i })
        .eq("id", order[i])
        .eq("artwork_id", artworkId);
      if (error) throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("images order PUT error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Reorder failed" },
      { status: 500 }
    );
  }
}
