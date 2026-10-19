// The driver's guard (src/lib/browser/cdp-driver.ts, Decisions 10, 14, 16
// and 20) over a fake CDP connection: the guard is in place before the tab
// runs, every main-frame Document request is asked of the verdict (a
// refused hop aborted, the page left where it was), frames get the frame
// verdict, a new tab is closed while held, dialogs are dismissed, a page from
// a private address is closed, and an act sends no input until the element
// was found, checked and hit-tested; a connection lost after input answers
// unknown_outcome.

import { describe, expect, it, vi } from "vitest";
import { CdpClosed, CdpTimeout, type Cdp } from "./cdp";
import { attachBrowser, recordedEventsFrom, type GuardHooks } from "./cdp-driver";
import { RECORDER_BINDING_PREFIX, RECORDER_CALL, RECORDER_SOURCE, RECORDER_WORLD, recorderBinding } from "./page-recorder";
import type { SiteVerdict } from "./sites";
import { fingerprintOf, sealFingerprint, sealWords } from "./snapshot";
import type { ElementFingerprint } from "./types";

type Sent = { method: string; params: Record<string, unknown>; sessionId?: string };
type Responder = (method: string, params: Record<string, unknown>, sessionId: string | undefined, fake: FakeCdp) => unknown;

class FakeCdp implements Cdp {
  sent: Sent[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handlers = new Map<string, Array<(p: any, s?: string) => void>>();
  private closers: Array<() => void> = [];
  closed = false;
  /** A method whose send throws CdpClosed (and closes the connection), once. */
  dropOn: string | null = null;
  constructor(private respond: Responder) {}
  async send<T>(method: string, params: object = {}, sessionId?: string): Promise<T> {
    if (this.closed) throw new CdpClosed(method);
    this.sent.push({ method, params: params as Record<string, unknown>, sessionId });
    if (this.dropOn === method) {
      this.dropOn = null;
      await this.close();
      throw new CdpClosed(method);
    }
    return (await this.respond(method, params as Record<string, unknown>, sessionId, this)) as T;
  }
  on(event: string, fn: (p: unknown, s?: string) => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]);
  }
  emit(event: string, params: Record<string, unknown>, sessionId?: string) {
    for (const fn of this.handlers.get(event) ?? []) fn(params, sessionId);
  }
  onClose(fn: () => void) {
    if (this.closed) fn();
    else this.closers.push(fn);
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const fn of this.closers.splice(0)) fn();
  }
  methods(): string[] {
    return this.sent.map((s) => s.method);
  }
}

/** A reader stand-in: what Runtime.callFunctionOn answers per mode. */
type Reader = (mode: string, arg: Record<string, unknown>) => unknown;

const ELEMENTS = [
  { i: 0, tag: "input", role: "textbox", name: "Email", type: "email", autocomplete: "email", inputmode: null, nameAttr: "email", idAttr: "email", label: "Email", maxLength: null, codeBoxes: null, formAction: "http://login.proof.test/session", href: null, editable: false, disabled: false, filled: true, anchor: "e0e0e0e0" },
  { i: 1, tag: "input", role: "textbox", name: "Password", type: "password", autocomplete: "current-password", inputmode: null, nameAttr: "pw", idAttr: "pw", label: "Password", maxLength: null, codeBoxes: null, formAction: "http://login.proof.test/session", href: null, editable: false, disabled: false, filled: false, anchor: "e0e0e0e0" },
  { i: 2, tag: "button", role: "button", name: "Sign in", type: null, autocomplete: null, inputmode: null, nameAttr: null, idAttr: null, label: null, maxLength: null, codeBoxes: null, formAction: "http://login.proof.test/session", href: null, editable: false, disabled: false, filled: false, anchor: "f0f0f0f0" },
  { i: 3, tag: "button", role: "button", name: "Sign in", type: null, autocomplete: null, inputmode: null, nameAttr: null, idAttr: null, label: null, maxLength: null, codeBoxes: null, formAction: "http://login.proof.test/session", href: null, editable: false, disabled: false, filled: false, anchor: "f1f1f1f1" },
];

function readerFor(over: Partial<Record<string, Reader>> = {}): Reader {
  return (mode, arg) => {
    if (over[mode]) return over[mode]!(mode, arg);
    if (mode === "read") return { url: "http://login.proof.test/", title: "Sign in", contentType: "text/html", blocks: ["Welcome"], elements: ELEMENTS, links: [] };
    if (mode === "locate") return { ok: true, x: 100, y: 200 };
    if (mode === "focus") return { ok: true };
    if (mode === "find") return { matches: [{ text: "Sign in here", near: 2 }] };
    if (mode === "scroll") return { ok: true, atEnd: true };
    return { ok: false, code: "not_found" };
  };
}

function fakeBrowser(o: { reader?: Reader; navigate?: Responder; extra?: Responder } = {}): FakeCdp {
  const reader = o.reader ?? readerFor();
  return new FakeCdp((method, params, sessionId, fake) => {
    const extra = o.extra?.(method, params, sessionId, fake);
    if (extra !== undefined) return extra;
    switch (method) {
      case "Target.getTargets":
        return { targetInfos: [{ targetId: "TAB", type: "page", url: "about:blank", attached: false }] };
      case "Target.attachToTarget":
        return { sessionId: "S1" };
      case "Page.getFrameTree":
        return { frameTree: { frame: { id: "TAB", url: "about:blank" } } };
      case "Page.createIsolatedWorld":
        return { executionContextId: 7 };
      case "Runtime.callFunctionOn": {
        const args = params.arguments as Array<{ value: unknown }>;
        return { result: { value: reader(String(args[0].value), args[1].value as Record<string, unknown>) } };
      }
      case "Page.navigate":
        return o.navigate ? o.navigate(method, params, sessionId, fake) : { frameId: "TAB", loaderId: "L1" };
      case "Page.captureScreenshot":
        return { data: Buffer.from([0xff, 0xd8, 0xff]).toString("base64") };
      default:
        return {};
    }
  });
}

/** Hooks with the verdict: anything under refused.proof.test or blocked.proof.test is refused. */
function hooks(): GuardHooks & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = { verdict: [], refused: [], lost: [], dialog: [], download: [], upload: [], popup: [] };
  return {
    calls,
    verdict: (url: string, main: boolean): SiteVerdict | { ok: true; frame: true } => {
      calls.verdict.push([url, main]);
      const u = new URL(url);
      // As sites.ts siteVerdict: only web addresses.
      if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, code: "not_https", site: null };
      const host = u.hostname;
      if (host.endsWith("blocked.proof.test") || host.endsWith("exfil.proof.test")) return { ok: false, code: "not_allowed", site: host };
      return main ? { ok: true, site: host } : { ok: true, frame: true };
    },
    onRefused: (h, c, main) => calls.refused.push([h, c, main]),
    onLost: () => calls.lost.push([]),
    onDialog: (t) => calls.dialog.push([t]),
    onDownload: () => calls.download.push([]),
    onUpload: () => calls.upload.push([]),
    onPopup: (u) => calls.popup.push([u]),
  };
}

