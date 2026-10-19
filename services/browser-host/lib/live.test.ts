// The live view's websocket (docs/plans/browser-host.md 4.2, Decision 7),
// over a fake tab connection: watch views never type, control input arrives
// in order, revoke and expiry, the newest socket wins, pings, held buttons
// released, the screencast and its frames, nothing kept, LIVE_METHODS only,
// and the Origin.

import { EventEmitter } from "node:events";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

import { LIVE_METHODS } from "./live-input.mjs";
import { ACK_GAP_MS, BUFFER_MAX, connectTab, createLive, DEAD_MS, findTab, FRAME_MAX, HELLO_MS, PING_MS, SETTLE_MS, TAB_POLL_MS, type TabConn } from "./live.mjs";
import { createLog } from "./log.mjs";
import { createSessions, type Session } from "./sessions.mjs";
import { newBootKey } from "./tokens.mjs";

const ORIGIN = "http://127.0.0.1:8789";
const jpeg = (fill = 7, n = 64) => Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(n, fill)]);
const frameEvent = (sessionId: number, bytes = jpeg()) => ({
  data: bytes.toString("base64"),
  metadata: { deviceWidth: 1280, deviceHeight: 800, scrollOffsetX: 0, scrollOffsetY: 120, pageScaleFactor: 1, offsetTop: 0, timestamp: 1 },
  sessionId,
});
/** A frame's JPEG, read back from the binary message (4.2). */
const jpegOf = (m: Buffer) => m.subarray(5 + m.readUInt32BE(1));
const headerOf = (m: Buffer) => JSON.parse(m.subarray(5, 5 + m.readUInt32BE(1)).toString("utf8"));

/** A fake tab connection: what the live view sent, and the tab's events on demand. */
function fakeTab(now: () => number = () => performance.now()) {
  const sent: Array<{ method: string; params: Record<string, unknown>; at: number }> = [];
  let onEvent: ((m: string, p: unknown) => void) | null = null;
  let onClose: (() => void) | null = null;
  const t = {
    sent,
    closed: null as null | { drain?: boolean },
    backlogN: 0,
    send: async (method: string, params: Record<string, unknown> = {}) => {
      sent.push({ method, params, at: now() });
      return {};
    },
    backlog: () => t.backlogN,
    onEvent: (fn: (m: string, p: unknown) => void) => void (onEvent = fn),
    onClose: (fn: () => void) => void (onClose = fn),
    close: (o: { drain?: boolean } = {}) => void (t.closed = o),
    emit: (m: string, p: unknown) => onEvent?.(m, p),
    lose: () => onClose?.(),
    methods: () => sent.map((x) => x.method),
    inputs: () => sent.filter((x) => x.method.startsWith("Input.")),
  };
  return t;
}
type FakeTab = ReturnType<typeof fakeTab>;

function fakeLauncher() {
  return {
    async launch(ask: { id: string }) {
      return {
        browserWs: "ws://127.0.0.1:1/devtools/browser/b",
        devtoolsBase: "http://127.0.0.1:1",
        tabTargetId: "T1",
        stop: async () => undefined,
        exited: new Promise<string>(() => undefined),
        stateEntry: { id: ask.id, pid: 4242, pgid: 4242, started: "x", profile: `/p/${ask.id}` },
      };
    },
    reap: async () => 0,
    sweep: async () => 0,
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;
let env: Setup | null = null;
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await env?.close();
  env = null;
});

