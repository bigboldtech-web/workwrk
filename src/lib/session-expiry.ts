// Session expiry contract (spec-shell.md section 1.10).
//
// One event, one flag, one login URL builder. `apiFetch` and the SSE client
// dispatch `workwrk:session-expired` on a 401 once GET /api/auth/session
// confirms the session is gone (api-fetch.ts sessionGoneAfter401; a 401 from
// a person still signed in is an ordinary failure); the shell mounts one
// SessionExpiredDialog that listens for it; every poller that goes through
// `apiFetch` stops on its own because the flag short-circuits the fetch.
//
// Pure where it can be: the URL builder, the draft keys and the flag are
// plain functions so the vitest suite (node, no DOM) can prove them. The two
// browser-only helpers guard `window` themselves.

export const SESSION_EXPIRED_EVENT = "workwrk:session-expired";
export const OFFLINE_EVENT = "workwrk:offline";
export const ONLINE_EVENT = "workwrk:online";
export const IDLE_WARNING_EVENT = "workwrk:session-idle-warning";

/** Why the session ended. `revoked` = every session of the account ended
 *  (Log out everywhere, a password change, an admin's action, Sign everyone
 *  out), never a plain log out in another browser, which ends only that
 *  browser's session; `expired` = idle or absolute lifetime; `unknown` = no
 *  further detail (a session logged out in this browser included). */
export type SessionExpiryReason = "expired" | "revoked" | "unknown";

export interface SessionExpiredDetail {
  reason: SessionExpiryReason;
  /** The request that surfaced the 401, for diagnostics. */
  source?: string;
}

export interface IdleWarningDetail {
  /** ISO timestamp the session lapses at. */
  idleUntil: string;
}

/** Two minutes before `idleUntil` the shell warns (spec 1.10 rule 4). */
export const IDLE_WARNING_LEAD_MS = 2 * 60 * 1000;

/**
 * The one URL whose GET re-issues the session cookie (NextAuth's session
 * route). Every other route reads the session without a response object in
 * the App Router and cannot roll it forward.
 */
export const SESSION_RENEW_URL = "/api/auth/session";

let expired = false;

/** True once a confirmed log out (a 401 the session route confirmed) has been seen this page load. */
export function isSessionExpired(): boolean {
  return expired;
}

/** Test seam and the "signed in again" reset. */
export function resetSessionExpired(): void {
  expired = false;
}

/**
 * Flag the session as gone and tell the shell, once. Repeat calls are
 * no-ops so twenty pollers failing at once produce one dialog.
 */
export function markSessionExpired(detail: SessionExpiredDetail = { reason: "unknown" }): boolean {
  if (expired) return false;
  expired = true;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<SessionExpiredDetail>(SESSION_EXPIRED_EVENT, { detail }));
  }
  return true;
}

/**
 * `/login?callbackUrl=<pathname+search>`. The login page already honours
 * `callbackUrl` (src/app/(auth)/login/page.tsx), so preserving it is the
 * whole fix for "redirect drops where you were". Auth routes and non-app
 * paths never become a callback: a loop through /login is worse than a
 * landing on the default.
 */
export function loginUrlFor(pathname: string, search: string = "", hash: string = ""): string {
  const path = pathname && pathname.startsWith("/") ? pathname : "/";
  if (path === "/" || path.startsWith("/login") || path.startsWith("/register") || path.startsWith("/signup") || path.startsWith("/join") || path.startsWith("/verify-email") || path.startsWith("/reset-password") || path.startsWith("/forgot-password")) {
    return "/login";
  }
  const query = search && search.startsWith("?") ? search : search ? `?${search}` : "";
  // The fragment is part of the address (settings spec 8.4 makes fields
  // addressable), so it rides along inside the encoded callback.
  const fragment = hash && hash.startsWith("#") ? hash : hash ? `#${hash}` : "";
  return `/login?callbackUrl=${encodeURIComponent(`${path}${query}${fragment}`)}`;
}

