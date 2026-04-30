import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendMailingListNotification } from "@/lib/email";

export const maxDuration = 15;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  let body: { name?: unknown; email?: unknown; honeypot?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Honeypot: a hidden field humans never see/fill. Bots that
  // blindly fill every input get silently swallowed (200 OK so they
  // don't retry, no DB write).
  if (typeof body.honeypot === "string" && body.honeypot.length > 0) {
    return NextResponse.json({ ok: true });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";

  if (!name || name.length > 200) {
    return NextResponse.json({ error: "Name required" }, { status: 400 });
  }
  if (!email || !EMAIL_RE.test(email) || email.length > 320) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = request.headers.get("user-agent") || null;

  const supabase = createAdminClient();
  // Upsert on email (case-insensitive index handles dedup at the DB
  // layer). Re-subscribing refreshes name + ip + ua.
  const { error: dbError } = await supabase
    .from("mailing_list_signups")
    .upsert(
      { name, email, source: "footer", ip_address: ip, user_agent: ua },
      { onConflict: "email" },
    );
  if (dbError) {
    console.error("[/api/subscribe] db error:", dbError);
    return NextResponse.json(
      { error: "Could not save signup" },
      { status: 500 },
    );
  }

  // Email is best-effort — we already saved the row, so a failure
  // here shouldn't punish the user with an error response.
  try {
    await sendMailingListNotification({ name, email });
    await supabase
      .from("mailing_list_signups")
      .update({ notified_at: new Date().toISOString() })
      .eq("email", email);
  } catch (err) {
    console.error("[/api/subscribe] email error:", err);
  }

  return NextResponse.json({ ok: true });
}
