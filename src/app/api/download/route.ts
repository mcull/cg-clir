/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resolveImageUrl } from "@/lib/utils";
import crypto from "crypto";

function hashIP(ip: string): string {
  return crypto
    .createHash("sha256")
    .update(ip + (process.env.IP_HASH_SALT || ""))
    .digest("hex");
}

function buildFilename(artistName: string | null, title: string): string {
  const parts = ["Creative Growth Public Archive"];
  if (artistName && artistName.trim()) parts.push(artistName.trim());
  parts.push((title || "Untitled").trim());
  // Sanitize: drop characters that are illegal in common filesystems / HTTP headers.
  const safe = parts.join(" - ").replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return `${safe}.jpg`;
}

/**
 * GET /api/download?id=<artwork_id>
 *
 * Streams the artwork's image with Content-Disposition: attachment so the
 * browser triggers a real download regardless of source (R2 or legacy
 * artcld). Logs a download_event row plus a PostHog event keyed by the
 * (salted) hashed client IP.
 *
 * The browser sees a same-origin response with attachment headers, so
 * the `download` filename is honored consistently across all sources.
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const artwork_id = url.searchParams.get("id");
    if (!artwork_id) {
      return NextResponse.json({ error: "id query param is required" }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const { data: artwork, error: artworkError } = await supabase
      .from("artworks")
      .select("id, image_url, image_original, title, artist:artists(first_name, last_name)")
      .eq("id", artwork_id)
      .single();

    if (artworkError || !artwork) {
      return NextResponse.json({ error: "Artwork not found" }, { status: 404 });
    }
    const sourceUrl = resolveImageUrl(artwork);
    if (!sourceUrl) {
      return NextResponse.json({ error: "Artwork has no image" }, { status: 404 });
    }

    // Tracking
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0] ||
      request.headers.get("x-real-ip") ||
      request.ip ||
      "unknown";
    const ipHash = hashIP(ip);
    const userAgent = request.headers.get("user-agent");
    const referrer = request.headers.get("referer");

    await supabase
      .from("download_events")
      .insert({ artwork_id, ip_hash: ipHash, user_agent: userAgent, referrer: referrer })
      .then(({ error }) => {
        if (error) console.error("Error logging download event:", error);
      });

    if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
      fetch(
        `${process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com"}/track/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: process.env.NEXT_PUBLIC_POSTHOG_KEY,
            event: "artwork_downloaded_server",
            properties: { artwork_id, title: artwork.title },
            distinct_id: ipHash,
          }),
        }
      ).catch(() => {});
    }

    // Stream the source image back with attachment headers.
    const sourceResponse = await fetch(sourceUrl);
    if (!sourceResponse.ok || !sourceResponse.body) {
      return NextResponse.json(
        { error: `Source image fetch failed: ${sourceResponse.status}` },
        { status: 502 }
      );
    }

    const artistTuple = (artwork as any).artist;
    const artistName = artistTuple
      ? `${artistTuple.first_name || ""} ${artistTuple.last_name || ""}`.trim()
      : null;

    const filename = buildFilename(artistName || null, artwork.title);
    const contentType = sourceResponse.headers.get("content-type") || "image/jpeg";

    return new NextResponse(sourceResponse.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Download API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
