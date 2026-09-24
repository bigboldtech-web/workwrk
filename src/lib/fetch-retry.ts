// fetchWithRetry: a write that must not be lost to a dropped connection.
//
// The sheet's cell writes (PATCH /api/tables/[id]/rows and POST .../rows/batch)
// and the form responder's submit need three things apiFetch deliberately does
// not do for writes (Phase 5 hard rule: "keepalive, retry and a surfaced
// failure state"):
//   - keepalive, so a write fired as the tab closes still reaches the server
//     (only below the browser's 64 KB keepalive body limit; a bigger body goes
//     out without it rather than being refused);
//   - a retry on a NETWORK failure or a 5xx, with the same backoff apiFetch
//     uses, and never on a 4xx: a 409 conflict or a 403 refusal is an answer;
//   - the Response itself on success or on any 4xx, so callers keep reading
//     their own status codes and bodies exactly as before. Only when every
//     attempt failed does it throw, and the caller surfaces that.
//
// Only an idempotent write may ride it: a cell write sets values (a repeat
// after a lost response lands the same value, or answers 409 on a guarded
// write, which the caller reconciles), the batch route's updates and deletes
// tolerate stale ids, and the form Submit carries a submission key the server
// stores the response under, so a repeat finds the first one. A row INSERT
// has no such key and must not use this.

import { backoffDelayMs } from "./api-fetch";

export const KEEPALIVE_MAX_BODY = 60_000;

export interface FetchRetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** The UTF-8 size of a text body, or null for a body keepalive never carries. */
function bodyBytes(body: BodyInit | null | undefined): number | null {
  if (typeof body !== "string") return null;
  // A UTF-16 unit is at least one byte, so a body this long is over the
  // limit without encoding it; anything shorter is cheap to measure exactly
  // (the in-flight budget needs the real size, not an upper bound).
  if (body.length >= KEEPALIVE_MAX_BODY) return null;
  return new TextEncoder().encode(body).length;
}

/** The browser's keepalive quota is in bytes, and one character of text can
 *  be up to four, so the body is measured as UTF-8. */
export function shouldKeepalive(body: BodyInit | null | undefined): boolean {
  const n = bodyBytes(body);
  return n !== null && n < KEEPALIVE_MAX_BODY;
}

// Chrome's 64 KiB keepalive quota is shared by EVERY keepalive request in
// flight, not per request: a columns PATCH next to a large batch chunk can
// be refused with a TypeError on a healthy network. The bytes this module
// has in flight are counted, a request that would overrun the budget goes
// out without keepalive, and an attempt refused while carrying keepalive is
// retried without it, so the quota can never turn into a false "not saved".
let keepaliveInFlight = 0;

/** Test hook: the keepalive bytes currently in flight. */
export function keepaliveBytesInFlight(): number {
  return keepaliveInFlight;
}

export async function fetchWithRetry(url: string, init: RequestInit, opts: FetchRetryOptions = {}): Promise<Response> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const size = bodyBytes(init.body);
  let keepaliveRefused = false;
  let lastError: unknown = null;
  for (let i = 0; i < attempts; i++) {
    const keepalive = !keepaliveRefused && size !== null && keepaliveInFlight + size < KEEPALIVE_MAX_BODY;
    if (keepalive) keepaliveInFlight += size;
    try {
      const res = await doFetch(url, keepalive ? { ...init, keepalive: true } : init);
      if (res.status < 500) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastError = e;
      if (keepalive) keepaliveRefused = true;
    } finally {
      if (keepalive) keepaliveInFlight -= size;
    }
    if (i < attempts - 1) await sleep(backoffDelayMs(i, opts.baseDelayMs ?? 600));
  }
  throw lastError instanceof Error ? lastError : new Error("request failed");
}
