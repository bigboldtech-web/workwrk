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

/**
 * A workspace's lockout rule (Workspace settings > Security > Failed
 * sign-ins). The built-in 8 failures and 15 minutes are the FLOOR: an org may
 * lock sooner and for longer, never later or shorter, so no setting can
 * weaken the brute-force guard. Unknown emails use the built-in rule.
 */
export interface LockoutPolicy {
  lockoutThreshold?: number;
  lockoutMinutes?: number;
}

/** The rule actually applied for a policy (pure; tested). */
export function effectiveLockout(policy?: LockoutPolicy | null): { maxFails: number; lockMs: number } {
  const t = policy?.lockoutThreshold;
  const m = policy?.lockoutMinutes;
  const maxFails = typeof t === "number" && Number.isFinite(t) ? Math.min(MAX_FAILS, Math.max(3, Math.round(t))) : MAX_FAILS;
  const lockMs = typeof m === "number" && Number.isFinite(m) ? Math.max(LOCK_MS, Math.min(24 * 60, Math.round(m)) * 60 * 1000) : LOCK_MS;
  return { maxFails, lockMs };
}
const MAX_ENTRIES = 20_000; // hard cap so the map can't grow unbounded

export function throttleKey(ip: string | null | undefined, email: string): string {
  // The IP comes from a request header, so a caller can put anything in it.
  // A "|" in it is swapped out so the FIRST "|" in a key always ends the IP
  // part, which is what clearLoginFailuresForEmail relies on to find a key's
  // email without being fooled by a forged IP or an email containing "|".
  return `${(ip || "?").trim().replace(/\|/g, "_")}|${email.trim().toLowerCase()}`;
}

/** Seconds remaining on a lockout for this key, or 0 if not locked. */
export function loginLockRemaining(key: string): number {
  const b = buckets.get(key);
  if (!b) return 0;
  const left = b.lockedUntil - Date.now();
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

/** Record a failed attempt; returns true if this failure triggered a lockout. */
export function recordLoginFailure(key: string, policy?: LockoutPolicy | null): boolean {
  const { maxFails, lockMs } = effectiveLockout(policy);
  const now = Date.now();
  if (buckets.size > MAX_ENTRIES) sweep(now);
  let b = buckets.get(key);
  if (!b || now - b.windowStart > WINDOW_MS) b = { fails: 0, windowStart: now, lockedUntil: 0 };
  b.fails += 1;
  let lockedNow = false;
  if (b.fails >= maxFails) {
    b.lockedUntil = now + lockMs;
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

/**
 * A successful password reset clears every counter and lockout for that
 * email, from every IP. The reset proves the person owns the mailbox and
 * replaces the password that was being guessed, so leaving them locked out
 * would only tell them their new password failed. The failed sign-ins were
 * often made from another device than the one the reset link is opened on,
 * so clearing just the reset request's own IP|email key is not enough.
 * An attacker gains nothing: a cleared bucket restarts the normal budget
 * against a password they do not know.
 */
export function clearLoginFailuresForEmail(email: string): void {
  const target = email.trim().toLowerCase();
  if (!target) return;
  for (const k of buckets.keys()) {
    // Exact match on the part after the first "|" (throttleKey keeps "|" out
    // of the IP part), never a suffix match, so resetting b@x.com cannot lift
    // a lockout on a different account such as a|b@x.com.
    const at = k.indexOf("|");
    if (at >= 0 && k.slice(at + 1) === target) buckets.delete(k);
  }
}

function sweep(now: number): void {
  for (const [k, b] of buckets) {
    if (b.lockedUntil < now && now - b.windowStart > WINDOW_MS) buckets.delete(k);
  }
}
