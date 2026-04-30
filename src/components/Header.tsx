"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// Raw CG header HTML extracted from creativegrowth.org via Playwright
// This is injected as static HTML to match their site exactly
import cgHeaderHtml from "./cg-header.html";

export default function Header() {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith("/admin");
  const [mobileOpen, setMobileOpen] = useState(false);

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

  // Close mobile menu when navigating
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  if (isAdmin) return null;

  return (
    <header className="bg-white sticky top-0 z-40">
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <link rel="stylesheet" href="/cg-header.css" />

      {/* Injected CG header. We toggle the `cg-header-wrapper--mobile-open`
       * class via the hamburger to reveal the nav menu on small screens;
       * desktop behavior is unchanged because the mobile-collapse rules
       * only kick in below the breakpoint. */}
      <div
        className={`cg-header-wrapper${mobileOpen ? " cg-header-wrapper--mobile-open" : ""}`}
        dangerouslySetInnerHTML={{ __html: cgHeaderHtml }}
      />

      {/* Mobile hamburger — only visible below the breakpoint via CSS */}
      <button
        type="button"
        aria-label={mobileOpen ? "Close menu" : "Open menu"}
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen((o) => !o)}
        className="cg-header-hamburger"
      >
        <span className="cg-header-hamburger__bar" />
        <span className="cg-header-hamburger__bar" />
        <span className="cg-header-hamburger__bar" />
      </button>
    </header>
  );
}
