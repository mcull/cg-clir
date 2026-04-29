"use client";

import { usePathname } from "next/navigation";

// Raw CG footer HTML extracted from creativegrowth.org. Injected as
// static markup to match their site exactly. Mirrors the pattern in
// Header.tsx + cg-header.html.
import cgFooterHtml from "./cg-footer.html";

export default function Footer() {
  const pathname = usePathname();

  // Don't show the footer on admin pages.
  if (pathname?.startsWith("/admin")) return null;

  return (
    <footer className="bg-white border-t border-gray-200 mt-16">
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <link rel="stylesheet" href="/cg-footer.css" />

      <div
        className="cg-footer-wrapper"
        dangerouslySetInnerHTML={{ __html: cgFooterHtml }}
      />

      {/* CLIR archive credit — local addition below the CG footer. */}
      <div className="border-t border-gray-200 py-6 text-center text-xs text-gray-600">
        <p>
          This digital archive is supported by a grant from the Council on
          Library and Information Resources (CLIR).
        </p>
      </div>
    </footer>
  );
}
