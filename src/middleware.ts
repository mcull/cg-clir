import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isAllowedAdmin } from "@/lib/admin-allowlist";

/**
 * Central gate for /admin and /api/admin. Refreshes the Supabase session
 * (keeping cookies fresh for Server Components) and enforces authn + authz
 * with getUser() — the validated check — at the edge. Pages redirect to
 * login; API routes get 401. The layout and requireAdmin() remain as
 * defense-in-depth.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const { pathname } = request.nextUrl;

  // Dev-only escape hatch — never honored in production.
  const devBypass =
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_AUTH_BYPASS === "true";

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Always refresh the token (getUser validates it against the auth server).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The login page must stay reachable while signed out.
  if (pathname === "/admin/login") return response;

  const allowed = devBypass || isAllowedAdmin(user?.email);
  if (allowed) return response;

  if (pathname.startsWith("/api/admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/admin/login";
  loginUrl.search = "";
  if (user) loginUrl.searchParams.set("error", "forbidden");
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/admin/:path*"],
};
