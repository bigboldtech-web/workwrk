// rate-limit-memory — a tiny in-memory sliding-window limiter for PUBLIC,
// unauthenticated endpoints (password-reset requests, signups) that would
// otherwise be free to abuse: bombing a victim's inbox with reset emails, or
// scripting mass org creation.
//
// Per-process + single pm2 instance, same trade-off as login-throttle: enough
// to stop scripted abuse on one node; swap the store for Redis when scaling
// horizontally. Never used for anything a legitimate burst would trip.
//
// PRUNED AT MOST ONCE A SWEEP_EVERY_MS, ONLY OF BUCKETS PAST THEIR OWN WINDOW
// (review round 1 of AI teammates Phase 3). Once more than MAX_ENTRIES keys
// were live (a per-person limit on every Google call, across a large
// deployment), every call by every feature walked the whole map and deleted
// nothing. Now a store over the cap is walked at most once per interval, and
// a bucket goes only once its own window (and an hour, the floor it always
// had) is past, when the next hit on it would start a new bucket anyway. So
// no limit ever reads differently for being pruned: a day-long window is
// never cut to an hour by a sweep, as it could be before.

import { clientIpFromHeaders } from "./client-ip";

/** One key's count in its window, and the longest window it was counted in (what pruning waits out). */
type Hit = { count: number; windowStart: number; windowMs: number };

const store = new Map<string, Hit>();
const MAX_ENTRIES = 50_000;
/** How often, at most, a store over MAX_ENTRIES is walked. */
const SWEEP_EVERY_MS = 10_000;
/** No bucket is pruned younger than this, whatever its window. */
const KEEP_AT_LEAST_MS = 60 * 60 * 1000;

let lastSweep = 0;

/**
 * Count one hit against `key`. Returns { ok:false, retryAfter } once the count
 * in the rolling window exceeds `max`. Fail-open by construction — if anything
 * about the store is off, a legitimate caller still gets through.
 */
export function rateLimit(
  key: string,
  opts: { max: number; windowMs: number },
): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  // A clock set back starts the interval again rather than stopping sweeps.
  if (store.size > MAX_ENTRIES && (now - lastSweep >= SWEEP_EVERY_MS || now < lastSweep)) sweep(now);
  let h = store.get(key);
  if (!h || now - h.windowStart > opts.windowMs) h = { count: 0, windowStart: now, windowMs: opts.windowMs };
  h.count += 1;
  h.windowMs = Math.max(h.windowMs, opts.windowMs);
  store.set(key, h);
  if (h.count > opts.max) {
    const retryAfter = Math.ceil((h.windowStart + opts.windowMs - now) / 1000);
    return { ok: false, retryAfter: Math.max(1, retryAfter) };
  }
  return { ok: true, retryAfter: 0 };
}

/**
 * The client's address for a per-address limit, read in the order a client
 * cannot forge (src/lib/client-ip.ts). "unknown" when nothing is known, so
 * every unknown caller shares one bucket rather than getting a fresh one.
 */
export function ipFromRequest(req: Request): string {
  return clientIpFromHeaders(req.headers) ?? "unknown";
}

function sweep(now: number): void {
  lastSweep = now;
  for (const [k, h] of store) {
    // Past its own window, and an hour at the least: its next hit would start
    // a new bucket anyway, so dropping it changes no answer.
    if (now - h.windowStart > Math.max(h.windowMs, KEEP_AT_LEAST_MS)) store.delete(k);
  }
}
