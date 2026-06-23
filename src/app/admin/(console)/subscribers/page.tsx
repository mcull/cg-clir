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
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Email Subscribers</h1>
          <p className="text-sm text-gray-600 mt-1">
            {signups.length.toLocaleString()} signups from the digital archive
            footer form.
          </p>
        </div>
        <a
          href="/api/admin/subscribers/export"
          download
          className="inline-flex items-center px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded hover:bg-gray-700 transition-colors"
        >
          Download CSV (Artcloud format)
        </a>
      </div>

      {signups.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded p-8 text-center text-gray-500">
          No signups yet.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Signed up</th>
                <th className="px-4 py-3 font-medium">Notified</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {signups.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-900">{row.name}</td>
                  <td className="px-4 py-3 text-gray-700">{row.email}</td>
                  <td className="px-4 py-3 text-gray-500">{row.source}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {fmtDate(row.created_at)}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
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
