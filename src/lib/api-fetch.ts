// apiFetch: the ONE error path for shell fetches (spec-shell.md section 1.7).
//
//   const r = await apiFetch<{ effective: EffectivePreferences }>("/api/preferences");
//   if (!r.ok) return <ErrorState onRetry={refetch} />;   // never setRows([])
//   use(r.data);
//
// Rules, all of them enforced here so no caller has to remember:
//   - never throws for an HTTP or network failure; the result says what happened
//   - 401 marks the session expired and dispatches `workwrk:session-expired`
//     (spec 1.10); once that has happened every later call short-circuits to
//     `{ ok: false, status: 401 }` without touching the network, which is how
//     the pollers stop
//   - a network failure dispatches `workwrk:offline`; the next success after it
//     dispatches `workwrk:online`
//   - the body is parsed as JSON when it is JSON, else kept as text; a 401 body
//     is never assumed to be JSON (one route answers with plain text)
//
// The pure parts (error-body parsing, retry policy) live in named functions so
// the vitest suite proves them without a DOM.

import {
  OFFLINE_EVENT,
  ONLINE_EVENT,
  isSessionExpired,
  markSessionExpired,
  type SessionExpiryReason,
} from "./session-expiry";

export type ApiOk<T> = { ok: true; status: number; data: T };
export type ApiFail = {
  ok: false;
  status: number;
  error: string;
  /** True when the request never reached a server. */
  offline?: boolean;
  /** zod issues or any structured detail the route returned. */
  issues?: unknown;
};
export type ApiResult<T> = ApiOk<T> | ApiFail;

export interface ApiFetchInit extends Omit<RequestInit, "body"> {
  /** JSON-encode this as the body and set the content type. */
  json?: unknown;
  body?: BodyInit | null;
  /** Skip the session-expired short-circuit (the login flow itself). */
  allowWhenExpired?: boolean;
}

export const SESSION_EXPIRED_ERROR = "Your session has expired";
export const OFFLINE_ERROR = "You're offline";

/** Pick the human message out of whatever the route sent. */
export function parseErrorBody(status: number, contentType: string | null, text: string): { error: string; issues?: unknown } {
  const trimmed = text.trim();
  if (contentType && contentType.includes("application/json") && trimmed) {
    try {
      const body = JSON.parse(trimmed) as Record<string, unknown>;
      const msg = typeof body?.error === "string" ? body.error : typeof body?.message === "string" ? body.message : null;
      return { error: msg ?? defaultErrorFor(status), issues: body?.issues };
    } catch {
      // declared JSON that does not parse: never surface the raw bytes
      return { error: defaultErrorFor(status) };
    }
  }
  if (trimmed && trimmed.length <= 200 && !trimmed.startsWith("<") && !trimmed.startsWith("{")) return { error: trimmed };
  return { error: defaultErrorFor(status) };
}

export function defaultErrorFor(status: number): string {
  if (status === 401) return SESSION_EXPIRED_ERROR;
  if (status === 403) return "You don't have access to this";
  if (status === 404) return "Not found";
  if (status === 429) return "Too many requests. Try again in a moment";
  if (status >= 500) return "Something went wrong on our side";
  if (status === 0) return OFFLINE_ERROR;
  return "Something went wrong";
}

/** A 401 whose body names a revocation reads as "signed out everywhere". */
export function expiryReasonFor(errorText: string): SessionExpiryReason {
  const t = errorText.toLowerCase();
  if (t.includes("revoked") || t.includes("signed out") || t.includes("every device")) return "revoked";
  if (t.includes("expired")) return "expired";
  return "unknown";
}

let wasOffline = false;

function dispatch(name: string, detail?: unknown) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export async function apiFetch<T = unknown>(url: string, init: ApiFetchInit = {}): Promise<ApiResult<T>> {
  const { json, allowWhenExpired, headers, body, ...rest } = init;

  if (isSessionExpired() && !allowWhenExpired) {
    return { ok: false, status: 401, error: SESSION_EXPIRED_ERROR };
  }

  const finalHeaders = new Headers(headers ?? {});
  let finalBody: BodyInit | null | undefined = body;
  if (json !== undefined) {
    if (!finalHeaders.has("content-type")) finalHeaders.set("content-type", "application/json");
    finalBody = JSON.stringify(json);
  }

  let res: Response;
  try {
    res = await fetch(url, { ...rest, headers: finalHeaders, body: finalBody, credentials: rest.credentials ?? "same-origin" });
  } catch {
    if (!wasOffline) {
      wasOffline = true;
      dispatch(OFFLINE_EVENT, { url });
    }
    return { ok: false, status: 0, error: OFFLINE_ERROR, offline: true };
  }

  if (wasOffline) {
    wasOffline = false;
    dispatch(ONLINE_EVENT);
  }

  if (res.status === 401) {
    const text = await res.text().catch(() => "");
    const parsed = parseErrorBody(401, res.headers.get("content-type"), text);
    markSessionExpired({ reason: expiryReasonFor(parsed.error), source: url });
    return { ok: false, status: 401, error: SESSION_EXPIRED_ERROR, issues: parsed.issues };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const parsed = parseErrorBody(res.status, res.headers.get("content-type"), text);
    return { ok: false, status: res.status, error: parsed.error, issues: parsed.issues };
  }

  if (res.status === 204) return { ok: true, status: 204, data: undefined as T };

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return { ok: true, status: res.status, data: (await res.json()) as T };
    } catch {
      return { ok: false, status: res.status, error: "The server sent an unreadable response" };
    }
  }
  const text = await res.text().catch(() => "");
  // AN API PATH THAT DOES NOT EXIST ANSWERS 200 WITH A RENDERED PAGE.
  //
  // The dashboard catch-all renders its not-found PAGE for anything it does
  // not recognise, including paths under /api/, and it does so at HTTP 200.
  // Reporting that as success is worse here than anywhere else: a write to a
  // mistyped or renamed route would come back { ok: true } with an HTML
  // string as its data, and the caller would tell the person their change was
  // saved when nothing was written. No real API route answers 2xx with an
  // HTML document, so this can only ever catch the broken case.
  if (isApiPath(url) && looksLikeHtml(contentType, text)) {
    return { ok: false, status: res.status, error: defaultErrorFor(404) };
  }
  return { ok: true, status: res.status, data: text as unknown as T };
}

