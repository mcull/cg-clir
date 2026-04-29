/**
 * Server-side HogQL query helper for the PostHog Query API.
 * Used by the admin dashboard to surface visitor analytics.
 *
 * Reads:
 *   - POSTHOG_PERSONAL_API_KEY  (auth)
 *   - POSTHOG_PROJECT_ID        (numeric project id from PostHog → Settings)
 *   - NEXT_PUBLIC_POSTHOG_HOST  (defaults to https://us.i.posthog.com)
 *
 * Returns null when env vars are missing or the request fails — the
 * caller should treat that as "stats not available right now" and
 * render gracefully.
 */

const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

interface QueryResult<TRow = unknown[]> {
  results: TRow[];
}

export async function hogql<TRow = unknown[]>(
  query: string
): Promise<QueryResult<TRow> | null> {
  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  if (!apiKey || !projectId) return null;

  try {
    const res = await fetch(`${HOST}/api/projects/${projectId}/query/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: { kind: "HogQLQuery", query },
      }),
      // Don't let a slow PostHog block the dashboard for too long.
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.error(`PostHog query failed: ${res.status}`, await res.text().catch(() => ""));
      return null;
    }
    return (await res.json()) as QueryResult<TRow>;
  } catch (err) {
    console.error("PostHog query error:", err);
    return null;
  }
}
