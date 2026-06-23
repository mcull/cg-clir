import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isAllowedAdmin } from "@/lib/admin-allowlist";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/**
 * Dev-only escape hatch. The bypass is honored ONLY outside production, so
 * a stray NEXT_PUBLIC_AUTH_BYPASS=true in a prod environment can never open
 * the admin again.
 */
export function isDevAuthBypass(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_AUTH_BYPASS === "true"
  );
}

/**
 * Gate admin API routes: requires a verified Supabase user whose email is
 * allowed (domain or allowlist). Uses getUser() — which validates the JWT
 * against the auth server — rather than getSession(), which only decodes
 * the cookie. Returns null on success; a 401 NextResponse to return early
 * on failure.
 */
export async function requireAdmin(): Promise<NextResponse | null> {
  if (isDevAuthBypass()) return null;
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user || !isAllowedAdmin(data.user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/**
 * Service-role Supabase client for admin write paths. Bypasses RLS, so
 * only call from API routes that have already gone through requireAdmin.
 */
export function adminSupabase(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
