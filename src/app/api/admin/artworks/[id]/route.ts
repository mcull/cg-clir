import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminSupabase } from "@/lib/admin-auth";

export const maxDuration = 30;

/**
 * PATCH /api/admin/artworks/[id]
 *
 * Partial update of an artwork row. Uses service-role to bypass RLS
 * (route is gated by requireAdmin, so this is admin-only).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthed = await requireAdmin();
  if (unauthed) return unauthed;

  try {
    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const { error } = await adminSupabase()
      .from("artworks")
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("admin/artworks PATCH error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 500 }
    );
  }
}
