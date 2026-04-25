"use client";
import { useEffect, useRef, useState, ReactNode } from "react";

interface DropdownPanelProps {
  label: string;
  badgeCount?: number;
  children: (close: () => void) => ReactNode;
}

/**
 * Pill-style trigger button + popover panel with click-outside close.
 * Used by the multi-select, artist typeahead, and sort dropdowns.
 */
export default function DropdownPanel({ label, badgeCount, children }: DropdownPanelProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const labelWithBadge = badgeCount && badgeCount > 0 ? `${label} (${badgeCount})` : label;

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="border border-gray-400 rounded-md px-4 py-2 text-sm font-medium bg-white hover:border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {labelWithBadge} <span className="ml-1">▾</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 min-w-[220px] bg-white border border-gray-300 rounded-md shadow-lg py-2">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
