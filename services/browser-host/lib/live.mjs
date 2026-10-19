// @ts-check
// The live view (docs/plans/browser-host.md section 4, Decisions 6 and 7):
// WebSocket /live/{id}/ws, the picture of a session's tab and, for a control
// view, the person's input to it.
//
// THE UPGRADE: the Origin must be the host's own public origin (the page is
// the host's), else 403 before the upgrade. Rate limits close the socket
// 4429 at once: 60 connects a minute an address, an address blocked for 10
// minutes after 20 token failures in a minute, and an address the API's
// auth failures block.
//
// THE HELLO comes first, within 5 seconds, or the socket is closed 4400. A
// session that is not running answers {t:"ended"} and 4404 (so after a host
// restart the frame says the browser closed); a token that is not good for
// it closes 4401 with the reason invalid, expired or revoked. The host keeps
// only the token's SHA-256: a second socket on the same token closes the
// first 4408 and takes its place (the newest wins: a person whose network
// dropped is never locked out). At most 4 viewers a session; a fifth is
// closed 4409, but for a control view: it closes the oldest watch view
// instead (4409 evicted), so four watchers never keep the person out of
// their own take over.
//
// WATCH VIEWS NEVER TYPE: the first input message on one closes it 4403, and
// no Input command is sent for it. CONTROL VIEWS' input goes through
// lib/live-input.mjs to CDP Input on the tab, in order, at most 300 messages
// a second (past that moves and wheels are dropped; presses, releases and
// keys are never dropped out of order: past 600 messages of any kind, pings
// and junk included, or 100,000 characters of text a minute, the viewer is
// closed 4429), with at most 50 commands in flight. When a control viewer
// leaves, by any close, the host releases every button and key it pressed
// and never released (at most 3 and 16, lib/live-input.mjs). Those releases
// wait, bounded, while there is no tab connection or its backlog is full,
// and go first on the next one, so none is lost to a reconnect.
//
// THE FRAMES: the first viewer starts Page.startScreencast and the last to
// leave stops it. A frame must decode to at most 2 MB and start FF D8, or it
// is dropped. It goes to each viewer whose socket has under 1 MB waiting and
// no frame still being written; a viewer behind keeps only the newest. Each
// frame is acknowledged no sooner than 66 ms after the last acknowledgement,
// so at most 15 a second leave Chrome. The newest frame is held in memory
// only while a viewer is attached, for one who joins.
//
// THE SETTLE: while an acknowledgement waits, Chrome is at its limit of
// frames in flight, drops what it captures then, and never sends it again;
// a page that then stays still (a form sent, the next page loaded) would
// show its old picture for good. So when a frame's acknowledgement had to
// wait, and no frame follows within 150 ms of the last acknowledgement, the
// host restarts the screencast (stop, then start, on its own connection),
// and Chrome captures the page as it is. At most one restart a quiet
// period: the frames a restart itself brings (within 200 ms) never call for
// another. At most one a second, whatever the page does.
//
// THE TAB CONNECTION is the live view's own, to /devtools/page/<the tab>,
// opened at the first viewer (never at the session's start, so it never
// meets the driver's setup) and closed with the last. It may send only
// LIVE_METHODS. The tab is the launch tab, or the one page left once popups
// are closed: /json/list is read each second while a viewer waits. A
// connection that is lost is opened again after 250 ms, doubling to 5
// seconds while it keeps being lost, and back to 250 ms once a frame comes.
//
// PINGS: a websocket ping to every viewer every 15 seconds; one silent for
// 45 seconds is closed and its slot freed. A viewer's {t:"ping"} is answered
// {t:"pong"}.
//
// REVOKE bumps the session's control epoch and closes every control view
// 4401 revoked, so every control token minted before it is void.
//
// NOTHING KEPT: no frame and no input touches the disk, and the log carries
// codes and counts only (section 7).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import WebSocket, { WebSocketServer } from "ws";

import { requestUrl } from "./api.mjs";
import { clientAddress, createLimiter } from "./auth.mjs";
import { createInputMapper, HELD_KEYS_MAX, INPUT_TYPES, isInput, LIVE_METHODS, parseMessage } from "./live-input.mjs";
import { SYSTEM_CLOCK } from "./sessions.mjs";
import { CONTROL_MS, liveTokenHash, mintLive, verifyLive } from "./tokens.mjs";

export const VIEWERS_MAX = 4;
export const HELLO_MS = 5000;
export const PING_MS = 15_000;
export const DEAD_MS = 45_000;
export const ACK_GAP_MS = 66;
export const FRAME_MAX = 2 * 1024 * 1024;
export const BUFFER_MAX = 1024 * 1024;
export const IN_FLIGHT_MAX = 50;
export const BACKLOG_MAX = 1000;
export const MESSAGES_PER_SECOND = 300;
export const HARD_MESSAGES_PER_SECOND = 600;
export const TEXT_PER_MINUTE = 100_000;
export const TAB_POLL_MS = 1000;
export const SETTLE_MS = 150;
/** The frames a restart itself brings, which never call for another. */
export const RESTART_ECHO_MS = 200;
/** The least time between two settle restarts. */
export const SETTLE_GAP_MS = 1000;
/** A lost tab connection is opened again after this, doubling to REOPEN_MAX_MS. */
export const REOPEN_MIN_MS = 250;
export const REOPEN_MAX_MS = 5000;
/** The releases a session may owe at once: four viewers' buttons and keys. */
export const RELEASES_MAX = 4 * (HELD_KEYS_MAX + 3);
export const VIEWER_PAYLOAD_MAX = 64 * 1024;
const TAB_PAYLOAD_MAX = 16 * 1024 * 1024;
const RETRY_MS = 100;
const DRAIN_MS = 1000;

