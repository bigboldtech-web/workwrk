// Settings navigation: the origin rule (settings-architecture.md section 8.3).
//
//   openSettings(href)   records { returnTo, at } in sessionStorage and navigates
//   closeSettings()      returns to `returnTo` if it is not a settings route,
//                        else `lastAppPath`, else the app fallback (/today)
//
// `lastAppPath` is the last pathname outside /settings and /account, kept by
// the shell in context and mirrored to sessionStorage so a hard refresh
// inside a door or a deep link from an email still has somewhere sensible to
// go. Never `history.back()` through settings pages; never a hard-coded
// destination from settings chrome beyond the final fallback here.
//
// Pure resolution (`resolveCloseTarget`) is separate from the storage-backed
// wrappers so the vitest suite proves the rule without a DOM.

import { SETTINGS_ROUTES, WORK_HOME_HREF } from "./nav/route-hub";

export const SETTINGS_RETURN_KEY = "workwrk:settings:return";
export const LAST_APP_PATH_KEY = "workwrk:shell:last-app-path";
/** The last-resort exit. Settings chrome never names it directly. */
export const SETTINGS_FALLBACK_HREF: string = WORK_HOME_HREF;

/** A return entry older than this is stale (a tab left open overnight). */
export const SETTINGS_RETURN_TTL_MS = 12 * 60 * 60 * 1000;

export interface SettingsReturn {
  returnTo: string;
  at: number;
}

/** `/settings/*` and `/account/*` (the takeover), exactly the spec's two prefixes. */
export function isSettingsRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return SETTINGS_ROUTES.some((p) => pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(`${p}?`));
}

/** A same-origin app path: absolute, no protocol, no double slash. */
function isSafeAppPath(p: string | null | undefined): p is string {
  return typeof p === "string" && p.startsWith("/") && !p.startsWith("//") && !/^\/[a-z]+:/i.test(p);
}

export function resolveCloseTarget(input: {
  returnTo?: string | null;
  lastAppPath?: string | null;
  fallback?: string;
}): string {
  const fallback = input.fallback ?? SETTINGS_FALLBACK_HREF;
  if (isSafeAppPath(input.returnTo) && !isSettingsRoute(input.returnTo)) return input.returnTo;
  if (isSafeAppPath(input.lastAppPath) && !isSettingsRoute(input.lastAppPath)) return input.lastAppPath;
  return fallback;
}

// ── Storage-backed wrappers (browser only; every call is guarded) ──

function session(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function readSettingsReturn(now: number = Date.now()): SettingsReturn | null {
  const s = session();
  if (!s) return null;
  try {
    const raw = s.getItem(SETTINGS_RETURN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SettingsReturn;
    if (!parsed || typeof parsed.returnTo !== "string" || typeof parsed.at !== "number") return null;
    if (now - parsed.at > SETTINGS_RETURN_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeSettingsReturn(returnTo: string, at: number = Date.now()): void {
  const s = session();
  if (!s) return;
  try {
    s.setItem(SETTINGS_RETURN_KEY, JSON.stringify({ returnTo, at } satisfies SettingsReturn));
  } catch {
    // storage full or blocked: closeSettings falls back to lastAppPath
  }
}

export function clearSettingsReturn(): void {
  const s = session();
  if (!s) return;
  try {
    s.removeItem(SETTINGS_RETURN_KEY);
  } catch {
    // nothing to clear
  }
}

export function readLastAppPath(): string | null {
  const s = session();
  if (!s) return null;
  try {
    return s.getItem(LAST_APP_PATH_KEY);
  } catch {
    return null;
  }
}

/** The fragment of the current location, when there is one (fields are addressable, spec 8.4). */
function currentHash(): string {
  if (typeof window === "undefined") return "";
  const h = window.location.hash;
  return h && h !== "#" ? h : "";
}

/** The shell calls this on every pathname change; settings routes are ignored. */
export function recordLastAppPath(pathname: string | null | undefined, search: string = ""): void {
  if (!pathname || isSettingsRoute(pathname)) return;
  const s = session();
  if (!s) return;
  try {
    s.setItem(LAST_APP_PATH_KEY, `${pathname}${search}${currentHash()}`);
  } catch {
    // ignore
  }
  for (const notify of lastAppPathListeners) notify();
}

// The shell reads lastAppPath through useSyncExternalStore (readLastAppPath is
// the snapshot, null on the server), so a record above wakes every reader
// without a state write inside an effect.
const lastAppPathListeners = new Set<() => void>();

export function subscribeLastAppPath(listener: () => void): () => void {
  lastAppPathListeners.add(listener);
  return () => {
    lastAppPathListeners.delete(listener);
  };
}

export function serverLastAppPath(): string | null {
  return null;
}

/**
 * Record where the person is coming from (path, query and fragment) before
 * navigating into a door. Callers navigate with their router afterwards or
 * use `useSettingsNav().openSettings`, which does both.
 */
export function rememberSettingsOrigin(): void {
  if (typeof window === "undefined") return;
  if (isSettingsRoute(window.location.pathname)) return; // already inside: keep the original origin
  writeSettingsReturn(`${window.location.pathname}${window.location.search}${currentHash()}`);
}

/** Where "Back to app", the close button and Esc go right now. */
export function closeSettingsTarget(): string {
  return resolveCloseTarget({
    returnTo: readSettingsReturn()?.returnTo ?? null,
    lastAppPath: readLastAppPath(),
  });
}
