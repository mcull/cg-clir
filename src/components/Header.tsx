"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import SearchBar from "./SearchBar";

export default function Header() {
  const pathname = usePathname();

  // Don't show header on admin pages
  const isAdmin = pathname?.startsWith("/admin");
  if (isAdmin) return null;

  return (
    <header className="border-b border-gray-200 bg-white sticky top-0 z-40">
      <nav className="container-max py-4 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link
            href="/"
            className="text-xl font-serif font-bold text-gray-900 hover:text-blue-600 transition-colors"
          >
            Creative Growth Gallery
          </Link>

          <ul className="hidden md:flex gap-6 items-center">
            <li>
              <Link
                href="/collection"
                className={`hover:text-blue-600 transition-colors ${
                  pathname === "/collection"
                    ? "text-blue-600 font-semibold"
                    : "text-gray-700"
                }`}
              >
                Collection
              </Link>
            </li>
            <li>
              <Link
                href="/artists"
                className={`hover:text-blue-600 transition-colors ${
                  pathname === "/artists"
                    ? "text-blue-600 font-semibold"
                    : "text-gray-700"
                }`}
              >
                Artists
              </Link>
            </li>
            <li>
              <Link
                href="/about"
                className={`hover:text-blue-600 transition-colors ${
                  pathname === "/about"
                    ? "text-blue-600 font-semibold"
                    : "text-gray-700"
                }`}
              >
                About
              </Link>
            </li>
          </ul>
        </div>

        <SearchBar />
      </nav>

      {/* Mobile menu */}
      <div className="md:hidden border-t border-gray-200">
        <div className="container-max py-3 flex flex-col gap-3">
          <Link
            href="/collection"
            className={`hover:text-blue-600 transition-colors ${
              pathname === "/collection"
                ? "text-blue-600 font-semibold"
                : "text-gray-700"
            }`}
          >
            Collection
          </Link>
          <Link
            href="/artists"
            className={`hover:text-blue-600 transition-colors ${
              pathname === "/artists"
                ? "text-blue-600 font-semibold"
                : "text-gray-700"
            }`}
          >
            Artists
          </Link>
          <Link
            href="/about"
            className={`hover:text-blue-600 transition-colors ${
              pathname === "/about"
                ? "text-blue-600 font-semibold"
                : "text-gray-700"
            }`}
          >
            About
          </Link>
        </div>
      </div>
    </header>
  );
}
