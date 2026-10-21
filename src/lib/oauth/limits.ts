// The OAuth server's rate limits (docs/plans/mcp-server.md Decision 15, 3.10).
//
// LIMITS THAT NEVER BLOCK A VALID CALLER (review H2, M3). An address is
// counted only for traffic that carries no well-formed credential, so an
// office or a cloud egress shared by hundreds of people never shares one
// bucket with a stranger hammering us: a request with a well-formed client
// and code or refresh token is counted by that client or token family
// instead. A client id that does not exist is not a valid caller, so the
// token endpoint counts it by address too. There is NO global hard cap
// (a stranger could fill it for everyone); a surge logs one line an hour.
//
// In memory, one pm2 instance (src/lib/rate-limit-memory.ts). The daily
// tool-call caps live in the database (step 2).

import { proofLimits } from "@/lib/mcp/config";
import { rateLimit } from "@/lib/rate-limit-memory";

export type LimitVerdict = { ok: boolean; retryAfter: number };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function worst(...v: LimitVerdict[]): LimitVerdict {
  const refused = v.filter((x) => !x.ok);
  if (refused.length === 0) return { ok: true, retryAfter: 0 };
  return { ok: false, retryAfter: Math.max(...refused.map((x) => x.retryAfter)) };
}

// ── Surge lines: counted, never a refusal ──

const surges = new Map<string, { hour: number; count: number; logged: boolean }>();

/**
 * Count one event toward a surge line: past `over` in a clock hour it logs
 * `[oauth] surge <kind>` once that hour (the line names the kind only, never
 * the key it was counted under). Never refuses anything.
 */
export function surge(kind: string, over: number, now = Date.now(), key: string = kind): void {
  const hour = Math.floor(now / HOUR);
  // Bounded: past the cap, every counter from an earlier hour goes.
  if (surges.size > 10_000) for (const [k, v] of surges) if (v.hour !== hour) surges.delete(k);
  let s = surges.get(key);
  if (!s || s.hour !== hour) {
    s = { hour, count: 0, logged: false };
    surges.set(key, s);
  }
  s.count += 1;
  if (s.count > over && !s.logged) {
    s.logged = true;
    console.warn(`[oauth] surge ${kind}`);
  }
}

/** Registration: 60 a minute and 600 an hour per address (the proof: 6 in 60 seconds); a surge line above 2,000 an hour overall. */
export function registerLimit(ip: string): LimitVerdict {
  surge("register", 2000);
  if (proofLimits()) return rateLimit(`oauth:register:proof:${ip}`, { max: 6, windowMs: MINUTE });
  return worst(
    rateLimit(`oauth:register:m:${ip}`, { max: 60, windowMs: MINUTE }),
    rateLimit(`oauth:register:h:${ip}`, { max: 600, windowMs: HOUR }),
  );
}

/** The authorization request: 300 per 10 minutes per address, which also caps its live pending requests. */
export function authorizeLimit(ip: string): LimitVerdict {
  return rateLimit(`oauth:authorize:${ip}`, { max: 300, windowMs: 10 * MINUTE });
}

/** The consent page: 60 views a minute per person. */
export function consentLimit(userId: string): LimitVerdict {
  return rateLimit(`oauth:consent:${userId}`, { max: 60, windowMs: MINUTE });
}

/** The decision: 20 a minute per person. */
export function decisionLimit(userId: string): LimitVerdict {
  return rateLimit(`oauth:decision:${userId}`, { max: 20, windowMs: MINUTE });
}

/** The token endpoint without a well-formed credential (or with a client id that does not exist): 120 a minute per address. */
export function tokenAnonLimit(ip: string): LimitVerdict {
  return rateLimit(`oauth:token:anon:${ip}`, { max: 120, windowMs: MINUTE });
}

/** The code grant: 60 a minute per authenticated client. */
export function tokenClientLimit(clientId: string): LimitVerdict {
  return rateLimit(`oauth:token:client:${clientId}`, { max: 60, windowMs: MINUTE });
}

/** The refresh grant: 30 a minute per refresh family. */
export function tokenFamilyLimit(familyId: string): LimitVerdict {
  return rateLimit(`oauth:token:family:${familyId}`, { max: 30, windowMs: MINUTE });
}

/** A failed client authentication: no lockout (a stranger could lock a real app out); a surge line above 100 an hour for that client. */
export function clientAuthFailed(clientId: string | null): void {
  surge("client_auth", 100, Date.now(), `client_auth:${clientId ?? "unknown"}`);
}

/** Revocation without a well-formed token: 120 a minute per address. */
export function revokeAnonLimit(ip: string): LimitVerdict {
  return rateLimit(`oauth:revoke:anon:${ip}`, { max: 120, windowMs: MINUTE });
}

/** Test seam: forget the surge counters. */
export function resetSurges(): void {
  surges.clear();
}
