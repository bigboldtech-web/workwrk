// The workspace's session rules (Workspace settings > Security > Sessions),
// applied in the jwt callback of src/lib/auth.ts. Pure; tested.
//
//   idle      signed out once nothing renewed the session for
//             `sessionIdleMinutes`. NextAuth's session.maxAge (12h) stays the
//             ceiling: the org value can only narrow it.
//   absolute  signed out `sessionMaxDays` after the sign-in, however active.
//             A token issued before this rule existed carries no sign-in time
//             and starts its clock at its first check, so nobody is signed
//             out by the rollout itself.
//
// A token with no seenAt (minted before this rule) is idle-timed from its own
// issue time (jwt iat, rewritten whenever the cookie is), never from "now":
// otherwise a replayed pre-rule cookie, whose refreshed copy nobody saves,
// would be treated as seen on every read and never idle-end.
//
// An ended session stays ended: `policyEnded` is never cleared by the
// five-minute revalidation (which only recomputes `revoked`).

export const NEXTAUTH_MAX_AGE_MIN = 12 * 60;
const DAY_MS = 86_400_000;

export interface SessionClock {
  authAt?: unknown;
  seenAt?: unknown;
  /** The token's own issue time (jwt iat, in ms): the last-seen time of a token minted before seenAt existed. */
  issuedAt?: unknown;
  idleMin?: unknown;
  maxDays?: unknown;
}

export type SessionVerdict =
  | { ended: false; authAt: number; seenAt: number }
  | { ended: true; reason: "idle" | "lifetime" };

export function sessionVerdict(clock: SessionClock, now: number = Date.now()): SessionVerdict {
  const authAt = typeof clock.authAt === "number" && clock.authAt > 0 ? clock.authAt : now;
  const lastSeen = lastSeenOf(clock, now);
  const idleMin = typeof clock.idleMin === "number" && clock.idleMin > 0 ? Math.min(clock.idleMin, NEXTAUTH_MAX_AGE_MIN) : NEXTAUTH_MAX_AGE_MIN;
  if (now - lastSeen > idleMin * 60_000) return { ended: true, reason: "idle" };
  if (typeof clock.maxDays === "number" && clock.maxDays > 0 && now - authAt > clock.maxDays * DAY_MS) return { ended: true, reason: "lifetime" };
  return { ended: false, authAt, seenAt: now };
}

/** When this session lapses if nothing renews it (the idle warning's boundary). */
export function sessionIdleUntil(clock: SessionClock, now: number = Date.now()): number {
  const lastSeen = lastSeenOf(clock, now);
  const idleMin = typeof clock.idleMin === "number" && clock.idleMin > 0 ? Math.min(clock.idleMin, NEXTAUTH_MAX_AGE_MIN) : NEXTAUTH_MAX_AGE_MIN;
  let until = lastSeen + idleMin * 60_000;
  const authAt = typeof clock.authAt === "number" && clock.authAt > 0 ? clock.authAt : null;
  if (authAt && typeof clock.maxDays === "number" && clock.maxDays > 0) until = Math.min(until, authAt + clock.maxDays * DAY_MS);
  return until;
}

function lastSeenOf(clock: SessionClock, now: number): number {
  if (typeof clock.seenAt === "number" && clock.seenAt > 0) return clock.seenAt;
  if (typeof clock.issuedAt === "number" && clock.issuedAt > 0 && clock.issuedAt <= now) return clock.issuedAt;
  return now;
}
