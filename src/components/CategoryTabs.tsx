"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Category } from "@/lib/types";

interface CategoryTabsProps {
  categories: Category[];
}

export default function CategoryTabs({ categories }: CategoryTabsProps) {
  const searchParams = useSearchParams();
  const activeCategory = searchParams.get("category") || "all";

  return (
    <div className="mb-8 border-b border-gray-200 overflow-x-auto">
      <div role="tablist" className="flex gap-8 pb-0">
        <Link
          href="/collection"
          role="tab"
          aria-selected={activeCategory === "all"}
          aria-controls="artwork-grid"
          className={`px-2 py-3 font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeCategory === "all"
              ? "text-blue-600 border-blue-600"
              : "text-gray-700 border-transparent hover:text-gray-900"
          }`}
        >
          All Works
        </Link>

        {categories.map((category) => (
          <Link
            key={category.id}
            href={`/collection?category=${category.slug}`}
            role="tab"
            aria-selected={activeCategory === category.slug}
            aria-controls="artwork-grid"
            className={`px-2 py-3 font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeCategory === category.slug
                ? "text-blue-600 border-blue-600"
                : "text-gray-700 border-transparent hover:text-gray-900"
            }`}
          >
            {category.name}
          </Link>
        ))}
      </div>
    </div>
  );
}