async function setup(o: { controlSeconds?: number; fakeClock?: boolean; tabs?: Array<FakeTab | null> } = {}) {
  const lines: string[] = [];
  const log = createLog({ write: (l) => lines.push(l) });
  const bootKey = newBootKey();
  const mono = o.fakeClock ? () => Date.now() : () => performance.now();
  let wallOffset = 0;
  const clock = { wall: () => Date.now() + wallOffset, mono };
  const sessions = createSessions({ cfg: { mode: "process", max: 8, proof: false, connectBase: "ws://127.0.0.1:8789" }, launcher: fakeLauncher(), state: { write: () => undefined, read: () => null }, log, bootKey, clock });
  const tabs: FakeTab[] = [];
  const planned = o.tabs ? [...o.tabs] : null;
  let opens = 0;
  const live = createLive({
    cfg: { publicUrl: ORIGIN, publicOrigin: ORIGIN, test: { controlSeconds: o.controlSeconds ?? null } },
    sessions,
    bootKey,
    log,
    clock,
    tabConnect: async () => {
      opens += 1;
      const t = planned && planned.length > 0 ? planned.shift()! : planned ? null : fakeTab(mono);
      if (t) tabs.push(t);
      return t as TabConn | null;
    },
  });
  const server = http.createServer((_q, r) => r.end());
  server.on("upgrade", (req, socket, head) => {
    if (!live.upgrade(req, socket, head)) socket.destroy();
  });
  if (!o.fakeClock) await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = o.fakeClock ? 0 : (server.address() as AddressInfo).port;
  const make = async (): Promise<Session> => {
    // Exempt from never_connected: no CDP client connects in these tests.
    const r = await sessions.create({ projectId: "p", region: "us-east-1", timeoutSeconds: 600, viewport: { width: 1280, height: 800 }, userMetadata: { wk: "tag", row: "row" }, exempt: true });
    if (!r.ok) throw new Error("not made");
    return r.session;
  };
  return {
    lines,
    sessions,
    live,
    tabs,
    port,
    make,
    opens: () => opens,
    shiftWall: (ms: number) => void (wallOffset = ms),
    close: async () => {
      live.close();
      if (server.listening) await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

const tokenOf = (url: string) => url.split("#t=")[1];

/** A real viewer socket: its hello sent at open, every text and frame kept. */
function view(port: number, id: string, token: string | null, origin = ORIGIN) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/live/${id}/ws`, { origin });
  const texts: Array<Record<string, unknown>> = [];
  const frames: Buffer[] = [];
  let gotHello: (m: Record<string, unknown> | null) => void = () => undefined;
  const hello = new Promise<Record<string, unknown> | null>((r) => (gotHello = r));
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    ws.on("close", (code, reason) => {
      gotHello(null);
      resolve({ code, reason: String(reason) });
    }),
  );
  ws.on("open", () => {
    if (token !== null) ws.send(JSON.stringify({ t: "hello", token }));
  });
  ws.on("message", (data, binary) => {
    if (binary) return void frames.push(Buffer.from(data as Buffer));
    const m = JSON.parse(String(data));
    texts.push(m);
    if (m.t === "hello") gotHello(m);
  });
  ws.on("error", () => undefined);
  const send = (m: unknown) => ws.send(JSON.stringify(m));
  return { ws, texts, frames, hello, closed, send };
}

const until = async (fn: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
};

/** A fake viewer socket, for the tests on fake timers (lib/live.mjs accept). */
function fakeSocket() {
  const e = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const s = Object.assign(e, {
    readyState: WebSocket.OPEN as number,
    bufferedAmount: 0,
    sent: [] as Array<string | Buffer>,
    callbacks: [] as Array<() => void>,
    holdCallbacks: false,
    pings: 0,
    closedWith: null as null | { code: number; reason: string },
    terminated: false,
    send(data: string | Buffer, opts?: unknown, cb?: () => void) {
      s.sent.push(data);
      const done = typeof opts === "function" ? (opts as () => void) : cb;
      if (done) {
        if (s.holdCallbacks) s.callbacks.push(done);
        else done();
      }
    },
    close(code: number, reason: string) {
      s.closedWith = { code, reason };
      s.readyState = WebSocket.CLOSED;
      queueMicrotask(() => e.emit("close", code, Buffer.from(reason)));
    },
    terminate() {
      s.terminated = true;
      s.readyState = WebSocket.CLOSED;
      queueMicrotask(() => e.emit("close", 1006, Buffer.alloc(0)));
    },
    ping() {
      s.pings += 1;
    },
    hello(token: string) {
      e.emit("message", Buffer.from(JSON.stringify({ t: "hello", token })), false);
    },
    say(m: unknown) {
      e.emit("message", Buffer.from(JSON.stringify(m)), false);
    },
    texts: () => s.sent.filter((x): x is string => typeof x === "string").map((x) => JSON.parse(x)),
    frames: () => s.sent.filter((x): x is Buffer => Buffer.isBuffer(x)),
  });
  return s;
}

const MOUSE_DOWN = { t: "mouse", type: "down", x: 100, y: 200, button: "left", buttons: 1, clicks: 1, mods: 0 };

describe("a watch view", () => {
  it("is closed 4403 at its first input, and no Input command is ever sent for it", async () => {
    env = await setup();
    const s = await env.make();
    const v = view(env.port, s.id, tokenOf(env.live.urlFor(s, "watch")));
    expect(await v.hello).toEqual({ t: "hello", mode: "watch", width: 1280, height: 800, exp: expect.any(Number) });
    await until(() => env!.tabs.length === 1 && env!.tabs[0].methods().includes("Page.startScreencast"));
    // A ping is no input.
    v.send({ t: "ping" });
    await until(() => v.texts.some((m) => m.t === "pong"));
    v.send(MOUSE_DOWN);
    v.send({ t: "key", type: "down", key: "a", code: "KeyA", vk: 65, text: "a" });
    v.send({ t: "text", text: "typed by a watcher" });
    expect(await v.closed).toEqual({ code: 4403, reason: "watch" });
    await new Promise((r) => setTimeout(r, 50));
    expect(env.tabs[0].inputs()).toEqual([]);
    expect(env.live.counts().watchInputRefused).toBe(1);
    expect(env.lines).toContain("[host] live watch_input_refused");
  });
});

describe("a control view", () => {
  it("relays its input in order, as live-input maps it, and brings the tab to the front", async () => {
    env = await setup();
    const s = await env.make();
    const v = view(env.port, s.id, tokenOf(env.live.urlFor(s, "control")));
    expect(await v.hello).toMatchObject({ t: "hello", mode: "control" });
    await until(() => env!.tabs.length === 1 && env!.tabs[0].methods().includes("Page.bringToFront"));
    const msgs = [
      { t: "mouse", type: "move", x: 50, y: 60, button: "none", buttons: 0, clicks: 1, mods: 0 },
      MOUSE_DOWN,
      { t: "mouse", type: "up", x: 100, y: 200, button: "left", buttons: 0, clicks: 1, mods: 0 },
      { t: "key", type: "down", key: "H", code: "KeyH", vk: 72, text: "H", mods: 8, repeat: false, location: 0 },
      { t: "key", type: "up", key: "H", code: "KeyH", vk: 72, text: "", mods: 8, repeat: false, location: 0 },
      { t: "ime", text: "日", start: 1, end: 1 },
      { t: "text", text: "日本" },
      { t: "wheel", x: 10, y: 10, dx: 0, dy: 240, mods: 0 },
    ];
    for (const m of msgs) v.send(m);
    await until(() => env!.tabs[0].inputs().length === msgs.length);
    expect(env.tabs[0].inputs().map((x) => [x.method, x.params.type ?? x.params.text])).toEqual([
      ["Input.dispatchMouseEvent", "mouseMoved"],
      ["Input.dispatchMouseEvent", "mousePressed"],
      ["Input.dispatchMouseEvent", "mouseReleased"],
      ["Input.dispatchKeyEvent", "keyDown"],
      ["Input.dispatchKeyEvent", "keyUp"],
      ["Input.imeSetComposition", "日"],
      ["Input.insertText", "日本"],
      ["Input.dispatchMouseEvent", "mouseWheel"],
    ]);
    expect(env.tabs[0].inputs()[1].params).toEqual({ type: "mousePressed", x: 100, y: 200, button: "left", buttons: 1, clickCount: 1, modifiers: 0 });
    // A message that is no input is dropped, never sent.
    v.send({ t: "evaluate", expression: "document.title" });
    v.send({ t: "text", text: "after" });
    await until(() => env!.tabs[0].inputs().length === msgs.length + 1);
    expect(env.tabs[0].inputs().at(-1)).toMatchObject({ method: "Input.insertText", params: { text: "after" } });
    expect(env.live.counts().inputs).toMatchObject({ mouse: 3, key: 2, ime: 1, text: 2, wheel: 1 });
  });

  it("holding the left button and a key, it leaves: the host releases both on its behalf", async () => {
    env = await setup();
    const s = await env.make();
    const v = view(env.port, s.id, tokenOf(env.live.urlFor(s, "control")));
    await v.hello;
    await until(() => env!.tabs.length === 1);
    v.send(MOUSE_DOWN);
    v.send({ t: "mouse", type: "move", x: 140, y: 230, button: "none", buttons: 1, clicks: 1, mods: 0 });
    v.send({ t: "key", type: "down", key: "a", code: "KeyA", vk: 65, text: "a", mods: 0, repeat: false, location: 0 });
    await until(() => env!.tabs[0].inputs().length === 3);
    // The frame closed mid drag: the socket simply goes.
    v.ws.terminate();
    await until(() => env!.tabs[0].inputs().length === 5);
    expect(env.tabs[0].inputs().slice(3)).toEqual([
      { method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", x: 140, y: 230, button: "left", buttons: 0, clickCount: 1, modifiers: 0 }, at: expect.any(Number) },
      { method: "Input.dispatchKeyEvent", params: { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 0, location: 0 }, at: expect.any(Number) },
    ]);
    // The release went before the screencast stopped, and the tab connection drains before it closes.
    const methods = env.tabs[0].methods();
    expect(methods.lastIndexOf("Input.dispatchKeyEvent")).toBeLessThan(methods.indexOf("Page.stopScreencast"));
    expect(env.tabs[0].closed).toEqual({ drain: true });
    expect(env.live.counts().released).toBe(2);
  });
});

describe("revoke and expiry", () => {
  it("revoke closes every control view 4401 revoked, keeps the watch views, and a reconnect with that token is refused", async () => {
    env = await setup();
    const s = await env.make();
    const control = tokenOf(env.live.urlFor(s, "control"));
    const c = view(env.port, s.id, control);
    const w = view(env.port, s.id, tokenOf(env.live.urlFor(s, "watch")));
    await c.hello;
    await w.hello;
    expect(env.live.revoke(s.id)).toBe(1);
    expect(await c.closed).toEqual({ code: 4401, reason: "revoked" });
    expect(s.epoch).toBe(1);
    const again = view(env.port, s.id, control);
    expect(await again.closed).toEqual({ code: 4401, reason: "revoked" });
    expect(w.ws.readyState).toBe(WebSocket.OPEN);
    // A control token minted after it works.
    const fresh = view(env.port, s.id, tokenOf(env.live.urlFor(s, "control")));
    expect(await fresh.hello).toMatchObject({ mode: "control" });
    expect(env.live.revoke("00000000-0000-4000-8000-000000000000")).toBeNull();
    env.sessions.end(s.id, "released");
    expect(env.live.revoke(s.id)).toBeNull();
  });

  it("exp closes 4401 expired, and an expired token is refused at its hello", async () => {
    env = await setup({ controlSeconds: 2 });
    const s = await env.make();
    const url = env.live.urlFor(s, "control");
    const exp = JSON.parse(Buffer.from(tokenOf(url).split(".")[0], "base64url").toString("utf8")).e as number;
    // The host's clock, a moment before exp.
    env.shiftWall(exp * 1000 - 200 - Date.now());
    const v = view(env.port, s.id, tokenOf(url));
    expect(await v.hello).toMatchObject({ mode: "control", exp });
    expect(await v.closed).toEqual({ code: 4401, reason: "expired" });
    const late = view(env.port, s.id, tokenOf(url));
    expect(await late.closed).toEqual({ code: 4401, reason: "expired" });
  });
});

describe("who may be a viewer", () => {
  it("a fifth viewer gets 4409; once one leaves, another may come", async () => {
    env = await setup();
    const s = await env.make();
    const four = [0, 1, 2, 3].map(() => view(env!.port, s.id, tokenOf(env!.live.urlFor(s, "watch"))));
    for (const v of four) expect(await v.hello).toMatchObject({ mode: "watch" });
    const fifth = view(env.port, s.id, tokenOf(env.live.urlFor(s, "watch")));
    expect(await fifth.closed).toEqual({ code: 4409, reason: "full" });
    four[0].ws.close();
    await four[0].closed;
    await until(() => env!.live.counts().viewers === 3);
    expect(await view(env.port, s.id, tokenOf(env.live.urlFor(s, "watch"))).hello).toMatchObject({ mode: "watch" });
  });

  it("a second socket on one token closes the first with 4408 and takes over (never a lock out with 4409)", async () => {
    env = await setup();
    const s = await env.make();
    const t = tokenOf(env.live.urlFor(s, "control"));
    const first = view(env.port, s.id, t);
    await first.hello;
    await until(() => env!.tabs.length === 1);
    first.send(MOUSE_DOWN);
    await until(() => env!.tabs[0].inputs().length === 1);
    const second = view(env.port, s.id, t);
    expect(await second.hello).toMatchObject({ mode: "control" });
    expect(await first.closed).toEqual({ code: 4408, reason: "replaced" });
    // The first's held button released; the tab connection and the screencast stay for the second.
    await until(() => env!.tabs[0].inputs().length === 2);
    expect(env.tabs[0].inputs()[1].params).toMatchObject({ type: "mouseReleased", button: "left" });
    second.send({ t: "text", text: "still typing" });
    await until(() => env!.tabs[0].inputs().length === 3);
    expect(env.tabs[0].inputs()[2].params).toEqual({ text: "still typing" });
    expect(env.tabs).toHaveLength(1);
    expect(env.tabs[0].methods()).not.toContain("Page.stopScreencast");
    expect(env.live.counts()).toMatchObject({ viewers: 1, replaced: 1, full: 0 });
  });

  it("a bad Origin is refused 403 before the upgrade", async () => {
    env = await setup();
    const s = await env.make();
    for (const origin of ["http://evil.test", "http://localhost:3016", "http://127.0.0.1:8790"]) {
      const ws = new WebSocket(`ws://127.0.0.1:${env.port}/live/${s.id}/ws`, { origin });
      const status = await new Promise<number>((resolve) => {
        ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
        ws.on("open", () => resolve(101));
        ws.on("error", () => undefined);
      });
      expect({ origin, status }).toEqual({ origin, status: 403 });
    }
    const none = new WebSocket(`ws://127.0.0.1:${env.port}/live/${s.id}/ws`);
    expect(await new Promise<number>((r) => none.on("unexpected-response", (_q, res) => r(res.statusCode ?? 0)).on("error", () => undefined))).toBe(403);
    expect(env.live.counts()).toMatchObject({ refusedOrigin: 4, connects: 0 });
    expect(env.tabs).toHaveLength(0);
  });

  it("a bad hello closes 4400, a token that is not good 4401 invalid, and a session not running {t:ended} then 4404", async () => {
    env = await setup();
    const s = await env.make();
    const other = await env.make();
    const bad = view(env.port, s.id, null);
    await new Promise<void>((r) => bad.ws.on("open", () => r()));
    bad.ws.send(JSON.stringify({ t: "mouse", type: "down" }));
    expect(await bad.closed).toEqual({ code: 4400, reason: "bad_hello" });
    expect(await view(env.port, s.id, tokenOf(env.live.urlFor(other, "control"))).closed).toEqual({ code: 4401, reason: "invalid" });
    expect(await view(env.port, s.id, "nope.nope").closed).toEqual({ code: 4401, reason: "invalid" });
    const gone = view(env.port, "00000000-0000-4000-8000-000000000000", tokenOf(env.live.urlFor(s, "watch")));
    expect(await gone.closed).toEqual({ code: 4404, reason: "ended" });
    expect(gone.texts).toEqual([{ t: "ended" }]);
    // A session that ends with viewers: each is told, then closed 4404.
    const w = view(env.port, s.id, tokenOf(env.live.urlFor(s, "watch")));
    await w.hello;
    env.sessions.end(s.id, "released");
    expect(await w.closed).toEqual({ code: 4404, reason: "ended" });
    expect(w.texts.at(-1)).toEqual({ t: "ended" });
  });
});