/** The close codes (4.2). */
export const CLOSE = Object.freeze({ badHello: 4400, token: 4401, watchInput: 4403, ended: 4404, replaced: 4408, full: 4409, limited: 4429 });

const PATH = /^\/live\/([A-Za-z0-9_-]{1,200})\/ws$/;
const TARGET_ID = /^[A-Za-z0-9_-]{1,128}$/;
const ENDED = JSON.stringify({ t: "ended" });
const PONG = JSON.stringify({ t: "pong" });
const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * The live view's own connection to a tab.
 * @typedef {{
 *   send: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
 *   backlog: () => number,
 *   onEvent: (fn: (method: string, params: any) => void) => void,
 *   onClose: (fn: () => void) => void,
 *   close: (o?: { drain?: boolean }) => void,
 * }} TabConn
 */

/**
 * A connection to a tab that may send only LIVE_METHODS, in order, with at
 * most `maxInFlight` commands waiting for Chrome's answer (the rest queue).
 * @param {string} wsUrl ws://<devtools>/devtools/page/<id>
 * @param {{ maxInFlight?: number }} [o]
 * @returns {Promise<TabConn>}
 */
export function connectTab(wsUrl, o = {}) {
  const maxInFlight = o.maxInFlight ?? IN_FLIGHT_MAX;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false, followRedirects: false, maxPayload: TAB_PAYLOAD_MAX, handshakeTimeout: 5000 });
    let next = 0;
    let inFlight = 0;
    let open = false;
    let closed = false;
    /** @typedef {{ method: string, params: Record<string, unknown>, resolve: (v: unknown) => void, reject: (e: Error) => void }} Job */
    /** @type {Map<number, Job>} */
    const pending = new Map();
    /** @type {Job[]} */
    const queue = [];
    /** @type {Array<(method: string, params: any) => void>} */
    const events = [];
    /** @type {Array<() => void>} */
    const closes = [];
    /** @type {Array<() => void>} */
    let drained = [];

    const settle = () => {
      if (inFlight === 0 && queue.length === 0) for (const fn of drained.splice(0)) fn();
    };
    const pump = () => {
      while (open && !closed && inFlight < maxInFlight && queue.length > 0) {
        const job = /** @type {Job} */ (queue.shift());
        next += 1;
        pending.set(next, job);
        inFlight += 1;
        ws.send(JSON.stringify({ id: next, method: job.method, params: job.params }));
      }
      settle();
    };
    const fail = () => {
      const e = new Error("tab_closed");
      for (const j of pending.values()) j.reject(e);
      for (const j of queue.splice(0)) j.reject(e);
      pending.clear();
      inFlight = 0;
      settle();
    };

    ws.on("message", (data, binary) => {
      if (binary) return;
      /** @type {any} */
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;
      if (typeof msg.id === "number") {
        const job = pending.get(msg.id);
        if (!job) return;
        pending.delete(msg.id);
        inFlight -= 1;
        if (msg.error) job.reject(new Error("cdp_error"));
        else job.resolve(msg.result);
        pump();
      } else if (typeof msg.method === "string") {
        for (const fn of events) fn(msg.method, msg.params ?? {});
      }
    });
    ws.on("open", () => {
      open = true;
      resolve(conn);
      pump();
    });
    ws.on("error", () => {
      if (!open) reject(new Error("tab_unreachable"));
    });
    ws.on("close", () => {
      const first = !closed;
      closed = true;
      open = false;
      fail();
      if (first) for (const fn of closes) fn();
      reject(new Error("tab_unreachable"));
    });

    /** @type {TabConn} */
    const conn = {
      send(method, params = {}) {
        // The guard the app set up is never touched: nothing but LIVE_METHODS leaves this connection.
        if (!LIVE_METHODS.includes(method)) return Promise.reject(new Error("not_a_live_method"));
        if (closed) return Promise.reject(new Error("tab_closed"));
        return new Promise((res, rej) => {
          queue.push({ method, params, resolve: res, reject: rej });
          pump();
        });
      },
      backlog: () => queue.length,
      onEvent: (fn) => void events.push(fn),
      onClose: (fn) => void closes.push(fn),
      close(c = {}) {
        if (closed) return;
        const shut = () => {
          if (closed) return;
          closed = true;
          try {
            ws.close();
          } catch {
            /* gone */
          }
        };
        if (!c.drain || (inFlight === 0 && queue.length === 0)) return shut();
        // What was asked last (a viewer's held button released, the screencast stopped) goes first.
        const t = setTimeout(shut, DRAIN_MS);
        t.unref?.();
        drained.push(() => {
          clearTimeout(t);
          shut();
        });
      },
    };
  });
}

