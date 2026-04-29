/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function ImportPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleExport = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from("artworks")
        .select(
          `
          *,
          artist:artists(first_name, last_name),
          categories:artwork_categories(category:categories(name))
          `
        )
        .order("sort_order", { ascending: true });

      if (fetchError) throw fetchError;

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
      <h1 className="text-3xl font-bold text-gray-900 mb-8">
        Import / Export
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Export */}
        <div className="bg-white rounded-lg shadow p-8">
          <h2 className="text-xl font-bold text-gray-900 mb-4">
            Export Collection
          </h2>
          <p className="text-gray-600 mb-6">
            Download the current catalog as a CSV file. This includes all
            artwork metadata, artist information, and categories.
          </p>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm">
              {error}
            </div>
          )}

          {success && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-green-800 text-sm">
              {success}
            </div>
          )}

          <button
            onClick={handleExport}
            disabled={loading}
            className="button-primary disabled:opacity-50"
          >
            {loading ? "Exporting..." : "Export as CSV"}
          </button>
        </div>

        {/* Import (disabled) */}
        <div className="bg-white rounded-lg shadow p-8 opacity-75">
          <h2 className="text-xl font-bold text-gray-900 mb-4">
            Import Collection
          </h2>
          <p className="text-gray-600 mb-6">
            Upload a CSV to bulk-create or update artworks. The expected
            columns mirror the existing Art Cloud export: Title, Artist First
            Name, Artist Last Name, Date Created, Medium, Height, Width, Depth,
            Inventory Number, Tags, and On Website.
          </p>

          <div className="border-2 border-dashed border-gray-300 rounded p-6 text-center text-sm text-gray-500 mb-4">
            <p className="font-semibold mb-1">Browser-based import is disabled.</p>
            <p>
              A bulk write through this form would touch every artwork row;
              we&apos;re holding it until role-based access controls land on
              the admin so the action is appropriately gated.
            </p>
          </div>

          <button
            type="button"
            disabled
            className="button-primary opacity-50 cursor-not-allowed"
            title="Disabled until RBAC is in place"
          >
            Choose CSV…
          </button>

          <p className="text-xs text-gray-500 mt-4">
            In the meantime, run the script from a terminal:{" "}
            <code className="bg-gray-100 px-1 rounded">npm run import:csv</code>
          </p>
        </div>
      </div>
    </div>
  );
}
