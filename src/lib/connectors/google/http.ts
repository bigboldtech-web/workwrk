// One call to Gmail or Google Calendar for a person's own connection
// (docs/plans/ai-teammates-phase3.md step 2): the access token kept fresh,
// a refusal named by kind, and a write never sent twice.
//
// THE TOKEN. Used while it has more than a minute left; otherwise refreshed
// first (refreshFor). A 401 means Google refused the request before doing
// anything, so it refreshes once, by force, and the request goes once more:
// safe for writes too. One opened connection is refreshed at most once,
// however many requests its call makes (review of step 3: REFRESHED).
//
// A WRITE IS NEVER SENT TWICE (Decision 24). A GET that timed out, lost its
// connection or met a 5xx is tried once more after half a second. A write
// that timed out or lost its connection may have happened, so it answers
// unknown_outcome and is never retried; the tools tell the person to check
// Gmail or their calendar before asking again. A write answered with a 5xx
// is unknown_outcome too: a server error after the request reached Google
// does not say nothing was done, and answering "try again" could send an
// email twice.
//
// A REFRESH WRITES ONLY ON THE VERSION IT READ. The new access token is
// stored by a compare-and-swap on tokenVersion (and status active), so two
// refreshes at once both write a valid token, and one from before a
// reconnect writes nothing, and then uses nothing: a token the swap could not
// store answers not_connected or needs_reconnect (review of step 2).
// invalid_grant marks the connection needs_reconnect by the same swap
// (connections.ts markNeedsReconnect); invalid_client is WorkwrK's own
// credentials and marks nothing; anything else is Google being unavailable
// (Decision 18).
//
// LOGS NAME THE KIND AND THE STATUS ONLY: "[connectors] google <failure>
// <status>". Never a token, an address, a URL with a query, or a body.
//
// Server-only: opens sealed tokens.

import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { markNeedsReconnect, type LiveConnection } from "../connections";
import { openToken, sealToken } from "../seal";
import type { GoogleConfig } from "./config";
import { refreshAccess } from "./oauth";

export type GoogleFailure =
  | "not_connected"
  | "needs_reconnect"
  | "scope_missing"
  | "not_found"
  | "changed"
  | "rate_limited"
  | "forbidden"
  | "bad_request"
  | "unavailable"
  | "client"
  | "unknown_outcome";

export type GoogleResult<T> = { ok: true; data: T; etag?: string | null } | { ok: false; failure: GoogleFailure; retryAfter?: number };

export interface GoogleRequest {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  url: string;
  body?: unknown;
  /** The event's etag, so a change lands only on the version the person approved (Decision 12). */
  ifMatch?: string | null;
  /** Anything but a read: never retried on an unknown outcome. */
  write: boolean;
}

/** Each request to Gmail or Calendar gives up after this long. */
export const CALL_TIMEOUT_MS = 15_000;
/** A token with less than this left is refreshed first. */
const FRESH_FOR_MS = 60_000;
/** How long a GET waits before its one retry. */
const RETRY_DELAY_MS = 500;
/** What a 429 with no Retry-After is read as. */
const DEFAULT_RETRY_AFTER_S = 30;

function logFailure(failure: GoogleFailure | string, status: number | string): void {
  console.error(`[connectors] google ${failure} ${status}`);
}

type AccessResult = { ok: true; accessToken: string } | { ok: false; failure: GoogleFailure };

/**
 * A fresh access token for this connection: Google's refresh answer, stored
 * only while the row still has the tokenVersion it was read with.
 */