describe("on the host's timers (fake)", () => {
  it("a viewer that says no hello within 5 seconds is closed 4400", async () => {
    vi.useFakeTimers();
    env = await setup({ fakeClock: true });
    const s = await env.make();
    const ws = fakeSocket();
    env.live.accept(ws as never, s.id, "203.0.113.9");
    vi.advanceTimersByTime(HELLO_MS - 1);
    expect(ws.closedWith).toBeNull();
    vi.advanceTimersByTime(1);
    expect(ws.closedWith).toEqual({ code: 4400, reason: "no_hello" });
  });

  it("the host pings every viewer; one silent for 45 seconds is closed and its slot freed, one that answers stays", async () => {
    vi.useFakeTimers();
    env = await setup({ fakeClock: true });
    const s = await env.make();
    const silent = fakeSocket();
    const alive = fakeSocket();
    env.live.accept(silent as never, s.id, "203.0.113.9");
    env.live.accept(alive as never, s.id, "203.0.113.9");
    silent.hello(tokenOf(env.live.urlFor(s, "watch")));
    alive.hello(tokenOf(env.live.urlFor(s, "watch")));
    expect(env.live.counts().viewers).toBe(2);
    for (let i = 0; i < 4; i += 1) {
      await vi.advanceTimersByTimeAsync(PING_MS);
      alive.emit("pong");
    }
    expect(silent.pings).toBe(2);
    expect(alive.pings).toBe(4);
    expect(DEAD_MS).toBe(45_000);
    expect(silent.terminated).toBe(true);
    expect(alive.terminated).toBe(false);
    expect(env.live.counts()).toMatchObject({ viewers: 1, silent: 1 });
  });

  it("the screencast starts with the first viewer and stops with the last, each frame acknowledged at least 66 ms after the last", async () => {
    vi.useFakeTimers();
    env = await setup({ fakeClock: true });
    const s = await env.make();
    const a = fakeSocket();
    const b = fakeSocket();
    env.live.accept(a as never, s.id, "203.0.113.9");
    a.hello(tokenOf(env.live.urlFor(s, "watch")));
    await vi.advanceTimersByTimeAsync(0);
    const tab = env.tabs[0];
    expect(tab.sent.map((x) => [x.method, x.params])).toEqual([["Page.startScreencast", { format: "jpeg", quality: 65, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 }]]);
    env.live.accept(b as never, s.id, "203.0.113.9");
    b.hello(tokenOf(env.live.urlFor(s, "watch")));
    for (let i = 1; i <= 5; i += 1) tab.emit("Page.screencastFrame", frameEvent(i));
    await vi.advanceTimersByTimeAsync(1000);
    const acks = tab.sent.filter((x) => x.method === "Page.screencastFrameAck");
    expect(acks.map((x) => x.params.sessionId)).toEqual([1, 2, 3, 4, 5]);
    for (let i = 1; i < acks.length; i += 1) expect(acks[i].at - acks[i - 1].at).toBeGreaterThanOrEqual(ACK_GAP_MS);
    expect(a.frames()).toHaveLength(5);
    expect(headerOf(a.frames()[0])).toEqual({ w: 1280, h: 800, sx: 0, sy: 120, seq: 1 });
    // One start for the two viewers; the stop and start after the acknowledgements are the settle (its own test).
    expect(tab.methods().slice(0, 7)).toEqual(["Page.startScreencast", ...Array(5).fill("Page.screencastFrameAck"), "Page.stopScreencast"]);
    a.close(1000, "");
    await vi.advanceTimersByTimeAsync(0);
    const stopsWithOne = tab.methods().filter((m) => m === "Page.stopScreencast").length;
    b.close(1000, "");
    await vi.advanceTimersByTimeAsync(0);
    expect(tab.methods().at(-1)).toBe("Page.stopScreencast");
    expect(tab.methods().filter((m) => m === "Page.stopScreencast")).toHaveLength(stopsWithOne + 1);
    expect(tab.closed).toEqual({ drain: true });
  });

  it("a burst whose acknowledgements had to wait is followed, once quiet, by one restart of the screencast; a frame in time, or frames that never waited, cause none", async () => {
    vi.useFakeTimers();
    env = await setup({ fakeClock: true });
    const s = await env.make();
    const v = fakeSocket();
    env.live.accept(v as never, s.id, "203.0.113.9");
    v.hello(tokenOf(env.live.urlFor(s, "watch")));
    await vi.advanceTimersByTimeAsync(0);
    const tab = env.tabs[0];
    const restarts = () => tab.methods().filter((m) => m === "Page.stopScreencast").length;
    // Frames far apart: each acknowledged at once, nothing waited, no restart.
    for (let i = 1; i <= 3; i += 1) {
      tab.emit("Page.screencastFrame", frameEvent(1));
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(restarts()).toBe(0);
    // A burst: three frames at once, the last two acknowledged 66 and 132 ms later.
    for (let i = 0; i < 3; i += 1) tab.emit("Page.screencastFrame", frameEvent(1));
    await vi.advanceTimersByTimeAsync(2 * ACK_GAP_MS + SETTLE_MS - 1);
    expect(restarts()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(tab.methods().slice(-2)).toEqual(["Page.stopScreencast", "Page.startScreencast"]);
    expect(tab.sent.at(-1)?.params).toEqual({ format: "jpeg", quality: 65, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });
    // The restart's own frame is acknowledged at once: no second restart.
    tab.emit("Page.screencastFrame", frameEvent(2));
    await vi.advanceTimersByTimeAsync(2000);
    expect(restarts()).toBe(1);
    // A burst, then a frame within the settle window: Chrome captures again, so no restart.
    for (let i = 0; i < 3; i += 1) tab.emit("Page.screencastFrame", frameEvent(2));
    await vi.advanceTimersByTimeAsync(2 * ACK_GAP_MS + SETTLE_MS - 50);
    tab.emit("Page.screencastFrame", frameEvent(2));
    await vi.advanceTimersByTimeAsync(2000);
    expect(restarts()).toBe(1);
    expect(env.live.counts().settles).toBe(1);
  });

  it("a slow viewer gets the newest frame only, a frame not starting FF D8 or over 2 MB is dropped (still acknowledged), and a viewer who joins gets the newest", async () => {
    vi.useFakeTimers();
    env = await setup({ fakeClock: true });
    const s = await env.make();
    const fast = fakeSocket();
    const behind = fakeSocket();
    const writing = fakeSocket();
    for (const v of [fast, behind, writing]) {
      env.live.accept(v as never, s.id, "203.0.113.9");
      v.hello(tokenOf(env.live.urlFor(s, "watch")));
    }
    await vi.advanceTimersByTimeAsync(0);
    const tab = env.tabs[0];
    behind.bufferedAmount = BUFFER_MAX;
    writing.holdCallbacks = true;
    tab.emit("Page.screencastFrame", frameEvent(1, jpeg(1)));
    tab.emit("Page.screencastFrame", frameEvent(2, Buffer.from("not a jpeg at all")));
    tab.emit("Page.screencastFrame", frameEvent(3, Buffer.concat([jpeg(2), Buffer.alloc(FRAME_MAX)])));
    tab.emit("Page.screencastFrame", frameEvent(4, jpeg(4)));
    tab.emit("Page.screencastFrame", frameEvent(5, jpeg(5)));
    expect(fast.frames().map((f) => jpegOf(f)[2])).toEqual([1, 4, 5]);
    expect(behind.frames()).toHaveLength(0);
    // One frame still being written: the next waits, and only the newest of them is kept.
    expect(writing.frames().map((f) => jpegOf(f)[2])).toEqual([1]);
    writing.callbacks.shift()!();
    expect(writing.frames().map((f) => jpegOf(f)[2])).toEqual([1, 5]);
    behind.bufferedAmount = 0;
    await vi.advanceTimersByTimeAsync(400);
    expect(behind.frames().map((f) => jpegOf(f)[2])).toEqual([5]);
    expect(env.live.counts()).toMatchObject({ frames: 3, framesDropped: 2 });
    expect(tab.sent.filter((x) => x.method === "Page.screencastFrameAck").map((x) => x.params.sessionId)).toEqual([1, 2, 3, 4, 5]);
    const late = fakeSocket();
    env.live.accept(late as never, s.id, "203.0.113.9");
    late.hello(tokenOf(env.live.urlFor(s, "watch")));
    expect(late.frames().map((f) => jpegOf(f)[2])).toEqual([5]);
  });

  it("the tab is looked for each second while a viewer waits", async () => {
    vi.useFakeTimers();
    const tab = fakeTab(() => Date.now());
    env = await setup({ fakeClock: true, tabs: [null, null, tab] });
    const s = await env.make();
    const v = fakeSocket();
    env.live.accept(v as never, s.id, "203.0.113.9");
    v.hello(tokenOf(env.live.urlFor(s, "control")));
    await vi.advanceTimersByTimeAsync(0);
    expect(env.opens()).toBe(1);
    await vi.advanceTimersByTimeAsync(TAB_POLL_MS);
    expect(env.opens()).toBe(2);
    expect(tab.sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(TAB_POLL_MS);
    expect(env.opens()).toBe(3);
    expect(tab.methods()).toEqual(["Page.startScreencast", "Page.bringToFront"]);
    // Input before the tab was there was not kept for later.
    tab.lose();
    v.say(MOUSE_DOWN);
    expect(tab.inputs()).toHaveLength(0);
  });

  it("past 300 messages a second moves are dropped; presses never are; past 600 the viewer is closed 4429", async () => {
    vi.useFakeTimers();
    env = await setup({ fakeClock: true });
    const s = await env.make();
    const v = fakeSocket();
    env.live.accept(v as never, s.id, "203.0.113.9");
    v.hello(tokenOf(env.live.urlFor(s, "control")));
    await vi.advanceTimersByTimeAsync(0);
    const tab = env.tabs[0];
    for (let i = 0; i < 350; i += 1) v.say({ t: "mouse", type: "move", x: i, y: 1 });
    expect(tab.inputs()).toHaveLength(300);
    v.say({ t: "key", type: "down", key: "Shift", code: "ShiftLeft", vk: 16, mods: 8, location: 1 });
    for (let i = 0; i < 100; i += 1) v.say({ t: "key", type: i % 2 ? "up" : "down", key: "a", code: "KeyA", vk: 65, text: "a" });
    expect(tab.inputs()).toHaveLength(401);
    expect(v.closedWith).toBeNull();
    for (let i = 0; i < 200; i += 1) v.say({ t: "key", type: i % 2 ? "up" : "down", key: "b", code: "KeyB", vk: 66, text: "b" });
    expect(v.closedWith).toEqual({ code: 4429, reason: "rate_limited" });
    // Every key up to the 600th went, in order, none after; and what it held was released.
    const keys = tab.inputs().filter((x) => x.method === "Input.dispatchKeyEvent").map((x) => x.params);
    expect(keys.filter((k) => k.key === "b" && k.type !== "keyUp")).toHaveLength(75);
    expect(keys.slice(-2)).toEqual([
      expect.objectContaining({ type: "keyUp", key: "Shift", code: "ShiftLeft", modifiers: 0 }),
      expect.objectContaining({ type: "keyUp", key: "b", modifiers: 0 }),
    ]);
  });

  it("60 connects a minute from an address, then 4429; 20 token failures block its connects for 10 minutes", async () => {
    vi.useFakeTimers();
    env = await setup({ fakeClock: true });
    const s = await env.make();
    for (let i = 0; i < 60; i += 1) {
      const v = fakeSocket();
      env.live.accept(v as never, s.id, "198.51.100.4");
      expect(v.closedWith).toBeNull();
      v.close(1000, "");
    }
    const over = fakeSocket();
    env.live.accept(over as never, s.id, "198.51.100.4");
    expect(over.closedWith).toEqual({ code: 4429, reason: "rate_limited" });
    for (let i = 0; i < 20; i += 1) {
      const v = fakeSocket();
      env.live.accept(v as never, s.id, "192.0.2.7");
      v.hello("bad.token");
    }
    const blocked = fakeSocket();
    env.live.accept(blocked as never, s.id, "192.0.2.7");
    expect(blocked.closedWith).toEqual({ code: 4429, reason: "rate_limited" });
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    const still = fakeSocket();
    env.live.accept(still as never, s.id, "192.0.2.7");
    expect(still.closedWith).toEqual({ code: 4429, reason: "rate_limited" });
    await vi.advanceTimersByTimeAsync(61_000);
    const free = fakeSocket();
    env.live.accept(free as never, s.id, "192.0.2.7");
    expect(free.closedWith).toBeNull();
  });
});

describe("nothing kept", () => {
  it("no fs write happens across a live session, and no frame, input, token or id is logged", async () => {
    const writes = [
      vi.spyOn(fs, "writeFileSync"),
      vi.spyOn(fs, "writeFile"),
      vi.spyOn(fs, "appendFileSync"),
      vi.spyOn(fs, "appendFile"),
      vi.spyOn(fs, "writeSync"),
      vi.spyOn(fs, "createWriteStream"),
      vi.spyOn(fs.promises, "writeFile"),
      vi.spyOn(fs.promises, "appendFile"),
    ];
    env = await setup();
    const s = await env.make();
    const control = tokenOf(env.live.urlFor(s, "control"));
    const watch = tokenOf(env.live.urlFor(s, "watch"));
    const c = view(env.port, s.id, control);
    const w = view(env.port, s.id, watch);
    await c.hello;
    await w.hello;
    await until(() => env!.tabs.length === 1);
    const marker = Buffer.from("FRAME_WORDS_ON_THE_PAGE");
    env.tabs[0].emit("Page.screencastFrame", frameEvent(1, Buffer.concat([Buffer.from([0xff, 0xd8]), marker])));
    await until(() => c.frames.length === 1 && w.frames.length === 1);
    expect(jpegOf(c.frames[0]).includes(marker)).toBe(true);
    c.send({ t: "text", text: "TYPED_SECRET_42" });
    c.send({ t: "key", type: "down", key: "q", code: "KeyQ", vk: 81, text: "q" });
    await until(() => env!.tabs[0].inputs().length === 2);
    w.send({ t: "text", text: "WATCHER_WORDS" });
    await w.closed;
    env.live.revoke(s.id);
    await c.closed;
    env.sessions.end(s.id, "released");
    for (const spy of writes) expect(spy).not.toHaveBeenCalled();
    const all = env.lines.join("\n");
    expect(env.lines.length).toBeGreaterThan(5);
    for (const secret of ["TYPED_SECRET_42", "WATCHER_WORDS", "FRAME_WORDS", marker.toString("base64").slice(0, 12), control.slice(0, 20), watch.slice(-20), s.id, "127.0.0.1"]) expect(all).not.toContain(secret);
    for (const l of env.lines) expect(l).toMatch(/^\[host\] [a-z0-9_ =?]+$/);
  });
});

describe("the live view's connection to the tab", () => {
  it("sends only LIVE_METHODS, across watch, control, every input, revoke and the end", async () => {
    env = await setup();
    const s = await env.make();
    const c = view(env.port, s.id, tokenOf(env.live.urlFor(s, "control")));
    const w = view(env.port, s.id, tokenOf(env.live.urlFor(s, "watch")));
    await c.hello;
    await w.hello;
    await until(() => env!.tabs.length === 1);
    env.tabs[0].emit("Page.screencastFrame", frameEvent(9));
    for (const m of [
      MOUSE_DOWN,
      { t: "mouse", type: "move", x: 1, y: 1 },
      { t: "key", type: "down", key: "Tab", code: "Tab", vk: 9 },
      { t: "text", text: "x" },
      { t: "ime", text: "y" },
      { t: "wheel", x: 1, y: 1, dx: 1, dy: 1 },
      { t: "evaluate", expression: "1" },
      { t: "navigate", url: "http://example.com/" },
    ])
      c.send(m);
    await until(() => env!.tabs[0].inputs().length >= 6);
    env.live.revoke(s.id);
    await c.closed;
    env.sessions.end(s.id, "released");
    await w.closed;
    const methods = env.tabs.flatMap((t) => t.methods());
    expect(new Set(methods)).toEqual(new Set(["Page.startScreencast", "Page.bringToFront", "Page.screencastFrameAck", "Input.dispatchMouseEvent", "Input.dispatchKeyEvent", "Input.insertText", "Input.imeSetComposition", "Page.stopScreencast"]));
    for (const m of methods) expect(LIVE_METHODS).toContain(m);
  });

  it("connectTab refuses any other method without sending it, and keeps at most 50 in flight, in order", async () => {
    const got: Array<{ id: number; method: string }> = [];
    const peers: WebSocket[] = [];
    const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((r) => wss.once("listening", () => r()));
    wss.on("connection", (ws) => {
      peers.push(ws);
      ws.on("message", (d) => got.push(JSON.parse(String(d))));
    });
    const url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/devtools/page/T1`;
    const tab = await connectTab(url);
    for (const bad of ["Runtime.evaluate", "DOM.getDocument", "Emulation.setTouchEmulationEnabled", "Network.enable", "Fetch.enable", "Target.createTarget", "Page.navigate"]) {
      await expect(tab.send(bad, {})).rejects.toThrow("not_a_live_method");
    }
    const answers = Array.from({ length: 60 }, (_, i) => tab.send("Input.insertText", { text: String(i) }));
    await until(() => got.length === 50);
    await new Promise((r) => setTimeout(r, 30));
    expect(got).toHaveLength(50);
    expect(tab.backlog()).toBe(10);
    // Chrome answers the first ten: ten more go.
    for (const m of got.slice(0, 10)) peers[0].send(JSON.stringify({ id: m.id, result: {} }));
    await until(() => got.length === 60);
    expect(got.map((m) => m.method).every((m) => m === "Input.insertText")).toBe(true);
    expect(got.map((m) => (m as unknown as { params: { text: string } }).params.text)).toEqual(Array.from({ length: 60 }, (_, i) => String(i)));
    for (const m of got.slice(10)) peers[0].send(JSON.stringify({ id: m.id, result: {} }));
    await Promise.all(answers);
    // An event reaches its listener.
    const events: string[] = [];
    tab.onEvent((m) => events.push(m));
    peers[0].send(JSON.stringify({ method: "Page.screencastFrame", params: { sessionId: 1 } }));
    await until(() => events.length === 1);
    tab.close();
    await new Promise<void>((r) => wss.close(() => r()));
  });

  it("findTab answers the launch tab, else the one page left, else none", async () => {
    let list: unknown[] = [];
    const server = http.createServer((_q, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(list));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const devtoolsBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    list = [
      { type: "page", id: "OTHER" },
      { type: "page", id: "T1" },
      { type: "service_worker", id: "SW" },
    ];
    expect(await findTab({ devtoolsBase, tabTargetId: "T1" })).toBe("T1");
    list = [
      { type: "page", id: "NEW" },
      { type: "iframe", id: "F" },
    ];
    expect(await findTab({ devtoolsBase, tabTargetId: "T1" })).toBe("NEW");
    list = [
      { type: "page", id: "NEW" },
      { type: "page", id: "POPUP" },
    ];
    expect(await findTab({ devtoolsBase, tabTargetId: "T1" })).toBeNull();
    list = [{ type: "page", id: "../../browser" }];
    expect(await findTab({ devtoolsBase, tabTargetId: "T1" })).toBeNull();
    await new Promise<void>((r) => server.close(() => r()));
  });
});
