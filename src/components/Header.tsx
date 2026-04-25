"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Raw CG header HTML extracted from creativegrowth.org via Playwright
// This is injected as static HTML to match their site exactly
import cgHeaderHtml from "./cg-header.html";

export default function Header() {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith("/admin");

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

    return () => document.removeEventListener("click", handleClick);
  }, []);

  if (isAdmin) return null;

  return (
    <header className="bg-white sticky top-0 z-40">
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <link rel="stylesheet" href="/cg-header.css" />

      {/* Injected CG header */}
      <div
        className="cg-header-wrapper"
        dangerouslySetInnerHTML={{ __html: cgHeaderHtml }}
      />
    </header>
  );
}
