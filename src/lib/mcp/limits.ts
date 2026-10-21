// The MCP endpoint's limits in memory (docs/plans/mcp-server.md Decision 15,
// 2.1, 3.10), as the review of step 2 left them.
//
// LIMITS THAT NEVER BLOCK A VALID CALLER (review H2, M3; step 2 review M3).
// A request with no well-formed credential is never refused: it is how
// every hosted connector discovers the authorization server, often from one
// shared egress address, and its whole answer is the 401 challenge, given
// before the body is read, so counting it protected nothing. What is
// counted per address is a FAILED LOOKUP of a well-formed token that names
// no token at all (a guessed or long-deleted one): past 120 in a minute,
// each such failure from that address answers 429 instead of 401, before
// its body is read. The token is looked up first, so a valid token is never
// counted and never refused for what strangers on its address do; nor is a
// token that exists but was revoked or has expired counted (that is a real
// app that must connect again). Every such failure also counts toward a
// surge line, above 10,000 an hour.
//
// A request with a good token is counted by its connection (120 messages a
// minute) and its person (240), per message, a batch's included (step 2
// review M1).
//
// THE WRITE BURSTS (3.10, step 3): a connection makes at most 10 changes in
// any 10 seconds and 30 in any minute, counted per change, a subtask
// included. A write call is let in while the connection has room for one
// more change, and charged one at once (so two calls at the same moment
// cannot both take the last place); a create that also made subtasks is
// charged the rest after it ran. So a task with its 25 subtasks always goes
// through as one call, and the calls after it wait. Refused calls count too:
// an app that keeps sending writes it cannot make is slowed like any other.
//
// The daily caps live in the database (usage.ts).

import { surge } from "@/lib/oauth/limits";
import { rateLimit } from "@/lib/rate-limit-memory";

export type LimitVerdict = { ok: boolean; retryAfter: number };

const MINUTE = 60_000;

/** Failed lookups of well-formed unknown tokens one address may make in a minute. */
export const UNKNOWN_TOKENS_PER_MINUTE = 120;

const failures = new Map<string, { start: number; count: number }>();
const FAILURES_MAX = 50_000;

/** Is this address refused for now? Peeks, never counts. */
export function unknownTokenBlocked(ip: string, now: number = Date.now()): LimitVerdict {
  const f = failures.get(ip);
  if (!f || now - f.start >= MINUTE || f.count < UNKNOWN_TOKENS_PER_MINUTE) return { ok: true, retryAfter: 0 };
  return { ok: false, retryAfter: Math.max(1, Math.ceil((f.start + MINUTE - now) / 1000)) };
}

/** One failed lookup of a well-formed token that names no token, from this address. */
export function unknownTokenFailed(ip: string, now: number = Date.now()): void {
  surge("mcp_unknown_token", 10_000, now);
  // Bounded: past the cap, every window already over goes.
  if (failures.size > FAILURES_MAX) for (const [k, v] of failures) if (now - v.start >= MINUTE) failures.delete(k);
  const f = failures.get(ip);
  if (!f || now - f.start >= MINUTE) failures.set(ip, { start: now, count: 1 });
  else f.count += 1;
}

/** Test seam: forget the failures. */
export function resetUnknownTokenFailures(): void {
  failures.clear();
}

/** One message with a good token: 120 a minute per connection and 240 a minute per person, both counted. */
export function mcpConnectionLimit(grantId: string, userId: string): LimitVerdict {
  const g = rateLimit(`mcp:grant:${grantId}`, { max: 120, windowMs: MINUTE });
  const p = rateLimit(`mcp:person:${userId}`, { max: 240, windowMs: MINUTE });
  const refused = [g, p].filter((v) => !v.ok);
  return refused.length ? { ok: false, retryAfter: Math.max(...refused.map((v) => v.retryAfter)) } : { ok: true, retryAfter: 0 };
}

// ── The write bursts ──

/** Changes a connection may make in any 10 seconds, and in any minute. */
export const WRITES_PER_10_SECONDS = 10;
export const WRITES_PER_MINUTE = 30;
const TEN_SECONDS = 10_000;
const WRITES_MAX_KEYS = 50_000;

/** Each connection's change times in the last minute, oldest first. */
const writes = new Map<string, number[]>();

function recent(grantId: string, now: number): number[] {
  const list = (writes.get(grantId) ?? []).filter((t) => now - t < MINUTE && t <= now + MINUTE);
  if (list.length) writes.set(grantId, list);
  else writes.delete(grantId);
  return list;
}

/**
 * Let one write call in, or not: room for one more change in both windows.
 * When it is let in, one change is charged at once.
 */
export function admitWrite(grantId: string, now: number = Date.now()): LimitVerdict {
  if (writes.size > WRITES_MAX_KEYS) for (const k of [...writes.keys()]) recent(k, now);
  const list = recent(grantId, now);
  const inTen = list.filter((t) => now - t < TEN_SECONDS);
  if (inTen.length >= WRITES_PER_10_SECONDS) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((inTen[inTen.length - WRITES_PER_10_SECONDS] + TEN_SECONDS - now) / 1000)) };
  }
  if (list.length >= WRITES_PER_MINUTE) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((list[list.length - WRITES_PER_MINUTE] + MINUTE - now) / 1000)) };
  }
  list.push(now);
  writes.set(grantId, list);
  return { ok: true, retryAfter: 0 };
}

/** The changes a call made beyond the one admitWrite charged (a create's subtasks). */
export function chargeWrites(grantId: string, extra: number, now: number = Date.now()): void {
  if (extra <= 0) return;
  const list = recent(grantId, now);
  for (let i = 0; i < extra; i += 1) list.push(now);
  writes.set(grantId, list);
}

/** Test seam: forget every connection's bursts. */
export function resetWriteBursts(): void {
  writes.clear();
}
