// The browser provider's API (docs/plans/ai-teammates-phase4.md Decision 1):
// Browserbase, behind our own small interface, so a later swap changes this
// file and nothing else. Outside production the same calls go to the
// stand-in (scripts/browser-stand-in.mjs), which answers Browserbase's paths
// in Browserbase's shapes.
//
// Every request:
//   - carries X-BB-API-Key and nothing else that identifies anyone;
//   - gives up after 10 seconds, or sooner when its caller says so
//     (`timeoutMs`, the sweep's releases and list: follow-up to review round
//     1 of Phase 4), aborted through an AbortController, its answer's body
//     included; and follows no redirect (a redirect could carry the key
//     somewhere else);
//   - reads at most RESPONSE_MAX bytes of the answer;
//   - logs only "[browser] provider <op> <failure> <status>": never the key,
//     the connect address (it holds a signing key) or a live view address.
//
// A CREATE THAT TIMES OUT IS NEVER RETRIED (Decision 27): it may have
// started a browser, which answers unknown_outcome; the row ends and the
// reaper releases whatever started, by its tag. Every session is created
// with keepAlive false (the provider ends it when our connection closes, so
// a restart ends it there too), recording and logging off, a fresh browser,
// and a timeout of its reserved minutes plus one, the last backstop.
//
// **verify** before production (Founder actions 1 and 3), against
// Browserbase's API reference: keepAlive, userMetadata,
// browserSettings.recordSession and logSession, region, timeout in seconds,
// the debug endpoint's debuggerFullscreenUrl, REQUEST_RELEASE and the
// status filter of the list.
//
// Server-only: talks to the network.

import { liveViewOriginOk, type BrowserConfig, type BrowserReleaseConfig } from "./config";

export type ProviderFailure = "unavailable" | "rate_limited" | "refused" | "not_found" | "client" | "unknown_outcome";

export type ProviderResult<T> = { ok: true; data: T } | { ok: false; failure: ProviderFailure; retryAfter?: number };

/** How long one request may take. */
export const PROVIDER_TIMEOUT_MS = 10_000;

/** The most of an answer read: a list of running sessions is the largest. */
const RESPONSE_MAX = 2_000_000;

/** A provider session id as it may appear in a path: what Browserbase issues (a UUID) and the stand-in's. */
const SESSION_ID = /^[A-Za-z0-9_-]{1,200}$/;

/** The viewport every browser has (the live view and the pictures are this size). */
export const VIEWPORT = { width: 1280, height: 800 } as const;

type Op = "create" | "live_view" | "release" | "list";

function logFailure(op: Op, failure: ProviderFailure, status: number | null): void {
  console.error(`[browser] provider ${op} ${failure} ${status ?? "-"}`);
}

/** Seconds from a Retry-After header (seconds or a date), at most an hour, at least one. */
function retryAfterOf(h: string | null): number | undefined {
  if (!h) return undefined;
  const t = h.trim();
  if (/^\d{1,6}$/.test(t)) return Math.min(3600, Math.max(1, Number(t)));
  const at = Date.parse(t);
  if (!Number.isNaN(at)) return Math.min(3600, Math.max(1, Math.ceil((at - Date.now()) / 1000)));
  return undefined;
}

function failureOf(status: number): ProviderFailure {
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "client";
  if (status === 404) return "not_found";
  if (status >= 500) return "unavailable";
  return "refused";
}

/** Whether a fetch error is its own timeout (the request may have arrived). */
function timedOut(err: unknown): boolean {
  const name = err && typeof err === "object" ? String((err as { name?: unknown }).name ?? "") : "";
  return name === "TimeoutError" || name === "AbortError";
}

type Answer = { ok: true; status: number; body: unknown; retryAfter?: number } | { ok: false; failure: ProviderFailure; status: number | null; retryAfter?: number };

/** What a caller may ask of one request: `timeoutMs`, a shorter wait than PROVIDER_TIMEOUT_MS (never a longer one). */
export type RequestOptions = { timeoutMs?: number };

