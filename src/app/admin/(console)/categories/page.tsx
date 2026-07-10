/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Category } from "@/lib/types";

export default function CategoriesPage() {
  const supabase = createClient();

  const [categories, setCategories] = useState<
    (Category & { artwork_count?: number })[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: "",
    description: "",
  });
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    fetchCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchCategories = async () => {
    try {
      setLoading(true);
      const { data, error: fetchError } = await supabase
        .from("categories")
        .select("*")
        .order("sort_order", { ascending: true });

      if (fetchError) throw fetchError;

      // Get counts for each category
      const categoriesWithCounts = await Promise.all(
        (data || []).map(async (cat: Category) => {
          const { count } = await supabase
            .from("artwork_categories")
            .select("*", { count: "exact", head: true })
            .eq("category_id", cat.id);

          return {
            ...cat,
            artwork_count: count || 0,
          };
        })
      );

      setCategories(categoriesWithCounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error loading categories");
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: any) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsCreating(true);
      setError(null);

      const slug = formData.name
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, "")
        .replace(/[\s_]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

      const newCat = {
        name: formData.name,
        slug,
        description: formData.description || null,
        sort_order: (categories.length || 0) + 1,
        ai_suggested: false,
      };

      const { error: insertError } = await supabase
        .from("categories")
        .insert([newCat]);

      if (insertError) throw insertError;

      setFormData({ name: "", description: "" });
      await fetchCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error creating category");
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm("Delete this category?")) return;

    try {
      const { error: deleteError } = await supabase
        .from("categories")
        .delete()
        .eq("id", id);

      if (deleteError) throw deleteError;
      await fetchCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error deleting category");
    }
  };

  return (
    <div>
      <h1 className="text-[44px] leading-none tracking-[-0.5px]">Categories</h1>
      <p className="mt-3 text-sm text-muted">
        {categories.length.toLocaleString()}{" "}
        {categories.length === 1 ? "category" : "categories"} keeping the catalog organized.
      </p>

      {/* Create Form */}
      <div className="mt-8 border border-ink bg-card p-6">
        <h2 className="mb-4 text-base">Create new category</h2>

        {error && (
          <div className="mb-4 border border-ink bg-card px-3.5 py-2.5 text-sm text-ink">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="name"
              className="mb-2 block text-[11px] uppercase tracking-[1.5px] text-muted"
            >
              Name *
            </label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
              className="admin-field w-full border border-line bg-card px-3.5 py-2.5 text-sm"
            />
          </div>

          <div>
            <label
              htmlFor="description"
              className="mb-2 block text-[11px] uppercase tracking-[1.5px] text-muted"
            >
              Description
            </label>
            <textarea
              id="description"
              name="description"
              value={formData.description}
              onChange={handleChange}
              rows={3}
              className="admin-field w-full border border-line bg-card px-3.5 py-2.5 text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={isCreating || !formData.name}
            className="admin-btn admin-btn-primary px-[22px] py-3 text-xs tracking-[2px] disabled:opacity-50"
          >
            {isCreating ? "Creating…" : "Create Category"}
          </button>
        </form>
      </div>

      {/* Categories List */}
      {loading ? (
        <div className="mt-8 border border-ink bg-card py-12 text-center text-sm text-muted">
          Loading…
        </div>
      ) : categories.length > 0 ? (
        <div className="mt-8 border border-ink bg-card overflow-x-auto">
          <table className="w-full">
            <thead className="bg-ink text-paper">
              <tr>
                <th className="px-5 py-3 text-left text-[10px] uppercase tracking-[1.8px]">
                  Name
                </th>
                <th className="px-5 py-3 text-left text-[10px] uppercase tracking-[1.8px]">
                  Description
                </th>
                <th className="px-5 py-3 text-left text-[10px] uppercase tracking-[1.8px]">
                  Artworks
                </th>
                <th className="px-5 py-3 text-left text-[10px] uppercase tracking-[1.8px]">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => (
                <tr key={cat.id} className="hover:bg-row-hover">
                  <td className="border-b border-hairline px-5 py-3 text-sm text-ink">
                    {cat.name}
                    {cat.ai_suggested && (
                      <span className="ml-2 border border-line px-2 py-1 text-xs uppercase tracking-[1px] text-muted">
                        AI suggested
                      </span>
                    )}
                  </td>
                  <td className="border-b border-hairline px-5 py-3 text-[13px] text-muted">
                    {cat.description || "—"}
                  </td>
                  <td className="border-b border-hairline px-5 py-3 text-[13px] text-muted">
                    {cat.artwork_count || 0}
                  </td>
                  <td className="border-b border-hairline px-5 py-3 text-right">
                    <button
                      onClick={() => handleDelete(cat.id)}
                      className="text-xs uppercase tracking-[1.5px] text-red-700 hover:text-red-900"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-8 border border-ink bg-card py-12 text-center">
          <p className="text-sm text-muted">No categories yet.</p>
        </div>
      )}
    </div>
  );
}
