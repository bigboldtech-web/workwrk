// The tab's workspace on every change it sends (final Settings review, H1):
// which requests carry x-workspace-id, and which answers raise the shell's
// "this tab shows another workspace" strip. Uploads keep their rule (any 409
// raises it); everywhere else only a refusal that says so does, since a 409
// there is usually a name already in use.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isUploadRequest, isWorkspaceWrite, resetTabWorkspaceForTest, setTabWorkspace, STALE_TAB_EVENT, tabEventFor, TAB_OK_EVENT } from "./tab-workspace";

const ORIGIN = "https://app.workwrk.com";

describe("isUploadRequest", () => {
  it("matches this app's two upload routes, however the request names them", () => {
    expect(isUploadRequest("/api/upload", ORIGIN)).toBe(true);
    expect(isUploadRequest("/api/uploads/presign", ORIGIN)).toBe(true);
    expect(isUploadRequest(`${ORIGIN}/api/upload`, ORIGIN)).toBe(true);
    expect(isUploadRequest(new URL("/api/upload", ORIGIN), ORIGIN)).toBe(true);
  });

  it("leaves every other request alone", () => {
    for (const url of ["/api/files", "/api/uploads/file-x.pdf", "/api/upload/x", "https://elsewhere.example/api/upload", "/api/uploadx"]) {
      expect(isUploadRequest(url, ORIGIN)).toBe(false);
    }
  });
});

describe("isWorkspaceWrite", () => {
  it("a change to this app's API, by any method but GET and HEAD, names the workspace", () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE", "patch"]) {
      expect(isWorkspaceWrite("/api/settings", { method }, ORIGIN), method).toBe(true);
    }
    expect(isWorkspaceWrite(`${ORIGIN}/api/org/preferences`, { method: "PATCH" }, ORIGIN)).toBe(true);
    expect(isWorkspaceWrite(new Request(`${ORIGIN}/api/permissions`, { method: "PATCH" }), undefined, ORIGIN)).toBe(true);
  });

  it("a read, another site, a page and NextAuth's own routes do not", () => {
    expect(isWorkspaceWrite("/api/settings", undefined, ORIGIN)).toBe(false);
    expect(isWorkspaceWrite("/api/settings", { method: "GET" }, ORIGIN)).toBe(false);
    expect(isWorkspaceWrite("/api/settings", { method: "HEAD" }, ORIGIN)).toBe(false);
    expect(isWorkspaceWrite(new Request(`${ORIGIN}/api/settings`), undefined, ORIGIN)).toBe(false);
    expect(isWorkspaceWrite("https://elsewhere.example/api/settings", { method: "POST" }, ORIGIN)).toBe(false);
    expect(isWorkspaceWrite("/settings/identity", { method: "POST" }, ORIGIN)).toBe(false);
    expect(isWorkspaceWrite("/apiary", { method: "POST" }, ORIGIN)).toBe(false);
    expect(isWorkspaceWrite("/api/auth/session", { method: "POST" }, ORIGIN)).toBe(false);
    expect(isWorkspaceWrite("/api/auth/signout", { method: "POST" }, ORIGIN)).toBe(false);
  });
});

describe("tabEventFor", () => {
  const res = (status: number, headers: Record<string, string> = {}) => ({ status, ok: status >= 200 && status < 300, headers: new Headers(headers) });

  it("an upload route's 409 raises the strip, as before, and its success takes it away", () => {
    expect(tabEventFor(res(409), true)).toBe("stale");
    expect(tabEventFor(res(201), true)).toBe("ok");
    expect(tabEventFor(res(400), true)).toBeNull();
  });

  it("elsewhere only a refusal marked x-stale-tab raises it: a name in use (a plain 409) never does", () => {
    expect(tabEventFor(res(409, { "x-stale-tab": "1" }), false)).toBe("stale");
    expect(tabEventFor(res(409), false)).toBeNull();
    expect(tabEventFor(res(403), false)).toBeNull();
    expect(tabEventFor(res(500), false)).toBeNull();
    // Fixes review, L3: a route that never compares the workspace (a
    // presence ping) must not hide the strip while the tab is still stale.
    expect(tabEventFor(res(200), false)).toBeNull();
    expect(tabEventFor(res(204), false)).toBeNull();
  });
});

describe("the installed wrapper", () => {
  let sent: Array<{ url: string; headers: Headers }>;
  let answer: Response;
  let events: string[];

  beforeEach(() => {
    resetTabWorkspaceForTest();
    sent = [];
    events = [];
    answer = new Response("{}", { status: 200 });
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: String(input instanceof Request ? input.url : input), headers: new Headers(init?.headers) });
      return answer;
    });
    vi.stubGlobal("window", {
      fetch,
      location: { origin: ORIGIN },
      dispatchEvent: (e: Event) => { events.push(e.type); return true; },
    });
    vi.stubGlobal("CustomEvent", class extends Event {});
  });
  afterEach(() => {
    resetTabWorkspaceForTest();
    vi.unstubAllGlobals();
  });

  it("stamps the tab's workspace on a change, never on a read, and keeps one the caller set", async () => {
    setTabWorkspace("org-a");
    await window.fetch("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" } });
    await window.fetch("/api/settings");
    await window.fetch("/api/upload", { method: "POST", headers: { "x-workspace-id": "org-b" } });
    expect(sent[0].headers.get("x-workspace-id")).toBe("org-a");
    expect(sent[0].headers.get("content-type")).toBe("application/json");
    expect(sent[1].headers.get("x-workspace-id")).toBeNull();
    expect(sent[2].headers.get("x-workspace-id")).toBe("org-b");
  });

  it("names the workspace it was last told, through one wrapper (the layout mounted again after a sign in)", async () => {
    setTabWorkspace("org-a");
    setTabWorkspace(null);
    setTabWorkspace("org-b");
    await window.fetch("/api/permissions", { method: "PATCH" });
    expect(sent).toHaveLength(1);
    expect(sent[0].headers.get("x-workspace-id")).toBe("org-b");
  });

  it("sends nothing while the tab names no workspace", async () => {
    setTabWorkspace(null);
    await window.fetch("/api/settings", { method: "PATCH" });
    expect(sent[0].headers.get("x-workspace-id")).toBeNull();
  });

  it("raises the strip on a marked refusal, says nothing on a name in use or another route's success, and takes it away on an accepted upload", async () => {
    setTabWorkspace("org-a");
    answer = new Response("{}", { status: 409, headers: { "x-stale-tab": "1" } });
    await window.fetch("/api/settings", { method: "PATCH" });
    answer = new Response("{}", { status: 409 });
    await window.fetch("/api/offices", { method: "POST" });
    answer = new Response("{}", { status: 200 });
    await window.fetch("/api/me/presence", { method: "POST" });
    await window.fetch("/api/upload", { method: "POST" });
    expect(events).toEqual([STALE_TAB_EVENT, TAB_OK_EVENT]);
  });

  it("an upload's bare 409 still raises the strip", async () => {
    setTabWorkspace("org-a");
    answer = new Response("{}", { status: 409 });
    await window.fetch("/api/upload", { method: "POST" });
    expect(events).toEqual([STALE_TAB_EVENT]);
  });
});
