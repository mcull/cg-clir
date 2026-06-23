/**
 * Pure authorization check for admin access. Framework-free so it can be
 * unit-tested in isolation and reused from the layout, API guard, and
 * middleware alike.
 *
 * An email is allowed if its domain exactly matches ADMIN_EMAIL_DOMAIN,
 * or if the full address appears in the comma-separated ADMIN_EMAIL_ALLOWLIST.
 * Both checks are case-insensitive. Domain matching is exact (no subdomains,
 * no suffix/substring spoofs).
 */
export interface AdminAllowlistConfig {
  domain?: string | null;
  allowlist?: string | null;
}

export function isAllowedAdmin(
  email: string | null | undefined,
  config?: AdminAllowlistConfig
): boolean {
  if (!email) return false;

  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  // Require a non-empty local part and domain part.
  if (at <= 0 || at === normalized.length - 1) return false;
  const emailDomain = normalized.slice(at + 1);

  const domain = (config?.domain ?? process.env.ADMIN_EMAIL_DOMAIN ?? "")
    .trim()
    .toLowerCase();
  if (domain && emailDomain === domain) return true;

  const allowlistRaw = config?.allowlist ?? process.env.ADMIN_EMAIL_ALLOWLIST ?? "";
  const allowlist = allowlistRaw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(normalized);
}
