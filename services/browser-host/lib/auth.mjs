// @ts-check
// The API key and the limits (docs/plans/browser-host.md 3.1, Decision 11).
//
// THE KEY: X-BB-API-Key, the header the app already sends. Its bytes are
// hashed and the hash compared with each stored one by crypto.timingSafeEqual,
// always every one, so the timing never says which one matched, or how long
// the key was. A missing header is hashed as the empty key and compared the
// same way.
//
// THE CLIENT ADDRESS is read from X-Forwarded-For only when the TCP peer is
// 127.0.0.1 (Caddy, which sets it fresh); otherwise it is the peer. It is
// kept in memory for a limit's window only, and never logged.
//
// THE LIMITS are fixed windows in memory, each answering how many whole
// seconds to wait. Pure: the clock is passed in.

import crypto from "node:crypto";

/**
 * The SHA-256 of a header's bytes.
 * @param {string} key
 */
function hashOf(key) {
  return crypto.createHash("sha256").update(Buffer.from(key, "utf8")).digest();
}

/**
 * Whether the header carries a key whose hash is one of `hashes`.
 * @param {string | string[] | undefined} header
 * @param {readonly Buffer[]} hashes
 * @returns {boolean}
 */
export function keyOk(header, hashes) {
  const given = hashOf(typeof header === "string" ? header : "");
  let ok = false;
  for (const h of hashes) {
    // Every stored hash is compared, whatever an earlier one said.
    const same = h.length === given.length && crypto.timingSafeEqual(h, given);
    ok = same || ok;
  }
  return ok && typeof header === "string" && header.length > 0;
}

/**
 * The client's address (see the header).
 * @param {{ socket: { remoteAddress?: string | undefined }, headers: Record<string, string | string[] | undefined> }} req
 * @returns {string}
 */
export function clientAddress(req) {
  const peer = String(req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
  if (peer !== "127.0.0.1") return peer || "unknown";
  const xff = req.headers["x-forwarded-for"];
  const raw = Array.isArray(xff) ? xff.join(",") : typeof xff === "string" ? xff : "";
  // The nearest proxy's entry is the last one.
  const last = raw.split(",").map((s) => s.trim()).filter(Boolean).at(-1);
  return last ? last.replace(/^::ffff:/, "").slice(0, 64) : peer;
}

/**
 * @typedef {{
 *   hit: (key: string) => number,
 *   blocked: (key: string) => number,
 *   size: () => number,
 * }} Limiter
 */

/**
 * A fixed window of `limit` hits each `windowMs` a key. `hit` counts one and
 * answers 0 while within the limit, else the whole seconds to wait. With
 * `blockMs`, the hit past the limit blocks the key for that long, and
 * `blocked` answers the seconds left of it (0 when free).
 * @param {{ limit: number, windowMs: number, blockMs?: number, now: () => number }} o
 * @returns {Limiter}
 */
export function createLimiter(o) {
  /** @type {Map<string, { start: number, count: number, blockedUntil: number }>} */
  const keys = new Map();
  const seconds = (/** @type {number} */ ms) => Math.max(1, Math.ceil(ms / 1000));
  let lastPrune = 0;
  const prune = (/** @type {number} */ now) => {
    if (now - lastPrune < o.windowMs) return;
    lastPrune = now;
    for (const [k, v] of keys) if (now - v.start >= o.windowMs && v.blockedUntil <= now) keys.delete(k);
  };
  return {
    hit(key) {
      const now = o.now();
      prune(now);
      let v = keys.get(key);
      if (!v || now - v.start >= o.windowMs) {
        v = { start: now, count: 0, blockedUntil: v?.blockedUntil ?? 0 };
        keys.set(key, v);
      }
      if (v.blockedUntil > now) return seconds(v.blockedUntil - now);
      v.count += 1;
      if (v.count <= o.limit) return 0;
      if (o.blockMs) {
        v.blockedUntil = now + o.blockMs;
        return seconds(o.blockMs);
      }
      return seconds(v.start + o.windowMs - now);
    },
    blocked(key) {
      const now = o.now();
      const v = keys.get(key);
      return v && v.blockedUntil > now ? seconds(v.blockedUntil - now) : 0;
    },
    size: () => keys.size,
  };
}

/**
 * The API's limits (3.1): ten auth failures in a minute from one address
 * block it on every route for ten minutes; 120 API requests a minute
 * overall, and 30 creates a minute.
 * @param {() => number} now
 */
export function apiLimits(now) {
  return {
    // Nine are counted; the tenth blocks.
    authFailures: createLimiter({ limit: 9, windowMs: 60_000, blockMs: 10 * 60_000, now }),
    requests: createLimiter({ limit: 120, windowMs: 60_000, now }),
    creates: createLimiter({ limit: 30, windowMs: 60_000, now }),
  };
}
