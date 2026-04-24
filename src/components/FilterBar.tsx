"use client";
import { useState, FormEvent } from "react";
import { useRouter, usePathname } from "next/navigation";
import MultiSelectDropdown from "./MultiSelectDropdown";
import ArtistTypeaheadDropdown from "./ArtistTypeaheadDropdown";
import SortDropdown from "./SortDropdown";
import ActiveFilterChips from "./ActiveFilterChips";
import { FilterState, toQueryString } from "@/lib/filter-state";

interface FilterBarProps {
  state: FilterState;
  cohort: "artwork" | "ephemera";
  themeOptions: { value: string; label: string; count: number }[];
  formatOptions: { value: string; label: string; count: number }[];
  decadeOptions: { value: string; label: string; count: number }[];
  artistOptions: { slug: string; name: string; available: boolean }[];
}

/**
 * Composes search input + filter dropdowns + chips. Pushes URL changes
 * via Next.js router; the page re-renders server-side with new params.
 */
export default function FilterBar({
  state,
  cohort,
  themeOptions,
  formatOptions,
  decadeOptions,
  artistOptions,
}: FilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [searchInput, setSearchInput] = useState(state.q);

  function navigate(next: FilterState) {
    // Reset page to 1 when any filter changes
    const reset = { ...next, page: 1 };
    const qs = toQueryString(reset);
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function onSearchSubmit(e: FormEvent) {
    e.preventDefault();
    navigate({ ...state, q: searchInput.trim() });
  }

  // Build chip list from current state
  const chips: { label: string; onRemove: () => void }[] = [];
  for (const t of state.themes) {
    chips.push({
      label: themeOptions.find((o) => o.value === t)?.label || t,
      onRemove: () => navigate({ ...state, themes: state.themes.filter((x) => x !== t) }),
    });
  }
  for (const f of state.formats) {
    chips.push({
      label: formatOptions.find((o) => o.value === f)?.label || f,
      onRemove: () => navigate({ ...state, formats: state.formats.filter((x) => x !== f) }),
    });
  }
  for (const d of state.decades) {
    chips.push({
      label: d,
      onRemove: () => navigate({ ...state, decades: state.decades.filter((x) => x !== d) }),
    });
  }
  if (state.artist) {
    const name = artistOptions.find((a) => a.slug === state.artist)?.name || state.artist;
    chips.push({
      label: name,
      onRemove: () => navigate({ ...state, artist: null }),
    });
  }

  const isCollection = cohort === "artwork";

  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <form onSubmit={onSearchSubmit} className="relative">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search artwork & artists"
            className="border-2 border-gray-900 rounded-md pl-4 pr-10 py-2 text-sm w-80 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button type="submit" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-700" aria-label="Search">
            ⌕
          </button>
        </form>

        {isCollection && (
          <MultiSelectDropdown
            label="Theme"
            options={themeOptions}
            selected={state.themes}
            onChange={(themes) => navigate({ ...state, themes })}
          />
        )}
        {isCollection && (
          <MultiSelectDropdown
            label="Format"
            options={formatOptions}
            selected={state.formats}
            onChange={(formats) => navigate({ ...state, formats })}
          />
        )}
        <ArtistTypeaheadDropdown
          artists={artistOptions}
          selected={state.artist}
          onChange={(artist) => navigate({ ...state, artist })}
        />
        {isCollection && (
          <MultiSelectDropdown
            label="Decade"
            options={decadeOptions}
            selected={state.decades}
            onChange={(decades) => navigate({ ...state, decades })}
          />
        )}

        <div className="ml-auto">
          <SortDropdown
            current={state.sort}
            searchActive={!!state.q}
            onChange={(sort) => navigate({ ...state, sort })}
          />
        </div>
      </div>

      <ActiveFilterChips
        chips={chips}
        onClearAll={() => navigate({ ...state, themes: [], formats: [], decades: [], artist: null })}
      />
    </div>
  );
}
