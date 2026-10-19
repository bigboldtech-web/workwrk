// @ts-check
// The host's tokens (docs/plans/browser-host.md 3.3).
//
// THE BOOT KEY: 32 random bytes each boot, held in memory only. A restart
// voids every token, and every session goes with it.
//
// THE CONNECT TOKEN: base64url(HMAC-SHA256(bootKey, "connect." + id)),
// checked in constant time and good once: the session's `connected` flag.
// Nothing about the person, the workspace or the teammate is in it.
//
// THE LIVE TOKEN (step 2): payload.mac, where
//   payload = base64url(JSON { s: id, m: "w" | "c", e: exp unix seconds, g: control epoch, n: 16 random bytes })
//   mac     = base64url(HMAC-SHA256(bootKey, "live." + payload))
// valid while e is in the future (the host's own clock, the one that minted
// it), s is the path's id, and, for control, g equals the session's epoch: a
// revoke bumps the epoch, so every control token minted before it is void.
//   - watch: e is the session's own end plus 60 seconds, so a watch view
//     outlives its session's end; at most 2 hours from minting.
//   - control: e is 15 minutes from minting (the take over and recording
//     window is 10), never past that same end.
// While a socket uses a token the host keeps only its SHA-256 (liveTokenHash),
// so the newest socket on a token wins (lib/live.mjs). It carries nothing
// about the person, the workspace or the teammate.
//
// Pure: the key and the clock are passed in.

import crypto from "node:crypto";

/** A boot's key. */
export function newBootKey() {
  return crypto.randomBytes(32);
}

/**
 * The connect token of a session.
 * @param {Buffer} bootKey
 * @param {string} id
 * @returns {string}
 */
export function connectToken(bootKey, id) {
  return crypto.createHmac("sha256", bootKey).update(`connect.${id}`).digest("base64url");
}

/**
 * Whether `token` is the connect token of `id`, in constant time.
 * @param {Buffer} bootKey
 * @param {string} id
 * @param {unknown} token
 * @returns {boolean}
 */
export function verifyConnect(bootKey, id, token) {
  const want = Buffer.from(connectToken(bootKey, id), "utf8");
  const got = Buffer.from(typeof token === "string" ? token : "", "utf8");
  // Compared at the expected length whatever was sent, so the time never says how long it was.
  const padded = Buffer.alloc(want.length);
  got.copy(padded, 0, 0, Math.min(got.length, want.length));
  const same = crypto.timingSafeEqual(want, padded);
  return same && got.length === want.length;
}

/**
 * The connect token's one use: "ok" sets `s.connected`, "used" once it has
 * been, "invalid" for any other token.
 * @param {Buffer} bootKey
 * @param {{ id: string, connected: boolean }} s
 * @param {unknown} token
 * @returns {"ok" | "used" | "invalid"}
 */
export function redeemConnect(bootKey, s, token) {
  if (!verifyConnect(bootKey, s.id, token)) return "invalid";
  if (s.connected) return "used";
  s.connected = true;
  return "ok";
}

/** A watch token's grace past its session's own end (3.3). */
export const WATCH_GRACE_MS = 60_000;
/** A watch token's longest life from minting (3.3). */
export const WATCH_MAX_MS = 2 * 60 * 60_000;
/** A control token's life from minting (3.3). */
export const CONTROL_MS = 15 * 60_000;
/** The longest live token the host reads. */
export const LIVE_TOKEN_MAX = 1024;

const B64URL = /^[A-Za-z0-9_-]+$/;
const PAYLOAD_KEYS = "e,g,m,n,s";

/**
 * @param {Buffer} bootKey
 * @param {string} payload
 */
const liveMac = (bootKey, payload) => crypto.createHmac("sha256", bootKey).update(`live.${payload}`).digest("base64url");

/**
 * Mint a live token.
 * @param {Buffer} bootKey
 * @param {{ id: string, mode: "watch" | "control", nowMs: number, sessionEndMs: number, epoch: number, controlMs?: number }} o
 * @returns {{ token: string, exp: number }}
 */
export function mintLive(bootKey, o) {
  const end = o.sessionEndMs + WATCH_GRACE_MS;
  const until = o.mode === "control" ? Math.min(o.nowMs + (o.controlMs ?? CONTROL_MS), end) : Math.min(end, o.nowMs + WATCH_MAX_MS);
  const exp = Math.floor(until / 1000);
  const body = { s: o.id, m: o.mode === "control" ? "c" : "w", e: exp, g: o.epoch, n: crypto.randomBytes(16).toString("base64url") };
  const payload = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
  return { token: `${payload}.${liveMac(bootKey, payload)}`, exp };
}

/**
 * Check a live token for a session: its mode and exp, or why it is refused.
 * The mac is checked first, in constant time, so nothing else is read from a
 * token the host did not mint.
 * @param {Buffer} bootKey
 * @param {unknown} token
 * @param {{ id: string, nowMs: number, epoch: number }} o
 * @returns {{ ok: true, mode: "watch" | "control", exp: number } | { ok: false, reason: "invalid" | "expired" | "revoked" }}
 */
export function verifyLive(bootKey, token, o) {
  /** @type {{ ok: false, reason: "invalid" }} */
  const invalid = { ok: false, reason: "invalid" };
  if (typeof token !== "string" || token.length > LIVE_TOKEN_MAX) return invalid;
  const dot = token.indexOf(".");
  if (dot < 1 || dot !== token.lastIndexOf(".")) return invalid;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!B64URL.test(payload) || !B64URL.test(mac)) return invalid;
  const want = Buffer.from(liveMac(bootKey, payload), "utf8");
  const got = Buffer.alloc(want.length);
  Buffer.from(mac, "utf8").copy(got, 0, 0, want.length);
  if (!crypto.timingSafeEqual(want, got) || mac.length !== want.length) return invalid;
  /** @type {any} */
  let body;
  try {
    body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return invalid;
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join(",") !== PAYLOAD_KEYS) return invalid;
  if (body.s !== o.id || (body.m !== "w" && body.m !== "c") || !Number.isSafeInteger(body.e) || !Number.isSafeInteger(body.g) || typeof body.n !== "string") return invalid;
  const mode = body.m === "c" ? "control" : "watch";
  if (mode === "control" && body.g !== o.epoch) return { ok: false, reason: "revoked" };
  if (body.e * 1000 <= o.nowMs) return { ok: false, reason: "expired" };
  return { ok: true, mode, exp: body.e };
}

/**
 * What the host keeps of a token while a socket uses it: its SHA-256.
 * @param {string} token
 */
export function liveTokenHash(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}
