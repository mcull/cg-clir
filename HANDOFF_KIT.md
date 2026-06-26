# Handoff Kit — Creative Growth Public Archive

**Purpose:** the running checklist of everything required to fully hand the live
product over to Creative Growth — account ownership, billing, secrets, auth, and
operational know-how. This is the *actionable* companion to:

- [`PROJECT_HANDOFF.md`](./PROJECT_HANDOFF.md) — project state / context narrative
- [`DESIGN.md`](./DESIGN.md) — architecture, data model, project plan

> Living document. Check items off as they're completed; add tasks as they surface.
> Legend: `[ ]` todo · `[~]` in progress · `[x]` done.

---

## 1. Accounts & ownership transfer
Move every service the product depends on into Creative Growth–owned accounts (not personal ones).

- [ ] **Vercel** — transfer the project to a CG-owned Vercel team / account
- [ ] **Supabase** — move project `qvovplzzvfqkzbmvplbu` into a CG-owned org; add CG owner, remove personal access when done
- [ ] **Cloudflare R2** — transfer the `cg-clir` bucket / account that hosts the images
- [ ] **GitHub** — transfer the repo to a CG-owned org (or add CG as admin)
- [ ] **Domain / DNS** — confirm `archive.creativegrowth.org` is managed under CG's DNS and points at Vercel

## 2. Secrets, API keys & billing
Anything created under a personal account should be re-issued under CG and rotated.

- [ ] **Rotate & re-own API keys** to CG accounts: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, PostHog, Givebutter, Resend
- [ ] **Billing** — put Vercel, Supabase, Cloudflare R2, OpenAI, Anthropic, ElevenLabs on CG payment methods
- [ ] **Confirm prod env vars** in Vercel match the current code (`ADMIN_EMAIL_DOMAIN`, `ADMIN_EMAIL_ALLOWLIST`, Supabase keys, R2, etc.)
- [x] **Remove `NEXT_PUBLIC_AUTH_BYPASS`** from Vercel production *(confirmed by Marc)*

## 3. Auth & admin access
- [x] **Custom SMTP configured (INTERIM)** — Supabase custom SMTP via Resend. Magic-link sends verified working in prod (2026-06-25). ⚠️ **Interim arrangement:** emails send from `no-reply@nexthorizoncollective.org` using **Marc's personal Resend account**. This is a personal dependency — if that account/domain goes away, staff get locked out.
- [ ] **Move email sending off Marc's personal accounts** — replace the interim SMTP with a CG-owned setup: a `creativegrowth.org` (or `archive.creativegrowth.org`) sender domain verified under a CG-owned Resend (or other provider) account. **Requires CG DNS access** (add SPF/DKIM records) — the blocker that's currently weeks out. Until then, login email is riding on Marc's domain.
- [x] **Supabase redirect URLs** — Site URL + `/auth/callback` for localhost and `https://archive.creativegrowth.org` *(confirmed by Marc)*
- [x] **Verify the live magic-link round-trip** — OTP send confirmed against prod; magic-link → `/auth/callback` → `/admin` working (2026-06-25). First emails from the new domain may land in spam until reputation builds — tell staff to check spam / mark "not spam."
- [ ] **Onboard CG admin(s)** — confirm the people who need access have `@creativegrowth.org` accounts and can sign in via magic link
- [ ] **Tighten the allowlist** — once CG admins are confirmed working, remove the personal fallback `marc.cull@gmail.com` from `ADMIN_EMAIL_ALLOWLIST` (or keep intentionally for break-glass — decide with CG)
- [ ] **Raise Supabase Auth email rate limit** if multiple admins sign in around the same time (Auth → Rate Limits)

## 4. Operational runbooks (write these for CG)
- [ ] **Import new inventory** — how to run `npm run import:csv -- <file>` against a fresh Art Cloud export (note the `on_website` / cohort / ephemera-tag behavior)
- [ ] **Generate / review descriptions** — the AI description + human-review workflow
- [ ] **Common admin tasks** — editing artworks/artists, exporting subscribers
- [ ] **Where things live** — diagram of Vercel ↔ Supabase ↔ R2 and which dashboard does what

## 5. Pre-launch verification
- [ ] **Accessibility audit** (WCAG / axe) across public pages — the whole reason for the project
- [ ] **Confirm catalog counts** are correct on the live site (artwork + ephemera cohorts)
- [ ] **Smoke-test** download, search, filters, audio descriptions, and the artwork lightbox in production

---

## Open questions for Creative Growth
1. Who are the CG admin users (emails) for the console?
2. Which SMTP provider does CG want to use for transactional email?
3. Image licensing / public-domain notice wording — final sign-off
4. Who owns ongoing billing for each service?
