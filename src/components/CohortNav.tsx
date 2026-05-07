import Link from "next/link";

interface CohortNavProps {
  active: "artwork" | "ephemera";
}

export default function CohortNav({ active }: CohortNavProps) {
  // Separator is a CSS border (no text node) so there's no character
  // to fail color-contrast checks. Decorative-only by construction.
  return (
    <div className="flex items-center text-sm">
      <Link
        href="/"
        className={
          "pr-3 " +
          (active === "artwork"
            ? "text-green-700 font-semibold"
            : "text-gray-500 hover:text-gray-900")
        }
      >
        Artwork
      </Link>
      <Link
        href="/ephemera"
        className={
          "pl-3 border-l border-gray-300 " +
          (active === "ephemera"
            ? "text-green-700 font-semibold"
            : "text-gray-500 hover:text-gray-900")
        }
      >
        Ephemera
      </Link>
    </div>
  );
}
