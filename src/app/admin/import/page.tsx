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

        {/* Import */}
        <div className="bg-white rounded-lg shadow p-8">
          <h2 className="text-xl font-bold text-gray-900 mb-4">
            Import Collection
          </h2>
          <p className="text-gray-600 mb-6">
            Use the import script to add artworks in bulk. See documentation for
            CSV format and usage instructions.
          </p>

          <p className="text-gray-600 mb-4">
            Run the import script from your terminal:
          </p>

          <code className="block bg-gray-100 p-3 rounded text-sm mb-6 text-gray-900">
            npm run import:csv
          </code>

          <p className="text-sm text-gray-600">
            CSV files should include: Title, Artist First Name, Artist Last
            Name, Date Created, Medium, Height, Width, Depth, Inventory Number,
            Tags, and On Website columns.
          </p>
        </div>
      </div>
    </div>
  );
}