/** How long this request may take: the caller's wait when it is shorter, else PROVIDER_TIMEOUT_MS. */
function requestMs(o: RequestOptions): number {
  const t = o.timeoutMs;
  return typeof t === "number" && t > 0 ? Math.min(PROVIDER_TIMEOUT_MS, Math.ceil(t)) : PROVIDER_TIMEOUT_MS;
}

/**
 * One request, aborted once its time is up (follow-up to review round 1 of
 * Phase 4): before, a release the sweep stopped waiting on still ran to its
 * own 10 seconds. The abort reads as the timeout it is (TimeoutError), so a
 * create that may have arrived still answers unknown_outcome.
 */
async function call(
  base: string,
  apiKey: string,
  op: Op,
  method: "GET" | "POST",
  pathname: string,
  body?: Record<string, unknown>,
  o: RequestOptions = {},
): Promise<Answer> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError")), requestMs(o));
  timer.unref?.();
  try {
    return await answerOf(base, apiKey, op, method, pathname, body, ac.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function answerOf(
  base: string,
  apiKey: string,
  op: Op,
  method: "GET" | "POST",
  pathname: string,
  body: Record<string, unknown> | undefined,
  signal: AbortSignal,
): Promise<Answer> {
  let res: Response;
  try {
    res = await fetch(`${base}${pathname}`, {
      method,
      headers: { "X-BB-API-Key": apiKey, ...(body ? { "Content-Type": "application/json" } : {}), Accept: "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "error",
      cache: "no-store",
      signal,
    });
  } catch (err) {
    // A create that may have arrived is never taken as failed outright.
    const failure: ProviderFailure = op === "create" && timedOut(err) ? "unknown_outcome" : "unavailable";
    logFailure(op, failure, null);
    return { ok: false, failure, status: null };
  }
  const retryAfter = retryAfterOf(res.headers.get("retry-after"));
  let text = "";
  try {
    text = await res.text();
  } catch {
    // A refusal's body is not read anyway; a success that cannot be read is not one.
    if (res.ok) {
      const failure: ProviderFailure = op === "create" ? "unknown_outcome" : "unavailable";
      logFailure(op, failure, res.status);
      return { ok: false, failure, status: res.status };
    }
  }
  if (!res.ok) {
    const failure = failureOf(res.status);
    logFailure(op, failure, res.status);
    return { ok: false, failure, status: res.status, ...(retryAfter ? { retryAfter } : {}) };
  }
  if (text.length > RESPONSE_MAX) {
    const failure: ProviderFailure = op === "create" ? "unknown_outcome" : "unavailable";
    logFailure(op, failure, res.status);
    return { ok: false, failure, status: res.status };
  }
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      const failure: ProviderFailure = op === "create" ? "unknown_outcome" : "unavailable";
      logFailure(op, failure, res.status);
      return { ok: false, failure, status: res.status };
    }
  }
  return { ok: true, status: res.status, body: parsed };
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Whether a connect address is a websocket address this deployment may use (wss, or ws for the stand-in). */
function connectUrlOk(url: unknown, standIn: boolean): url is string {
  if (typeof url !== "string" || url.length > 4000 || !URL.canParse(url)) return false;
  const p = new URL(url).protocol;
  return p === "wss:" || (standIn && p === "ws:");
}

/**
 * Start one fresh browser for the session row `rowId`, tagged with this
 * deployment (see the header). `timeoutSeconds` is the provider's own limit.
 */
export async function createProviderSession(
  cfg: BrowserConfig,
  a: { rowId: string; timeoutSeconds: number },
): Promise<ProviderResult<{ providerSessionId: string; connectUrl: string }>> {
  const out = await call(cfg.apiBase, cfg.apiKey, "create", "POST", "/v1/sessions", {
    projectId: cfg.projectId,
    region: cfg.region,
    timeout: Math.max(60, Math.floor(a.timeoutSeconds)),
    keepAlive: false,
    browserSettings: { viewport: { ...VIEWPORT }, recordSession: false, logSession: false, blockAds: true },
    userMetadata: { wk: cfg.deploymentTag, row: a.rowId },
  });
  if (!out.ok) return { ok: false, failure: out.failure, ...(out.retryAfter ? { retryAfter: out.retryAfter } : {}) };
  const b = rec(out.body);
  const id = b.id;
  if (typeof id !== "string" || !SESSION_ID.test(id) || !connectUrlOk(b.connectUrl, cfg.standIn)) {
    // Something started, or not: the reaper ends it by its tag.
    logFailure("create", "unknown_outcome", out.status);
    return { ok: false, failure: "unknown_outcome" };
  }
  return { ok: true, data: { providerSessionId: id, connectUrl: b.connectUrl as string } };
}

/**
 * The live view's address for the session's person (Decision 19), minted on
 * request and never stored or logged. Refused unless its origin is the
 * provider's.
 */
export async function liveViewUrl(cfg: BrowserConfig, providerSessionId: string): Promise<ProviderResult<string>> {
  if (!SESSION_ID.test(providerSessionId)) return { ok: false, failure: "not_found" };
  const out = await call(cfg.apiBase, cfg.apiKey, "live_view", "GET", `/v1/sessions/${encodeURIComponent(providerSessionId)}/debug`);
  if (!out.ok) return { ok: false, failure: out.failure, ...(out.retryAfter ? { retryAfter: out.retryAfter } : {}) };
  const url = rec(out.body).debuggerFullscreenUrl;
  if (typeof url !== "string" || url.length > 4000 || !liveViewOriginOk(url, cfg)) {
    logFailure("live_view", "refused", out.status);
    return { ok: false, failure: "refused" };
  }
  return { ok: true, data: url };
}

/**
 * Ask the provider to end the browser. "already" when it is gone (404) or
 * already ending (409); "failed" otherwise, for the sweep to try again.
 * `timeoutMs`: the most the caller waits (the sweep's SWEEP_RELEASE_MS),
 * past which the request is aborted and reads "failed" (follow-up to review
 * round 1 of Phase 4).
 */
export async function releaseProviderSession(cfg: BrowserReleaseConfig, providerSessionId: string, o: RequestOptions = {}): Promise<"released" | "already" | "failed"> {
  if (!SESSION_ID.test(providerSessionId)) return "already";
  const out = await call(
    cfg.apiBase,
    cfg.apiKey,
    "release",
    "POST",
    `/v1/sessions/${encodeURIComponent(providerSessionId)}`,
    { projectId: cfg.projectId, status: "REQUEST_RELEASE" },
    o,
  );
  if (out.ok) return "released";
  if (out.status === 404 || out.status === 409) return "already";
  return "failed";
}

/**
 * The provider's running sessions, with the tag and row each was created
 * with (null when it has none). `timeoutMs`: the most the caller waits (the
 * sweep's budget left), past which the request is aborted and reads
 * unavailable (follow-up to review round 1 of Phase 4).
 */
export async function listRunningProviderSessions(
  cfg: BrowserReleaseConfig,
  o: RequestOptions = {},
): Promise<ProviderResult<Array<{ providerSessionId: string; tag: string | null; rowId: string | null }>>> {
  const out = await call(cfg.apiBase, cfg.apiKey, "list", "GET", "/v1/sessions?status=RUNNING", undefined, o);
  if (!out.ok) return { ok: false, failure: out.failure, ...(out.retryAfter ? { retryAfter: out.retryAfter } : {}) };
  const list = Array.isArray(out.body) ? out.body : Array.isArray(rec(out.body).sessions) ? (rec(out.body).sessions as unknown[]) : null;
  if (!list) {
    logFailure("list", "unavailable", out.status);
    return { ok: false, failure: "unavailable" };
  }
  const data: Array<{ providerSessionId: string; tag: string | null; rowId: string | null }> = [];
  for (const raw of list) {
    const s = rec(raw);
    if (typeof s.id !== "string" || !SESSION_ID.test(s.id)) continue;
    // A session another status filter let through is left alone.
    if (typeof s.status === "string" && s.status !== "RUNNING") continue;
    const meta = rec(s.userMetadata);
    const tag = typeof meta.wk === "string" && meta.wk.length <= 80 ? meta.wk : null;
    const rowId = typeof meta.row === "string" && meta.row.length <= 80 ? meta.row : null;
    data.push({ providerSessionId: s.id, tag, rowId });
  }
  return { ok: true, data };
}
