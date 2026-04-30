import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 30;

// Schema CG already imports against — keep the order exactly as
// shipped in tmp/ArtcloudClientImportTemplate.csv so Quinn can
// drop the file straight into Artcloud's importer.
const ARTCLOUD_HEADERS = [
  "salutation",
  "firstname",
  "lastname",
  "email",
  "addressline1",
  "addressline2",
  "city",
  "state",
  "zip",
  "country",
  "shipping_addressline1",
  "shipping_addressline2",
  "shipping_city",
  "shipping_state",
  "shipping_zip",
  "shipping_country",
  "phone_home",
  "phone_mobile",
  "phone_other",
  "notes",
  "company",
  "website",
  "tags",
  "origin",
  "staff_email",
  "created",
  "is_subscribed",
  "spouse_first_name",
  "spouse_last_name",
  "interests",
  "artist_interests",
  "job_title",
  "import_key",
] as const;

function csvCell(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // Quote if it contains a comma, quote, or newline; double internal quotes.
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length <= 1) return { first: parts[0] || "", last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

export async function GET() {
  const unauthed = await requireAdmin();
  if (unauthed) return unauthed;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("mailing_list_signups")
    .select("name, email, source, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[/api/admin/subscribers/export] db error:", error);
    return NextResponse.json({ error: "Could not fetch" }, { status: 500 });
  }

  const lines = [ARTCLOUD_HEADERS.join(",")];
  for (const row of data || []) {
    const { first, last } = splitName(row.name as string);
    const cells: Record<(typeof ARTCLOUD_HEADERS)[number], string> = {
      salutation: "",
      firstname: first,
      lastname: last,
      email: row.email as string,
      addressline1: "",
      addressline2: "",
      city: "",
      state: "",
      zip: "",
      country: "",
      shipping_addressline1: "",
      shipping_addressline2: "",
      shipping_city: "",
      shipping_state: "",
      shipping_zip: "",
      shipping_country: "",
      phone_home: "",
      phone_mobile: "",
      phone_other: "",
      notes: "",
      company: "",
      website: "",
      tags: "digital-archive",
      origin: (row.source as string) || "footer",
      staff_email: "",
      // Artcloud accepts ISO; if they prefer YYYY-MM-DD just slice(0,10).
      created: row.created_at as string,
      is_subscribed: "true",
      spouse_first_name: "",
      spouse_last_name: "",
      interests: "",
      artist_interests: "",
      job_title: "",
      // Stable key so re-imports update the same record instead of
      // creating duplicates (Artcloud's documented dedup field).
      import_key: `archive-${row.email as string}`,
    };
    lines.push(ARTCLOUD_HEADERS.map((h) => csvCell(cells[h])).join(","));
  }

  const today = new Date().toISOString().slice(0, 10);
  return new NextResponse(lines.join("\n") + "\n", {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="archive-subscribers-${today}.csv"`,
      "cache-control": "no-store",
    },
  });
}
