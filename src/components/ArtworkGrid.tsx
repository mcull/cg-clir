import { ReactNode } from "react";

interface ArtworkGridProps {
  children: ReactNode;
  columns?: "responsive" | "3" | "2" | "1";
}

export default function ArtworkGrid({
  children,
  columns = "responsive",
}: ArtworkGridProps) {
  const gridColsClass = {
    responsive:
      "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
    "3": "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    "2": "grid-cols-1 sm:grid-cols-2",
    "1": "grid-cols-1",
  }[columns];

  return (
    <div
      className={`grid gap-6 ${gridColsClass}`}
      aria-label="Artwork collection"
    >
      {children}
    </div>
  );
}