async function attached(fake: FakeCdp, h = hooks()) {
  const handle = await attachBrowser("wss://connect.example/secret", h, { fixtureSuffix: ".proof.test", connect: async () => fake, navTimeoutMs: 200, settleMaxMs: 300 });
  return { handle, h };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("attachBrowser: the guard before the tab runs", () => {
  it("denies downloads and permissions, and pauses every Document request before the tab is let run", async () => {
    const fake = fakeBrowser();
    await attached(fake);
    const m = fake.methods();
    expect(fake.sent.find((s) => s.method === "Browser.setDownloadBehavior")?.params).toEqual({ behavior: "deny", eventsEnabled: true });
    expect(m.indexOf("Browser.setDownloadBehavior")).toBeLessThan(m.indexOf("Target.attachToTarget"));
    const denied = fake.sent.filter((s) => s.method === "Browser.setPermission").map((s) => s.params);
    expect(denied).toContainEqual({ permission: { name: "geolocation" }, setting: "denied" });
    expect(denied).toContainEqual({ permission: { name: "camera" }, setting: "denied" });
    expect(denied.every((p) => p.setting === "denied")).toBe(true);
    const fetchAt = fake.sent.findIndex((s) => s.method === "Fetch.enable" && s.sessionId === "S1");
    const runAt = fake.sent.findIndex((s) => s.method === "Runtime.runIfWaitingForDebugger" && s.sessionId === "S1");
    expect(fetchAt).toBeGreaterThan(-1);
    expect(fetchAt).toBeLessThan(runAt);
    expect(fake.sent[fetchAt].params).toEqual({ patterns: [{ urlPattern: "*", resourceType: "Document", requestStage: "Request" }] });
    // New targets are held before they load, on the browser and under the tab.
    const auto = fake.sent.filter((s) => s.method === "Target.setAutoAttach");
    expect(auto.map((a) => a.sessionId)).toEqual([undefined, "S1"]);
    expect(auto.every((a) => a.params.waitForDebuggerOnStart === true && a.params.flatten === true)).toBe(true);
    expect(fake.sent.some((s) => s.method === "Page.setInterceptFileChooserDialog" && s.params.enabled === true)).toBe(true);
  });

  it("bypasses every service worker on the tab before it runs (review of Phase 4 step 2)", async () => {
    const fake = fakeBrowser();
    await attached(fake);
    const bypassAt = fake.sent.findIndex((s) => s.method === "Network.setBypassServiceWorker" && s.sessionId === "S1");
    const runAt = fake.sent.findIndex((s) => s.method === "Runtime.runIfWaitingForDebugger" && s.sessionId === "S1");
    expect(bypassAt).toBeGreaterThan(-1);
    expect(fake.sent[bypassAt].params).toEqual({ bypass: true });
    expect(bypassAt).toBeLessThan(runAt);
  });

  it("closes every other tab the browser already had", async () => {
    const fake = fakeBrowser({
      extra: (method) => (method === "Target.getTargets" ? { targetInfos: [{ targetId: "TAB", type: "page" }, { targetId: "OTHER", type: "page" }] } : undefined),
    });
    await attached(fake);
    expect(fake.sent).toContainEqual({ method: "Target.closeTarget", params: { targetId: "OTHER" }, sessionId: undefined });
  });

  it("closes the connection and gives no handle when the guard cannot be set", async () => {
    const fake = fakeBrowser({ extra: (method) => (method === "Fetch.enable" ? Promise.reject(new Error("no Fetch")) : undefined) });
    await expect(attached(fake)).rejects.toThrow();
    expect(fake.closed).toBe(true);
  });
});

describe("the guard", () => {
  it("aborts a refused main-frame request, so the page stays, and lets an allowed one go", async () => {
    const fake = fakeBrowser();
    const { h } = await attached(fake);
    fake.emit("Fetch.requestPaused", { requestId: "r1", request: { url: "http://blocked.proof.test/" }, frameId: "TAB", resourceType: "Document", redirectedRequestId: "r0" }, "S1");
    fake.emit("Fetch.requestPaused", { requestId: "r2", request: { url: "http://docs.proof.test/guide" }, frameId: "TAB", resourceType: "Document" }, "S1");
    await tick();
    expect(fake.sent).toContainEqual({ method: "Fetch.failRequest", params: { requestId: "r1", errorReason: "Aborted" }, sessionId: "S1" });
    expect(fake.sent).toContainEqual({ method: "Fetch.continueRequest", params: { requestId: "r2" }, sessionId: "S1" });
    expect(h.calls.refused).toEqual([["blocked.proof.test", "not_allowed", true]]);
    expect(h.calls.verdict).toEqual([
      ["http://blocked.proof.test/", true],
      ["http://docs.proof.test/guide", true],
    ]);
  });

  it("asks only the frame verdict for another frame, and blocks a refused frame request", async () => {
    const fake = fakeBrowser();
    const { h } = await attached(fake);
    fake.emit("Fetch.requestPaused", { requestId: "f1", request: { url: "http://exfil.proof.test/frame" }, frameId: "CHILD", resourceType: "Document" }, "S1");
    fake.emit("Fetch.requestPaused", { requestId: "f2", request: { url: "http://ads.example.net/frame" }, frameId: "CHILD", resourceType: "Document" }, "S1");
    await tick();
    expect(h.calls.verdict).toEqual([
      ["http://exfil.proof.test/frame", false],
      ["http://ads.example.net/frame", false],
    ]);
    expect(fake.sent).toContainEqual({ method: "Fetch.failRequest", params: { requestId: "f1", errorReason: "BlockedByClient" }, sessionId: "S1" });
    expect(fake.sent).toContainEqual({ method: "Fetch.continueRequest", params: { requestId: "f2" }, sessionId: "S1" });
  });

  it("refuses when the verdict itself throws", async () => {
    const fake = fakeBrowser();
    const h = hooks();
    h.verdict = () => {
      throw new Error("rules unreadable");
    };
    await attached(fake, h);
    fake.emit("Fetch.requestPaused", { requestId: "r9", request: { url: "http://docs.proof.test/" }, frameId: "TAB", resourceType: "Document" }, "S1");
    await tick();
    expect(fake.sent).toContainEqual({ method: "Fetch.failRequest", params: { requestId: "r9", errorReason: "Aborted" }, sessionId: "S1" });
  });

  it("guards a frame of another site in its own process too", async () => {
    const fake = fakeBrowser();
    await attached(fake);
    fake.emit("Target.attachedToTarget", { sessionId: "F1", targetInfo: { targetId: "CHILD", type: "iframe", url: "" }, waitingForDebugger: true }, "S1");
    await tick();
    await tick();
    const f = fake.sent.filter((s) => s.sessionId === "F1").map((s) => s.method);
    expect(f.indexOf("Fetch.enable")).toBeGreaterThan(-1);
    expect(f.indexOf("Fetch.enable")).toBeLessThan(f.indexOf("Runtime.runIfWaitingForDebugger"));
  });

  it("closes a new tab once every request of its is refused, never letting it load, and tells it once", async () => {
    const fake = fakeBrowser();
    const { h } = await attached(fake);
    fake.emit("Target.targetCreated", { targetInfo: { targetId: "POP", type: "page", url: "http://exfil.proof.test/p", attached: false } });
    fake.emit("Target.attachedToTarget", { sessionId: "P1", targetInfo: { targetId: "POP", type: "page", url: "http://exfil.proof.test/p" }, waitingForDebugger: true });
    await tick();
    await tick();
    await tick();
    const p1 = fake.sent.filter((s) => s.sessionId === "P1").map((s) => s.method);
    // Its guard first, then it runs (a held popup of the same site froze the tab), then it closes.
    expect(p1).toEqual(["Fetch.enable", "Runtime.runIfWaitingForDebugger"]);
    expect(fake.sent.findIndex((s) => s.method === "Target.closeTarget" && s.params.targetId === "POP")).toBeGreaterThan(fake.sent.findIndex((s) => s.sessionId === "P1" && s.method === "Runtime.runIfWaitingForDebugger"));
    // Whatever it asks for is refused without asking the verdict.
    fake.emit("Fetch.requestPaused", { requestId: "pp1", request: { url: "http://exfil.proof.test/p" }, frameId: "POP", resourceType: "Document" }, "P1");
    await tick();
    expect(fake.sent).toContainEqual({ method: "Fetch.failRequest", params: { requestId: "pp1", errorReason: "BlockedByClient" }, sessionId: "P1" });
    expect(h.calls.verdict.some(([u]) => u === "http://exfil.proof.test/p")).toBe(false);
    expect(h.calls.popup).toEqual([["http://exfil.proof.test/p"]]);
    // The late check of a created page closes nothing twice and tells nothing twice.
    await new Promise((r) => setTimeout(r, 1100));
    expect(fake.sent.filter((s) => s.method === "Target.closeTarget" && s.params.targetId === "POP")).toHaveLength(1);
    expect(h.calls.popup).toHaveLength(1);
  });

  it("closes a page auto-attach missed, a moment after it appears", async () => {
    const fake = fakeBrowser();
    const { h } = await attached(fake);
    fake.emit("Target.targetCreated", { targetInfo: { targetId: "STRAY", type: "page", url: "http://exfil.proof.test/s", attached: false } });
    await new Promise((r) => setTimeout(r, 1100));
    expect(fake.sent.filter((s) => s.method === "Target.closeTarget" && s.params.targetId === "STRAY")).toHaveLength(1);
    expect(h.calls.popup).toEqual([["http://exfil.proof.test/s"]]);
  });

  it("dismisses dialogs, accepting only a leave-this-page one, and tells of uploads and downloads", async () => {
    const fake = fakeBrowser();
    const { h } = await attached(fake);
    fake.emit("Page.javascriptDialogOpening", { type: "confirm", message: "Delete everything?" }, "S1");
    fake.emit("Page.javascriptDialogOpening", { type: "beforeunload", message: "" }, "S1");
    fake.emit("Page.fileChooserOpened", { mode: "selectSingle" }, "S1");
    fake.emit("Browser.downloadWillBegin", { url: "http://docs.proof.test/file.pdf" });
    await tick();
    const answers = fake.sent.filter((s) => s.method === "Page.handleJavaScriptDialog").map((s) => s.params.accept);
    expect(answers).toEqual([false, true]);
    expect(h.calls.dialog).toEqual([["confirm"], ["beforeunload"]]);
    expect(h.calls.upload).toHaveLength(1);
    expect(h.calls.download).toHaveLength(1);
  });

  describe("the commit check (review of Phase 4 step 2)", () => {
    const blanks = (fake: FakeCdp) => fake.sent.filter((s) => s.method === "Page.navigate" && s.params.url === "about:blank" && s.sessionId === "S1").length;
    const readerCalls = (fake: FakeCdp) => fake.sent.filter((s) => s.method === "Runtime.callFunctionOn").length;
    const signIn: ElementFingerprint = { tag: "button", role: "button", name: "Sign in", kind: "none", type: null, formHost: "login.proof.test", href: null, twin: 0, twins: 2, anchor: "f0f0f0f0", at: 2 };

    it("holds and blanks a refused host that committed with no request paused, a back/forward cache restore", async () => {
      const fake = fakeBrowser();
      const { handle, h } = await attached(fake);
      fake.emit("Page.frameNavigated", { frame: { id: "TAB", loaderId: "L9", url: "http://blocked.proof.test/", securityOrigin: "http://blocked.proof.test" }, type: "BackForwardCacheRestore" }, "S1");
      await tick();
      expect(fake.sent.some((s) => s.method === "Page.stopLoading" && s.sessionId === "S1")).toBe(true);
      expect(blanks(fake)).toBe(1);
      expect(h.calls.refused).toEqual([["blocked.proof.test", "not_allowed", true]]);
      // Nothing of it is read, found, pictured or acted on while it closes: the reader never runs.
      expect(await handle.snapshot()).toMatchObject({ url: "about:blank", blocks: [], elements: [], links: [] });
      expect(await handle.find("anything")).toEqual({ matches: [] });
      await expect(handle.screenshot({})).rejects.toThrow();
      expect(await handle.click(signIn)).toEqual({ ok: false, code: "changed" });
      expect(readerCalls(fake)).toBe(0);
      expect(fake.sent.some((s) => s.method.startsWith("Input."))).toBe(false);
      // about:blank in its place: reading again.
      fake.emit("Page.frameNavigated", { frame: { id: "TAB", loaderId: "L10", url: "about:blank" } }, "S1");
      expect((await handle.snapshot()).blocks).toEqual(["Welcome"]);
    });

    it("leaves a page the verdict allows, and answers a refused commit during an open as blocked_hop", async () => {
      const fake = fakeBrowser({
        navigate: (_m, p, _s, f) => {
          if (p.url === "about:blank") return { frameId: "TAB" };
          // A worker of the allowed site answered with a page of a refused one: no request was paused.
          f.emit("Page.frameNavigated", { frame: { id: "TAB", loaderId: "L2", url: "http://exfil.proof.test/served" } }, "S1");
          return { frameId: "TAB", loaderId: "L2" };
        },
      });
      const { handle, h } = await attached(fake);
      fake.emit("Page.frameNavigated", { frame: { id: "TAB", loaderId: "L1", url: "http://docs.proof.test/" } }, "S1");
      expect(blanks(fake)).toBe(0);
      expect(await handle.navigate("http://docs.proof.test/sw")).toEqual({ ok: false, code: "blocked_hop", host: "exfil.proof.test" });
      expect(blanks(fake)).toBe(1);
      expect(h.calls.refused).toEqual([["exfil.proof.test", "not_allowed", true]]);
    });

    it("replaces Chrome's own error page quietly, telling no refusal", async () => {
      const fake = fakeBrowser();
      const { h } = await attached(fake);
      fake.emit("Page.frameNavigated", { frame: { id: "TAB", loaderId: "L3", url: "chrome-error://chromewebdata/", unreachableUrl: "https://nowhere.example.com/" } }, "S1");
      await tick();
      expect(blanks(fake)).toBe(1);
      expect(h.calls.refused).toEqual([]);
    });

    it("never commits again a host a private address served, from the back/forward cache or loaded again", async () => {
      const fake = fakeBrowser({
        navigate: (_m, p, _s, f) => {
          if (p.url === "about:blank") return { frameId: "TAB" };
          f.emit("Network.responseReceived", { type: "Document", frameId: "TAB", loaderId: "LP", response: { url: "https://rebind.example.com/", mimeType: "text/html", remoteIPAddress: "10.0.0.5" } }, "S1");
          f.emit("Page.frameNavigated", { frame: { id: "TAB", loaderId: "LP", url: "https://rebind.example.com/" } }, "S1");
          return { frameId: "TAB", loaderId: "LP" };
        },
      });
      const h = hooks();
      h.verdict = (url, main) => (main ? { ok: true, site: new URL(url).hostname } : { ok: true, frame: true });
      const { handle } = await attached(fake, h);
      expect(await handle.navigate("https://rebind.example.com/")).toMatchObject({ ok: false, code: "private_address" });
      // Its own commit is told once, at its response.
      expect(h.calls.refused).toEqual([["rebind.example.com", "private_address", true]]);
      fake.emit("Page.frameNavigated", { frame: { id: "TAB", loaderId: "LB", url: "about:blank" } }, "S1");
      expect((await handle.snapshot()).blocks).toEqual(["Welcome"]);
      // Back from the back/forward cache: no response, the verdict allows the host, and it is held again.
      fake.emit("Page.frameNavigated", { frame: { id: "TAB", loaderId: "LP", url: "https://rebind.example.com/" }, type: "BackForwardCacheRestore" }, "S1");
      expect((await handle.snapshot()).blocks).toEqual([]);
      expect(h.calls.refused).toHaveLength(2);
    });

    it("blanks the page on request, held until about:blank is in its place", async () => {
      const fake = fakeBrowser();
      const { handle } = await attached(fake);
      await handle.blank();
      expect(blanks(fake)).toBe(1);
      expect((await handle.snapshot()).blocks).toEqual([]);
      expect(readerCalls(fake)).toBe(0);
      fake.emit("Page.frameNavigated", { frame: { id: "TAB", loaderId: "L4", url: "about:blank" } }, "S1");
      expect((await handle.snapshot()).blocks).toEqual(["Welcome"]);
    });
  });

  it("tells of a lost connection once", async () => {
    const fake = fakeBrowser();
    const { handle, h } = await attached(fake);
    await fake.close();
    fake.emit("Target.targetDestroyed", { targetId: "TAB" });
    expect(h.calls.lost).toHaveLength(1);
    await expect(handle.snapshot()).rejects.toThrow(/gone/);
    expect(await handle.navigate("http://docs.proof.test/")).toEqual({ ok: false, code: "lost" });
  });
});

describe("navigate", () => {
  /** A navigation that answers with these events first. */
  function navigating(events: (fake: FakeCdp) => void, answer: Record<string, unknown> = { frameId: "TAB", loaderId: "L1" }): Responder {
    return (_m, p, _s, fake) => {
      // Closing a page puts about:blank in its place, which answers no document.
      if (p.url === "about:blank") return { frameId: "TAB" };
      events(fake);
      return answer;
    };
  }

  it("stops at a refused redirect hop and says which host, the request never continued", async () => {
    const fake = fakeBrowser({
      navigate: navigating((f) => f.emit("Fetch.requestPaused", { requestId: "h2", request: { url: "http://blocked.proof.test/" }, frameId: "TAB", resourceType: "Document", redirectedRequestId: "h1" }, "S1"), { frameId: "TAB", errorText: "net::ERR_ABORTED" }),
    });
    const { handle } = await attached(fake);
    expect(await handle.navigate("http://docs.proof.test/redirect-blocked")).toEqual({ ok: false, code: "blocked_hop", host: "blocked.proof.test" });
    expect(fake.sent.some((s) => s.method === "Fetch.continueRequest" && s.params.requestId === "h2")).toBe(false);
  });

  it("refuses an address the verdict refuses before anything is sent", async () => {
    const fake = fakeBrowser();
    const { handle } = await attached(fake);
    expect(await handle.navigate("http://exfil.proof.test/?d=notes")).toEqual({ ok: false, code: "blocked_hop", host: "exfil.proof.test" });
    expect(fake.methods()).not.toContain("Page.navigate");
  });

  it("opens an allowed page and answers its site", async () => {
    const fake = fakeBrowser({
      navigate: navigating((f) => {
        f.emit("Network.responseReceived", { type: "Document", frameId: "TAB", response: { url: "http://docs.proof.test/", mimeType: "text/html", remoteIPAddress: "127.0.0.1" } }, "S1");
        f.emit("Page.frameNavigated", { frame: { id: "TAB", url: "http://docs.proof.test/" } }, "S1");
        setTimeout(() => f.emit("Page.loadEventFired", {}, "S1"), 5);
      }),
    });
    const { handle } = await attached(fake);
    expect(await handle.navigate("http://docs.proof.test/")).toEqual({ ok: true, url: "http://docs.proof.test/", site: "docs.proof.test" });
    expect(handle.currentUrl()).toBe("http://docs.proof.test/");
  });

  it("closes a page served from a private address before it is read", async () => {
    const fake = fakeBrowser({
      navigate: navigating((f) => {
        f.emit("Network.responseReceived", { type: "Document", frameId: "TAB", response: { url: "https://rebind.example.com/", mimeType: "text/html", remoteIPAddress: "169.254.169.254" } }, "S1");
      }),
    });
    const h = hooks();
    h.verdict = (url, main) => (main ? { ok: true, site: new URL(url).hostname } : { ok: true, frame: true });
    const { handle } = await attached(fake, h);
    expect(await handle.navigate("https://rebind.example.com/")).toEqual({ ok: false, code: "private_address", host: "rebind.example.com" });
    await tick();
    expect(fake.methods()).toContain("Page.stopLoading");
    expect(fake.sent.some((s) => s.method === "Page.navigate" && s.params.url === "about:blank")).toBe(true);
    // Nothing of it is read while it closes.
    expect((await handle.snapshot()).blocks).toEqual([]);
  });

  it("closes a main-frame page whose response names no address, outside the fixture sites (review of Phase 4 step 2)", async () => {
    const noAddress = (host: string) =>
      fakeBrowser({
        navigate: navigating((f) => {
          f.emit("Network.responseReceived", { type: "Document", frameId: "TAB", loaderId: "L1", response: { url: `https://${host}/`, mimeType: "text/html" } }, "S1");
          f.emit("Page.frameNavigated", { frame: { id: "TAB", loaderId: "L1", url: `https://${host}/` } }, "S1");
          setTimeout(() => f.emit("Page.loadEventFired", {}, "S1"), 5);
        }),
      });
    const h = hooks();
    h.verdict = (url, main) => (main ? { ok: true, site: new URL(url).hostname } : { ok: true, frame: true });
    const held = noAddress("news.example.com");
    const a = await attached(held, h);
    expect(await a.handle.navigate("https://news.example.com/")).toEqual({ ok: false, code: "private_address", host: "news.example.com" });
    expect(held.sent.some((s) => s.method === "Page.navigate" && s.params.url === "about:blank")).toBe(true);
    expect((await a.handle.snapshot()).blocks).toEqual([]);
    // The stand-in's fixture sites keep their allowance.
    const fixture = noAddress("docs.proof.test");
    const b = await attached(fixture);
    expect(await b.handle.navigate("https://docs.proof.test/")).toEqual({ ok: true, url: "https://docs.proof.test/", site: "docs.proof.test" });
    expect(fixture.sent.some((s) => s.method === "Page.navigate" && s.params.url === "about:blank")).toBe(false);
  });

  it("reads a document that is not a web page as not_html, and a failed load as unreachable", async () => {
    const pdf = fakeBrowser({
      navigate: navigating((f) => {
        f.emit("Network.responseReceived", { type: "Document", frameId: "TAB", response: { url: "http://docs.proof.test/pdf", mimeType: "application/pdf", remoteIPAddress: "127.0.0.1" } }, "S1");
        f.emit("Page.frameNavigated", { frame: { id: "TAB", url: "http://docs.proof.test/pdf" } }, "S1");
        setTimeout(() => f.emit("Page.loadEventFired", {}, "S1"), 5);
      }),
    });
    expect(await (await attached(pdf)).handle.navigate("http://docs.proof.test/pdf")).toMatchObject({ ok: false, code: "not_html" });
    const down = fakeBrowser({ navigate: navigating(() => {}, { frameId: "TAB", errorText: "net::ERR_NAME_NOT_RESOLVED" }) });
    expect(await (await attached(down)).handle.navigate("https://nowhere.example.com/")).toMatchObject({ ok: false, code: "unreachable" });
  });
});

describe("reading", () => {
  it("gives each control its kind and twin, and keeps the reader's hints and values to itself", async () => {
    const fake = fakeBrowser();
    const { handle } = await attached(fake);
    const snap = await handle.snapshot();
    expect(snap.elements.map((e) => [e.name, e.kind, e.twin, e.formHost])).toEqual([
      ["Email", "email", 0, "login.proof.test"],
      ["Password", "password", 0, "login.proof.test"],
      ["Sign in", "none", 0, "login.proof.test"],
      ["Sign in", "none", 1, "login.proof.test"],
    ]);
    // Which twin (review of Phase 4 step 3): how many, its anchor and its place.
    expect(snap.elements.map((e) => [e.twins, e.anchor, e.at])).toEqual([
      [1, "e0e0e0e0", 0],
      [1, "e0e0e0e0", 1],
      [2, "f0f0f0f0", 2],
      [2, "f1f1f1f1", 3],
    ]);
    const json = JSON.stringify(snap);
    for (const hint of ["autocomplete", "nameAttr", "idAttr", "inputmode", "readerIndex", "current-password"]) expect(json).not.toContain(hint);
    // The reader runs in its own world, its arguments passed by value.
    const call = fake.sent.find((s) => s.method === "Runtime.callFunctionOn");
    expect(call?.params.executionContextId).toBe(7);
    expect(fake.sent.find((s) => s.method === "Page.createIsolatedWorld")?.params).toMatchObject({ frameId: "TAB", worldName: "wk-reader" });
  });

  // docs/plans/ai-teammates-phase5.md Decision 18 (page-reader.ts mayAct).
  it("keeps the reader's mark on a link listed because it may act beside its fingerprint, never in its twin key", async () => {
    const approve = { i: 4, tag: "a", role: "link", name: "Approve", type: null, autocomplete: null, inputmode: null, nameAttr: null, idAttr: null, label: null, maxLength: null, codeBoxes: null, formAction: null, href: "http://login.proof.test/approve?id=5", editable: false, disabled: false, filled: false, anchor: "a4a4a4a4", followable: true };
    const fake = fakeBrowser({ reader: readerFor({ read: () => ({ url: "http://login.proof.test/", title: "Sign in", contentType: "text/html", blocks: [], elements: [...ELEMENTS, approve], links: [{ text: "Approve", href: approve.href }] }) }) });
    const { handle } = await attached(fake);
    const els = (await handle.snapshot()).elements;
    // Before: the mark was dropped, so the server could not tell the link from a control.
    expect(els.map((e) => e.followable === true)).toEqual([false, false, false, false, true]);
    expect(els[4]).toMatchObject({ tag: "a", role: "link", name: "Approve", kind: "none", href: approve.href, twin: 0, twins: 1, at: 4 });
    expect(fingerprintOf(els[4])).not.toHaveProperty("followable");
  });

  it("finds words with the nearest control's fingerprint", async () => {
    const { handle } = await attached(fakeBrowser());
    expect(await handle.find("sign in")).toEqual({
      matches: [{ text: "Sign in here", near: { tag: "button", role: "button", name: "Sign in", kind: "none", type: null, formHost: "login.proof.test", href: null, twin: 0, twins: 2, anchor: "f0f0f0f0", at: 2 } }],
    });
  });
});

describe("acting", () => {
  const signIn = (twin: number): ElementFingerprint => ({ tag: "button", role: "button", name: "Sign in", kind: "none", type: null, formHost: "login.proof.test", href: null, twin, twins: 2, anchor: twin === 0 ? "f0f0f0f0" : "f1f1f1f1", at: 2 + twin });
  const password: ElementFingerprint = { tag: "input", role: "textbox", name: "Password", kind: "password", type: "password", formHost: "login.proof.test", href: null, twin: 0, twins: 1, anchor: "e0e0e0e0", at: 1 };
  const inputs = (fake: FakeCdp) => fake.sent.filter((s) => s.method.startsWith("Input."));

  it("clicks the second of two twins at its centre", async () => {
    const located: unknown[] = [];
    const fake = fakeBrowser({ reader: readerFor({ locate: (_m, arg) => (located.push(arg), { ok: true, x: 40, y: 50 }) }) });
    const { handle } = await attached(fake);
    expect(await handle.click(signIn(1))).toMatchObject({ ok: true, settled: true });
    expect(located).toEqual([{ i: 3, tag: "button", name: "Sign in", anchor: "f1f1f1f1" }]);
    expect(inputs(fake).map((s) => s.params.type)).toEqual(["mouseMoved", "mousePressed", "mouseReleased"]);
    expect(inputs(fake)[1].params).toMatchObject({ x: 40, y: 50, button: "left", clickCount: 1 });
  });

  // Review round 1 of Phase 4: a card may keep its target sealed (snapshot.ts sealFingerprint).
  it("finds a sealed target by sealing the fresh read's name and link the same way, and nothing for other words", async () => {
    const located: unknown[] = [];
    const fake = fakeBrowser({ reader: readerFor({ locate: (_m, arg) => (located.push(arg), { ok: true, x: 40, y: 50 }) }) });
    const { handle } = await attached(fake);
    const sealed = sealFingerprint(signIn(1));
    expect(sealed).not.toHaveProperty("name");
    // Before: a sealed target has no name or link to compare, so it was never found.
    expect(await handle.click(sealed as never)).toMatchObject({ ok: true, settled: true });
    expect(located).toEqual([{ i: 3, tag: "button", name: "Sign in", anchor: "f1f1f1f1" }]);
    expect(await handle.click({ ...sealed, nameHash: sealWords("Place order") } as never)).toEqual({ ok: false, code: "not_found" });
    expect(await handle.click({ ...sealed, hrefHash: sealWords("http://login.proof.test/") } as never)).toEqual({ ok: false, code: "not_found" });
    expect(await handle.click({ ...sealed, twins: 3 } as never)).toEqual({ ok: false, code: "changed" });
    // A plain one is found as before.
    expect(await handle.click(signIn(0))).toMatchObject({ ok: true });
  });

  // Review round 2 of Phase 4: the anchor sealed too (snapshot.ts sealFingerprint anchorHash).
  it("finds a sealed target by sealing the fresh read's anchor, hands the reader its plain anchor, and refuses a changed one", async () => {
    const located: unknown[] = [];
    const fake = fakeBrowser({ reader: readerFor({ locate: (_m, arg) => (located.push(arg), { ok: true, x: 40, y: 50 }) }) });
    const { handle } = await attached(fake);
    const sealed = sealFingerprint(signIn(1));
    // Before: the card kept the reader's own 8 hex digits.
    expect(sealed).not.toHaveProperty("anchor");
    expect(sealed.anchorHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sealed.anchorHash).not.toBe("f1f1f1f1");
    expect(await handle.click(sealed as never)).toMatchObject({ ok: true, settled: true });
    // The reader's own check in the page gets the fresh read's plain anchor (placeArg).
    expect(located).toEqual([{ i: 3, tag: "button", name: "Sign in", anchor: "f1f1f1f1" }]);
    // Another anchor sealed, or the reader's plain hash where the seal belongs: changed, nothing located.
    expect(await handle.click({ ...sealed, anchorHash: sealWords("f0f0f0f0") } as never)).toEqual({ ok: false, code: "changed" });
    expect(await handle.click({ ...sealed, anchorHash: "f1f1f1f1" } as never)).toEqual({ ok: false, code: "changed" });
    expect(located).toHaveLength(1);
    // The row's words changed in the page: changed, and nothing sent.
    const moved = fakeBrowser({ reader: readerFor({ read: () => ({ url: "http://login.proof.test/", title: "Sign in", contentType: "text/html", blocks: [], elements: [ELEMENTS[0], ELEMENTS[1], ELEMENTS[2], { ...ELEMENTS[3], anchor: "abababab" }], links: [] }) }) });
    expect(await (await attached(moved)).handle.click(sealed as never)).toEqual({ ok: false, code: "changed" });
    expect(inputs(moved)).toEqual([]);
  });

  it("sends nothing for a sensitive field, an element gone, fewer twins, or one covered", async () => {
    const fake = fakeBrowser({ reader: readerFor({ locate: () => ({ ok: false, code: "covered" }) }) });
    const { handle } = await attached(fake);
    expect(await handle.type(password, "hunter2", false)).toEqual({ ok: false, code: "sensitive" });
    // Read as sensitive now even when the card's fingerprint said otherwise.
    expect(await handle.type(password, "x", false)).toEqual({ ok: false, code: "sensitive" });
    expect(await handle.click({ ...signIn(0), name: "Place order" })).toEqual({ ok: false, code: "not_found" });
    expect(await handle.click({ ...signIn(2), twins: 3 })).toEqual({ ok: false, code: "changed" });
    expect(await handle.click(signIn(0))).toEqual({ ok: false, code: "covered" });
    expect(inputs(fake)).toEqual([]);
  });

  it("answers unknown_outcome when the connection goes after the press was sent, and lost_before when it went first", async () => {
    const late = fakeBrowser();
    const a = await attached(late);
    late.dropOn = "Input.dispatchMouseEvent";
    // The move is the first send: dropped there, nothing was pressed.
    expect(await a.handle.click(signIn(0))).toEqual({ ok: false, code: "lost_before" });

    const later = fakeBrowser();
    const b = await attached(later);
    let n = 0;
    const real = later.send.bind(later);
    vi.spyOn(later, "send").mockImplementation(async (method: string, params?: object, sessionId?: string) => {
      if (method === "Input.dispatchMouseEvent" && ++n === 2) {
        await later.close();
        throw new CdpClosed(method);
      }
      return real(method, params, sessionId);
    });
    expect(await b.handle.click(signIn(0))).toEqual({ ok: false, code: "unknown_outcome" });
  });

  it("types after focusing, with Enter as a key press, and answers a refused hop as blocked_hop", async () => {
    const fake = fakeBrowser({
      extra: (method, params, _s, f) => {
        if (method === "Input.dispatchKeyEvent" && params.type === "keyDown") {
          f.emit("Fetch.requestPaused", { requestId: "k1", request: { url: "http://exfil.proof.test/collect" }, frameId: "TAB", resourceType: "Document" }, "S1");
          return {};
        }
        return undefined;
      },
    });
    const { handle } = await attached(fake);
    const email: ElementFingerprint = { tag: "input", role: "textbox", name: "Email", kind: "email", type: "email", formHost: "login.proof.test", href: null, twin: 0, twins: 1, anchor: "e0e0e0e0", at: 0 };
    expect(await handle.type(email, "max@proof.test", true)).toEqual({ ok: false, code: "blocked_hop", host: "exfil.proof.test" });
    expect(inputs(fake).map((s) => [s.method, s.params.type ?? s.params.text])).toEqual([
      ["Input.insertText", "max@proof.test"],
      ["Input.dispatchKeyEvent", "keyDown"],
      ["Input.dispatchKeyEvent", "keyUp"],
    ]);
  });
});

// Review of Phase 4 step 3.
describe("which twin, the document, once, replacing and the whole list", () => {
  const signIn = (twin: number): ElementFingerprint => ({ tag: "button", role: "button", name: "Sign in", kind: "none", type: null, formHost: "login.proof.test", href: null, twin, twins: 2, anchor: twin === 0 ? "f0f0f0f0" : "f1f1f1f1", at: 2 + twin });
  const inputs = (fake: FakeCdp) => fake.sent.filter((s) => s.method.startsWith("Input."));
  const readerSends = (fake: FakeCdp, mode: string) => fake.sent.filter((s) => s.method === "Runtime.callFunctionOn" && (s.params.arguments as Array<{ value: unknown }>)[0].value === mode);
  const country: ElementFingerprint = { tag: "select", role: "combobox", name: "Country", kind: "select", type: null, formHost: "login.proof.test", href: null, twin: 0, twins: 1, anchor: "c0c0c0c0", at: 4 };
  const withList = [...ELEMENTS, { i: 4, tag: "select", role: "combobox", name: "Country", type: null, autocomplete: null, inputmode: null, nameAttr: "country", idAttr: "country", label: "Country", maxLength: null, codeBoxes: null, formAction: "http://login.proof.test/session", href: null, editable: false, disabled: false, filled: false, anchor: "c0c0c0c0", options: ["Andorra"], optionCount: 250 }];
  const listPage = (over: Partial<Record<string, Reader>> = {}) =>
    readerFor({ read: () => ({ url: "http://login.proof.test/", title: "Sign in", contentType: "text/html", blocks: [], elements: withList, links: [] }), ...over });

  it("answers changed for a new twin inserted above the card's, and clicks nothing", async () => {
    // The card's twin was the first "Sign in" (index 2); a new one now sits above it.
    const newcomer = { ...ELEMENTS[2], anchor: "abababab" };
    const moved = [ELEMENTS[0], ELEMENTS[1], newcomer, { ...ELEMENTS[2], i: 3 }, { ...ELEMENTS[3], i: 4 }];
    const fake = fakeBrowser({ reader: readerFor({ read: () => ({ url: "http://login.proof.test/", title: "Sign in", contentType: "text/html", blocks: [], elements: moved, links: [] }) }) });
    const { handle } = await attached(fake);
    expect(await handle.click(signIn(0))).toEqual({ ok: false, code: "changed" });
    // The same count with another anchor at the index, or the same anchor at another place, is changed too.
    const swapped = fakeBrowser({ reader: readerFor({ read: () => ({ url: "http://login.proof.test/", title: "Sign in", contentType: "text/html", blocks: [], elements: [ELEMENTS[0], ELEMENTS[1], ELEMENTS[3], ELEMENTS[2]].map((e, i) => ({ ...e, i })), links: [] }) }) });
    expect(await (await attached(swapped)).handle.click(signIn(0))).toEqual({ ok: false, code: "changed" });
    expect(inputs(fake)).toEqual([]);
    expect(inputs(swapped)).toEqual([]);
    expect(readerSends(fake, "locate")).toEqual([]);
  });

  it("carries a control's other words beside its fingerprint, never in it or its twin key (review round 1 of Phase 4)", async () => {
    // Before: readerElement dropped alsoNamed, so a relabelled Buy button warned nothing.
    const relabelled = [ELEMENTS[0], ELEMENTS[1], { ...ELEMENTS[2], alsoNamed: "Buy now for 480 dollars" }, ELEMENTS[3]];
    const fake = fakeBrowser({ reader: readerFor({ read: () => ({ url: "http://login.proof.test/", title: "Sign in", contentType: "text/html", blocks: [], elements: relabelled, links: [] }) }) });
    const { handle } = await attached(fake);
    const els = (await handle.snapshot()).elements;
    expect((els[2] as { alsoNamed?: string }).alsoNamed).toBe("Buy now for 480 dollars");
    expect("alsoNamed" in els[3]).toBe(false);
    // The two Sign in buttons are still twins of each other: the other words are not part of the key.
    expect(els[2].twins).toBe(2);
    expect(els[3].twins).toBe(2);
    expect(fingerprintOf(els[2])).not.toHaveProperty("alsoNamed");
  });

  it("passes the anchor back to the reader, which checks it again in the page", async () => {
    const located: unknown[] = [];
    const fake = fakeBrowser({ reader: readerFor({ locate: (_m, arg) => (located.push(arg), { ok: true, x: 1, y: 1 }) }) });
    const { handle } = await attached(fake);
    await handle.click(signIn(0));
    expect(located).toEqual([{ i: 2, tag: "button", name: "Sign in", anchor: "f0f0f0f0" }]);
  });

  it("changes the document id with every commit and every move within a document, and not otherwise", async () => {
    const fake = fakeBrowser();
    const { handle } = await attached(fake);
    const first = handle.documentId();
    expect(handle.documentId()).toBe(first);
    fake.emit("Page.frameNavigated", { frame: { id: "TAB", loaderId: "L1", url: "http://shop.proof.test/checkout" } }, "S1");
    const second = handle.documentId();
    expect(second).not.toBe(first);
    fake.emit("Page.navigatedWithinDocument", { frameId: "TAB", url: "http://shop.proof.test/checkout#pay" }, "S1");
    const third = handle.documentId();
    expect(third).not.toBe(second);
    // A frame's commit is not the tab's document.
    fake.emit("Page.frameNavigated", { frame: { id: "CHILD", parentId: "TAB", loaderId: "L9", url: "http://ads.proof.test/frame" } }, "S1");
    expect(handle.documentId()).toBe(third);
    // Another browser's ids never equal this one's.
    expect((await attached(fakeBrowser())).handle.documentId()).not.toBe(first);
  });

  it("sends a choice once: one that timed out is unknown_outcome, never sent again in a new world", async () => {
    let selects = 0;
    const fake = fakeBrowser({
      reader: listPage(),
      extra: (method, params) => {
        if (method === "Runtime.callFunctionOn" && (params.arguments as Array<{ value: unknown }>)[0].value === "select") {
          selects += 1;
          return Promise.reject(new CdpTimeout(method));
        }
        return undefined;
      },
    });
    const { handle } = await attached(fake);
    expect(await handle.select(country, { index: 249, label: "Zimbabwe" })).toEqual({ ok: false, code: "unknown_outcome" });
    // Before: the reader tried it again in a new world, so a choice could be made twice.
    expect(selects).toBe(1);
  });

  it("locates and focuses once too, a failure after the call left being unknown_outcome", async () => {
    const fail = (mode: string) =>
      fakeBrowser({
        extra: (method, params) => (method === "Runtime.callFunctionOn" && (params.arguments as Array<{ value: unknown }>)[0].value === mode ? Promise.reject(new CdpTimeout(method)) : undefined),
      });
    const click = fail("locate");
    expect(await (await attached(click)).handle.click(signIn(0))).toEqual({ ok: false, code: "unknown_outcome" });
    expect(readerSends(click, "locate")).toHaveLength(1);
    const email: ElementFingerprint = { tag: "input", role: "textbox", name: "Email", kind: "email", type: "email", formHost: "login.proof.test", href: null, twin: 0, twins: 1, anchor: "e0e0e0e0", at: 0 };
    const typing = fail("focus");
    expect(await (await attached(typing)).handle.type(email, "max@proof.test", false)).toEqual({ ok: false, code: "unknown_outcome" });
    expect(readerSends(typing, "focus")).toHaveLength(1);
    expect(inputs(typing)).toEqual([]);
  });

  it("asks the reader to replace what a field holds before typing", async () => {
    const focused: Array<Record<string, unknown>> = [];
    const fake = fakeBrowser({ reader: readerFor({ focus: (_m, arg) => (focused.push(arg), { ok: true }) }) });
    const { handle } = await attached(fake);
    const email: ElementFingerprint = { tag: "input", role: "textbox", name: "Email", kind: "email", type: "email", formHost: "login.proof.test", href: null, twin: 0, twins: 1, anchor: "e0e0e0e0", at: 0 };
    expect(await handle.type(email, "max@proof.test", false)).toMatchObject({ ok: true });
    expect(focused).toEqual([{ i: 0, tag: "input", name: "Email", anchor: "e0e0e0e0", replace: true }]);
  });

  it("reads a list's options for matching, at most 1,000, with how many it has, and chooses by index and label", async () => {
    const asked: Array<[string, Record<string, unknown>]> = [];
    const fake = fakeBrowser({
      reader: listPage({
        options: (m, arg) => (asked.push([m, arg]), { ok: true, options: Array.from({ length: 1200 }, (_, k) => ({ label: `Country ${k + 1}`, disabled: k === 3 })), total: 1200 }),
        select: (m, arg) => (asked.push([m, arg]), { ok: true }),
        locate: () => ({ ok: true, x: 1, y: 1 }),
      }),
    });
    const { handle } = await attached(fake);
    const listed = await handle.options(country);
    expect(listed.ok && listed.options).toHaveLength(1000);
    expect(listed).toMatchObject({ ok: true, total: 1200 });
    expect(listed.ok && listed.options[3]).toEqual({ label: "Country 4", disabled: true });
    expect(await handle.select(country, { index: 249, label: "Country 250" })).toMatchObject({ ok: true });
    expect(asked).toEqual([
      ["options", { i: 4, tag: "select", name: "Country", anchor: "c0c0c0c0" }],
      ["select", { i: 4, tag: "select", name: "Country", anchor: "c0c0c0c0", index: 249, label: "Country 250" }],
    ]);
    // A list whose place changed reads nothing.
    expect(await handle.options({ ...country, at: 9 })).toEqual({ ok: false, code: "changed" });
  });
});

// Phase 5 step 2 (docs/plans/ai-teammates-phase5.md): the recorder's world,
// its binding and its queue, with the Runtime domain never enabled.
describe("the recorder (Phase 5 step 2)", () => {
  type Rec = { installed: string | null; events: unknown[] };
  /** A browser whose recorder worlds answer by context: each one's installation and queue, and which contexts were bound. */
  function recordingBrowser(
    o: {
      installedAt?: (ctx: number) => string | null;
      addBindingFails?: boolean;
      drainHangs?: boolean;
      worldFails?: boolean;
      startFails?: boolean;
      stopFails?: boolean;
      moreAtStop?: boolean;
      /** The stop's first command held until this settles (Chrome holding a page's commands while a slow page loads, M1). */
      holdStop?: Promise<void>;
    } = {},
  ) {
    let nextCtx = 20;
    const worlds = new Map<number, Rec>();
    const bound: number[] = [];
    const fake = fakeBrowser({
      extra: (method, params) => {
        if (method === "Page.createIsolatedWorld" && params.worldName === RECORDER_WORLD) {
          if (o.worldFails) return Promise.reject(new Error("no world"));
          nextCtx += 1;
          worlds.set(nextCtx, { installed: o.installedAt ? o.installedAt(nextCtx) : "new_document", events: [] });
          return { executionContextId: nextCtx };
        }
        if (method === "Page.addScriptToEvaluateOnNewDocument") return { identifier: "script-1" };
        if (method === "Page.removeScriptToEvaluateOnNewDocument" && o.holdStop) return o.holdStop.then(() => ({}));
        if (method === "Runtime.addBinding") {
          if (o.addBindingFails) return Promise.reject(new Error("no binding"));
          bound.push(Number(params.executionContextId));
          return {};
        }
        if (method === "Runtime.callFunctionOn" && params.functionDeclaration === RECORDER_CALL) {
          const op = (params.arguments as Array<{ value: unknown }>)[0].value;
          const w = worlds.get(Number(params.executionContextId));
          if (!w) return Promise.reject(new Error("Cannot find context with specified id"));
          if (op === "drain" && o.drainHangs) return new Promise(() => undefined);
          if (op === "start" && o.startFails) return Promise.reject(new Error("Cannot find context with specified id"));
          if (op === "stop" && o.stopFails) return Promise.reject(new Error("Cannot find context with specified id"));
          const how = w.installed ?? "late";
          if (op === "drain" || op === "ensure" || op === "stop") {
            const events = w.events.splice(0);
            return { result: { value: { installed: how, events, more: op === "stop" && o.moreAtStop === true, lost: false } } };
          }
          return { result: { value: { installed: how } } };
        }
        return undefined;
      },
    });
    return { fake, worlds, bound };
  }
  const control = { tag: "button", role: "button", name: "Submit expense", type: null, formHost: "expenses.proof.test", formKey: 0, group: null, choice: false, opener: false, inRow: null, inNav: false, suggestion: false, wordsChanged: false, href: null, hints: { tag: "button" }, formFields: [] };
  const click = (page: string) => ({ type: "click", control, at: 1, page });
  /** The last recording's start: its token and its binding's name, as the driver gave them to the page. */
  const lastStart = (fake: FakeCdp) => {
    const starts = fake.sent.filter((s) => s.method === "Runtime.callFunctionOn" && s.params.functionDeclaration === RECORDER_CALL && (s.params.arguments as Array<{ value: unknown }>)[0].value === "start");
    const args = (starts[starts.length - 1]?.params.arguments ?? []) as Array<{ value: unknown }>;
    return { token: args[1]?.value as string, binding: args[2]?.value as string };
  };
  const tokenOf = (fake: FakeCdp) => lastStart(fake).token;
  const bindingOf = (fake: FakeCdp) => lastStart(fake).binding;
  /** A binding call of the recording now on, unless a name is given. */
  const binding = (fake: FakeCdp, payload: unknown, name = bindingOf(fake)) => ({ name, payload: JSON.stringify(payload), executionContextId: 21 });

  it("puts the recorder into every new document in its own world, starts it in the open one through a binding of that world alone, and never enables Runtime", async () => {
    const { fake, bound } = recordingBrowser();
    const { handle } = await attached(fake);
    await handle.watch(true);
    const add = fake.sent.find((s) => s.method === "Page.addScriptToEvaluateOnNewDocument");
    expect(add?.params).toMatchObject({ source: RECORDER_SOURCE, worldName: "wk-recorder", runImmediately: true });
    const world = fake.sent.find((s) => s.method === "Page.createIsolatedWorld" && s.params.worldName === "wk-recorder");
    expect(world?.params).toEqual({ frameId: "TAB", worldName: "wk-recorder", grantUniveralAccess: false });
    // The binding by the world's own context id, never by name (which needs Runtime.enable) and never the page's, named by this recording's token.
    expect(fake.sent.filter((s) => s.method === "Runtime.addBinding").map((s) => s.params)).toEqual([{ name: recorderBinding(tokenOf(fake)), executionContextId: 21 }]);
    expect(bindingOf(fake)).toBe(recorderBinding(tokenOf(fake)));
    expect(bindingOf(fake).startsWith(RECORDER_BINDING_PREFIX)).toBe(true);
    expect(bound).toEqual([21]);
    const start = fake.sent.find((s) => s.method === "Runtime.callFunctionOn" && s.params.functionDeclaration === RECORDER_CALL);
    expect(start?.params).toMatchObject({ executionContextId: 21, returnByValue: true });
    expect((start?.params.arguments as Array<{ value: unknown }>)[0].value).toBe("start");
    expect(typeof tokenOf(fake)).toBe("string");
    expect(fake.methods()).not.toContain("Runtime.enable");
  });

  it("keeps the events a binding sends as they happen, a click that navigates included, and holds no request for them", async () => {
    const { fake } = recordingBrowser();
    const { handle } = await attached(fake);
    await handle.watch(true);
    const token = tokenOf(fake);
    // The click's binding call comes before the navigation it causes (the self-test's order).
    fake.emit("Runtime.bindingCalled", binding(fake, { t: token, e: click("http://expenses.proof.test/new") }), "S1");
    fake.emit("Fetch.requestPaused", { requestId: "r9", request: { url: "http://expenses.proof.test/submit" }, frameId: "TAB", resourceType: "Document" }, "S1");
    await tick();
    // Continued at once: nothing is drained at the pause (Chrome holds every command back until the commit).
    expect(fake.sent.filter((s) => s.method === "Fetch.continueRequest" && s.params.requestId === "r9")).toHaveLength(1);
    const drainsBefore = fake.sent.filter((s) => s.method === "Runtime.callFunctionOn" && (s.params.arguments as Array<{ value: unknown }>)[0].value === "drain").length;
    expect(drainsBefore).toBe(0);
    const out = await handle.drainEvents();
    expect(out.events.map((e) => [e.type, e.control?.name])).toEqual([["click", "Submit expense"]]);
    // Another recording's, another binding's, or a page's own words: never kept.
    fake.emit("Runtime.bindingCalled", binding(fake, { t: "another-token", e: click("http://expenses.proof.test/new") }), "S1");
    fake.emit("Runtime.bindingCalled", { name: "somethingElse", payload: JSON.stringify({ t: token, e: click("http://x.test/") }), executionContextId: 21 }, "S1");
    // Another recording's binding name, this one's token: not this recording's binding.
    fake.emit("Runtime.bindingCalled", binding(fake, { t: token, e: click("http://x.test/") }, recorderBinding("another-token")), "S1");
    fake.emit("Runtime.bindingCalled", { name: bindingOf(fake), payload: "not json", executionContextId: 21 }, "S1");
    expect((await handle.drainEvents()).events).toEqual([]);
  });

  it("finds the next document's recorder at its commit, binds it and takes its queue; a late install or no binding is a gap, and so is a page change from a document that had no binding", async () => {
    const { fake, worlds } = recordingBrowser({ installedAt: (ctx) => (ctx === 23 ? "late" : "new_document") });
    const { handle } = await attached(fake);
    await handle.watch(true);
    fake.emit("Page.frameNavigated", { frame: { id: "TAB", loaderId: "L2", url: "http://expenses.proof.test/new" }, type: "Navigation" }, "S1");
    await tick();
    await tick();
    expect(fake.sent.filter((s) => s.method === "Page.createIsolatedWorld" && s.params.worldName === "wk-recorder").map((s) => s.params.frameId)).toEqual(["TAB", "TAB"]);
    expect(fake.sent.filter((s) => s.method === "Runtime.addBinding").map((s) => s.params.executionContextId)).toEqual([21, 22]);
    let out = await handle.drainEvents();
    expect(out.events).toEqual([]);
    expect(out.pages.map((p) => p.url)).toEqual(["http://expenses.proof.test/new"]);
    // A world the new-document script was not in: installed late, a gap at that page.
    worlds.set(23, { installed: "late", events: [] });
    fake.emit("Page.frameNavigated", { frame: { id: "TAB", loaderId: "L3", url: "http://expenses.proof.test/reports" }, type: "Navigation" }, "S1");
    await tick();
    await tick();
    out = await handle.drainEvents();
    expect(out.events.map((e) => [e.type, e.page])).toEqual([["gap", "http://expenses.proof.test/reports"]]);
    // A move within a document keeps the document's recorder: no new world.
    const worldsBefore = fake.sent.filter((s) => s.method === "Page.createIsolatedWorld" && s.params.worldName === "wk-recorder").length;
    fake.emit("Page.navigatedWithinDocument", { frameId: "TAB", url: "http://expenses.proof.test/reports#week" }, "S1");
    await tick();
    expect(fake.sent.filter((s) => s.method === "Page.createIsolatedWorld" && s.params.worldName === "wk-recorder")).toHaveLength(worldsBefore);
  });

  it("adds no gap for a page change through about:blank or Chrome's error page, where nothing is recorded", async () => {
    const { fake } = recordingBrowser();
    const { handle } = await attached(fake);
    await handle.watch(true);
    fake.emit("Page.frameNavigated", { frame: { id: "TAB", loaderId: "L2", url: "about:blank" } }, "S1");
    fake.emit("Page.frameNavigated", { frame: { id: "TAB", loaderId: "L3", url: "chrome-error://chromewebdata/", unreachableUrl: "http://nowhere.proof.test/" } }, "S1");
    fake.emit("Page.frameNavigated", { frame: { id: "TAB", loaderId: "L4", url: "http://expenses.proof.test/new" }, type: "Navigation" }, "S1");
    await tick();
    await tick();
    const out = await handle.drainEvents();
    expect(out.events).toEqual([]);
    expect(out.pages.map((p) => p.url)).toEqual(["http://expenses.proof.test/new"]);
  });

  it("drains a document whose binding could not be added, and marks its page change as a gap", async () => {
    const { fake, worlds } = recordingBrowser({ addBindingFails: true });
    const { handle } = await attached(fake);
    await handle.watch(true);
    // No binding: the recorder is started without the token, and its queue is read by the poll.
    expect((fake.sent.find((s) => s.method === "Runtime.callFunctionOn" && s.params.functionDeclaration === RECORDER_CALL)?.params.arguments as Array<{ value: unknown }>)[1].value).toBeNull();
    worlds.get(21)!.events.push(click("http://expenses.proof.test/"));
    expect((await handle.drainEvents()).events.map((e) => e.type)).toEqual(["click"]);
    fake.emit("Page.frameNavigated", { frame: { id: "TAB", loaderId: "L2", url: "http://expenses.proof.test/new" }, type: "Navigation" }, "S1");
    await tick();
    await tick();
    // Its last events may have gone with it, said as a gap; the next document, unbound too, another.
    expect((await handle.drainEvents()).events.map((e) => [e.type, e.page])).toEqual([
      ["gap", "http://expenses.proof.test/new"],
    ]);
  });

  it("drains only the known context in the poll, never making a world, and answers nothing when that fails", async () => {
    const { fake } = recordingBrowser({ drainHangs: false });
    const { handle } = await attached(fake);
    await handle.watch(true);
    const worlds = () => fake.sent.filter((s) => s.method === "Page.createIsolatedWorld" && s.params.worldName === "wk-recorder").length;
    const before = worlds();
    fake.emit("Page.frameNavigated", { frame: { id: "TAB", loaderId: "L2", url: "http://expenses.proof.test/new" }, type: "Navigation" }, "S1");
    // The poll before the new document's world is known: no world made for it, no events.
    expect((await handle.drainEvents()).events).toEqual([]);
    expect(worlds()).toBe(before + 1);
    await tick();
    await tick();
    // A context gone under the poll (Cannot find context): no events this tick, and no new world either.
    fake.emit("Page.frameNavigated", { frame: { id: "TAB", loaderId: "L3", url: "about:blank" } }, "S1");
    expect((await handle.drainEvents()).events).toEqual([]);
    expect(worlds()).toBe(before + 1);
  });

  it("removes the script and the binding's notices and stops the recorder at watch(false); a second watch(true) stops the first and starts a recording of its own", async () => {
    const { fake } = recordingBrowser();
    const { handle } = await attached(fake);
    await handle.watch(true);
    const first = lastStart(fake);
    await handle.watch(true);
    const second = lastStart(fake);
    // One script on at a time: the first's removed before the second's is put in (final races review, M1).
    expect(fake.methods().filter((m) => m === "Page.addScriptToEvaluateOnNewDocument" || m === "Page.removeScriptToEvaluateOnNewDocument")).toEqual([
      "Page.addScriptToEvaluateOnNewDocument",
      "Page.removeScriptToEvaluateOnNewDocument",
      "Page.addScriptToEvaluateOnNewDocument",
    ]);
    expect(second.token).not.toBe(first.token);
    expect(second.binding).not.toBe(first.binding);
    const ops = () => fake.sent.filter((s) => s.method === "Runtime.callFunctionOn" && s.params.functionDeclaration === RECORDER_CALL).map((s) => (s.params.arguments as Array<{ value: unknown }>)[0].value);
    expect(ops()).toEqual(["start", "stop", "start"]);
    await handle.watch(false);
    expect(fake.sent.filter((s) => s.method === "Page.removeScriptToEvaluateOnNewDocument").map((s) => s.params)).toEqual([{ identifier: "script-1" }, { identifier: "script-1" }]);
    expect(fake.sent.filter((s) => s.method === "Runtime.removeBinding").map((s) => s.params)).toEqual([{ name: first.binding }, { name: second.binding }]);
    expect(ops()).toEqual(["start", "stop", "start", "stop"]);
    // Not recording: no binding call is kept, and the poll answers nothing.
    fake.emit("Runtime.bindingCalled", binding(fake, { t: tokenOf(fake), e: click("http://expenses.proof.test/") }), "S1");
    expect(await handle.drainEvents()).toEqual({ events: [], pages: [] });
    expect(fake.methods()).not.toContain("Runtime.enable");
  });

  it("reads the recorder's events defensively, every hint as a read's (kindOfElement), and drops what is not one", () => {
    const events = recordedEventsFrom([
      {
        type: "input",
        at: 5,
        page: "http://expenses.proof.test/new",
        control: { ...control, tag: "DIV", role: "textbox", name: "", hints: { tag: "div", editable: true, name: "Notes", label: null }, formFields: [{ tag: "input", type: "password", label: "Password" }] },
      },
      { type: "click", control: null, page: "http://x.test/" },
      { type: "telepathy", control, page: "http://x.test/" },
      { type: "frame_focus", control: null, at: 6, page: "http://expenses.proof.test/pay" },
      { type: "click", control: { ...control, formHost: "not a host!", href: "h".repeat(9000) }, page: "http://x.test/" },
    ]);
    expect(events.map((e) => e.type)).toEqual(["input", "frame_focus", "click"]);
    // An editable region's hints as a read reads them: a text area, named by its label words.
    expect(events[0].control?.tag).toBe("div");
    expect(events[0].control?.hints).toMatchObject({ tag: "textarea", label: "Notes" });
    expect(events[0].control?.formFields[0]).toMatchObject({ tag: "input", type: "password", label: "Password" });
    expect(events[2].control?.formHost).toBeNull();
    // Past 8,192 still past it, so actingAddress fails closed on it.
    expect(events[2].control?.href?.length).toBe(8193);
  });

  it("never throws out of a lost connection: watch and drainEvents resolve", async () => {
    const { fake } = recordingBrowser();
    const { handle } = await attached(fake);
    await handle.watch(true);
    await fake.close();
    // A bound document's events had all left: nothing waiting, and no gap.
    await expect(handle.watch(false)).resolves.toEqual({ events: [] });
    await expect(handle.drainEvents()).resolves.toEqual({ events: [], pages: [] });
    await expect(handle.watch(true)).resolves.toBeUndefined();
  });

  // Review of Phase 5 step 2 (the lows the driver holds).
  it("hands over at watch(false) what was still waiting, the notices not yet drained and the open document's queue, stopping the recorder before the binding's notices", async () => {
    const { fake, worlds } = recordingBrowser();
    const { handle } = await attached(fake);
    await handle.watch(true);
    // A notice after the last drain, and an event the document queued (its binding call failed).
    fake.emit("Runtime.bindingCalled", binding(fake, { t: tokenOf(fake), e: click("http://expenses.proof.test/new") }), "S1");
    worlds.get(21)!.events.push({ ...click("http://expenses.proof.test/new"), control: { ...control, name: "Add line" } });
    const out = await handle.watch(false);
    // Before: watch(false) answered nothing and both were thrown away, with no gap.
    expect(out).toEqual({ events: [expect.objectContaining({ type: "click", control: expect.objectContaining({ name: "Submit expense" }) }), expect.objectContaining({ type: "click", control: expect.objectContaining({ name: "Add line" }) })] });
    const order = fake.sent.map((s) => (s.method === "Runtime.callFunctionOn" && s.params.functionDeclaration === RECORDER_CALL ? `call:${(s.params.arguments as Array<{ value: unknown }>)[0].value}` : s.method));
    expect(order.indexOf("call:stop")).toBeGreaterThan(order.indexOf("Page.removeScriptToEvaluateOnNewDocument"));
    expect(order.indexOf("Runtime.removeBinding")).toBeGreaterThan(order.indexOf("call:stop"));
    // Stopped: nothing more.
    expect(await handle.drainEvents()).toEqual({ events: [], pages: [] });
  });

  it("says at watch(false) that something may be missing when the queue held more than one answer, or an unbound document could not be read", async () => {
    let r = recordingBrowser({ moreAtStop: true });
    let handle = (await attached(r.fake)).handle;
    await handle.watch(true);
    expect((await handle.watch(false))?.events.map((e) => e.type)).toEqual(["gap"]);
    r = recordingBrowser({ addBindingFails: true, stopFails: true });
    handle = (await attached(r.fake)).handle;
    await handle.watch(true);
    expect((await handle.watch(false))?.events.map((e) => e.type)).toEqual(["gap"]);
    // A bound document whose stop failed: its events had left through the binding, so no gap.
    r = recordingBrowser({ stopFails: true });
    handle = (await attached(r.fake)).handle;
    await handle.watch(true);
    expect(await handle.watch(false)).toEqual({ events: [] });
  });

  it("marks a gap on the start page when the recorder could not be started there, so its queue is never silently unread", async () => {
    for (const o of [{ worldFails: true }, { startFails: true }]) {
      const { fake } = recordingBrowser(o);
      const { handle } = await attached(fake);
      fake.emit("Page.frameNavigated", { frame: { id: "TAB", loaderId: "L1", url: "http://docs.proof.test/guide" }, type: "Navigation" }, "S1");
      await tick();
      await handle.watch(true);
      // Before: no context was known, so the poll never read that page and said nothing.
      expect((await handle.drainEvents()).events.map((e) => [e.type, e.page]), JSON.stringify(o)).toEqual([["gap", "http://docs.proof.test/guide"]]);
    }
  });

  // Final races review, M1: a recording started while the previous one's stop is still in flight.
  it("starts a recording asked during a stop still in flight only once that stop is done, with its own token, binding and script, and never cut by the old stop", async () => {
    let release = () => undefined as void;
    const holdStop = new Promise<void>((r) => (release = r));
    const { fake } = recordingBrowser({ holdStop });
    const { handle } = await attached(fake);
    await handle.watch(true);
    const a = lastStart(fake);
    // Done while a slow page loads: Chrome holds the stop's commands.
    const stopA = handle.watch(false);
    await tick();
    // A's last notice, still on its way while it stops.
    fake.emit("Runtime.bindingCalled", binding(fake, { t: a.token, e: click("http://expenses.proof.test/new") }, a.binding), "S1");
    // B at once, the server's 2 seconds past.
    const startB = handle.watch(true);
    await tick();
    await tick();
    // Before: B reused A's stopping state at once, its token and no script of its own.
    expect(fake.methods().filter((m) => m === "Page.addScriptToEvaluateOnNewDocument")).toHaveLength(1);
    expect(fake.sent.filter((s) => s.method === "Runtime.callFunctionOn" && s.params.functionDeclaration === RECORDER_CALL).map((s) => (s.params.arguments as Array<{ value: unknown }>)[0].value)).toEqual(["start"]);
    release();
    const handed = await stopA;
    await startB;
    expect(handed?.events.map((e) => e.control?.name)).toEqual(["Submit expense"]);
    const b = lastStart(fake);
    expect(b.token).not.toBe(a.token);
    expect(b.binding).toBe(recorderBinding(b.token));
    expect(b.binding).not.toBe(a.binding);
    expect(fake.methods().filter((m) => m === "Page.addScriptToEvaluateOnNewDocument")).toHaveLength(2);
    // The old stop removed only its own binding, before B's was added.
    const order = fake.sent.map((s) => (s.method === "Runtime.removeBinding" || s.method === "Runtime.addBinding" ? `${s.method}:${String(s.params.name)}` : s.method));
    expect(order.filter((m) => m.startsWith("Runtime.removeBinding"))).toEqual([`Runtime.removeBinding:${a.binding}`]);
    expect(order.indexOf(`Runtime.addBinding:${b.binding}`)).toBeGreaterThan(order.indexOf(`Runtime.removeBinding:${a.binding}`));
    // B records: its own notices kept, A's never.
    fake.emit("Runtime.bindingCalled", binding(fake, { t: b.token, e: { ...click("http://expenses.proof.test/new"), control: { ...control, name: "Add line" } } }), "S1");
    fake.emit("Runtime.bindingCalled", binding(fake, { t: a.token, e: click("http://expenses.proof.test/new") }, a.binding), "S1");
    // Before: every one of B's events dropped, the old stop having cleared the state B was using.
    expect((await handle.drainEvents()).events.map((e) => e.control?.name)).toEqual(["Add line"]);
    expect((await handle.watch(false))?.events).toEqual([]);
  });

  it("never reads into a new recording what an earlier one left: a recording the server never stopped is stopped first, its events dropped", async () => {
    const { fake } = recordingBrowser();
    const { handle } = await attached(fake);
    await handle.watch(true);
    const a = lastStart(fake);
    fake.emit("Runtime.bindingCalled", binding(fake, { t: a.token, e: click("http://expenses.proof.test/new") }), "S1");
    // No watch(false) came for A (its end skipped the stop): B starts.
    await handle.watch(true);
    const b = lastStart(fake);
    expect(b.token).not.toBe(a.token);
    // Before: B's first poll handed over A's click.
    expect((await handle.drainEvents()).events).toEqual([]);
    expect(fake.sent.filter((s) => s.method === "Runtime.removeBinding").map((s) => s.params.name)).toEqual([a.binding]);
  });

  it("runs each watch in the order asked: a stop asked while a start is still in flight stops that start's recording", async () => {
    const { fake } = recordingBrowser();
    const { handle } = await attached(fake);
    const start = handle.watch(true);
    const stop = handle.watch(false);
    await start;
    await stop;
    const b = lastStart(fake);
    expect(fake.sent.filter((s) => s.method === "Runtime.removeBinding").map((s) => s.params.name)).toEqual([b.binding]);
    fake.emit("Runtime.bindingCalled", binding(fake, { t: b.token, e: click("http://expenses.proof.test/new") }), "S1");
    expect(await handle.drainEvents()).toEqual({ events: [], pages: [] });
  });

  it("marks a gap for a binding call of this recording too big to read, and ignores one of another recording", async () => {
    const { fake } = recordingBrowser();
    const { handle } = await attached(fake);
    await handle.watch(true);
    const huge = { ...control, hints: { tag: "input", nameAttr: "n".repeat(210_000) } };
    fake.emit("Runtime.bindingCalled", binding(fake, { t: "another-token", e: { ...click("http://expenses.proof.test/new"), control: huge } }), "S1");
    expect((await handle.drainEvents()).events).toEqual([]);
    fake.emit("Runtime.bindingCalled", binding(fake, { t: tokenOf(fake), e: { ...click("http://expenses.proof.test/new"), control: huge } }), "S1");
    // Before: dropped with no word.
    expect((await handle.drainEvents()).events.map((e) => e.type)).toEqual(["gap"]);
  });
});
