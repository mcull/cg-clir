import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Magic-link / OAuth callback. Exchanges the one-time `code` for a session
 * (cookies are set by the SSR client) and redirects to `next` (default
 * /admin). On failure, bounce back to login with an error flag.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/admin";

  if (code) {
    const supabase = createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    console.error("[auth/callback] exchange error:", error.message);
  }

  return NextResponse.redirect(`${origin}/admin/login?error=auth`);
}
