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
  // Insert; rely on the case-insensitive unique index (LOWER(email))
  // for dedup. PostgREST upsert can't target an expression index, so
  // we catch the unique-violation (23505) and treat it as a success
  // — re-subscribing is a no-op rather than an error to the user.
  const { error: dbError } = await supabase
    .from("mailing_list_signups")
    .insert({ name, email, source: "footer", ip_address: ip, user_agent: ua });
  if (dbError && dbError.code !== "23505") {
    console.error("[/api/subscribe] db error:", dbError);
    return NextResponse.json(
      { error: "Could not save signup" },
      { status: 500 },
    );
  }
  const isDuplicate = dbError?.code === "23505";

  // Email is best-effort — and only fires for genuinely new signups
  // so re-submits don't spam Quinn. notified_at is only stamped when
  // we actually delivered (skipped: false), so the column truly
  // reflects "Quinn was notified".
  if (!isDuplicate) {
    try {
      const result = await sendMailingListNotification({ name, email });
      if (!result.skipped) {
        await supabase
          .from("mailing_list_signups")
          .update({ notified_at: new Date().toISOString() })
          .eq("email", email);
      }
    } catch (err) {
      console.error("[/api/subscribe] email error:", err);
    }
  }

  return NextResponse.json({ ok: true });
}
