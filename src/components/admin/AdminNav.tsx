"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS: { href: string; label: string; exact?: boolean }[] = [
  { href: "/admin", label: "Dashboard", exact: true },
  { href: "/admin/artworks", label: "Artworks" },
  { href: "/admin/artists", label: "Artists" },
  { href: "/admin/subscribers", label: "Subscribers" },
  { href: "/admin/import", label: "Import/Export" },
];

/**
 * Sidebar navigation. Client component so it can mark the active route with
 * a small green square (the redesign's active indicator).
 */
export default function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5 px-3 py-5">
      {ITEMS.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2.5 rounded-[2px] px-4 py-2.5 text-xs uppercase tracking-[2px] transition-colors ${
              active
                ? "text-paper"
                : "text-[#CFC9BC] hover:bg-sidebar-hover hover:text-paper"
            }`}
          >
            {/* 7px square: green when active, transparent otherwise so labels stay aligned. */}
            <span
              aria-hidden="true"
              className={`h-[7px] w-[7px] shrink-0 ${active ? "bg-green" : "bg-transparent"}`}
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
