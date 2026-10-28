// The workspace this tab's page belongs to, sent with every change it makes.
//
// WHY. Every tab shares one session, and switching workspace in one tab moves
// the session for all of them. A tab left open on the workspace the person
// switched away from would write into the workspace the session acts in now:
// its uploads filed under another company's prefix (and lost when that
// company is deleted for good, src/lib/company-files.ts), and its settings
// saves landing on the other company (Identity's name and domain, the rail,
// the access matrix, the profile fields). So each tab tells the server which
// workspace its page belongs to, and the routes refuse a mismatch ("Reload it
// to make changes here"): the upload routes themselves, and the shared admin
// write gates (src/lib/access/tab-workspace-check.ts).
//
// One wrapper around fetch, installed when the tab's boot payload arrives
// (src/app/(dashboard)/layout.tsx), so no control has to send it itself: it
// touches only same-origin requests that change something (not GET or HEAD)
// to this app's /api routes, NextAuth's own excepted, and adds the
// x-workspace-id header. A page outside the dashboard (sign in, the marketing
// site, the Staff console) never installs it, so sends nothing.
//
// The strip (STALE_TAB_EVENT): an upload route answers a stale tab with a
// bare 409, so any 409 there raises it, as before. Every other route has
// 409s of its own (a name already in use, a stale edit), so only a refusal
// that says so (the x-stale-tab header) raises it there. Any accepted change
// (2xx) raises TAB_OK_EVENT, and the strip goes.

const UPLOAD_PATHS = new Set(["/api/upload", "/api/uploads/presign"]);

/** The request header naming the workspace the tab's page belongs to. */
export const TAB_WORKSPACE_HEADER = "x-workspace-id";

/** The response header a route sets when it refused this tab for showing another workspace. */
export const STALE_TAB_HEADER = "x-stale-tab";

/** Raised on window when a route refuses this tab for showing another
 *  workspace: the shell shows a strip that says so, with Reload
 *  (src/components/layout/os/os-shell.tsx), whatever the control that tried
 *  the change does with the answer. */
export const STALE_TAB_EVENT = "workwrk:stale-tab";

/** Raised when a change from this tab is accepted again, so the strip goes. */
export const TAB_OK_EVENT = "workwrk:tab-ok";

let tabWorkspace: string | null = null;
let installed = false;

function urlOf(input: RequestInfo | URL, origin: string): URL | null {
  try {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return new URL(href, origin);
  } catch {
    return null;
  }
}

/** Whether a request goes to one of this app's upload routes. */
export function isUploadRequest(input: RequestInfo | URL, origin: string): boolean {
  const url = urlOf(input, origin);
  return !!url && url.origin === origin && UPLOAD_PATHS.has(url.pathname);
}

/**
 * Whether a request changes something through this app's API, so it names
 * the tab's workspace: same origin, under /api/, not NextAuth's own routes
 * (the session plumbing acts on no workspace), and any method but GET and
 * HEAD (a read never writes into the wrong workspace).
 */
export function isWorkspaceWrite(input: RequestInfo | URL, init: RequestInit | undefined, origin: string): boolean {
  const url = urlOf(input, origin);
  if (!url || url.origin !== origin || !url.pathname.startsWith("/api/") || url.pathname.startsWith("/api/auth/")) return false;
  const fromRequest = typeof Request !== "undefined" && input instanceof Request ? input.method : undefined;
  const method = (init?.method ?? fromRequest ?? "GET").toUpperCase();
  return method !== "GET" && method !== "HEAD";
}

/**
 * Which event an answer raises (pure; tested): an upload route's 409, or any
 * route's refusal carrying the x-stale-tab header, raises the strip; an
 * accepted upload takes it away; anything else (another 409, a 400, a 5xx,
 * or a change to a route that never compares the workspace, such as a
 * presence ping) says nothing about the tab, so the strip stays until the
 * tab reloads or an upload, which always compares it, is accepted.
 */
export function tabEventFor(res: { status: number; ok: boolean; headers: Pick<Headers, "get"> }, upload: boolean): "stale" | "ok" | null {
  if (res.headers.get(STALE_TAB_HEADER) === "1") return "stale";
  if (upload && res.status === 409) return "stale";
  return upload && res.ok ? "ok" : null;
}

/**
 * Remember this tab's workspace (null forgets it), and start sending it with
 * every change. The dashboard layout names it once per mount, on its first
 * boot, and forgets it when it unmounts (src/app/(dashboard)/layout.tsx).
 */
export function setTabWorkspace(organizationId: string | null | undefined): void {
  tabWorkspace = organizationId || null;
  if (installed || typeof window === "undefined" || typeof window.fetch !== "function") return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const origin = window.location.origin;
    const upload = isUploadRequest(input, origin);
    if (!tabWorkspace || !(upload || isWorkspaceWrite(input, init, origin))) return original(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has(TAB_WORKSPACE_HEADER)) headers.set(TAB_WORKSPACE_HEADER, tabWorkspace);
    return original(input, { ...init, headers }).then((res) => {
      const event = tabEventFor(res, upload);
      if (event === "stale") window.dispatchEvent(new CustomEvent(STALE_TAB_EVENT));
      else if (event === "ok") window.dispatchEvent(new CustomEvent(TAB_OK_EVENT));
      return res;
    });
  };
}

/** For the wrapper's own test: forget the tab and the installed wrapper. */
export function resetTabWorkspaceForTest(): void {
  tabWorkspace = null;
  installed = false;
}