/** The login URL plus the reason /login reads: a real revocation (every session ended) adds "You were logged out on every device." */
export function loginHrefFor(base: string, reason: SessionExpiryReason): string {
  if (reason !== "revoked") return base;
  return `${base}${base.includes("?") ? "&" : "?"}reason=revoked`;
}

/** The current location's login URL, or bare /login outside a browser. */
export function currentLoginUrl(): string {
  if (typeof window === "undefined") return "/login";
  return loginUrlFor(window.location.pathname, window.location.search, window.location.hash);
}

// ── Draft preservation (spec 1.10 rule 3) ─────────────────────────

const DRAFT_PREFIX = "workwrk:draft:";

/** `workwrk:draft:{kind}:{id}` */
export function draftKey(kind: string, id: string): string {
  return `${DRAFT_PREFIX}${kind}:${id}`;
}

/**
 * The server version the draft was taken from: `updatedAt`, a revision
 * counter, an etag, whatever the document's API exposes. The restore UI
 * compares it with the version it loads (`isDraftStale`) so a draft never
 * silently overwrites a newer save from another device or collaborator.
 */
export type DraftBaseVersion = string | number;

export interface StoredDraft<T = unknown> {
  savedAt: string;
  value: T;
  /** Absent when the editor did not know its base version. */
  baseVersion?: DraftBaseVersion | null;
}

/** Minimal Storage surface so tests can pass a Map-backed stand-in. */
export interface DraftStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface DraftIo {
  /** Defaults to localStorage; a test passes a Map-backed stand-in. */
  store?: DraftStore | null;
}

function defaultStore(): DraftStore | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function storeOf(io: DraftIo | undefined): DraftStore | null {
  return io && "store" in io ? (io.store ?? null) : defaultStore();
}

/** Write a draft; returns false when storage is unavailable or full. */
export function saveDraft<T>(
  kind: string,
  id: string,
  value: T,
  opts: DraftIo & { baseVersion?: DraftBaseVersion | null; now?: () => Date } = {},
): boolean {
  const store = storeOf(opts);
  if (!store) return false;
  try {
    const entry: StoredDraft<T> = { savedAt: (opts.now ?? (() => new Date()))().toISOString(), value };
    if (opts.baseVersion !== undefined) entry.baseVersion = opts.baseVersion;
    store.setItem(draftKey(kind, id), JSON.stringify(entry));
    return true;
  } catch {
    return false;
  }
}