export async function refreshFor(conn: LiveConnection, cfg: GoogleConfig): Promise<AccessResult> {
  let refreshToken: string;
  try {
    refreshToken = openToken(conn.refreshTokenSealed);
  } catch {
    // No key opens it: WorkwrK's own fault, never the person's.
    logFailure("client", "key");
    return { ok: false, failure: "client" };
  }
  const r = await refreshAccess(cfg, refreshToken);
  if (r.ok) {
    const wrote = await prisma.teammateConnection
      .updateMany({
        where: { id: conn.id, tokenVersion: conn.tokenVersion, status: "active" },
        data: { accessTokenSealed: sealToken(r.accessToken) as unknown as Prisma.InputJsonValue, accessTokenExpiresAt: new Date(Date.now() + r.expiresIn * 1000) },
      })
      .catch(() => null);
    if (wrote?.count === 1) return { ok: true, accessToken: r.accessToken };
    // The swap wrote nothing (review of step 2): the connection this call
    // read was disconnected, reconnected (perhaps as another account) or
    // marked broken meanwhile. A disconnect that kept a shared account's
    // grant at Google leaves this refresh token working, so the new token
    // would still read or write the old account after the person ended it.
    // It is never used; the row as it is now says why.
    const now = await prisma.teammateConnection
      .findUnique({ where: { id: conn.id }, select: { tokenVersion: true, status: true } })
      .catch(() => undefined);
    if (now === undefined) return { ok: false, failure: "unavailable" };
    if (now === null) return { ok: false, failure: "not_connected" };
    if (now.tokenVersion !== conn.tokenVersion || now.status !== "active") return { ok: false, failure: "needs_reconnect" };
    // Unchanged: only the write failed (the database, a moment), and the
    // token is this very connection's.
    return { ok: true, accessToken: r.accessToken };
  }
  if (r.kind === "invalid_grant") {
    await markNeedsReconnect(conn, "revoked");
    return { ok: false, failure: "needs_reconnect" };
  }
  if (r.kind === "invalid_client") return { ok: false, failure: "client" };
  return { ok: false, failure: "unavailable" };
}

/**
 * The one refresh each opened connection gets (review of step 3). A tool call
 * opens the person's connection once (connector-access.ts openConnector) and
 * every request it makes shares that object: a search's list and each of its
 * message reads, five at a time. Without this each of them refreshed an
 * expired token on its own, up to 21 refreshes and 21 writes for one search,
 * which is the per-user quota flooding Decision 22 is meant to prevent. The
 * first request that needs a refresh starts it, the rest (at the same moment
 * or later in the call) wait on the same answer, a failed one included, and
 * the entry goes with the object when the call is done.
 */
const REFRESHED = new WeakMap<LiveConnection, Promise<AccessResult>>();

function refreshOnce(conn: LiveConnection, cfg: GoogleConfig): Promise<AccessResult> {
  const known = REFRESHED.get(conn);
  if (known) return known;
  const started = refreshFor(conn, cfg);
  REFRESHED.set(conn, started);
  return started;
}

/**
 * The token this call already refreshed, else the stored one while it has
 * more than a minute left, else this call's one refresh. Everything before
 * the refresh starts runs at once, with no wait, so requests sent side by side
 * find the refresh the first of them started.
 */
function accessFor(conn: LiveConnection, cfg: GoogleConfig, force: boolean): Promise<AccessResult> {
  if (conn.status !== "active") return Promise.resolve<AccessResult>({ ok: false, failure: "needs_reconnect" });
  const refreshed = REFRESHED.get(conn);
  if (refreshed) return refreshed;
  if (!force && conn.accessTokenSealed && conn.accessTokenExpiresAt && conn.accessTokenExpiresAt.getTime() - Date.now() > FRESH_FOR_MS) {
    try {
      return Promise.resolve<AccessResult>({ ok: true, accessToken: openToken(conn.accessTokenSealed) });
    } catch {
      // Sealed under a key no longer held: a refresh writes a new one.
    }
  }
  return refreshOnce(conn, cfg);
}

/**
 * A refresh now, before an approval sends anything (review of step 3): a
 * grant revoked at Google, or a refresh token Testing mode expired after
 * seven days (Decision 32), is found while the card can still wait for the
 * person to reconnect, instead of when the send is already under way. It is
 * this connection's one refresh, so the call's own requests use its token.
 */
export async function freshAccess(conn: LiveConnection, cfg: GoogleConfig): Promise<{ ok: true } | { ok: false; failure: GoogleFailure }> {
  if (conn.status !== "active") return { ok: false, failure: "needs_reconnect" };
  const r = await refreshOnce(conn, cfg);
  return r.ok ? { ok: true } : { ok: false, failure: r.failure };
}

type Sent = { kind: "response"; res: Response } | { kind: "network" };

async function sendOnce(token: string, req: GoogleRequest): Promise<Sent> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  if (req.body !== undefined) headers["Content-Type"] = "application/json";
  if (req.ifMatch) headers["If-Match"] = req.ifMatch;
  try {
    const res = await fetch(req.url, {
      method: req.method,
      headers,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      cache: "no-store",
    });
    return { kind: "response", res };
  } catch {
    return { kind: "network" };
  }
}

