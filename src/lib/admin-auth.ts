import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/**
 * Gate admin API routes behind the same auth check the admin layout uses
 * (Supabase session, with a NEXT_PUBLIC_AUTH_BYPASS dev escape hatch).
 * Returns null on success; returns a 401 NextResponse to throw early on
 * failure.
 */
export async function requireAdmin(): Promise<NextResponse | null> {
  if (process.env.NEXT_PUBLIC_AUTH_BYPASS === "true") return null;
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session) {
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
