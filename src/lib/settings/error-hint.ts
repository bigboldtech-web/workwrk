// What a Settings failure says to the person (final Settings review, L4):
// never a raw "status 500", "HTTP 500" or the browser's "Failed to fetch".
// A message the server wrote for people is kept; anything raw, or nothing,
// becomes the one plain line.

export const CONNECTION_HINT = "Check your connection, then try again.";

// The words a fetch or a status check leaves behind: a status code alone,
// and each browser's own name for a request that never arrived.
const RAW = /^(?:status|http)\s*\d{3}$|failed to fetch|networkerror|network error|load failed/i;

/** The failure's own words when a person can read them, else null (pure; tested). */
export function errorDetail(e: unknown): string | null {
  const m = e instanceof Error ? e.message.trim() : typeof e === "string" ? e.trim() : "";
  return !m || RAW.test(m) ? null : m;
}

/** The hint under a failure: its own words, or CONNECTION_HINT (pure; tested). */
export function errorHint(e: unknown): string {
  return errorDetail(e) ?? CONNECTION_HINT;
}
