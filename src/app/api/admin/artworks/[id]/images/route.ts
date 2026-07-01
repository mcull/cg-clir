import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminSupabase } from "@/lib/admin-auth";
import { uploadToR2, artworkImageKey } from "@/lib/r2";
import { generateVariants } from "@/lib/image-processing";

export const maxDuration = 60;

/** GET — list an artwork's images, primary first. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthed = await requireAdmin();
  if (unauthed) return unauthed;
  const { id } = await params;
  const { data, error } = await adminSupabase()
    .from("artwork_images")
    .select("*")
    .eq("artwork_id", id)
    .order("is_primary", { ascending: false })
    .order("sort_order", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ images: data });
}

/**
 * POST — add an image, multipart/form-data:
 *   file?: Blob | url?: string   (one required)
 *   short_description?: string
 *   make_primary?: "true"
 * Generates variants, uploads to R2, inserts the row. If it's the artwork's
 * first image or make_primary is set, it becomes primary.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthed = await requireAdmin();
  if (unauthed) return unauthed;
  const { id: artworkId } = await params;
  const db = adminSupabase();

  try {
    const form = await request.formData();
    const file = form.get("file");
    const url = form.get("url");
    const shortDescription = (form.get("short_description") as string) || null;
    const makePrimaryRequested = form.get("make_primary") === "true";

    let input: Buffer;
    let sourceUrl: string | null = null;
    if (file instanceof Blob) {
      input = Buffer.from(await file.arrayBuffer());
    } else if (typeof url === "string" && url) {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
      input = Buffer.from(await resp.arrayBuffer());
      sourceUrl = url;
    } else {
      return NextResponse.json({ error: "Provide a file or a url" }, { status: 400 });
    }

    // Folder = inventory_number when available, else the artwork id.
    const { data: art } = await db
      .from("artworks")
      .select("inventory_number")
      .eq("id", artworkId)
      .single();
    const folder = art?.inventory_number || artworkId;

    // Reserve the row id up front so the R2 key can use it.
    const imageId = crypto.randomUUID();
    const variants = await generateVariants(input);
    let displayUrl: string | null = sourceUrl;
    let originalUrl: string | null = sourceUrl;
    for (const v of variants) {
      const key = artworkImageKey(folder, imageId, v.name);
      const publicUrl = await uploadToR2(key, v.buffer, "image/jpeg");
      if (v.name === "large_1600") displayUrl = publicUrl;
      if (v.name === "original") originalUrl = publicUrl;
    }

    // Next sort_order = max + 1.
    const { data: maxRow } = await db
      .from("artwork_images")
      .select("sort_order")
      .eq("artwork_id", artworkId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { count } = await db
      .from("artwork_images")
      .select("id", { count: "exact", head: true })
      .eq("artwork_id", artworkId);

    const { data: inserted, error: insErr } = await db
      .from("artwork_images")
      .insert({
        id: imageId,
        artwork_id: artworkId,
        image_url: displayUrl,
        image_original: originalUrl,
        short_description: shortDescription,
        sort_order: (maxRow?.sort_order ?? -1) + 1,
        is_primary: false,
      })
      .select()
      .single();
    if (insErr) throw insErr;

    // First image, or explicitly requested: make it the single primary.
    if (makePrimaryRequested || (count ?? 0) === 0) {
      const { error: pErr } = await db
        .from("artwork_images")
        .update({ is_primary: false })
        .eq("artwork_id", artworkId)
        .neq("id", imageId);
      if (pErr) throw pErr;
      const { error: p2Err } = await db
        .from("artwork_images")
        .update({ is_primary: true })
        .eq("id", imageId);
      if (p2Err) throw p2Err;
    }

    return NextResponse.json({ image: inserted });
  } catch (err) {
    console.error("images POST error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Create failed" },
      { status: 500 }
    );
  }
}
