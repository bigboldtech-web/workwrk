// The live view's page (docs/plans/browser-host.md 4.1): four elements and
// no other UI; no cookie, storage, eval or markup writes; the token read
// from the fragment and removed with replaceState; input listeners only
// inside attachControl, which runs only once the host says control; the
// words with no dashes; and the app's four token values.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { LIVE_COPY } from "./copy.mjs";
import { start } from "./live.mjs";
import { BUTTON_NAMES, closeState, decodeFrame, own, remotePoint, RETRY_DELAYS, tokenExp, wheelPixels } from "./view.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..");
const read = (f: string) => fs.readFileSync(path.join(HERE, f), "utf8");
const PAGE_FILES = ["page.html", "live.mjs", "view.mjs", "copy.mjs", "live.css"];
const INPUT_EVENTS = ["pointerdown", "pointermove", "pointerup", "pointercancel", "wheel", "contextmenu", "keydown", "keyup", "beforeinput", "input", "compositionstart", "compositionupdate", "compositionend", "paste", "focus", "touchstart", "touchmove", "touchend", "mousedown", "mouseup", "mousemove", "click"];

describe("the page's files", () => {
  it("page.html holds the canvas, the text area, the status line and the script, and nothing else", () => {
    const html = read("page.html");
    const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";
    const tags = [...body.matchAll(/<([a-z]+)\b/g)].map((m) => m[1]);
    expect(tags).toEqual(["canvas", "textarea", "p", "script"]);
    expect(body).toContain('<canvas id="screen" role="img" aria-label="The teammate\'s browser">');
    expect(body).toContain('<textarea id="keys" autocomplete="off" autocapitalize="off" spellcheck="false" aria-hidden="true">');
    expect(body).toContain('<p id="status" role="status" hidden>');
    expect(body).toContain('<script type="module" src="/live/assets/live.mjs"></script>');
    // No inline script or style, which the CSP would refuse anyway, and no form, button or link.
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
    expect(html).not.toMatch(/\sstyle=|<style|<button|<form|<input|<a\s|<iframe|<img/);
  });

  it("the page and its scripts hold no cookie, storage, eval, markup writes or clipboard writes", () => {
    const forbidden = [/document\.cookie/, /localStorage/, /sessionStorage/, /indexedDB/, /\beval\s*\(/, /new\s+Function/, /innerHTML/, /outerHTML/, /insertAdjacentHTML/, /document\.write/, /navigator\.clipboard/, /clipboard\.write/, /setTimeout\(\s*["'`]/, /caches\./, /serviceWorker/];
    for (const f of PAGE_FILES) {
      const t = read(f);
      for (const re of forbidden) expect({ f, re: String(re), found: re.test(t) }).toEqual({ f, re: String(re), found: false });
    }
  });

  it("the token is read from the fragment and removed from the frame's address with replaceState, before anything else", () => {
    const t = read("live.mjs");
    const readAt = t.indexOf("readToken(g.location.hash)");
    const replaceAt = t.indexOf('g.history.replaceState(null, "", g.location.pathname)');
    expect(readAt).toBeGreaterThan(0);
    expect(replaceAt).toBeGreaterThan(readAt);
    expect(t.indexOf("new g.WebSocket")).toBeGreaterThan(replaceAt);
    // The token goes in the hello, never in an address.
    expect(t).not.toMatch(/\?t=|token=/);
  });

  it("input listeners appear only inside attachControl", () => {
    const t = read("live.mjs");
    const open = t.indexOf("function attachControl() {");
    expect(open).toBeGreaterThan(0);
    let depth = 0;
    let close = -1;
    for (let i = t.indexOf("{", open); i < t.length; i += 1) {
      if (t[i] === "{") depth += 1;
      else if (t[i] === "}" && (depth -= 1) === 0) {
        close = i;
        break;
      }
    }
    const listeners = [...t.matchAll(/addEventListener\(\s*\n?\s*"([a-z]+)"/g)];
    expect(listeners.length).toBeGreaterThanOrEqual(14);
    for (const m of listeners) {
      expect(INPUT_EVENTS).toContain(m[1]);
      expect({ event: m[1], inside: (m.index ?? 0) > open && (m.index ?? 0) < close }).toEqual({ event: m[1], inside: true });
    }
    // No other way in: no on* handler on an element, and attachControl is called once, from the hello.
    expect(t).not.toMatch(/\.(onkeydown|onpointerdown|onmousedown|onclick|oninput|onpaste|onwheel)\s*=/);
    const code = t.split("\n").filter((l) => !/^\s*(\/\/|\/\*\*|\*)/.test(l)).join("\n");
    expect([...code.matchAll(/attachControl\(\)/g)]).toHaveLength(2);
    expect(t).toContain('if (mode === "control") attachControl();');
  });

  it("copy.mjs has no dashes, and holds the six words of 4.1", () => {
    const t = read("copy.mjs");
    expect(t).not.toMatch(/[‒-―]|--/);
    for (const f of PAGE_FILES) expect({ f, dashes: /[\u2013\u2014]/.test(read(f)) }).toEqual({ f, dashes: false });
    expect(LIVE_COPY).toEqual({
      connecting: "Connecting to the browser",
      reconnecting: "Connection lost. Trying again",
      ended: "This browser has closed.",
      expired: "This view has expired. Open it again from the chat.",
      revoked: "This view was closed.",
      refused: "This view can't be shown here.",
    });
  });

  it("live.css holds the four token values of tokens.css: the card frame's bg-subtle and text-ink-2, light and dark", () => {
    const tokens = fs.readFileSync(path.join(ROOT, "src", "app", "(dashboard)", "tokens.css"), "utf8");
    const value = (css: string, name: string) => new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(css)?.[1]?.toUpperCase();
    const darkAt = tokens.search(/^@media \(prefers-color-scheme: dark\) \{/m);
    expect(darkAt).toBeGreaterThan(0);
    const want = { bg: value(tokens, "--os-surface-1"), ink: value(tokens, "--os-ink-2"), darkBg: value(tokens.slice(darkAt), "--os-surface-1"), darkInk: value(tokens.slice(darkAt), "--os-ink-2") };
    expect(want).toEqual({ bg: "#F6F7F9", ink: "#5C6779", darkBg: "#15181D", darkInk: "#9AA3B2" });
    const css = read("live.css");
    const cssDark = css.search(/^@media \(prefers-color-scheme: dark\) \{/m);
    expect(cssDark).toBeGreaterThan(0);
    expect({ bg: value(css, "--live-bg"), ink: value(css, "--live-ink"), darkBg: value(css.slice(cssDark), "--live-bg"), darkInk: value(css.slice(cssDark), "--live-ink") }).toEqual(want);
    expect(css).toMatch(/font:\s*14px/);
    expect(css).toMatch(/background: var\(--live-bg\)/);
  });
});

// ── The page itself, in a fake window ──

class FakeEl {
  listeners = new Map<string, Array<(e: unknown) => void>>();
  hidden = false;
  textContent = "";
  width = 300;
  height = 150;
  value = "";
  focused = 0;
  addEventListener(type: string, fn: (e: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  getContext() {
    return { drawImage: () => undefined };
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 640, height: 400 };
  }
  focus() {
    this.focused += 1;
  }
  setPointerCapture() {}
  fire(type: string, e: Record<string, unknown>) {
    for (const fn of this.listeners.get(type) ?? []) fn({ preventDefault: () => undefined, ...e });
  }
}

class FakeWS {
  static all: FakeWS[] = [];
  sent: string[] = [];
  readyState = 0;
  binaryType = "";
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  constructor(readonly url: string) {
    FakeWS.all.push(this);
    order.push("ws");
  }
  send(d: string) {
    this.sent.push(d);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  hello(mode: "watch" | "control") {
    this.onmessage?.({ data: JSON.stringify({ t: "hello", mode, width: 1280, height: 800, exp: Math.floor(Date.now() / 1000) + 600 }) });
  }
  shut(code: number, reason = "") {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
  json() {
    return this.sent.map((x) => JSON.parse(x));
  }
}

let order: string[] = [];
const TOKEN = `${Buffer.from(JSON.stringify({ s: "abc", m: "c", e: Math.floor(Date.now() / 1000) + 900, g: 0, n: "x" })).toString("base64url")}.${"m".repeat(43)}`;

function page(o: { hash?: string; platform?: string } = {}) {
  FakeWS.all = [];
  order = [];
  const els = { screen: new FakeEl(), keys: new FakeEl(), status: new FakeEl() };
  const win = {
    document: { getElementById: (id: keyof typeof els) => els[id] ?? null },
    location: { hash: o.hash ?? `#t=${TOKEN}`, pathname: "/live/abc", origin: "http://127.0.0.1:8789" },
    history: { replaceState: vi.fn((...args: unknown[]) => void order.push(`replaceState:${args.length}`)) },
    navigator: { platform: o.platform ?? "MacIntel", userAgent: "" },
    WebSocket: FakeWS,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    setInterval: () => 0,
    requestAnimationFrame: (fn: () => void) => {
      fn();
      return 0;
    },
    cancelAnimationFrame: () => undefined,
    createImageBitmap: async () => ({ width: 1280, height: 800, close: () => undefined }),
    addEventListener: vi.fn(),
  };
  start(win as never);
  return { els, win, ws: () => FakeWS.all.at(-1)! };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the page, run", () => {
  it("reads the token from the fragment, removes it with replaceState before it connects, and sends it only in its hello", () => {
    const p = page();
    expect(p.win.history.replaceState).toHaveBeenCalledWith(null, "", "/live/abc");
    expect(order).toEqual(["replaceState:3", "ws"]);
    expect(p.ws().url).toBe("ws://127.0.0.1:8789/live/abc/ws");
    p.ws().open();
    expect(p.ws().json()).toEqual([{ t: "hello", token: TOKEN }]);
    expect(p.els.status).toMatchObject({ hidden: false, textContent: LIVE_COPY.connecting });
  });

  it("with no token, it shows refused and never connects", () => {
    const p = page({ hash: "" });
    expect(FakeWS.all).toHaveLength(0);
    expect(p.els.status).toMatchObject({ hidden: false, textContent: LIVE_COPY.refused });
  });

  it("a watch view registers no input listener; a control view does, once its hello says control", () => {
    const w = page();
    w.ws().open();
    w.ws().hello("watch");
    expect(w.els.screen.listeners.size).toBe(0);
    expect(w.els.keys.listeners.size).toBe(0);
    expect(w.win.addEventListener).not.toHaveBeenCalled();
    const c = page();
    expect(c.els.screen.listeners.size).toBe(0);
    c.ws().open();
    c.ws().hello("control");
    expect([...c.els.screen.listeners.keys()].sort()).toEqual(["contextmenu", "pointercancel", "pointerdown", "pointermove", "pointerup", "wheel"]);
    expect([...c.els.keys.listeners.keys()].sort()).toEqual(["beforeinput", "compositionend", "compositionupdate", "input", "keydown", "keyup", "paste"]);
  });

  it("in control: Cmd+A on a Mac is sent as Ctrl+A, Cmd+V is left to the paste, which sends the words, and a click is mapped to the remote", () => {
    const c = page({ platform: "MacIntel" });
    c.ws().open();
    c.ws().hello("control");
    const key = (type: string, o: Record<string, unknown>) => c.els.keys.fire(type, { key: "", code: "", keyCode: 0, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false, location: 0, ...o });
    key("keydown", { key: "a", code: "KeyA", keyCode: 65, metaKey: true });
    key("keydown", { key: "v", code: "KeyV", keyCode: 86, metaKey: true });
    c.els.keys.fire("paste", { clipboardData: { getData: (t: string) => (t === "text/plain" ? "x".repeat(12_000) : "") } });
    c.els.keys.fire("compositionupdate", { data: "日" });
    c.els.keys.fire("compositionend", { data: "日本" });
    c.els.screen.fire("pointerdown", { pointerType: "mouse", pointerId: 1, button: 0, buttons: 1, clientX: 320, clientY: 200, timeStamp: 10, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false });
    const sent = c.ws().json().slice(1);
    expect(sent[0]).toMatchObject({ t: "key", type: "down", key: "a", code: "KeyA", mods: 2, text: "" });
    expect(sent[1]).toEqual({ t: "text", text: "x".repeat(10_000) });
    expect(sent[2]).toEqual({ t: "ime", text: "日", start: 1, end: 1 });
    expect(sent[3]).toEqual({ t: "text", text: "日本" });
    // The canvas is 640 by 400 on screen, the remote 1280 by 800: the point doubles.
    expect(sent[4]).toEqual({ t: "mouse", type: "down", x: 640, y: 400, button: "left", buttons: 1, clicks: 1, mods: 0 });
    expect(sent).toHaveLength(5);
    expect(c.els.keys.focused).toBe(1);
  });

  it("a touch tap is a move, a press and a release; a one finger drag is wheel deltas", () => {
    const c = page();
    c.ws().open();
    c.ws().hello("control");
    const t = (type: string, x: number, y: number) => c.els.screen.fire(type, { pointerType: "touch", pointerId: 7, button: 0, buttons: 1, clientX: x, clientY: y, timeStamp: 1, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false });
    t("pointerdown", 100, 100);
    t("pointerup", 100, 100);
    t("pointerdown", 100, 300);
    t("pointermove", 100, 250);
    t("pointermove", 100, 200);
    t("pointerup", 100, 200);
    const sent = c.ws().json().slice(1);
    expect(sent.slice(0, 3).map((m) => [m.t, m.type, m.x, m.y])).toEqual([
      ["mouse", "move", 200, 200],
      ["mouse", "down", 200, 200],
      ["mouse", "up", 200, 200],
    ]);
    expect(sent.slice(3).every((m) => m.t === "wheel" && m.dy > 0)).toBe(true);
    expect(sent.slice(3).reduce((n, m) => n + m.dy, 0)).toBe(200);
  });

  it("each close shows its words, and only a close that is not final connects again, five times", async () => {
    const cases: Array<[number, string, string | null]> = [
      [4400, "", LIVE_COPY.refused],
      [4401, "invalid", LIVE_COPY.refused],
      [4401, "expired", LIVE_COPY.expired],
      [4401, "revoked", LIVE_COPY.revoked],
      [4403, "watch", LIVE_COPY.refused],
      [4404, "ended", LIVE_COPY.ended],
      [4409, "full", LIVE_COPY.refused],
    ];
    for (const [code, reason, words] of cases) {
      const p = page();
      p.ws().open();
      p.ws().shut(code, reason);
      expect({ code, reason, text: p.els.status.textContent, again: FakeWS.all.length }).toEqual({ code, reason, text: words, again: 1 });
    }
    const replaced = page();
    replaced.ws().open();
    replaced.ws().hello("control");
    replaced.ws().shut(4408, "replaced");
    expect({ hidden: replaced.els.status.hidden, again: FakeWS.all.length }).toEqual({ hidden: true, again: 1 });

    vi.useFakeTimers();
    const p = page();
    for (let i = 0; i < RETRY_DELAYS.length; i += 1) {
      p.ws().open();
      p.ws().shut(i % 2 ? 1011 : 4429);
      expect(p.els.status.textContent).toBe(LIVE_COPY.reconnecting);
      await vi.advanceTimersByTimeAsync(RETRY_DELAYS[i]);
      expect(FakeWS.all).toHaveLength(i + 2);
    }
    p.ws().shut(1006);
    expect(p.els.status.textContent).toBe(LIVE_COPY.expired);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(FakeWS.all).toHaveLength(RETRY_DELAYS.length + 1);
  });

  it("{t:ended} shows ended", () => {
    const p = page();
    p.ws().open();
    p.ws().onmessage?.({ data: JSON.stringify({ t: "ended" }) });
    expect(p.els.status.textContent).toBe(LIVE_COPY.ended);
  });
});

describe("the page's pure parts (live/view.mjs)", () => {
  it("decodes a frame, reads a token's exp, maps a point letterboxed, and sizes a wheel", () => {
    const header = Buffer.from(JSON.stringify({ w: 1280, h: 800, sx: 0, sy: 5, seq: 3 }));
    const lead = Buffer.alloc(5);
    lead[0] = 1;
    lead.writeUInt32BE(header.length, 1);
    const f = decodeFrame(new Uint8Array(Buffer.concat([lead, header, Buffer.from([0xff, 0xd8, 1])])));
    expect(f?.header).toEqual({ w: 1280, h: 800, sx: 0, sy: 5, seq: 3 });
    expect([...(f?.jpeg ?? [])]).toEqual([0xff, 0xd8, 1]);
    expect(decodeFrame(new Uint8Array([2, 0, 0, 0, 1, 0, 0]))).toBeNull();
    expect(tokenExp(TOKEN)).toBe(JSON.parse(Buffer.from(TOKEN.split(".")[0], "base64url").toString()).e);
    expect(tokenExp("junk")).toBeNull();
    // A 1000 by 400 canvas shows a 16:10 frame 640 wide, 180 px in from each side.
    expect(remotePoint(180, 0, { left: 0, top: 0, width: 1000, height: 400 }, { w: 1280, h: 800 })).toEqual({ x: 0, y: 0 });
    expect(remotePoint(500, 200, { left: 0, top: 0, width: 1000, height: 400 }, { w: 1280, h: 800 })).toEqual({ x: 640, y: 400 });
    expect(remotePoint(5000, 5000, { left: 0, top: 0, width: 1000, height: 400 }, { w: 1280, h: 800 })).toEqual({ x: 1279, y: 799 });
    expect(wheelPixels(0, 1, 2)).toEqual({ dx: 1, dy: 2 });
    expect(wheelPixels(1, 1, 2)).toEqual({ dx: 40, dy: 80 });
    expect(wheelPixels(2, 0, 1)).toEqual({ dx: 0, dy: 800 });
    expect(closeState(1006, "")).toEqual({ state: "reconnecting", retry: true });
  });
});

describe("the review of step 2", () => {
  it("L2: the page reads its tables for their own keys only", () => {
    expect(own(BUTTON_NAMES, 0)).toBe("left");
    expect(own(BUTTON_NAMES, 2)).toBe("right");
    for (const k of ["constructor", "__proto__", "toString", 3]) expect(own(BUTTON_NAMES, k)).toBeUndefined();
    expect(own(LIVE_COPY, "ended")).toBe(LIVE_COPY.ended);
    expect(own(LIVE_COPY, "constructor")).toBeUndefined();
    const t = read("live.mjs");
    expect(t).not.toMatch(/BUTTON_NAMES\[|LIVE_COPY\[/);
  });
});
