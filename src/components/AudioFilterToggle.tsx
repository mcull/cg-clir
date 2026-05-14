"use client";
import { Headphones } from "lucide-react";

interface AudioFilterToggleProps {
  value: boolean;
  count: number;
  onChange: (next: boolean) => void;
}

export default function AudioFilterToggle({ value, count, onChange }: AudioFilterToggleProps) {
  const disabled = count === 0 && !value;
  const handleClick = () => {
    if (disabled) return;
    onChange(!value);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-disabled={disabled || undefined}
      aria-label="With audio descriptions"
      title={`With audio descriptions — ${count} ${count === 1 ? "work" : "works"}`}
      onClick={handleClick}
      className={`inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
        disabled
          ? "border-gray-200 text-gray-400 cursor-not-allowed"
          : "border-gray-400 text-gray-900 hover:bg-gray-50 cursor-pointer"
      }`}
    >
      <Headphones size={16} aria-hidden="true" />
      <span
        aria-hidden="true"
        className="relative inline-block rounded-full transition-colors flex-shrink-0"
        style={{
          width: 32,
          height: 18,
          backgroundColor: value ? "#059669" : disabled ? "#e5e7eb" : "#d1d5db",
        }}
      >
        <span
          className="absolute rounded-full bg-white shadow"
          style={{
            top: 2,
            left: value ? 16 : 2,
            width: 14,
            height: 14,
            transition: "left 150ms ease",
          }}
        />
      </span>
      <span className="text-xs text-gray-500 tabular-nums">{count}</span>
    </button>
  );
}
