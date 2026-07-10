import { ReactNode } from "react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isDevAuthBypass } from "@/lib/admin-auth";
import { isAllowedAdmin } from "@/lib/admin-allowlist";
import { redirect } from "next/navigation";
import AdminNav from "@/components/admin/AdminNav";

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
    <div className="admin-shell flex min-h-screen bg-paper">
      {/* Sidebar */}
      <aside className="sticky top-0 flex h-screen w-[248px] shrink-0 flex-col bg-ink text-paper">
        <div className="border-b border-sidebar-line px-7 pb-6 pt-8">
          <div className="text-[17px] uppercase leading-[1.35] tracking-[2.5px]">
            Creative
            <br />
            Growth
          </div>
          <div className="mt-2.5 text-[11px] uppercase tracking-[2px] text-green-light">
            Admin Console
          </div>
        </div>

        <AdminNav />

        <div className="mt-auto flex flex-col gap-3 border-t border-sidebar-line px-7 pb-7 pt-6">
          <a
            href="/collection"
            className="text-xs tracking-[1px] text-[#CFC9BC] transition-colors hover:text-paper"
          >
            ← View gallery
          </a>
          {/* Logout must be a form-bound server action — onClick handlers
           * don't work in a Server Component, so the old button was inert.
           * signOut() clears the auth cookies, then we redirect to login. */}
          <form
            action={async () => {
              "use server";
              const supabase = createServerSupabaseClient();
              await supabase.auth.signOut();
              redirect("/admin/login");
            }}
          >
            <button
              type="submit"
              className="text-xs tracking-[1px] text-[#CFC9BC] transition-colors hover:text-paper"
            >
              Log out
            </button>
          </form>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1">
        <div className="flex items-center gap-2 bg-green px-10 py-2 text-xs tracking-[1.2px] text-paper">
          <span
            aria-hidden="true"
            className="h-[7px] w-[7px] rounded-full bg-white"
          />
          You&rsquo;re in admin mode — visitors can&rsquo;t see you fussing.
        </div>
        <div className="mx-auto max-w-[1180px] px-12 pb-16 pt-12">{children}</div>
      </main>
    </div>
  );
}