/**
 * The tab of a session: the launch tab when Chrome still lists it, else the
 * one page left, else null (popups not closed yet, or none).
 * @param {{ devtoolsBase: string, tabTargetId: string }} launched
 * @returns {Promise<string | null>}
 */
export async function findTab(launched) {
  const r = await fetch(`${launched.devtoolsBase}/json/list`, { redirect: "error", signal: AbortSignal.timeout(2000) });
  const list = await r.json();
  const pages = Array.isArray(list) ? list.filter((t) => t && t.type === "page" && typeof t.id === "string" && TARGET_ID.test(t.id)) : [];
  if (pages.some((p) => p.id === launched.tabTargetId)) return launched.tabTargetId;
  return pages.length === 1 ? String(pages[0].id) : null;
}

/**
 * The live view's connection to a session's tab, or null when there is no tab to connect to yet.
 * @param {import("./sessions.mjs").Session} s
 * @returns {Promise<TabConn | null>}
 */
async function openTab(s) {
  const l = s.launched;
  if (!l) return null;
  const id = await findTab(l).catch(() => null);
  if (!id) return null;
  return connectTab(`${l.devtoolsBase.replace(/^http/, "ws")}/devtools/page/${id}`);
}

/** The page's files, served from memory (lib/api.mjs): read once, at start. */
export const ASSET_FILES = Object.freeze({ "live.mjs": "live.mjs", "view.mjs": "view.mjs", "copy.mjs": "copy.mjs", "live.css": "live.css" });

/** @typedef {{ shell: Buffer, files: Map<string, { body: Buffer, type: string }> }} LiveAssets */

