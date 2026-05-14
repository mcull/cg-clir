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
        className={`relative inline-block h-[18px] w-[32px] rounded-full transition-colors ${
          value ? "bg-emerald-600" : disabled ? "bg-gray-200" : "bg-gray-300"
        }`}
        aria-hidden="true"
      >
        <span
          className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-transform ${
            value ? "translate-x-[16px]" : "translate-x-[2px]"
          }`}
        />
      </span>
      <span className="text-xs text-gray-500 tabular-nums">{count}</span>
    </button>
  );
}
