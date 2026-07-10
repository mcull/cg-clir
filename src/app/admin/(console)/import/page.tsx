/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchAllPages } from "@/lib/paginate";
import SectionHeader from "@/components/admin/SectionHeader";

// Prefer R2 over CDN — image_url is the canonical R2 path post-migration.
// This inverts resolveImageUrl()'s priority, which falls back to CDN for
// display continuity on rows still in mid-migration.
function exportImageUrl(
  image_url: string | null,
  image_original: string | null
): string {
  if (!image_url) return image_original || "";
  if (image_url.startsWith("http://") || image_url.startsWith("https://")) {
    return image_url;
  }
  const base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  return base ? `${base}/${image_url}` : image_url;
}

export default function ImportPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleExport = async () => {
    try {
      setLoading(true);
      setError(null);

      // Paginate past PostgREST's 1000-row cap so the export covers the
      // whole catalog (2,500+ rows), not just the first page. The id
      // tiebreaker keeps ordering stable across page boundaries.
      const data = await fetchAllPages<any>(async (from, to) => {
        const { data, error: fetchError } = await supabase
          .from("artworks")
          .select(
            `
            *,
            artist:artists(first_name, last_name),
            categories:artwork_categories(category:categories(name))
            `
          )
          .order("sort_order", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);
        if (fetchError) throw fetchError;
        return data || [];
      });

      // Create CSV
      const headers = [
        "ID",
        "Title",
        "Artist",
        "Date Created",
        "Medium",
        "Height",
        "Width",
        "Depth",
        "Inventory Number",
        "Filename",
        "Categories",
        "Tags",
        "On Website",
      ];

      const rows = (data || []).map((artwork: any): string[] => [
        artwork.id,
        artwork.title,
        artwork.artist
          ? `${artwork.artist.first_name} ${artwork.artist.last_name}`
          : "",
        artwork.date_created || "",
        artwork.medium || "",
        artwork.height || "",
        artwork.width || "",
        artwork.depth || "",
        artwork.inventory_number || "",
        exportImageUrl(artwork.image_url, artwork.image_original),
        artwork.categories?.map((c: any) => c.category.name).join("; ") || "",
        artwork.tags?.join("; ") || "",
        artwork.on_website ? "Yes" : "No",
      ]);

      const csv = [
        headers.join(","),
        ...rows.map((row) =>
          row
            .map((cell) =>
              typeof cell === "string" && cell.includes(",")
                ? `"${cell.replace(/"/g, '""')}"`
                : cell
            )
            .join(",")
        ),
      ].join("\n");

      // Download
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gallery-export-${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setSuccess("Exported successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1 className="text-[44px] leading-none tracking-[-0.5px]">
        Import / Export
      </h1>
      <p className="mt-3 text-sm text-muted">
        Bring the catalog data in and out as CSV.
      </p>

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Export */}
        <div className="border border-ink bg-card p-8">
          <SectionHeader title="Export" rule="hairline" />
          <p className="mt-4 mb-6 text-sm text-muted">
            Download the current catalog as a CSV file. This includes all
            artwork metadata, artist information, and categories.
          </p>

          {error && (
            <div className="mb-4 border border-[#b3261e] px-3 py-2.5 text-sm text-[#b3261e]">
              {error}
            </div>
          )}

          {success && (
            <div className="mb-4 border border-green px-3 py-2.5 text-sm text-green">
              {success}
            </div>
          )}

          <button
            onClick={handleExport}
            disabled={loading}
            className="admin-btn admin-btn-primary px-[22px] py-3 text-xs tracking-[2px] disabled:opacity-50"
          >
            {loading ? "Exporting..." : "Export as CSV"}
          </button>
        </div>

        {/* Import (disabled) */}
        <div className="border border-ink bg-card p-8 opacity-75">
          <SectionHeader title="Import" rule="hairline" />
          <p className="mt-4 mb-6 text-sm text-muted">
            Upload a CSV to bulk-create or update artworks. The expected
            columns mirror the existing Art Cloud export: Title, Artist First
            Name, Artist Last Name, Date Created, Medium, Height, Width, Depth,
            Inventory Number, Tags, and On Website.
          </p>

          <div className="border border-dashed border-line bg-[#FBFAF7] p-6 text-center text-sm text-muted mb-4">
            <p className="mb-1 text-ink">Browser-based import is disabled.</p>
            <p>
              A bulk write through this form would touch every artwork row;
              we&apos;re holding it until role-based access controls land on
              the admin so the action is appropriately gated.
            </p>
          </div>

          <button
            type="button"
            disabled
            className="admin-btn admin-btn-primary px-[22px] py-3 text-xs tracking-[2px] cursor-not-allowed"
            title="Disabled until RBAC is in place"
          >
            Choose CSV…
          </button>

          <p className="mt-4 text-xs text-muted">
            In the meantime, run the script from a terminal:{" "}
            <code className="border border-line px-1 text-ink">
              npm run import:csv
            </code>
          </p>
        </div>
      </div>
    </div>
  );
}
