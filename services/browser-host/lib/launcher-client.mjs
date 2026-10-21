// @ts-check
// Container mode's launcher (docs/plans/browser-host.md 5.1 and 5.5): the
// host's client of the launcher service, over its unix socket. The host
// itself has no Docker access at all (Decision 19); this asks the service's
// fixed operations and does the rest over the session's own bridge.
//
// LAUNCH asks `start`, then polls http://<container IP>:9222/json/version
// itself, every 100 ms, and reads the launch tab from /json/list, all within
// 8 seconds of the ask; else it asks `stop` and rejects. The browser
// endpoint is rebuilt on the container's own address from the path Chrome
// answers, so a host name in Chrome's answer is never followed. The live
// view (lib/live.mjs) and the proxy use the devtoolsBase, browserWs and
// tabTargetId this answers; their connections send no Origin.
//
// THE SWEEP'S KEEP LIST is read when the sweep's line is written to the
// socket, never earlier: lines go out in order on one connection and the
// service orders them as they came, so a session in the table when the line
// is written is kept, and a start written after it begins only once the
// sweep has listed what exists, and is never among what it removes (Step 1's
// rule, and the service's gate: launcher/ops.mjs THE ORDER). A self-test's
// reserved session is kept while it runs.
//
// EXITS: a container that ends on its own (Chrome exited, its own timeout,
// a kill) is found by `list`, asked every 5 seconds while sessions run. A
// session counts as gone only when a list asked after its launch finished
// no longer shows it running; a list that fails decides nothing.
//
// REACHABLE: false once a connection to the socket fails or drops with
// calls waiting, true again at the next answer. The host refuses creates
// while it is false (503 launcher_unreachable).
//
// THE TAG (final privacy review, M1): every session the launcher is asked
// about is named by `tagOf(id)`, the host's HMAC of its id under the boot key
// (lib/tokens.mjs launcherTag), never by the id itself: start, stop, the
// sweep's keep list and the list's answers. The launcher, Docker and the
// kernel never see a session id. The self-test's reserved tag is its own.
//
// DEVTOOLS' ANSWERS are read to at most DEVTOOLS_JSON_MAX (lib/devtools-json.mjs).

import net from "node:net";

import WebSocket from "ws";

import { devtoolsJson as readDevtoolsJson } from "./devtools-json.mjs";
import { DEVTOOLS_PORT, isSessionIp } from "./ranges.mjs";

/** Chrome must answer within this of the ask (3.2: 503 chrome_did_not_start past it). */
export const LAUNCH_MS = 8000;
/** How often DevTools is asked while a launch waits. */
export const READY_POLL_MS = 100;
/** How often `list` is asked while sessions run. */
export const EXIT_POLL_MS = 5000;
/** The self-test's reserved session (launcher/bodies.mjs SELFTEST_SESSION). */
export const SELFTEST_SESSION = "00000000-0000-4000-8000-000000000000";
/** How long the self-test waits for chrome://sandbox to say whether it is sandboxed. */
export const SANDBOX_READ_MS = 5000;

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NAME = /^wkb-[0-9a-f]{8}$/;
const BROWSER_PATH = /^\/devtools\/browser\/[A-Za-z0-9-]{1,80}$/;
const TARGET_ID = /^[A-Za-z0-9]{1,64}$/;
const LINE_MAX = 4 * 1024 * 1024;

/**
 * @typedef {import("./sessions.mjs").LaunchAsk} LaunchAsk
 * @typedef {import("./sessions.mjs").Launched} Launched
 * @typedef {{ send: (method: string, params?: Record<string, unknown>) => Promise<any>, close: () => void }} Cdp
 * @typedef {{ netlink: number | null, netlinkHigh: number | null, netAdmin: number | null }} ProbeCodes
 * @typedef {{ chrome: string, sandbox: string | null, probes: ProbeCodes | null, imageCreated: string | null, packages: string | null }} SelfTestResult
 */

