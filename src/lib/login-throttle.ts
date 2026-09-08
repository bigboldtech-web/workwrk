// login-throttle — basic brute-force protection for credential sign-in.
//
// Keyed by (source IP + email) so a single source can't hammer one account,
// while a legitimate user signing in from their own IP is never locked out by
// an attacker hammering from a different IP (avoids the account-lockout DoS).
// In-memory + per-process: enough to stop scripted guessing on a single
// instance; swap the store for Redis/Prisma when scaling horizontally.

type Bucket = { fails: number; windowStart: number; lockedUntil: number };

const buckets = new Map<string, Bucket>();

const WINDOW_MS = 15 * 60 * 1000; // failures counted within this rolling window
const MAX_FAILS = 8; // failed attempts before a lockout kicks in
const LOCK_MS = 15 * 60 * 1000; // how long the lockout lasts
const MAX_ENTRIES = 20_000; // hard cap so the map can't grow unbounded

export function throttleKey(ip: string | null | undefined, email: string): string {
  return `${(ip || "?").trim()}|${email.trim().toLowerCase()}`;
}

/** Seconds remaining on a lockout for this key, or 0 if not locked. */
export function loginLockRemaining(key: string): number {
  const b = buckets.get(key);
  if (!b) return 0;
  const left = b.lockedUntil - Date.now();
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

/** Record a failed attempt; returns true if this failure triggered a lockout. */
export function recordLoginFailure(key: string): boolean {
  const now = Date.now();
  if (buckets.size > MAX_ENTRIES) sweep(now);
  let b = buckets.get(key);
  if (!b || now - b.windowStart > WINDOW_MS) b = { fails: 0, windowStart: now, lockedUntil: 0 };
  b.fails += 1;
  let lockedNow = false;
  if (b.fails >= MAX_FAILS) {
    b.lockedUntil = now + LOCK_MS;
    b.fails = 0;
    b.windowStart = now;
    lockedNow = true;
  }
  buckets.set(key, b);
  return lockedNow;
}

/** A successful sign-in clears the counter for that key. */
export function clearLoginFailures(key: string): void {
  buckets.delete(key);
}

function sweep(now: number): void {
  for (const [k, b] of buckets) {
    if (b.lockedUntil < now && now - b.windowStart > WINDOW_MS) buckets.delete(k);
  }
}
