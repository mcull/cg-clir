"use client";

interface Chip {
  label: string;
  onRemove: () => void;
}

interface ActiveFilterChipsProps {
  chips: Chip[];
  onClearAll: () => void;
}

export default function ActiveFilterChips({ chips, onClearAll }: ActiveFilterChipsProps) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4 text-sm">
      <span className="text-gray-600 mr-1">Active:</span>
      {chips.map((c, i) => (
        <button
          key={i}
          type="button"
          onClick={c.onRemove}
          className="inline-flex items-center gap-1.5 px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-900"
        >
          <span>{c.label}</span>
          <span className="text-gray-500 text-xs">✕</span>
        </button>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="ml-2 text-blue-600 hover:text-blue-800 underline text-sm"
      >
        Clear all
      </button>
    </div>
  );
}
