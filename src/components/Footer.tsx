"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Raw CG footer HTML extracted from creativegrowth.org. Injected as
// static markup to match their site exactly. Mirrors the pattern in
// Header.tsx + cg-header.html.
import cgFooterHtml from "./cg-footer.html";

export default function Footer() {
  const pathname = usePathname();

  // Wire each footer subscribe form (desktop + mobile variants both
  // exist in the injected markup) to POST to our /api/subscribe route.
  // Listen on the form's submit event so Enter-in-input works for
  // keyboard-only users (the CG button is now type="submit").
  useEffect(() => {
    const forms = document.querySelectorAll<HTMLFormElement>(
      ".cg-footer-wrapper form.form--whitelabel",
    );

    const cleanups: Array<() => void> = [];
    forms.forEach((form) => {
      const button = form.querySelector<HTMLButtonElement>(
        "button.btn--whitelabel.btn--form",
      );
      const status = form.querySelector<HTMLElement>(".submission-status");

      // Drop a honeypot field humans never see — bots fill every input.
      if (!form.querySelector<HTMLInputElement>('input[name="hp"]')) {
        const hp = document.createElement("input");
        hp.type = "text";
        hp.name = "hp";
        hp.tabIndex = -1;
        hp.autocomplete = "off";
        hp.style.cssText =
          "position:absolute;left:-10000px;width:1px;height:1px;opacity:0";
        hp.setAttribute("aria-hidden", "true");
        form.appendChild(hp);
      }

      const onSubmit = async (e: SubmitEvent) => {
        e.preventDefault();
        const nameInput = form.querySelector<HTMLInputElement>(
          'input[name="Name"]',
        );
        const emailInput = form.querySelector<HTMLInputElement>(
          'input[name="Email"]',
        );
        const hpInput = form.querySelector<HTMLInputElement>('input[name="hp"]');

        const name = nameInput?.value.trim() || "";
        const email = emailInput?.value.trim() || "";
        if (!name || !email) {
          if (status) status.textContent = "Please enter your name and email. ";
          return;
        }
        if (button?.disabled) return;
        if (button) button.disabled = true;
        if (status) status.textContent = "Subscribing… ";

        try {
          const res = await fetch("/api/subscribe", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name, email, honeypot: hpInput?.value || "" }),
          });
          if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as {
              error?: string;
            };
            if (status) status.textContent = `${data.error || "Failed"}. `;
            if (button) button.disabled = false;
            return;
          }
          if (status) status.textContent = "Thanks — you're subscribed. ";
          if (nameInput) nameInput.value = "";
          if (emailInput) emailInput.value = "";
        } catch {
          if (status) status.textContent = "Network error, please retry. ";
          if (button) button.disabled = false;
        }
      };

      form.addEventListener("submit", onSubmit);
      cleanups.push(() => form.removeEventListener("submit", onSubmit));
    });

    return () => cleanups.forEach((fn) => fn());
  }, []);

  // Don't show the footer on admin pages.
  if (pathname?.startsWith("/admin")) return null;

  return (
    <footer className="cg-footer-bg border-t border-gray-200 mt-16">
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <link rel="stylesheet" href="/cg-footer.css" />

      <div
        className="cg-footer-wrapper"
        dangerouslySetInnerHTML={{ __html: cgFooterHtml }}
      />

      {/* CLIR archive credit — local addition below the CG footer. */}
      <div className="border-t border-gray-300 py-6 text-center text-xs text-gray-600">
        <p>
          This digital archive is supported by a grant from the Council on
          Library and Information Resources (CLIR).
        </p>
      </div>
    </footer>
  );
}
