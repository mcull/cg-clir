"use client";
import DropdownPanel from "./DropdownPanel";

interface Option {
  value: string;
  label: string;
  count: number;
}

interface MultiSelectDropdownProps {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (next: string[]) => void;
}

/**
 * Pill button + checkbox panel. Auto-applies on each click. Options
 * with count=0 are rendered greyed-out and disabled.
 */
export default function MultiSelectDropdown({ label, options, selected, onChange }: MultiSelectDropdownProps) {
  function toggle(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  return (
    <DropdownPanel label={label} badgeCount={selected.length}>
      {() => (
        <div className="max-h-72 overflow-y-auto">
          {options.length === 0 && (
            <div className="px-4 py-2 text-sm text-gray-500">No options available</div>
          )}
          {options.map((opt) => {
            const isSelected = selected.includes(opt.value);
            const isDisabled = opt.count === 0 && !isSelected;
            return (
              <label
                key={opt.value}
                className={`flex items-center gap-3 px-4 py-2 text-sm ${
                  isDisabled ? "text-gray-400 cursor-not-allowed" : "text-gray-900 cursor-pointer hover:bg-gray-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={isDisabled}
                  onChange={() => !isDisabled && toggle(opt.value)}
                  className="h-4 w-4"
                />
                <span className="flex-1">{opt.label}</span>
                <span className="text-xs text-gray-500">{opt.count}</span>
              </label>
            );
          })}
        </div>
      )}
    </DropdownPanel>
  );
}