/** Does this URL address our own API (absolute or relative)? */
function isApiPath(url: string): boolean {
  if (url.startsWith("/api/")) return true;
  try {
    return new URL(url, typeof window === "undefined" ? "http://localhost" : window.location.href).pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

/** An HTML document rather than an API payload. */
function looksLikeHtml(contentType: string, body: string): boolean {
  if (contentType.includes("text/html")) return true;
  return /^\s*<(!doctype html|html)\b/i.test(body);
}

// ── Retry helper (draft-preserving) ───────────────────────────────

export interface RetryOptions {
  /** Total attempts including the first. Default 3. */
  attempts?: number;
  /** Base delay; grows 1x, 2x, 4x with jitter. Default 600ms. */
  baseDelayMs?: number;
  /**
   * Also re-send a write (POST, PATCH, PUT, DELETE) on a transient failure.
   * OFF by default: a connection that dropped after the server committed,
   * or a 500 thrown after a partial write, would duplicate the task, comment
   * or kudos on the retry. Opt in only for a write the server de-duplicates
   * (an Idempotency-Key, an upsert keyed by the client). Spec 1.7 gives
   * every other write failure a user-driven Retry instead.
   */
  retryWrites?: boolean;
  /** Test seam. */
  sleep?: (ms: number) => Promise<void>;
}

const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

/** True for the methods HTTP calls safe: re-sending them changes nothing. */
export function isSafeMethod(method: string | undefined): boolean {
  return SAFE_METHODS.has((method ?? "GET").toUpperCase());
}

/**
 * Only transient failures retry: network loss and 5xx. Never a 4xx, never a
 * 401, and never a write unless the caller opted in with `retryWrites`.
 */
export function shouldRetry(result: ApiFail, method: string | undefined = "GET", retryWrites = false): boolean {
  if (!retryWrites && !isSafeMethod(method)) return false;
  if (result.offline) return true;
  if (result.status === 401) return false;
  return result.status >= 500;
}

/** 600, 1200, 2400ms ... with up to 25% jitter, capped at 10s. */
export function backoffDelayMs(attempt: number, baseDelayMs = 600, random: () => number = Math.random): number {
  const raw = Math.min(10_000, baseDelayMs * 2 ** Math.max(0, attempt));
  const jitter = raw * 0.25 * random();
  return Math.round(raw + jitter);
}

export type RetryResult<T> = ApiResult<T> & {
  /** On failure: the exact body the caller sent, untouched, so a draft is never lost. */
  draft?: unknown;
  attempts: number;
};

/**
 * `apiFetch` with retries for transient failures of a READ. A write is sent
 * once (see `RetryOptions.retryWrites`) and, on failure, the caller's `json`
 * body comes back untouched as `draft` so the person's own Retry can re-send
 * exactly what they typed: the helper never rewrites, drops or silently
 * duplicates it.
 */
export async function apiFetchWithRetry<T = unknown>(url: string, init: ApiFetchInit = {}, opts: RetryOptions = {}): Promise<RetryResult<T>> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: ApiResult<T> | null = null;
  let made = 0;
  for (let i = 0; i < attempts; i++) {
    const result = await apiFetch<T>(url, init);
    made = i + 1;
    if (result.ok) return { ...result, attempts: made };
    last = result;
    if (!shouldRetry(result, init.method, opts.retryWrites) || i === attempts - 1) break;
    await sleep(backoffDelayMs(i, opts.baseDelayMs));
  }
  const fail = last as ApiFail;
  // `attempts` is what was actually sent, so a caller can tell "sent once,
  // failed" (re-send is safe to offer) from "gave up after three".
  return { ...fail, draft: init.json ?? init.body ?? undefined, attempts: made };
}
