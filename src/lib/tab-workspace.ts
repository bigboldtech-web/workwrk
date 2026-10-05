// The workspace this tab's page belongs to, sent with every upload.
//
// WHY. Every tab shares one session, and switching workspace in one tab moves
// the session for all of them. A tab left open on the workspace the person
// switched away from would file its uploads under the workspace the session
// acts in now: one company's file stored under another company's prefix, and
// lost when that other company is deleted for good (src/lib/company-files.ts).
// So each tab tells /api/upload which workspace its page belongs to, and the
// route refuses a mismatch ("Reload it to upload here").
//
// One wrapper around fetch, installed when the tab's boot payload arrives
// (src/app/(dashboard)/layout.tsx), so every upload control sends it without
// each having to: it touches only same-origin requests to the upload routes
// and only adds the x-workspace-id header.

const UPLOAD_PATHS = new Set(["/api/upload", "/api/uploads/presign"]);

let tabWorkspace: string | null = null;
let installed = false;

/** Whether a request goes to one of this app's upload routes. */
export function isUploadRequest(input: RequestInfo | URL, origin: string): boolean {
  try {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, origin);
    return url.origin === origin && UPLOAD_PATHS.has(url.pathname);
  } catch {
    return false;
  }
}

/** Remember this tab's workspace, and start sending it with uploads. */
export function setTabWorkspace(organizationId: string | null | undefined): void {
  tabWorkspace = organizationId || null;
  if (installed || typeof window === "undefined" || typeof window.fetch !== "function") return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (!tabWorkspace || !isUploadRequest(input, window.location.origin)) return original(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has("x-workspace-id")) headers.set("x-workspace-id", tabWorkspace);
    return original(input, { ...init, headers });
  };
}
