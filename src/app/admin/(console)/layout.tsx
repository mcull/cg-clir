import { ReactNode } from "react";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isDevAuthBypass } from "@/lib/admin-auth";
import { isAllowedAdmin } from "@/lib/admin-allowlist";
import { redirect } from "next/navigation";

/**
 * Server-side gate (defense-in-depth alongside middleware). Verifies the
 * user via getUser() and checks the admin allowlist. Unauthenticated →
 * login; authenticated-but-not-allowed → login with a forbidden flag so
 * the login page shows a clear message instead of looping.
 */
async function requireAdminPage() {
  if (isDevAuthBypass()) return;

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data?.user) {
    redirect("/admin/login");
  }
  if (!isAllowedAdmin(data.user.email)) {
    redirect("/admin/login?error=forbidden");
  }
}

interface AdminLayoutProps {
  children: ReactNode;
}

export const metadata = {
  title: "Admin | Creative Growth Gallery",
};

export default async function AdminLayout({ children }: AdminLayoutProps) {
  await requireAdminPage();

  return (
    <div className="flex min-h-screen bg-gray-100">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 text-white relative">
        <div className="p-6 border-b border-gray-700">
          <h1 className="text-xl font-bold">Admin Console</h1>
          <p className="text-sm text-gray-400 mt-2">
            Creative Growth Gallery
          </p>
        </div>

        <nav className="p-6 space-y-4">
          <NavLink href="/admin" label="Dashboard" />
          <NavLink href="/admin/artworks" label="Artworks" />
          <NavLink href="/admin/artists" label="Artists" />
          <NavLink href="/admin/subscribers" label="Subscribers" />
          <NavLink href="/admin/import" label="Import/Export" />
        </nav>

        <div className="absolute bottom-6 left-6 right-6 pt-6 border-t border-gray-700">
          <a
            href="/collection"
            className="block text-sm text-gray-400 hover:text-white transition-colors"
          >
            ← View Gallery
          </a>
          <button
            onClick={async () => {
              "use server";
              const supabase = createServerSupabaseClient();
              await supabase.auth.signOut();
              redirect("/");
            }}
            className="mt-3 block text-sm text-gray-400 hover:text-white transition-colors"
          >
            Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1">
        <div className="bg-blue-600 text-white p-3 text-center text-sm">
          You are in admin mode
        </div>
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="block px-4 py-2 rounded hover:bg-gray-800 transition-colors text-gray-300 hover:text-white"
    >
      {label}
    </Link>
  );
}
