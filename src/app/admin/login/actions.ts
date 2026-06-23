"use server";

import { headers } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isAllowedAdmin } from "@/lib/admin-allowlist";

export interface LoginState {
  status: "idle" | "sent" | "error";
  message: string;
}

/**
 * Send a Supabase magic link — but only after the email passes the admin
 * allowlist, so we never email arbitrary addresses or create auth users for
 * non-admins. The success message is intentionally generic regardless of
 * whether the address was allowed, to avoid email enumeration.
 */
export async function requestMagicLink(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get("email") || "").trim();
  const sent: LoginState = {
    status: "sent",
    message: "If that address is authorized, a sign-in link is on its way — check your inbox.",
  };

  if (!email) {
    return { status: "error", message: "Enter your email address." };
  }

  // Non-allowed addresses get the same generic response (no enumeration).
  if (!isAllowedAdmin(email)) return sent;

  const h = headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host");
  const origin = `${proto}://${host}`;

  const supabase = createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=/admin`,
      shouldCreateUser: true,
    },
  });

  if (error) {
    console.error("[admin/login] signInWithOtp error:", error.message);
    return { status: "error", message: "Could not send the link. Please try again." };
  }

  return sent;
}
