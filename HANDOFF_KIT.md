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
- [ ] **Update the SMTP** — configure custom SMTP in Supabase (Auth → Emails → SMTP Settings) so magic-link emails send reliably. Supabase's built-in email sender is rate-limited (~a few/hour) and not meant for production; magic-link sign-in will be flaky until a real SMTP provider (e.g., Resend/SendGrid/Postmark) is wired up. Also review the magic-link email template/branding.
- [x] **Supabase redirect URLs** — Site URL + `/auth/callback` for localhost and `https://archive.creativegrowth.org` *(confirmed by Marc)*
- [ ] **Onboard CG admin(s)** — confirm the people who need access have `@creativegrowth.org` Google/email accounts and can sign in via magic link
- [ ] **Tighten the allowlist** — once CG admins are confirmed working, remove the personal fallback `marc.cull@gmail.com` from `ADMIN_EMAIL_ALLOWLIST` (or keep intentionally for break-glass — decide with CG)
- [ ] **Verify the live magic-link round-trip** — request link → email arrives → click → lands in `/admin` (not yet tested end-to-end; needs SMTP above)

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
