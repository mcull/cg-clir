"use client";
import { useState } from "react";
import DropdownPanel from "./DropdownPanel";

interface ArtistOption {
  slug: string;
  name: string;
  available: boolean;
}

interface ArtistTypeaheadDropdownProps {
  artists: ArtistOption[];
  selected: string | null;
  onChange: (next: string | null) => void;
}

export default function ArtistTypeaheadDropdown({ artists, selected, onChange }: ArtistTypeaheadDropdownProps) {
  const [filter, setFilter] = useState("");
  const selectedArtist = artists.find((a) => a.slug === selected) || null;
  const triggerLabel = selectedArtist ? `Artist: ${selectedArtist.name}` : "Artist";

  return (
    <DropdownPanel label={triggerLabel}>
      {(close) => {
        const visible = artists
          .filter((a) => a.available || a.slug === selected)
          .filter((a) => !filter || a.name.toLowerCase().includes(filter.toLowerCase()));

        return (
          <div className="w-72">
            <div className="px-3 pb-2">
              <input
                autoFocus
                type="text"
                placeholder={`Search ${artists.length} artists…`}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="max-h-72 overflow-y-auto border-t border-gray-200">
              {selected && (
                <button
                  type="button"
                  onClick={() => { onChange(null); close(); }}
                  className="w-full text-left px-4 py-2 text-sm text-blue-600 hover:bg-gray-50"
                >
                  ✕ Clear artist
                </button>
              )}
              {visible.length === 0 && (
                <div className="px-4 py-2 text-sm text-gray-500">No artists match</div>
              )}
              {visible.map((a) => (
                <button
                  key={a.slug}
                  type="button"
                  onClick={() => { onChange(a.slug); close(); }}
                  className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 hover:bg-gray-50 ${
                    a.slug === selected ? "font-semibold text-blue-700" : "text-gray-900"
                  }`}
                >
                  {a.slug === selected && <span>✓</span>}
                  <span>{a.name}</span>
                </button>
              ))}
            </div>
          </div>
        );
      }}
    </DropdownPanel>
  );
}
