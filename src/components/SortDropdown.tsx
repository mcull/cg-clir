"use client";
import DropdownPanel from "./DropdownPanel";
import type { SortKey } from "@/lib/filter-state";

interface SortDropdownProps {
  current: SortKey | null;
  searchActive: boolean;
  onChange: (next: SortKey | null) => void;
}

const LABELS: Record<SortKey, string> = {
  featured: "Featured",
  relevance: "Relevance",
  artist: "Artist (A-Z)",
  newest: "Newest first",
  oldest: "Oldest first",
  title: "Title (A-Z)",
};

export default function SortDropdown({ current, searchActive, onChange }: SortDropdownProps) {
  // Effective sort: if user hasn't picked, default to relevance with search, featured without
  const effective: SortKey = current ?? (searchActive ? "relevance" : "featured");
  const triggerLabel = `Sort: ${LABELS[effective]}`;

  // Available options: hide 'relevance' when search isn't active
  const options: SortKey[] = (["featured", "relevance", "artist", "newest", "oldest", "title"] as SortKey[])
    .filter((s) => s !== "relevance" || searchActive);

  return (
    <DropdownPanel label={triggerLabel}>
      {(close) => (
        <div>
          {options.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { onChange(s === (searchActive ? "relevance" : "featured") ? null : s); close(); }}
              className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 ${
                effective === s ? "font-semibold text-blue-700" : "text-gray-900"
              }`}
            >
              {effective === s && <span className="mr-2">✓</span>}
              {LABELS[s]}
            </button>
          ))}
        </div>
      )}
    </DropdownPanel>
  );
}
