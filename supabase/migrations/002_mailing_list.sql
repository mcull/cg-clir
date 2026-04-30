-- Mailing list signups captured by the public footer form.
-- Persisted here so we have a record even if the email notification
-- to gallery staff fails. Quinn pulls this list periodically into
-- CG's primary mailing system.

CREATE TABLE mailing_list_signups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'footer',
  ip_address    TEXT,
  user_agent    TEXT,
  notified_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Case-insensitive uniqueness on email — re-submits update the row's
-- timestamp instead of stacking duplicates.
CREATE UNIQUE INDEX idx_mailing_list_email_lower
  ON mailing_list_signups (LOWER(email));

ALTER TABLE mailing_list_signups ENABLE ROW LEVEL SECURITY;

-- No public read/write — the API route uses the service-role client.
-- (No RLS policies = no anon access by default.)