export function readDraft<T>(kind: string, id: string, opts: DraftIo = {}): StoredDraft<T> | null {
  const store = storeOf(opts);
  if (!store) return null;
  try {
    const raw = store.getItem(draftKey(kind, id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft<T>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.savedAt !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearDraft(kind: string, id: string, opts: DraftIo = {}): void {
  const store = storeOf(opts);
  if (!store) return;
  try {
    store.removeItem(draftKey(kind, id));
  } catch {
    // storage unavailable: nothing to clear
  }
}

/**
 * True when the document has moved on since the draft was taken, so the
 * restore UI must ask before overwriting. Unknown on either side is NOT
 * stale: a draft with no base version is offered as before, and the editor
 * decides. `Date` versions compare by value.
 */
export function isDraftStale(draft: Pick<StoredDraft, "baseVersion"> | null | undefined, current: DraftBaseVersion | Date | null | undefined): boolean {
  if (!draft || draft.baseVersion === undefined || draft.baseVersion === null) return false;
  if (current === undefined || current === null) return false;
  const cur = current instanceof Date ? current.toISOString() : current;
  const base = draft.baseVersion;
  if (typeof cur === "string" && typeof base === "string") {
    const a = Date.parse(cur);
    const b = Date.parse(base);
    if (!Number.isNaN(a) && !Number.isNaN(b)) return a !== b;
  }
  return String(cur) !== String(base);
}

// ── Idle warning (spec 1.10 rule 4) ───────────────────────────────

/**
 * How long until the warning should fire for a given `idleUntil`, or null
 * when there is no timeout, it is unparseable, or it is already past.
 */
export function idleWarningDelayMs(idleUntil: string | null | undefined, now: number = Date.now()): number | null {
  if (!idleUntil) return null;
  const at = Date.parse(idleUntil);
  if (Number.isNaN(at)) return null;
  const fireAt = at - IDLE_WARNING_LEAD_MS;
  if (at <= now) return null;
  return Math.max(0, fireAt - now);
}

/**
 * The longest single wait the idle warning hands setTimeout. A delay over
 * 2,147,483,647 ms (about 24.8 days) overflows and fires AT ONCE in every
 * browser, and a 30 day session puts the warning past that, so a longer wait
 * is taken a day at a time, each step measured again from the clock (which
 * also keeps it right after a laptop sleeps).
 */
export const IDLE_TIMER_STEP_MS = 24 * 60 * 60 * 1000;

/**
 * Arm the idle warning for `idleUntil`. Re-arming replaces the previous
 * timer, so every `/api/boot` or SSE `session.idle` refresh pushes it out.
 * Returns a disarm function.
 */
let idleTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleIdleWarning(idleUntil: string | null | undefined): () => void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (typeof window === "undefined") return () => {};
  const arm = () => {
    const delay = idleWarningDelayMs(idleUntil);
    if (delay === null) {
      idleTimer = null;
      return;
    }
    if (delay > IDLE_TIMER_STEP_MS) {
      idleTimer = setTimeout(arm, IDLE_TIMER_STEP_MS);
      return;
    }
    idleTimer = setTimeout(() => {
      idleTimer = null;
      window.dispatchEvent(new CustomEvent<IdleWarningDetail>(IDLE_WARNING_EVENT, { detail: { idleUntil: idleUntil as string } }));
    }, delay);
  };
  arm();
  return () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };
}

/**
 * Did a quiet renewal move the session's end later? The idle warning re-arms
 * only then. A renewal that cannot move it (the session's lifetime caps it)
 * would otherwise arm a warning that fires at once, renew again, and ask the
 * session route in a loop. Pure; tested.
 */
export function renewalMovedExpiry(before: string | null | undefined, after: string | null | undefined): boolean {
  if (!after) return false;
  const next = Date.parse(after);
  if (Number.isNaN(next)) return false;
  if (!before) return true;
  const prev = Date.parse(before);
  return Number.isNaN(prev) || next > prev;
}

// ── A failed session read is not a log out (2026-10-22) ───────────

/** The localStorage key next-auth's tabs tell each other about the session on (next-auth/client/_utils.js BroadcastChannel). */
export const NEXTAUTH_MESSAGE_KEY = "nextauth.message";

/**
 * Ask next-auth's SessionProvider in THIS tab to read the session again.
 * One failed GET /api/auth/session (offline as a laptop wakes, a 502 during
 * a deploy's reload) leaves the provider holding no session, and it then
 * skips every focus refetch for good, so the app read a network blip as a
 * log out. The provider also listens for the storage message other tabs post
 * when their session changes, and a tab never hears its own, so this hands
 * it one (useConfirmedSignOut calls it once the session route answered with
 * a user). Tested against next-auth's own listener.
 */
export function resyncSessionState(now: () => number = Date.now): void {
  if (typeof window === "undefined") return;
  try {
    const init = { key: NEXTAUTH_MESSAGE_KEY, newValue: JSON.stringify({ event: "session", data: { trigger: "getSession" }, timestamp: Math.floor(now() / 1000) }) };
    const ev = typeof StorageEvent === "function" ? new StorageEvent("storage", init) : Object.assign(new Event("storage"), init);
    window.dispatchEvent(ev);
  } catch {
    // no window events here: nothing to resync
  }
}
