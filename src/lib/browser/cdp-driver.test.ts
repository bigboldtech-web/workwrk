// The driver's guard (src/lib/browser/cdp-driver.ts, Decisions 10, 14, 16
// and 20) over a fake CDP connection: the guard is in place before the tab
// runs, every main-frame Document request is asked of the verdict (a
// refused hop aborted, the page left where it was), frames get the frame
// verdict, a new tab is closed while held, dialogs are dismissed, a page from
// a private address is closed, and an act sends no input until the element
// was found, checked and hit-tested; a connection lost after input answers
// unknown_outcome.

import { describe, expect, it, vi } from "vitest";
import { CdpClosed, type Cdp } from "./cdp";
import { attachBrowser, type GuardHooks } from "./cdp-driver";
import type { SiteVerdict } from "./sites";
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
  { i: 0, tag: "input", role: "textbox", name: "Email", type: "email", autocomplete: "email", inputmode: null, nameAttr: "email", idAttr: "email", label: "Email", maxLength: null, codeBoxes: null, formAction: "http://login.proof.test/session", href: null, editable: false, disabled: false, filled: true },
  { i: 1, tag: "input", role: "textbox", name: "Password", type: "password", autocomplete: "current-password", inputmode: null, nameAttr: "pw", idAttr: "pw", label: "Password", maxLength: null, codeBoxes: null, formAction: "http://login.proof.test/session", href: null, editable: false, disabled: false, filled: false },
  { i: 2, tag: "button", role: "button", name: "Sign in", type: null, autocomplete: null, inputmode: null, nameAttr: null, idAttr: null, label: null, maxLength: null, codeBoxes: null, formAction: "http://login.proof.test/session", href: null, editable: false, disabled: false, filled: false },
  { i: 3, tag: "button", role: "button", name: "Sign in", type: null, autocomplete: null, inputmode: null, nameAttr: null, idAttr: null, label: null, maxLength: null, codeBoxes: null, formAction: "http://login.proof.test/session", href: null, editable: false, disabled: false, filled: false },
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
      const host = new URL(url).hostname;
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
    const json = JSON.stringify(snap);
    for (const hint of ["autocomplete", "nameAttr", "idAttr", "inputmode", "readerIndex", "current-password"]) expect(json).not.toContain(hint);
    // The reader runs in its own world, its arguments passed by value.
    const call = fake.sent.find((s) => s.method === "Runtime.callFunctionOn");
    expect(call?.params.executionContextId).toBe(7);
    expect(fake.sent.find((s) => s.method === "Page.createIsolatedWorld")?.params).toMatchObject({ frameId: "TAB", worldName: "wk-reader" });
  });

  it("finds words with the nearest control's fingerprint", async () => {
    const { handle } = await attached(fakeBrowser());
    expect(await handle.find("sign in")).toEqual({ matches: [{ text: "Sign in here", near: { tag: "button", role: "button", name: "Sign in", kind: "none", type: null, formHost: "login.proof.test", href: null, twin: 0 } }] });
  });
});

describe("acting", () => {
  const signIn = (twin: number): ElementFingerprint => ({ tag: "button", role: "button", name: "Sign in", kind: "none", type: null, formHost: "login.proof.test", href: null, twin });
  const inputs = (fake: FakeCdp) => fake.sent.filter((s) => s.method.startsWith("Input."));

  it("clicks the second of two twins at its centre", async () => {
    const located: unknown[] = [];
    const fake = fakeBrowser({ reader: readerFor({ locate: (_m, arg) => (located.push(arg), { ok: true, x: 40, y: 50 }) }) });
    const { handle } = await attached(fake);
    expect(await handle.click(signIn(1))).toMatchObject({ ok: true, settled: true });
    expect(located).toEqual([{ i: 3, tag: "button", name: "Sign in" }]);
    expect(inputs(fake).map((s) => s.params.type)).toEqual(["mouseMoved", "mousePressed", "mouseReleased"]);
    expect(inputs(fake)[1].params).toMatchObject({ x: 40, y: 50, button: "left", clickCount: 1 });
  });

  it("sends nothing for a sensitive field, an element gone, fewer twins, or one covered", async () => {
    const fake = fakeBrowser({ reader: readerFor({ locate: () => ({ ok: false, code: "covered" }) }) });
    const { handle } = await attached(fake);
    expect(await handle.type({ tag: "input", role: "textbox", name: "Password", kind: "password", type: "password", formHost: "login.proof.test", href: null, twin: 0 }, "hunter2", false)).toEqual({ ok: false, code: "sensitive" });
    // Read as sensitive now even when the card's fingerprint said otherwise.
    expect(await handle.type({ tag: "input", role: "textbox", name: "Password", kind: "password", type: "password", formHost: "login.proof.test", href: null, twin: 0 }, "x", false)).toEqual({ ok: false, code: "sensitive" });
    expect(await handle.click({ ...signIn(0), name: "Place order" })).toEqual({ ok: false, code: "not_found" });
    expect(await handle.click(signIn(2))).toEqual({ ok: false, code: "changed" });
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
    const email: ElementFingerprint = { tag: "input", role: "textbox", name: "Email", kind: "email", type: "email", formHost: "login.proof.test", href: null, twin: 0 };
    expect(await handle.type(email, "max@proof.test", true)).toEqual({ ok: false, code: "blocked_hop", host: "exfil.proof.test" });
    expect(inputs(fake).map((s) => [s.method, s.params.type ?? s.params.text])).toEqual([
      ["Input.insertText", "max@proof.test"],
      ["Input.dispatchKeyEvent", "keyDown"],
      ["Input.dispatchKeyEvent", "keyUp"],
    ]);
  });
});
