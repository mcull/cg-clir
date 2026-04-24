import Link from "next/link";

interface CohortNavProps {
  active: "artwork" | "ephemera";
}

export default function CohortNav({ active }: CohortNavProps) {
  return (
    <div className="flex items-center justify-end gap-2 mb-3 text-sm">
      <Link
        href="/collection"
        className={active === "artwork" ? "text-green-700 font-semibold" : "text-gray-500 hover:text-gray-900"}
      >
        Artwork
      </Link>
      <span className="text-gray-300">|</span>
      <Link
        href="/ephemera"
        className={active === "ephemera" ? "text-green-700 font-semibold" : "text-gray-500 hover:text-gray-900"}
      >
        Ephemera
      </Link>
    </div>
  );
}
