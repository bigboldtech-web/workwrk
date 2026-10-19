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
// The live tokens (watch and control, with the control epoch) arrive in step 2.
//
// Pure: the key is passed in.

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