/**
 * What chrome://sandbox says, read from its text.
 * @param {string} text
 * @returns {{ ok: boolean, summary: string | null }}
 */
export function parseSandbox(text) {
  const t = String(text ?? "");
  const seccomp = /Seccomp-BPF sandbox\s*:?\s*Yes/i.test(t);
  const namespace = /Layer 1 Sandbox\s*:?\s*Namespace/i.test(t) || /Namespace Sandbox\s*:?\s*Yes/i.test(t);
  const adequate = /You are adequately sandboxed/i.test(t) && !/not adequately sandboxed/i.test(t);
  const ok = seccomp && namespace && adequate;
  return { ok, summary: ok ? "namespace seccomp_bpf" : null };
}

/**
 * Chrome's full version from Browser.getVersion's product ("HeadlessChrome/154.0.7499.40").
 * @param {unknown} product
 */
export function chromeVersionOf(product) {
  const m = /\/(\d+\.\d+\.\d+\.\d+)$/.exec(typeof product === "string" ? product : "");
  return m ? m[1] : null;
}

/**
 * A plain CDP connection for the self-test (its own browser, never a session's).
 * @param {string} url
 * @returns {Promise<Cdp>}
 */
function cdpConnect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { perMessageDeflate: false, followRedirects: false, maxPayload: 16 * 1024 * 1024, handshakeTimeout: 5000 });
    let next = 0;
    /** @type {Map<number, { resolve: (v: any) => void, reject: (e: Error) => void }>} */
    const waiting = new Map();
    const fail = () => {
      for (const w of waiting.values()) w.reject(new Error("cdp_closed"));
      waiting.clear();
    };
    ws.on("message", (d) => {
      try {
        const msg = JSON.parse(String(d));
        const w = typeof msg.id === "number" ? waiting.get(msg.id) : undefined;
        if (!w) return;
        waiting.delete(msg.id);
        if (msg.error) w.reject(new Error("cdp_error"));
        else w.resolve(msg.result);
      } catch {
        /* not ours */
      }
    });
    ws.on("close", fail);
    ws.on("error", () => {
      fail();
      reject(new Error("cdp_unreachable"));
    });
    ws.on("open", () =>
      resolve({
        send: (method, params = {}) =>
          new Promise((res, rej) => {
            next += 1;
            waiting.set(next, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ id: next, method, params }));
          }),
        close: () => ws.close(),
      }),
    );
  });
}

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The launcher service's client.
 * @param {{
 *   socketPath: string,
 *   tagOf?: (id: string) => string,
 *   log?: import("./log.mjs").Log,
 *   connect?: (path: string) => Promise<net.Socket>,
 *   devtoolsBase?: (ip: string) => string,
 *   cdp?: (url: string) => Promise<Cdp>,
 *   now?: () => number,
 *   launchMs?: number,
 *   pollMs?: number,
 *   exitPollMs?: number,
 *   callMs?: number,
 * }} o
 */
