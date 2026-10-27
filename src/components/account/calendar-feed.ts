// My settings > Connections, "Your calendar feed": what the card holds after
// a read of GET /api/calendar/ics/token (settings-cleanup Phase 5 review, the
// H1 sweep).
//
// A failed read used to become `{ token: null }`, so the card said "No feed
// link yet" over a feed that was live, and its "Create a feed link" POSTed a
// new token: the route replaces the one row's token, so the link the person
// had subscribed to in Apple Calendar, Outlook or Google stopped working, and
// the page reloads on every window focus, so one blip was enough. Now a
// failed read keeps what the card last really read (nothing, on the first
// read, which draws ErrorState), and never stands in "no feed".

export type FeedStatus = { token: string | null; url?: string; webcalUrl?: string; createdAt?: string };

/** The feed after one read (pure; tested): the answer, or the last real one and the error. */
export function feedAfterRead(
  prev: FeedStatus | null,
  r: { ok: true; data: FeedStatus } | { ok: false; error: string },
): { feed: FeedStatus | null; feedError: string | null } {
  if (r.ok) return { feed: r.data, feedError: null };
  return { feed: prev, feedError: r.error || "Couldn't load" };
}
