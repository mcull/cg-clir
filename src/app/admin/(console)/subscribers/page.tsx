import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = {
  title: "Subscribers | Admin | Creative Growth Gallery",
};

// Always render fresh — the table changes on every public signup,
// and Next would otherwise cache the build-time snapshot (which is
// empty because the build env can't reach prod data).
export const dynamic = "force-dynamic";

interface SignupRow {
  id: string;
  name: string;
  email: string;
  source: string;
  notified_at: string | null;
  created_at: string;
}

async function getSignups(): Promise<SignupRow[]> {
  // Service-role client (bypasses RLS) — page is already gated by
  // the admin layout's auth check.
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("mailing_list_signups")
    .select("id, name, email, source, notified_at, created_at")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[admin/subscribers] db error:", error);
    return [];
  }
  return (data || []) as SignupRow[];
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function AdminSubscribersPage() {
  const signups = await getSignups();

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[44px] leading-none tracking-[-0.5px]">
            Email Subscribers
          </h1>
          <p className="mt-3 text-sm text-muted">
            {signups.length.toLocaleString()} signups from the digital archive
            footer form.
          </p>
        </div>
        <a
          href="/api/admin/subscribers/export"
          download
          className="admin-btn admin-btn-secondary px-[22px] py-3 text-xs tracking-[2px]"
        >
          Download CSV (Artcloud format)
        </a>
      </div>

      {signups.length === 0 ? (
        <div className="mt-8 border border-ink bg-card py-12 text-center">
          <p className="text-sm text-muted">No signups yet.</p>
        </div>
      ) : (
        <div className="mt-8 border border-ink bg-card">
          <table className="w-full">
            <thead className="bg-ink text-paper">
              <tr>
                <th className="px-5 py-3 text-left text-[10px] uppercase tracking-[1.8px]">
                  Name
                </th>
                <th className="px-5 py-3 text-left text-[10px] uppercase tracking-[1.8px]">
                  Email
                </th>
                <th className="px-5 py-3 text-left text-[10px] uppercase tracking-[1.8px]">
                  Source
                </th>
                <th className="px-5 py-3 text-left text-[10px] uppercase tracking-[1.8px]">
                  Signed up
                </th>
                <th className="px-5 py-3 text-left text-[10px] uppercase tracking-[1.8px]">
                  Notified
                </th>
              </tr>
            </thead>
            <tbody>
              {signups.map((row) => (
                <tr key={row.id} className="hover:bg-row-hover">
                  <td className="px-5 py-3 border-b border-hairline text-sm text-ink">
                    {row.name}
                  </td>
                  <td className="px-5 py-3 border-b border-hairline text-sm text-ink">
                    {row.email}
                  </td>
                  <td className="px-5 py-3 border-b border-hairline text-[13px] text-muted">
                    {row.source}
                  </td>
                  <td className="px-5 py-3 border-b border-hairline text-[13px] text-muted">
                    {fmtDate(row.created_at)}
                  </td>
                  <td className="px-5 py-3 border-b border-hairline text-[13px] text-muted">
                    {row.notified_at ? fmtDate(row.notified_at) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