export function createLauncherClient(o) {
  const now = o.now ?? (() => performance.now());
  const launchMs = o.launchMs ?? LAUNCH_MS;
  const pollMs = o.pollMs ?? READY_POLL_MS;
  const exitPollMs = o.exitPollMs ?? EXIT_POLL_MS;
  const callMs = o.callMs ?? 30_000;
  const devtoolsBase = o.devtoolsBase ?? ((ip) => `http://${ip}:${DEVTOOLS_PORT}`);
  // The launcher's name of a session (see the header); the tests' own client may leave it out.
  const tagOf = o.tagOf ?? ((/** @type {string} */ id) => id);
  const cdp = o.cdp ?? cdpConnect;
  const connect =
    o.connect ??
    ((p) =>
      new Promise((resolve, reject) => {
        const s = net.connect(p);
        s.once("connect", () => resolve(s));
        s.once("error", reject);
      }));

  /** @type {net.Socket | null} */
  let conn = null;
  /** @type {Promise<void> | null} */
  let connecting = null;
  let nextId = 0;
  let unreachable = false;
  let closed = false;
  /** @type {Map<number, { resolve: (v: any) => void, reject: (e: Error) => void, timer: ReturnType<typeof setTimeout> }>} */
  const pending = new Map();
  /** Lines not yet written, each with its arguments read only when it is. */
  /** @type {Array<{ id: number, op: string, args: () => unknown }>} */
  let outbox = [];
  let selfTesting = false;

  /** Every launched session, watched for its exit, with its tag. */
  /** @type {Map<string, { seq: number, tag: string, done: (why: string) => void }>} */
  const watched = new Map();
  let seq = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let exitTimer = null;

  /** @param {Error} err */
  function failAll(err) {
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.reject(err);
      pending.delete(id);
    }
  }

  function flush() {
    if (!conn || conn.destroyed) return;
    const items = outbox;
    outbox = [];
    for (const item of items) {
      if (!pending.has(item.id)) continue;
      // Read now, as the line is written (a sweep's keep list).
      const args = item.args();
      conn.write(`${JSON.stringify(args === undefined ? { id: item.id, op: item.op } : { id: item.id, op: item.op, args })}\n`);
    }
  }

  function ensure() {
    if (closed || (conn && !conn.destroyed) || connecting) return;
    connecting = connect(o.socketPath).then(
      (s) => {
        connecting = null;
        conn = s;
        let buf = "";
        s.setEncoding("utf8");
        s.on("data", (d) => {
          buf += d;
          if (buf.length > LINE_MAX) {
            s.destroy();
            return;
          }
          let at;
          while ((at = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, at);
            buf = buf.slice(at + 1);
            let msg;
            try {
              msg = JSON.parse(line);
            } catch {
              continue;
            }
            const p = msg && typeof msg.id === "number" ? pending.get(msg.id) : undefined;
            if (!p) continue;
            pending.delete(msg.id);
            clearTimeout(p.timer);
            unreachable = false;
            if (msg.ok) p.resolve(msg.result);
            else p.reject(new Error(typeof msg.error === "string" && /^[a-z0-9_]{1,48}$/.test(msg.error) ? msg.error : "launcher_error"));
          }
        });
        const gone = () => {
          if (conn === s) conn = null;
          if (pending.size > 0) {
            unreachable = true;
            o.log?.event("launcher", "unreachable");
          }
          outbox = [];
          failAll(new Error("launcher_unreachable"));
        };
        s.on("close", gone);
        s.on("error", () => undefined);
        flush();
      },
      () => {
        connecting = null;
        unreachable = true;
        o.log?.event("launcher", "unreachable");
        outbox = [];
        failAll(new Error("launcher_unreachable"));
      },
    );
  }

  /**
   * One operation. `args` may be a getter, read when the line is written.
   * @param {string} op
   * @param {unknown | (() => unknown)} args
   * @param {number} [timeoutMs]
   * @returns {Promise<any>}
   */
  function call(op, args, timeoutMs = callMs) {
    if (closed) return Promise.reject(new Error("launcher_closed"));
    nextId += 1;
    const id = nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          if (pending.delete(id)) reject(new Error("launcher_timeout"));
        },
        Math.max(1, timeoutMs),
      );
      timer.unref?.();
      pending.set(id, { resolve, reject, timer });
      outbox.push({ id, op, args: typeof args === "function" ? /** @type {() => unknown} */ (args) : () => args });
      if (conn && !conn.destroyed) flush();
      else ensure();
    });
  }

  /**
   * A DevTools answer as JSON, or null when it is not up yet.
   * @param {string} url
   * @param {number} deadline
   */
  async function devtoolsJson(url, deadline) {
    try {
      return await readDevtoolsJson(url, { timeoutMs: Math.max(50, Math.min(1000, deadline - now())) });
    } catch {
      return null;
    }
  }

  /**
   * The browser endpoint and the launch tab of a container, within the deadline.
   * @param {string} ip
   * @param {number} deadline
   */
  async function ready(ip, deadline) {
    const base = devtoolsBase(ip);
    const host = new URL(base).host;
    /** @type {string | null} */
    let browserWs = null;
    while (now() < deadline && !browserWs) {
      const v = await devtoolsJson(`${base}/json/version`, deadline);
      const raw = v && typeof v.webSocketDebuggerUrl === "string" ? v.webSocketDebuggerUrl : "";
      if (raw && URL.canParse(raw)) {
        const p = new URL(raw).pathname;
        if (BROWSER_PATH.test(p)) browserWs = `ws://${host}${p}`;
      }
      if (!browserWs) await sleep(pollMs);
    }
    if (!browserWs) return null;
    while (now() < deadline) {
      const list = await devtoolsJson(`${base}/json/list`, deadline);
      const page = Array.isArray(list) ? list.find((t) => t && t.type === "page" && typeof t.id === "string" && TARGET_ID.test(t.id)) : null;
      if (page) return { browserWs, devtoolsBase: base, tabTargetId: String(page.id) };
      await sleep(pollMs);
    }
    return null;
  }

  function pollExits() {
    exitTimer = null;
    if (closed || watched.size === 0) return;
    const asked = seq;
    void call("list", undefined, 10_000)
      .then((list) => {
        const running = new Set(Array.isArray(list) ? list.filter((c) => c && c.running).map((c) => c.session) : []);
        for (const [id, w] of [...watched]) {
          if (w.seq <= asked && !running.has(w.tag)) {
            watched.delete(id);
            w.done("exit");
          }
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!closed && watched.size > 0 && !exitTimer) {
          exitTimer = setTimeout(pollExits, exitPollMs);
          exitTimer.unref?.();
        }
      });
  }

  /** @param {string} id @param {(why: string) => void} done */
  function watch(id, done) {
    seq += 1;
    watched.set(id, { seq, tag: tagOf(id), done });
    if (!exitTimer) {
      exitTimer = setTimeout(pollExits, exitPollMs);
      exitTimer.unref?.();
    }
  }

  /** @param {LaunchAsk} ask @returns {Promise<Launched>} */
  async function launch(ask) {
    const deadline = now() + launchMs;
    /** @type {{ browserWs: string, devtoolsBase: string, tabTargetId: string } | null} */
    let up = null;
    /** @type {string} */
    let name = "";
    const tag = tagOf(ask.id);
    try {
      const started = await call("start", { session: tag, viewport: { width: ask.viewport.width, height: ask.viewport.height }, timeoutSeconds: ask.timeoutSeconds }, Math.max(1, deadline - now()));
      if (!started || !NAME.test(started.name) || !isSessionIp(started.ip)) throw new Error("bad_start");
      name = started.name;
      up = await ready(started.ip, deadline);
      if (!up) throw new Error("not_ready");
    } catch {
      // Whatever the start made, if anything, goes: stop is by label, waits for its session's start alone, and drops one still waiting (launcher/ops.mjs).
      await call("stop", { session: tag }, 15_000).catch(() => undefined);
      throw new Error("chrome_did_not_start");
    }
    /** @type {(why: string) => void} */
    let done = () => undefined;
    /** @type {Promise<string>} */
    const exited = new Promise((r) => (done = r));
    watch(ask.id, done);
    /** @type {Promise<void> | null} */
    let stopping = null;
    const stop = () =>
      (stopping ??= (async () => {
        watched.delete(ask.id);
        await call("stop", { session: tag });
      })());
    return { ...up, stop, exited, stateEntry: { id: ask.id, container: name, network: name } };
  }

  return {
    launch,
    /** @param {Array<Record<string, unknown>>} entries */
    async reap(entries) {
      let killed = 0;
      for (const e of entries) {
        if (typeof e.id !== "string" || !SESSION_ID.test(e.id)) continue;
        try {
          const r = await call("stop", { session: tagOf(e.id) });
          if (r && Number(r.removed) > 0) killed += 1;
        } catch {
          // The sweep that follows removes it, or the next one does.
        }
      }
      return killed;
    },
    /** @param {() => readonly string[]} keep read when the sweep's line is written */
    async sweep(keep) {
      const r = await call("sweep", () => ({ keep: [...new Set([...keep().map(tagOf), ...(selfTesting ? [SELFTEST_SESSION] : [])])] }), 60_000);
      return r && Number.isFinite(Number(r.removed)) ? Number(r.removed) : 0;
    },
    /**
     * The self-test (5.2), on the image asked: Chrome's version, chrome://sandbox, then the probes. The caller holds a slot.
     * @param {"current" | "candidate"} [image]
     * @returns {Promise<SelfTestResult>}
     */
    async selfTest(image = "current") {
      // Kept by every sweep written from here until it is stopped.
      selfTesting = true;
      /** @type {string | null} */
      let chrome = null;
      /** @type {string | null} */
      let sandbox = null;
      /** @type {string | null} */
      let imageCreated = null;
      /** @type {string | null} */
      let packages = null;
      try {
        const started = await call("selftest", { image }, 60_000);
        imageCreated = typeof started?.image?.created === "string" ? started.image.created : null;
        // The image's package hash (launcher/bodies.mjs PACKAGES_FILE): a change promotes a build (lib/images.mjs).
        packages = typeof started?.image?.packages === "string" && /^[0-9a-f]{64}$/.test(started.image.packages) ? started.image.packages : null;
        if (!started || !isSessionIp(started.ip)) throw new Error("selftest_bad_start");
        const up = await ready(started.ip, now() + launchMs);
        if (!up) throw new Error("selftest_not_ready");
        const browser = await cdp(up.browserWs);
        try {
          chrome = chromeVersionOf((await browser.send("Browser.getVersion"))?.product);
        } finally {
          browser.close();
        }
        const tab = await cdp(`${up.devtoolsBase.replace(/^http/, "ws")}/devtools/page/${up.tabTargetId}`);
        try {
          await tab.send("Page.navigate", { url: "chrome://sandbox" });
          const until = now() + SANDBOX_READ_MS;
          while (now() < until) {
            const r = await tab.send("Runtime.evaluate", { expression: "document.body ? document.body.innerText : ''", returnByValue: true });
            const text = typeof r?.result?.value === "string" ? r.result.value : "";
            if (/sandboxed/i.test(text)) {
              sandbox = parseSandbox(text).summary;
              break;
            }
            await sleep(200);
          }
        } finally {
          tab.close();
        }
      } finally {
        await call("stop", { session: SELFTEST_SESSION }).catch(() => undefined);
        selfTesting = false;
      }
      if (!chrome) throw new Error("selftest_no_version");
      const probes = await call("probe", { image }, 120_000);
      /** @param {unknown} v */
      const code = (v) => (Number.isInteger(v) ? Number(v) : null);
      return { chrome, sandbox, probes: probes && typeof probes === "object" ? { netlink: code(probes.netlink), netlinkHigh: code(probes.netlinkHigh), netAdmin: code(probes.netAdmin) } : null, imageCreated, packages };
    },
    /** The launcher's build of the committed Dockerfile, as candidate. The caller holds a slot. */
    build: () => call("build", undefined, 45 * 60_000),
    /** candidate to current. */
    promote: () => call("promote", { tag: "candidate" }),
    /** The candidate tag removed, after a build that changed nothing or failed. */
    drop: () => call("drop", { tag: "candidate" }),
    /** Docker, containerd and runc. */
    versions: () => call("versions", undefined, 10_000),
    reachable: () => !unreachable,
    close() {
      closed = true;
      if (exitTimer) clearTimeout(exitTimer);
      failAll(new Error("launcher_closed"));
      conn?.destroy();
    },
  };
}

/** @typedef {ReturnType<typeof createLauncherClient>} LauncherClient */
