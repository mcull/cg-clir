import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import crypto from "crypto";

function hashIP(ip: string): string {
  return crypto
    .createHash("sha256")
    .update(ip + (process.env.IP_HASH_SALT || ""))
    .digest("hex");
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { artwork_id } = body;

    if (!artwork_id) {
      return NextResponse.json(
        { error: "artwork_id is required" },
        { status: 400 }
      );
    }

    // Get artwork
    const supabase = createServerSupabaseClient();
    const { data: artwork, error: artworkError } = await supabase
      .from("artworks")
      .select("id, image_url, title")
      .eq("id", artwork_id)
      .single();

    if (artworkError || !artwork) {
      return NextResponse.json(
        { error: "Artwork not found" },
        { status: 404 }
      );
    }

    // Get client IP
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0] ||
      request.headers.get("x-real-ip") ||
      request.ip ||
      "unknown";

    const ipHash = hashIP(ip);
    const userAgent = request.headers.get("user-agent");
    const referrer = request.headers.get("referer");

    // Log download event
    const { error: insertError } = await supabase
      .from("download_events")
      .insert({
        artwork_id,
        ip_hash: ipHash,
        user_agent: userAgent,
        referrer: referrer,
      });

    if (insertError) {
      console.error("Error logging download event:", insertError);
    }

    // Track with PostHog if configured
    if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
      try {
        await fetch(
          `${process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com"}/track/`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              api_key: process.env.NEXT_PUBLIC_POSTHOG_KEY,
              event: "artwork_downloaded_server",
              properties: {
                artwork_id,
                title: artwork.title,
              },
              distinct_id: ipHash,
            }),
          }
        ).catch(() => {
          // Silently fail PostHog tracking
        });
      } catch (err) {
        console.error("Error tracking with PostHog:", err);
      }
    }

    // Return image URL (will be signed R2 URL in production)
    return NextResponse.json({
      url: artwork.image_url,
      id: artwork.id,
      title: artwork.title,
    });
  } catch (error) {
    console.error("Download API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
