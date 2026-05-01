import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

// The CG footer is injected into every page (including /artwork/[id]) via
// dangerouslySetInnerHTML. WCAG 2.1 / Section 508 require every <form> to
// expose a submit-capable control so keyboard-only users can submit it
// (e.g. by pressing Enter inside an input). A submit control is one of:
//   - <button type="submit"> (or <button> with no/invalid type — defaults to submit)
//   - <input type="submit">
//   - <input type="image">
const FOOTER_HTML = readFileSync(
  join(__dirname, "../../src/components/cg-footer.html"),
  "utf-8",
);

function hasSubmitControl(form: Element): boolean {
  const buttons = Array.from(form.querySelectorAll("button"));
  const buttonSubmits = buttons.some((b) => {
    const type = b.getAttribute("type");
    return type === null || type === "" || type.toLowerCase() === "submit";
  });
  const inputSubmits = form.querySelector(
    'input[type="submit" i], input[type="image" i]',
  );
  return buttonSubmits || Boolean(inputSubmits);
}

describe("CG footer subscribe forms", () => {
  const dom = new JSDOM(`<!doctype html><html><body>${FOOTER_HTML}</body></html>`);
  const forms = Array.from(dom.window.document.querySelectorAll("form"));

  it("renders at least one subscribe form (desktop + mobile)", () => {
    expect(forms.length).toBeGreaterThanOrEqual(1);
  });

  it.each(forms.map((f, i) => [i, f] as const))(
    "form #%i exposes a keyboard-accessible submit control",
    (_i, form) => {
      expect(hasSubmitControl(form)).toBe(true);
    },
  );
});
