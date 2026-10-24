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
//
// AN IPv6 ADDRESS IS COUNTED BY ITS /64 (final review of the MCP server,
// security L3). One connection, one home router or one cloud machine is
// handed a whole /64, 2^64 addresses, so a full address per bucket let a
// single caller spend a fresh bucket on every request and walk around the
// registration and authorize limits. addressKey reads an IPv6 address down
// to its first four groups; an IPv4 address, and an IPv4 address written as
// IPv6 (::ffff:198.51.100.7), is counted as it is.

import { proofLimits } from "@/lib/mcp/config";
import { rateLimit } from "@/lib/rate-limit-memory";

export type LimitVerdict = { ok: boolean; retryAfter: number };

const HEXTET = /^[0-9a-f]{1,4}$/;
const IPV4_TAIL = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/;

/** An IPv6 address as its eight groups, an embedded IPv4 tail as the last two; null when it is not one. */
function ipv6Groups(raw: string): string[] | null {
  let text = raw;
  const tail: string[] = [];
  const v4 = IPV4_TAIL.exec(text);
  if (v4) {
    const b = v4[1].split(".").map(Number);
    if (b.some((x) => x > 255)) return null;
    tail.push(((b[0] << 8) | b[1]).toString(16), ((b[2] << 8) | b[3]).toString(16));
    text = text.slice(0, text.length - v4[1].length);
    // "...::" keeps its "::"; "...:" loses the colon before the tail.
    if (!text.endsWith("::")) {
      if (!text.endsWith(":")) return null;
      text = text.slice(0, -1);
    }
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const given = head.length + rest.length + tail.length;
  if (halves.length === 1 ? given !== 8 : given > 7) return null;
  const groups = [...head, ...Array<string>(8 - given).fill("0"), ...rest, ...tail];
  if (!groups.every((g) => HEXTET.test(g))) return null;
  return groups.map((g) => parseInt(g, 16).toString(16));
}

/**
 * The key a per-address limit counts a caller under: an IPv4 address as it
 * is, an IPv6 address by its /64 (see the header). A value that is no
 * address stays as it was, so it is never merged with a real one.
 */
export function addressKey(ip: string): string {
  const raw = ip.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (!raw.includes(":")) return raw;
  const g = ipv6Groups(raw);
  if (!g) return raw;
  // An IPv4 address written as IPv6 (::ffff:a.b.c.d) is that IPv4 address.
  if (g.slice(0, 5).every((x) => x === "0") && g[5] === "ffff") {
    const n = [parseInt(g[6], 16), parseInt(g[7], 16)];
    return `${n[0] >> 8}.${n[0] & 255}.${n[1] >> 8}.${n[1] & 255}`;
  }
  return `${g.slice(0, 4).join(":")}::/64`;
}

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
  const at = addressKey(ip);
  if (proofLimits()) return rateLimit(`oauth:register:proof:${at}`, { max: 6, windowMs: MINUTE });
  return worst(
    rateLimit(`oauth:register:m:${at}`, { max: 60, windowMs: MINUTE }),
    rateLimit(`oauth:register:h:${at}`, { max: 600, windowMs: HOUR }),
  );
}

/** The authorization request: 300 per 10 minutes per address, which also caps its live pending requests. */
export function authorizeLimit(ip: string): LimitVerdict {
  return rateLimit(`oauth:authorize:${addressKey(ip)}`, { max: 300, windowMs: 10 * MINUTE });
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
  return rateLimit(`oauth:token:anon:${addressKey(ip)}`, { max: 120, windowMs: MINUTE });
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
  return rateLimit(`oauth:revoke:anon:${addressKey(ip)}`, { max: 120, windowMs: MINUTE });
}

/** Test seam: forget the surge counters. */
export function resetSurges(): void {
  surges.clear();
}
