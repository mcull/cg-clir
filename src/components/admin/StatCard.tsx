/**
 * Catalog / activity stat card: label + big number, hard-edged white card with
 * an ink border and a green offset shadow on hover. An optional colored swatch
 * square sits at the top-right. Zero values render in `faint` per the design.
 */
export default function StatCard({
  label,
  value,
  swatch,
}: {
  label: string;
  value: number | string;
  swatch?: string;
}) {
  const isZero = value === 0 || value === "0";
  const display = typeof value === "number" ? value.toLocaleString() : value;

  return (
    <div className="admin-card-hover relative border border-ink bg-card px-5 pb-6 pt-5">
      {swatch && (
        <span
          aria-hidden="true"
          className="absolute right-3.5 top-3.5 h-2.5 w-2.5"
          style={{ backgroundColor: swatch }}
        />
      )}
      <div className="text-[11px] uppercase tracking-[1.5px] text-muted">
        {label}
      </div>
      <div
        className={`mt-3.5 text-[42px] leading-none tracking-[-1px] tabular-nums ${
          isZero ? "text-faint" : "text-ink"
        }`}
      >
        {display}
      </div>
    </div>
  );
}