/** A read tries once more after a timeout, a lost connection or a 5xx; a write never does. */
async function send(token: string, req: GoogleRequest): Promise<Sent> {
  const first = await sendOnce(token, req);
  if (req.write) return first;
  const again = first.kind === "network" || first.res.status >= 500;
  if (!again) return first;
  if (first.kind === "response") await first.res.body?.cancel().catch(() => undefined);
  await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  return sendOnce(token, req);
}

/** The reasons in Google's error body (errors[].reason, details[].reason), never its message. */
async function reasonsOf(res: Response): Promise<Set<string>> {
  const out = new Set<string>();
  const body = (await res.json().catch(() => null)) as unknown;
  const err = body && typeof body === "object" ? (body as { error?: unknown }).error : null;
  if (!err || typeof err !== "object") return out;
  const e = err as { errors?: unknown; details?: unknown; status?: unknown };
  for (const list of [e.errors, e.details]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const reason = item && typeof item === "object" ? (item as { reason?: unknown }).reason : null;
      if (typeof reason === "string") out.add(reason);
    }
  }
  if (typeof e.status === "string") out.add(e.status);
  return out;
}

function retryAfterOf(res: Response): number {
  const raw = res.headers.get("retry-after");
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 3600) : DEFAULT_RETRY_AFTER_S;
}

/**
 * One request to Google for this connection, answered as data or as one
 * named failure (see the file header):
 *   429, or 403 rateLimitExceeded / userRateLimitExceeded   rate_limited (Retry-After)
 *   403 insufficientPermissions / ACCESS_TOKEN_SCOPE_INSUFFICIENT
 *                                       scope_missing, and the connection is
 *                                       marked needs_reconnect (scopes_missing)
 *   404, 410                            not_found
 *   412                                 changed
 *   400                                 bad_request
 *   other 4xx                           forbidden
 *   5xx                                 unavailable (a write: unknown_outcome)
 */
export async function googleCall<T>(conn: LiveConnection, cfg: GoogleConfig, req: GoogleRequest): Promise<GoogleResult<T>> {
  const token = await accessFor(conn, cfg, false);
  if (!token.ok) return { ok: false, failure: token.failure };
  let sent = await send(token.accessToken, req);
  if (sent.kind === "response" && sent.res.status === 401) {
    await sent.res.body?.cancel().catch(() => undefined);
    const fresh = await accessFor(conn, cfg, true);
    if (!fresh.ok) return { ok: false, failure: fresh.failure };
    // A token this call already refreshed is not refreshed again (review of
    // step 3): the 401 stands, and is answered below.
    if (fresh.accessToken !== token.accessToken) sent = await send(fresh.accessToken, req);
  }
  if (sent.kind === "network") {
    const failure: GoogleFailure = req.write ? "unknown_outcome" : "unavailable";
    logFailure(failure, "network");
    return { ok: false, failure };
  }
  const res = sent.res;
  if (res.ok) {
    const etag = res.headers.get("etag");
    if (res.status === 204) return { ok: true, data: null as T, etag };
    const data = (await res.json().catch(() => null)) as T;
    return { ok: true, data, etag };
  }
  const status = res.status;
  let failure: GoogleFailure;
  let retryAfter: number | undefined;
  if (status === 429) {
    failure = "rate_limited";
    retryAfter = retryAfterOf(res);
    await res.body?.cancel().catch(() => undefined);
  } else if (status === 403) {
    const reasons = await reasonsOf(res);
    if (reasons.has("rateLimitExceeded") || reasons.has("userRateLimitExceeded")) {
      failure = "rate_limited";
      retryAfter = retryAfterOf(res);
    } else if (reasons.has("insufficientPermissions") || reasons.has("ACCESS_TOKEN_SCOPE_INSUFFICIENT")) {
      failure = "scope_missing";
      await markNeedsReconnect(conn, "scopes_missing");
    } else {
      failure = "forbidden";
    }
  } else {
    await res.body?.cancel().catch(() => undefined);
    if (status === 404 || status === 410) failure = "not_found";
    else if (status === 412) failure = "changed";
    else if (status === 400) failure = "bad_request";
    else if (status === 401) failure = "forbidden";
    else if (status >= 500) failure = req.write ? "unknown_outcome" : "unavailable";
    else failure = "forbidden";
  }
  logFailure(failure, status);
  return retryAfter !== undefined ? { ok: false, failure, retryAfter } : { ok: false, failure };
}
