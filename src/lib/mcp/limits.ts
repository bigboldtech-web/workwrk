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
// The daily caps live in the database (usage.ts); the write bursts are
// step 3's.

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
