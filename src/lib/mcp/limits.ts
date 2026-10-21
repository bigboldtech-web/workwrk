// The MCP endpoint's limits in memory (docs/plans/mcp-server.md Decision 15,
// 2.1 steps 6 and 10, 3.10).
//
// LIMITS THAT NEVER BLOCK A VALID CALLER (review H2, M3). An address is
// counted only for a request that carries no well-formed credential
// ("Bearer wkmcp_at_" and 43 base64url characters): 120 a minute. A request
// with one is counted by its connection (120 a minute) and its person (240 a
// minute) once the token is known good, so a stranger behind the same office
// address can never spend a valid caller's bucket. A well-formed token that
// is not found refuses nothing and logs one surge line an hour above 10,000.
//
// The live proof (MCP_PROOF_LIMITS=1, never in production) counts the
// address at 60 a minute, so 61 requests show the refusal (9.1 M19).
//
// The daily caps live in the database (usage.ts); the write bursts are
// step 3's.

import { surge } from "@/lib/oauth/limits";
import { rateLimit } from "@/lib/rate-limit-memory";
import { proofLimits } from "./config";

export type LimitVerdict = { ok: boolean; retryAfter: number };

const MINUTE = 60_000;

/** No well-formed credential: 120 a minute per address (the proof: 60). */
export function mcpAnonLimit(ip: string): LimitVerdict {
  return rateLimit(`mcp:anon:${ip}`, { max: proofLimits() ? 60 : 120, windowMs: MINUTE });
}

/** A well-formed token that names no token: counted toward a surge line, never refused. */
export function unknownTokenSurge(): void {
  surge("mcp_unknown_token", 10_000);
}

/** A good token's request: 120 a minute per connection and 240 a minute per person, both counted. */
export function mcpConnectionLimit(grantId: string, userId: string): LimitVerdict {
  const g = rateLimit(`mcp:grant:${grantId}`, { max: 120, windowMs: MINUTE });
  const p = rateLimit(`mcp:person:${userId}`, { max: 240, windowMs: MINUTE });
  const refused = [g, p].filter((v) => !v.ok);
  return refused.length ? { ok: false, retryAfter: Math.max(...refused.map((v) => v.retryAfter)) } : { ok: true, retryAfter: 0 };
}
