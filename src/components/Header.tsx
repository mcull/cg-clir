"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Raw CG header HTML extracted from creativegrowth.org via Playwright
// This is injected as static HTML to match their site exactly
import cgHeaderHtml from "./cg-header.html";

export default function Header() {
  const pathname = usePathname();

  const isAdmin = pathname?.startsWith("/admin");
  if (isAdmin) return null;

  // Wire up dropdown toggle behavior for the injected CG nav
  useEffect(() => {
    const wrapper = document.querySelector(".cg-header-wrapper");
    if (!wrapper) return;

    const drops = wrapper.querySelectorAll<HTMLElement>(".drop");
    drops.forEach((drop) => {
      const anchor = drop.querySelector<HTMLAnchorElement>(".drop__anch");
      const inn = drop.querySelector<HTMLElement>(".drop__inn");
      if (!anchor || !inn) return;

      anchor.addEventListener("click", (e) => {
        e.preventDefault();
        // Close other dropdowns
        drops.forEach((d) => {
          if (d !== drop) {
            const otherInn = d.querySelector<HTMLElement>(".drop__inn");
            if (otherInn) otherInn.style.display = "none";
          }
        });
        inn.style.display = inn.style.display === "block" ? "none" : "block";
      });
    });

    // Close dropdowns on outside click
    const handleClick = (e: MouseEvent) => {
      if (!wrapper.contains(e.target as Node)) {
        drops.forEach((drop) => {
          const inn = drop.querySelector<HTMLElement>(".drop__inn");
          if (inn) inn.style.display = "none";
        });
      }
    };
    document.addEventListener("click", handleClick);

    // Wire up search button to navigate to /search
    const searchBtn = wrapper.querySelector<HTMLAnchorElement>(".search__btn");
    if (searchBtn) {
      searchBtn.addEventListener("click", (e) => {
        e.preventDefault();
        window.location.href = "/search";
      });
    }

    return () => document.removeEventListener("click", handleClick);
  }, []);

  return (
    <header className="bg-white sticky top-0 z-40">
      {/* Load CG header CSS */}
      <link rel="stylesheet" href="/cg-header.css" />

      {/* Injected CG header */}
      <div
        className="cg-header-wrapper"
        dangerouslySetInnerHTML={{ __html: cgHeaderHtml }}
      />

      {/* CLIR gallery sub-nav */}
      <div className="border-t border-b border-gray-200 bg-gray-50">
        <div className="px-[50px] py-3 flex items-center gap-6">
          <Link
            href="/"
            className={`text-sm font-semibold transition-colors ${
              pathname === "/"
                ? "text-[#198639]"
                : "text-gray-700 hover:text-[#198639]"
            }`}
          >
            CLIR Collection
          </Link>
          <Link
            href="/collection"
            className={`text-sm font-semibold transition-colors ${
              pathname === "/collection"
                ? "text-[#198639]"
                : "text-gray-700 hover:text-[#198639]"
            }`}
          >
            Browse
          </Link>
          <Link
            href="/artists"
            className={`text-sm font-semibold transition-colors ${
              pathname?.startsWith("/artists")
                ? "text-[#198639]"
                : "text-gray-700 hover:text-[#198639]"
            }`}
          >
            Artists
          </Link>
          <Link
            href="/search"
            className={`text-sm font-semibold transition-colors ${
              pathname === "/search"
                ? "text-[#198639]"
                : "text-gray-700 hover:text-[#198639]"
            }`}
          >
            Search
          </Link>
          <Link
            href="/about"
            className={`text-sm font-semibold transition-colors ${
              pathname === "/about"
                ? "text-[#198639]"
                : "text-gray-700 hover:text-[#198639]"
            }`}
          >
            About This Project
          </Link>
        </div>
      </div>
    </header>
  );
}
