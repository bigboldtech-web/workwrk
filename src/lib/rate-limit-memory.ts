// rate-limit-memory — a tiny in-memory sliding-window limiter for PUBLIC,
// unauthenticated endpoints (password-reset requests, signups) that would
// otherwise be free to abuse: bombing a victim's inbox with reset emails, or
// scripting mass org creation.
//
// Per-process + single pm2 instance, same trade-off as login-throttle: enough
// to stop scripted abuse on one node; swap the store for Redis when scaling
// horizontally. Never used for anything a legitimate burst would trip.

import { clientIpFromHeaders } from "./client-ip";

type Hit = { count: number; windowStart: number };

const store = new Map<string, Hit>();
const MAX_ENTRIES = 50_000;

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
  if (store.size > MAX_ENTRIES) sweep(now);
  let h = store.get(key);
  if (!h || now - h.windowStart > opts.windowMs) h = { count: 0, windowStart: now };
  h.count += 1;
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
  for (const [k, h] of store) {
    // Drop buckets older than an hour — long enough for any window we use.
    if (now - h.windowStart > 60 * 60 * 1000) store.delete(k);
  }
}
