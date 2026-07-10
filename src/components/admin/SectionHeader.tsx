import { ReactNode } from "react";

/**
 * Section header: an UPPERCASE tracked label followed by a flex-1 rule on the
 * same baseline, with an optional right-aligned qualifier ("LAST 30 DAYS").
 * `rule` picks the divider weight — `ink` for page sections, `hairline` for
 * rules inside a card.
 */
export default function SectionHeader({
  title,
  qualifier,
  rule = "ink",
  className = "",
}: {
  title: ReactNode;
  qualifier?: ReactNode;
  rule?: "ink" | "hairline";
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-4 ${className}`}>
      <h2 className="whitespace-nowrap text-xs uppercase tracking-[2.5px] text-ink">
        {title}
      </h2>
      <span
        aria-hidden="true"
        className={`h-px flex-1 ${rule === "ink" ? "bg-ink" : "bg-hairline"}`}
      />
      {qualifier && (
        <span className="whitespace-nowrap text-[11px] uppercase tracking-[1px] text-muted">
          {qualifier}
        </span>
      )}
    </div>
  );
}
