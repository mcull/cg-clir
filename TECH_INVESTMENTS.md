# Future Tech Investments

Things worth adding to our tooling and infrastructure that we haven't prioritized yet. Distinct from `TECH_DEBT.md` (which catalogs shortcuts already taken) — this file is for "things we'd benefit from building" that someone has flagged as potentially valuable.

---

## TI-001: Playwright test infrastructure for the public site

**Priority:** Medium
**Added:** 2026-04-23

The project already depends on `playwright` (currently used by `scripts/scrape-bios.ts` for headless scraping), but has no test suite. UI changes are currently verified by ad-hoc curl smoke tests during PR review — useful for one-off checks, but they don't run on every change and don't catch regressions when someone refactors a conditional or restructures a layout.

**What we'd build:**
- Playwright test config + an npm test script
- A small fixture / seed-data strategy. Simplest start: hit real Supabase with read-only assertions against known stable SKUs (e.g., `RB 25` for human-described, `JS 5` for AI-described). If staging diverges from prod we can revisit.
- Initial coverage suggestions:
  - Artwork detail page: `<figure>` + visible `<figcaption>` present, `<img alt>` is the short form
  - Artwork detail page: "Visual description" metadata renders only when `description_origin === 'human'`
  - Artwork detail page: Tags and Inventory Number do not appear in metadata
  - Collection grid: image alts are ≤150 chars (no paragraph dumps)
  - Search page returns results for a known query
- Optionally: wire into CI so PRs surface test runs automatically

**Why it'd pay off:** as the gallery grows more conditional UI (storytelling section, admin workflows, additional metadata fields), the cost of silent regressions rises. The figcaption + conditional metadata pattern landed in PR for `feat/artwork-detail-captions` is exactly the kind of thing that breaks silently if the conditional gets restructured.

**Workaround for now:** ad-hoc smoke tests during PRs (curl + grep, dev-server-in-browser).