/** @returns {LiveAssets} */
export function liveAssets() {
  const dir = path.join(HERE, "..", "live");
  /** @type {Map<string, { body: Buffer, type: string }>} */
  const files = new Map();
  for (const [name, file] of Object.entries(ASSET_FILES)) {
    files.set(name, { body: fs.readFileSync(path.join(dir, file)), type: name.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8" });
  }
  return { shell: fs.readFileSync(path.join(dir, "page.html")), files };
}

/**
 * Refuse an upgrade with a status, then destroy the socket.
 * @param {import("node:stream").Duplex} socket
 * @param {number} status
 */
function refuse(socket, status) {
  try {
    socket.write(`HTTP/1.1 ${status} Forbidden\r\nConnection: close\r\nContent-Length: 0\r\nCache-Control: no-store\r\n\r\n`);
  } catch {
    /* gone */
  }
  socket.destroy();
}

/**
 * @typedef {{
 *   ws: WebSocket,
 *   id: string,
 *   addr: string,
 *   phase: "hello" | "live" | "closed",
 *   mode: "watch" | "control",
 *   hash: string,
 *   exp: number,
 *   mapper: import("./live-input.mjs").InputMapper | null,
 *   lastSeen: number,
 *   timers: Array<ReturnType<typeof setTimeout>>,
 *   rate: { second: number, count: number, minute: number, chars: number },
 *   pending: Buffer | null,
 *   sending: boolean,
 *   retry: ReturnType<typeof setTimeout> | null,
 * }} Viewer
 * @typedef {{
 *   id: string,
 *   viewers: Set<Viewer>,
 *   byToken: Map<string, Viewer>,
 *   tab: TabConn | null,
 *   opening: boolean,
 *   poll: ReturnType<typeof setTimeout> | null,
 *   screencasting: boolean,
 *   newest: Buffer | null,
 *   seq: number,
 *   acks: number[],
 *   ackTimer: ReturnType<typeof setTimeout> | null,
 *   lastAck: number,
 *   paced: boolean,
 *   settleTimer: ReturnType<typeof setTimeout> | null,
 *   lastRestart: number,
 *   backoff: number,
 *   reopen: ReturnType<typeof setTimeout> | null,
 *   releases: import("./live-input.mjs").Command[],
 *   releaseTimer: ReturnType<typeof setTimeout> | null,
 *   leaving: boolean,
 * }} LiveSession
 */

/**
 * The live view.
 * @param {{
 *   cfg: { publicUrl: string, publicOrigin: string, test?: { controlSeconds: number | null } },
 *   sessions: Pick<import("./sessions.mjs").Sessions, "get" | "onEnd">,
 *   bootKey: Buffer,
 *   log: import("./log.mjs").Log,
 *   clock?: import("./sessions.mjs").Clock,
 *   tabConnect?: (s: import("./sessions.mjs").Session) => Promise<TabConn | null>,
 *   blocked?: (addr: string) => number,
 * }} o
 */
export function createLive(o) {
  const { cfg, sessions, bootKey, log } = o;
  const clock = o.clock ?? SYSTEM_CLOCK;
  const tabConnect = o.tabConnect ?? openTab;
  const controlSeconds = cfg.test?.controlSeconds ?? 0;
  const controlMs = controlSeconds > 0 ? controlSeconds * 1000 : CONTROL_MS;
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: VIEWER_PAYLOAD_MAX });
  const mono = () => clock.mono();
  const limits = {
    connects: createLimiter({ limit: 60, windowMs: 60_000, now: mono }),
    // Nineteen are counted; the twentieth blocks, for ten minutes.
    tokenFailures: createLimiter({ limit: 19, windowMs: 60_000, blockMs: 10 * 60_000, now: mono }),
  };
  /** Counts only, for /health (section 7). */
  const tally = {
    connects: 0,
    refusedOrigin: 0,
    refusedHello: 0,
    tokenRefused: 0,
    ended: 0,
    full: 0,
    replaced: 0,
    rateLimited: 0,
    watchInputRefused: 0,
    revoked: 0,
    expired: 0,
    silent: 0,
    frames: 0,
    framesDropped: 0,
    framesSkipped: 0,
    inputsDropped: 0,
    fieldsDropped: 0,
    released: 0,
    releasesDropped: 0,
    keysEvicted: 0,
    watchersEvicted: 0,
    tabReopens: 0,
    settles: 0,
    cdpErrors: 0,
    /** @type {Record<string, number>} */
    inputs: Object.fromEntries(INPUT_TYPES.map((t) => [t, 0])),
  };
  /** @type {Map<string, LiveSession>} */
  const live = new Map();
  /** Every socket, past its upgrade, until it closes. */
  /** @type {Set<Viewer>} */
  const sockets = new Set();

  let closing = false;
  const pinger = setInterval(pingAll, PING_MS);
  pinger.unref?.();
  sessions.onEnd((s) => sessionEnded(s.id));

  /** @param {Viewer} v @param {() => void} fn @param {number} ms */
  const timer = (v, fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    v.timers.push(t);
  };
  /** @param {Viewer} v @param {string} text */
  const sendText = (v, text) => {
    if (v.ws.readyState === WebSocket.OPEN) v.ws.send(text);
  };
  /** @param {LiveSession} ls @param {string} method @param {Record<string, unknown>} params */
  const cmd = (ls, method, params) => {
    ls.tab?.send(method, params).catch(() => void (tally.cdpErrors += 1));
  };

  /** @param {string} id @returns {LiveSession} */
  function liveOf(id) {
    let ls = live.get(id);
    if (!ls) {
      ls = {
        id,
        viewers: new Set(),
        byToken: new Map(),
        tab: null,
        opening: false,
        poll: null,
        screencasting: false,
        newest: null,
        seq: 0,
        acks: [],
        ackTimer: null,
        lastAck: -Infinity,
        paced: false,
        settleTimer: null,
        lastRestart: -Infinity,
        backoff: REOPEN_MIN_MS,
        reopen: null,
        releases: [],
        releaseTimer: null,
        leaving: false,
      };
      live.set(id, ls);
    }
    return ls;
  }

  /**
   * A socket past its upgrade (tests call this directly with their own socket).
   * @param {WebSocket} ws
   * @param {string} id
   * @param {string} addr
   */
  function accept(ws, id, addr) {
    tally.connects += 1;
    /** @type {Viewer} */
    const v = { ws, id, addr, phase: "hello", mode: "watch", hash: "", exp: 0, mapper: null, lastSeen: mono(), timers: [], rate: { second: mono(), count: 0, minute: mono(), chars: 0 }, pending: null, sending: false, retry: null };
    sockets.add(v);
    ws.on("pong", () => void (v.lastSeen = mono()));
    ws.on("message", (data, binary) => onMessage(v, data, binary));
    ws.on("close", () => leave(v, 0, ""));
    ws.on("error", () => leave(v, 0, ""));
    if ((o.blocked?.(addr) ?? 0) > 0 || limits.tokenFailures.blocked(addr) > 0 || limits.connects.hit(addr) > 0) {
      tally.rateLimited += 1;
      log.event("live", "refused", CLOSE.limited);
      leave(v, CLOSE.limited, "rate_limited");
      return;
    }
    timer(
      v,
      () => {
        if (v.phase !== "hello") return;
        tally.refusedHello += 1;
        log.event("live", "refused", CLOSE.badHello);
        leave(v, CLOSE.badHello, "no_hello");
      },
      HELLO_MS,
    );
  }

  /**
   * @param {Viewer} v
   * @param {WebSocket.RawData} data
   * @param {boolean} binary
   */
  function onMessage(v, data, binary) {
    if (v.phase === "closed") return;
    v.lastSeen = mono();
    const msg = binary ? null : parseMessage(String(data));
    if (v.phase === "hello") return hello(v, msg);
    // Every message counts, pings and junk too: past 600 in a second the viewer is closed.
    const now = mono();
    const r = v.rate;
    if (now - r.second >= 1000) {
      r.second = now;
      r.count = 0;
    }
    r.count += 1;
    if (r.count > HARD_MESSAGES_PER_SECOND) {
      tally.rateLimited += 1;
      log.event("live", "input_rate");
      return leave(v, CLOSE.limited, "rate_limited");
    }
    if (!msg) {
      tally.inputsDropped += 1;
      return;
    }
    if (msg.t === "ping") return sendText(v, PONG);
    if (!isInput(msg)) {
      tally.inputsDropped += 1;
      return;
    }
    if (v.mode === "watch") {
      // A watcher never types: nothing is relayed, and the view closes.
      tally.watchInputRefused += 1;
      log.event("live", "watch_input_refused");
      return leave(v, CLOSE.watchInput, "watch");
    }
    input(v, msg);
  }

  /**
   * @param {Viewer} v
   * @param {Record<string, unknown> | null} msg
   */
  function hello(v, msg) {
    if (!msg || msg.t !== "hello" || typeof msg.token !== "string") {
      tally.refusedHello += 1;
      log.event("live", "refused", CLOSE.badHello);
      return leave(v, CLOSE.badHello, "bad_hello");
    }
    const s = sessions.get(v.id);
    if (!s || s.status !== "running") {
      // A forgotten id counts toward the address's token failures, as a guess would.
      if (!s) limits.tokenFailures.hit(v.addr);
      tally.ended += 1;
      sendText(v, ENDED);
      return leave(v, CLOSE.ended, "ended");
    }
    const checked = verifyLive(bootKey, msg.token, { id: v.id, nowMs: clock.wall(), epoch: s.epoch });
    if (!checked.ok) {
      tally.tokenRefused += 1;
      limits.tokenFailures.hit(v.addr);
      log.event("live", "refused", CLOSE.token, checked.reason);
      return leave(v, CLOSE.token, checked.reason);
    }
    const here = liveOf(v.id);
    v.hash = liveTokenHash(msg.token);
    // The newest socket on a token wins (4.2): the older is closed, and the
    // tab connection and the screencast stay for the newer.
    const old = here.byToken.get(v.hash);
    if (old) {
      tally.replaced += 1;
      log.event("live", "replaced");
      leave(old, CLOSE.replaced, "replaced", true);
    }
    if (here.viewers.size >= VIEWERS_MAX) {
      // The person's own take over is never kept out by watchers: the oldest watch view makes room.
      const watcher = checked.mode === "control" ? [...here.viewers].find((x) => x.mode === "watch") : undefined;
      if (!watcher) {
        tally.full += 1;
        log.event("live", "refused", CLOSE.full);
        return leave(v, CLOSE.full, "full");
      }
      tally.watchersEvicted += 1;
      log.event("live", "watcher_evicted");
      leave(watcher, CLOSE.full, "evicted");
    }
    for (const t of v.timers) clearTimeout(t);
    v.timers = [];
    v.phase = "live";
    v.mode = checked.mode;
    v.exp = checked.exp;
    if (v.mode === "control") v.mapper = createInputMapper(s.viewport);
    here.viewers.add(v);
    here.byToken.set(v.hash, v);
    here.leaving = false;
    timer(
      v,
      () => {
        tally.expired += 1;
        log.event("live", "expired");
        leave(v, CLOSE.token, "expired");
      },
      Math.max(0, v.exp * 1000 - clock.wall()),
    );
    sendText(v, JSON.stringify({ t: "hello", mode: v.mode, width: s.viewport.width, height: s.viewport.height, exp: v.exp }));
    log.event("live", "viewer", v.mode, { viewers: here.viewers.size });
    if (here.newest) offer(v, here.newest);
    if (here.tab) {
      if (!here.screencasting) startScreencast(here, s);
      if (v.mode === "control") cmd(here, "Page.bringToFront", {});
    } else ensureTab(here);
  }

  /**
   * @param {LiveSession} ls
   * @param {import("./sessions.mjs").Session} s
   */
  function startScreencast(ls, s) {
    ls.screencasting = true;
    cmd(ls, "Page.startScreencast", { format: "jpeg", quality: 65, maxWidth: s.viewport.width, maxHeight: s.viewport.height, everyNthFrame: 1 });
  }

  /** The tab connection, opened at the first viewer; polled each second while a viewer waits. @param {LiveSession} ls */
  function ensureTab(ls) {
    if (ls.tab || ls.opening || ls.reopen || closing) return;
    ls.opening = true;
    // Wanted while a viewer waits, or a release is owed to the page.
    const wanted = () => {
      const s = sessions.get(ls.id);
      return !closing && live.get(ls.id) === ls && (ls.viewers.size > 0 || ls.releases.length > 0) && s && s.status === "running" ? s : null;
    };
    const attempt = async () => {
      ls.poll = null;
      const s = wanted();
      if (!s) {
        ls.opening = false;
        return;
      }
      /** @type {TabConn | null} */
      let tab = null;
      try {
        tab = await tabConnect(s);
      } catch {
        tab = null;
      }
      const still = wanted();
      if (!still) {
        ls.opening = false;
        tab?.close();
        return;
      }
      if (!tab) {
        ls.poll = setTimeout(() => void attempt(), TAB_POLL_MS);
        ls.poll.unref?.();
        return;
      }
      const conn = tab;
      ls.opening = false;
      ls.tab = conn;
      log.event("live", "tab_open");
      conn.onEvent((method, params) => onTabEvent(ls, conn, method, params));
      conn.onClose(() => {
        if (ls.tab !== conn) return;
        ls.tab = null;
        ls.screencasting = false;
        clearAcks(ls);
        log.event("live", "tab_lost");
        // Opened again after a wait that doubles while it keeps being lost (a frame resets it).
        const wait = ls.backoff;
        ls.backoff = Math.min(REOPEN_MAX_MS, ls.backoff * 2);
        tally.tabReopens += 1;
        ls.reopen = setTimeout(() => {
          ls.reopen = null;
          ensureTab(ls);
        }, wait);
        ls.reopen.unref?.();
      });
      // What viewers held goes first; with no viewer left, that is all this connection was for.
      if (ls.viewers.size === 0) ls.leaving = true;
      flushReleases(ls);
      if (live.get(ls.id) !== ls || ls.viewers.size === 0) return;
      startScreencast(ls, still);
      if ([...ls.viewers].some((x) => x.mode === "control")) cmd(ls, "Page.bringToFront", {});
    };
    void attempt();
  }

  /** @param {LiveSession} ls */
  function clearAcks(ls) {
    if (ls.ackTimer) clearTimeout(ls.ackTimer);
    if (ls.settleTimer) clearTimeout(ls.settleTimer);
    ls.ackTimer = null;
    ls.settleTimer = null;
    ls.acks = [];
    ls.paced = false;
  }

  /** Each frame acknowledged no sooner than 66 ms after the last (at most 15 a second). @param {LiveSession} ls */
  function pumpAcks(ls) {
    if (ls.ackTimer || ls.acks.length === 0) return;
    const wait = Math.max(0, ls.lastAck + ACK_GAP_MS - mono());
    if (wait > 0 && !echo(ls)) ls.paced = true;
    ls.ackTimer = setTimeout(() => {
      ls.ackTimer = null;
      const sid = ls.acks.shift();
      if (sid === undefined || !ls.tab) return;
      ls.lastAck = mono();
      cmd(ls, "Page.screencastFrameAck", { sessionId: sid });
      if (ls.acks.length > 0) return pumpAcks(ls);
      // Every frame acknowledged: if one had to wait, Chrome may have dropped a capture meanwhile.
      if (ls.paced) {
        ls.paced = false;
        if (ls.settleTimer) clearTimeout(ls.settleTimer);
        ls.settleTimer = setTimeout(() => settle(ls), SETTLE_MS);
        ls.settleTimer.unref?.();
      }
    }, wait);
    ls.ackTimer.unref?.();
  }

  /** Whether now is within the frames a settle restart itself brings. @param {LiveSession} ls */
  const echo = (ls) => mono() - ls.lastRestart < RESTART_ECHO_MS;

  /** No frame since the last acknowledgement: the screencast restarted, so Chrome captures the page as it is. @param {LiveSession} ls */
  function settle(ls) {
    ls.settleTimer = null;
    const s = sessions.get(ls.id);
    if (!ls.tab || !ls.screencasting || ls.viewers.size === 0 || !s || s.status !== "running") return;
    // At most one a second: a page that keeps settling waits for its turn.
    const since = mono() - ls.lastRestart;
    if (since < SETTLE_GAP_MS) {
      ls.settleTimer = setTimeout(() => settle(ls), SETTLE_GAP_MS - since);
      ls.settleTimer.unref?.();
      return;
    }
    clearAcks(ls);
    tally.settles += 1;
    ls.lastRestart = mono();
    cmd(ls, "Page.stopScreencast", {});
    startScreencast(ls, s);
  }

  /** @param {unknown} v @param {number} lo @param {number} hi @param {number} d */
  const num = (v, lo, hi, d) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : d);

  /**
   * @param {LiveSession} ls
   * @param {TabConn} conn
   * @param {string} method
   * @param {any} params
   */
  function onTabEvent(ls, conn, method, params) {
    if (method !== "Page.screencastFrame" || ls.tab !== conn) return;
    // A frame came after the acknowledgements: Chrome captures again, and this is newer than anything it dropped.
    if (ls.settleTimer) clearTimeout(ls.settleTimer);
    ls.settleTimer = null;
    if ((ls.acks.length > 0 || ls.ackTimer) && !echo(ls)) ls.paced = true;
    // The connection works: a later loss waits the shortest time again.
    ls.backoff = REOPEN_MIN_MS;
    if (Number.isInteger(params?.sessionId)) {
      ls.acks.push(params.sessionId);
      pumpAcks(ls);
    }
    const data = params?.data;
    if (typeof data !== "string" || data.length > Math.ceil(FRAME_MAX / 3) * 4) {
      tally.framesDropped += 1;
      return;
    }
    const jpeg = Buffer.from(data, "base64");
    if (jpeg.length > FRAME_MAX || jpeg.length < 2 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
      tally.framesDropped += 1;
      return;
    }
    if (ls.viewers.size === 0) return;
    const m = params.metadata ?? {};
    const vp = sessions.get(ls.id)?.viewport ?? { width: 1280, height: 800 };
    ls.seq += 1;
    const header = Buffer.from(
      JSON.stringify({ w: num(m.deviceWidth, 1, 10_000, vp.width), h: num(m.deviceHeight, 1, 10_000, vp.height), sx: num(m.scrollOffsetX, -1e7, 1e7, 0), sy: num(m.scrollOffsetY, -1e7, 1e7, 0), seq: ls.seq }),
      "utf8",
    );
    const lead = Buffer.alloc(5);
    lead[0] = 0x01;
    lead.writeUInt32BE(header.length, 1);
    const frame = Buffer.concat([lead, header, jpeg]);
    ls.newest = frame;
    tally.frames += 1;
    for (const v of ls.viewers) offer(v, frame);
  }

  /**
   * A frame to a viewer: at once while it has under 1 MB waiting and no frame
   * still being written; else it keeps only the newest.
   * @param {Viewer} v
   * @param {Buffer} frame
   */
  function offer(v, frame) {
    if (v.phase !== "live" || v.ws.readyState !== WebSocket.OPEN) return;
    if (v.sending || v.ws.bufferedAmount >= BUFFER_MAX) {
      if (v.pending) tally.framesSkipped += 1;
      v.pending = frame;
      if (!v.sending && !v.retry) {
        v.retry = setTimeout(() => {
          v.retry = null;
          const next = v.pending;
          v.pending = null;
          if (next) offer(v, next);
        }, RETRY_MS);
        v.retry.unref?.();
      }
      return;
    }
    v.sending = true;
    v.ws.send(frame, { binary: true }, () => {
      v.sending = false;
      const next = v.pending;
      v.pending = null;
      if (next) offer(v, next);
    });
  }

  /**
   * A control viewer's input.
   * @param {Viewer} v
   * @param {Record<string, unknown>} msg
   */
  function input(v, msg) {
    const ls = live.get(v.id);
    const mapper = v.mapper;
    if (!ls || !mapper) return;
    const now = mono();
    const r = v.rate;
    if (now - r.minute >= 60_000) {
      r.minute = now;
      r.chars = 0;
    }
    const droppable = msg.t === "wheel" || (msg.t === "mouse" && msg.type === "move");
    const tab = ls.tab;
    // Moves and wheels go first when it is busy; nothing is sent before the tab is connected.
    if (!tab || (droppable && (r.count > MESSAGES_PER_SECOND || tab.backlog() > 0))) {
      tally.inputsDropped += 1;
      return;
    }
    if (tab.backlog() > BACKLOG_MAX) {
      tally.rateLimited += 1;
      log.event("live", "input_backlog");
      return leave(v, CLOSE.limited, "rate_limited");
    }
    const out = mapper.map(msg);
    tally.fieldsDropped += out.droppedFields;
    if (!out.ok) {
      tally.inputsDropped += 1;
      return;
    }
    r.chars += out.chars;
    if (r.chars > TEXT_PER_MINUTE) {
      tally.rateLimited += 1;
      log.event("live", "text_rate");
      return leave(v, CLOSE.limited, "rate_limited");
    }
    tally.keysEvicted += out.evicted;
    for (const c of out.commands) cmd(ls, c.method, c.params);
    if (Object.hasOwn(tally.inputs, out.kind)) tally.inputs[out.kind] += 1;
  }

  /**
   * A viewer leaves, by any close: what it held is released, and the last
   * viewer stops the screencast and closes the tab connection. `code` 0 means
   * the socket closed itself; `replaced`, that a newer socket on its token
   * takes its place at once, so the tab connection stays.
   * @param {Viewer} v
   * @param {number} code
   * @param {string} reason
   * @param {boolean} [replaced]
   */
  function leave(v, code, reason, replaced = false) {
    if (v.phase === "closed") return;
    const wasLive = v.phase === "live";
    v.phase = "closed";
    sockets.delete(v);
    for (const t of v.timers) clearTimeout(t);
    v.timers = [];
    if (v.retry) clearTimeout(v.retry);
    v.retry = null;
    v.pending = null;
    const ls = live.get(v.id);
    if (wasLive && ls && ls.viewers.has(v)) {
      ls.viewers.delete(v);
      if (ls.byToken.get(v.hash) === v) ls.byToken.delete(v.hash);
      if (v.mapper) {
        // So no button or key stays held in the remote page for the teammate's next act.
        const held = v.mapper.release();
        tally.released += held.length;
        owe(ls, held);
      }
      if (ls.viewers.size === 0 && !replaced) lastLeft(ls);
      else flushReleases(ls);
    }
    if (code) {
      try {
        v.ws.close(code, reason);
      } catch {
        /* gone */
      }
    }
  }

  /**
   * Releases owed to the page, at most RELEASES_MAX (the oldest go past it).
   * @param {LiveSession} ls
   * @param {import("./live-input.mjs").Command[]} commands
   */
  function owe(ls, commands) {
    ls.releases.push(...commands);
    const over = ls.releases.length - RELEASES_MAX;
    if (over > 0) {
      ls.releases.splice(0, over);
      tally.releasesDropped += over;
    }
  }

  /**
   * The releases owed, sent while there is a tab connection with room in its
   * backlog (else tried again shortly). With no viewer left, the live session
   * is let go once they are sent.
   * @param {LiveSession} ls
   */
  function flushReleases(ls) {
    if (ls.releaseTimer) clearTimeout(ls.releaseTimer);
    ls.releaseTimer = null;
    if (!ls.tab || ls.releases.length === 0) return;
    if (ls.tab.backlog() > BACKLOG_MAX) {
      ls.releaseTimer = setTimeout(() => flushReleases(ls), RETRY_MS);
      ls.releaseTimer.unref?.();
      return;
    }
    for (const c of ls.releases.splice(0)) cmd(ls, c.method, c.params);
    // The last viewer left while these were owed: now it may be let go.
    if (ls.leaving && ls.viewers.size === 0) lastLeft(ls);
  }

  /** The last viewer left: the releases owed sent (or kept until a connection can take them), the screencast stopped. @param {LiveSession} ls */
  function lastLeft(ls) {
    const s = sessions.get(ls.id);
    // A browser that is closing needs no release.
    if (!s || s.status !== "running") ls.releases = [];
    if (ls.tab && ls.releases.length > 0 && ls.tab.backlog() <= BACKLOG_MAX) for (const c of ls.releases.splice(0)) cmd(ls, c.method, c.params);
    if (ls.tab && ls.screencasting) cmd(ls, "Page.stopScreencast", {});
    ls.screencasting = false;
    ls.newest = null;
    clearAcks(ls);
    if (ls.releases.length > 0) {
      // Owed still: the connection is busy, or gone and opened again for them.
      ls.leaving = true;
      if (ls.tab) flushReleases(ls);
      else ensureTab(ls);
      return;
    }
    finish(ls);
  }

  /** The live session let go: its tab connection closed once what it was asked is sent. @param {LiveSession} ls */
  function finish(ls) {
    const tab = ls.tab;
    ls.tab = null;
    ls.opening = false;
    ls.leaving = false;
    ls.releases = [];
    for (const t of [ls.poll, ls.reopen, ls.releaseTimer]) if (t) clearTimeout(t);
    ls.poll = null;
    ls.reopen = null;
    ls.releaseTimer = null;
    clearAcks(ls);
    if (live.get(ls.id) === ls) live.delete(ls.id);
    tab?.close({ drain: true });
  }

  function pingAll() {
    const now = mono();
    for (const v of [...sockets]) {
      if (v.phase !== "live") continue;
      if (now - v.lastSeen >= DEAD_MS) {
        tally.silent += 1;
        log.event("live", "viewer_silent");
        try {
          v.ws.terminate();
        } catch {
          /* gone */
        }
        leave(v, 0, "");
        continue;
      }
      try {
        v.ws.ping();
      } catch {
        /* closing */
      }
    }
  }

  /** The session ended: {t:"ended"} then 4404 to every viewer, then the tab connection closed. @param {string} id */
  function sessionEnded(id) {
    for (const v of [...sockets]) {
      if (v.id !== id) continue;
      tally.ended += 1;
      sendText(v, ENDED);
      leave(v, CLOSE.ended, "ended");
    }
    const ls = live.get(id);
    if (ls) finish(ls);
  }

  return {
    accept,
    /**
     * The /live/{id}/ws upgrade: false when the path is not one.
     * @param {import("node:http").IncomingMessage} req
     * @param {import("node:stream").Duplex} socket
     * @param {Buffer} head
     */
    upgrade(req, socket, head) {
      const url = requestUrl(req.url);
      const m = url ? PATH.exec(url.pathname) : null;
      if (!m) return false;
      if (req.headers.origin !== cfg.publicOrigin) {
        tally.refusedOrigin += 1;
        log.event("live", "refused", 403);
        refuse(socket, 403);
        return true;
      }
      const addr = clientAddress(req);
      wss.handleUpgrade(req, socket, head, (ws) => accept(ws, m[1], addr));
      return true;
    },
    /**
     * The live view's address for a session: /live/<id>#t=<token>, the token in the fragment, never a query.
     * @param {import("./sessions.mjs").Session} s
     * @param {"watch" | "control"} mode
     */
    urlFor(s, mode) {
      const end = Date.parse(String(s.expiresAt));
      const { token } = mintLive(bootKey, { id: s.id, mode, nowMs: clock.wall(), sessionEndMs: Number.isFinite(end) ? end : clock.wall(), epoch: s.epoch, controlMs });
      return `${cfg.publicUrl}/live/${s.id}#t=${token}`;
    },
    /**
     * Revoke (Decision 7): the control epoch bumped and every control view closed 4401 revoked.
     * The number closed, or null when the session is unknown or not running.
     * @param {string} id
     * @returns {number | null}
     */
    revoke(id) {
      const s = sessions.get(id);
      if (!s || s.status !== "running") return null;
      s.epoch += 1;
      let n = 0;
      for (const v of [...sockets]) {
        if (v.id !== id || v.phase !== "live" || v.mode !== "control") continue;
        n += 1;
        leave(v, CLOSE.token, "revoked");
      }
      tally.revoked += n;
      log.event("live", "revoked", { views: n });
      return n;
    },
    sessionEnded,
    counts: () => {
      let viewers = 0;
      for (const ls of live.values()) viewers += ls.viewers.size;
      return { viewers, ...tally, inputs: { ...tally.inputs } };
    },
    close() {
      closing = true;
      clearInterval(pinger);
      for (const v of [...sockets]) leave(v, 1001, "");
      for (const ls of [...live.values()]) finish(ls);
      wss.close();
    },
  };
}

/** @typedef {ReturnType<typeof createLive>} Live */
