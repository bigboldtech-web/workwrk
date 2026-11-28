// A short-lived signed link to a local attachment (the final review of pen
// test 2026-11-28). An attachment needs someone signed in with a seat in its
// company (V-23); a public door (a shared doc or SOP, the e-sign page) hands
// its anonymous reader a link signed for this one file until `exp`, as the
// object-storage path already does with a presigned URL. The key derives from
// the auth secret, with its own label.
//
// Server-only.

import { createHmac, timingSafeEqual } from "node:crypto";

const LABEL = "workwrk:upload-link:v1";
const LOCAL = /^\/api\/uploads\/(file-([a-z0-9]{20,32})-[^/?#]+)(?:[?#].*)?$/i;

function key(): Buffer | null {
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  return secret ? createHmac("sha256", secret).update(LABEL).digest() : null;
}

function signature(filename: string, exp: number): string | null {
  const k = key();
  return k ? createHmac("sha256", k).update(`${filename}:${exp}`).digest("base64url").slice(0, 32) : null;
}

/** `url` signed for `ttlSeconds` when it is a local attachment of `organizationId`; anything else as given. */
export function signUploadUrl(url: string, organizationId: string, ttlSeconds = 6 * 3600, now = Date.now()): string {
  const m = LOCAL.exec(url);
  if (!m || m[2] !== organizationId) return url;
  const exp = Math.floor(now / 1000) + ttlSeconds;
  const sig = signature(m[1], exp);
  return sig ? `/api/uploads/${m[1]}?exp=${exp}&sig=${sig}` : url;
}

/** Whether a request names a live signature for this file. */
export function uploadLinkValid(filename: string, exp: string | null, sig: string | null, now = Date.now()): boolean {
  if (!exp || !sig) return false;
  const e = Number(exp);
  if (!Number.isInteger(e) || e * 1000 < now) return false;
  const want = signature(filename, e);
  if (!want) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Every local attachment link in a doc's content, signed for its anonymous
 * reader: legacy blocks' `url`, and BlockNote blocks' `props.url` at any depth.
 */
export function signContentUploadLinks<T>(content: T, organizationId: string, now = Date.now()): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== "object") return v;
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(o)) {
      out[k] = k === "url" && typeof val === "string" ? signUploadUrl(val, organizationId, 6 * 3600, now) : walk(val);
    }
    return out;
  };
  return walk(content) as T;
}
