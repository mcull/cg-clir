# Tech Debt

## TD-001: Programmatic DDL Migrations

**Priority:** Medium
**Added:** 2026-04-02

Currently, database schema migrations (`supabase/migrations/*.sql`) must be run manually via the Supabase SQL Editor in the browser. The sandbox environment blocks direct Postgres connections (port 5432/6543), and the Supabase connection pooler returns "Tenant or user not found" despite valid credentials — likely a Supavisor configuration or IPv4/IPv6 issue.

**What we need:** A way to run DDL migrations programmatically from scripts or CI/CD.

**Options to investigate:**
1. **Supabase CLI (`supabase db push`)** — the official way. Requires `supabase` CLI installed locally and linked to the project. Best for local dev and CI/CD.
2. **Supabase Management API** — the `/v1/projects/{ref}/database/query` endpoint accepts raw SQL but requires a Supabase access token (personal or org-level), not the project service role key.
3. **Fix direct Postgres connection** — check the project's IPv4 add-on setting in Supabase Dashboard → Project Settings → Add-ons. If IPv4 is disabled, either enable it or use the correct IPv6 pooler endpoint.
4. **Supabase Edge Function** — deploy a one-off Edge Function that accepts SQL and executes it via `postgres` module. Not ideal for production but works as a stopgap.

**Workaround for now:** Run migrations manually in the Supabase SQL Editor.
