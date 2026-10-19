// @ts-check
// The session table over one launcher (docs/plans/browser-host.md 5.1 and
// section 6). Nothing else knows which mode runs.
//
// A session is starting, then running, then ending, then ended. The API says
// RUNNING for the first two and COMPLETED for the rest.
//
// THE ENDS, each at most once (6.1), their clocks started at the create:
//   timeout            the create's timeout, on the host's own timers (monotonic)
//   never_connected    no /connect within 60 seconds of the create (proof mode's
//                      start-orphan sessions are exempt, as Browserbase's
//                      keepAlive sessions would be)
//   last_client_left   keepAlive false: the one client leaving
//   released           the release call
//   chrome_exited      Chrome (or its container) exits
//   provider_ended     proof mode's kill control
//   shutdown, reset    the host stopping; proof mode's reset
//
// ENDING closes, in order and once: the client socket, every end listener
// (the live view's viewers and its connection in step 2, the proof controls'
// connection), then Chrome. The ended record (id, status, times, metadata)
// is kept for an hour, for release (409) and the list, then forgotten (404).
//
// THE MAX counts starting and running sessions and held slots (6.2).
//
// THE STATE FILE is written at every start and end (6.4), naming the
// processes or containers only.
//
// THE SWEEP keeps what is live when it acts, never a list frozen when it
// began: it is handed liveIds itself, a getter (a create that lands during
// its process listing is kept). A session is in the table before its folder
// or its Chrome exists, and a launch stays live until it settles, even past
// proof mode's reset.
//
// A SHUTDOWN waits for every launch in flight as well as every stop, then
// sweeps whatever of ours is left, then writes the state: nothing detached
// outlives the host.

import crypto from "node:crypto";

import { createSlots } from "./limits.mjs";
import { connectToken, redeemConnect, verifyConnect } from "./tokens.mjs";

/** A session nobody connects to ends after this (6.1). */
export const NEVER_CONNECTED_MS = 60_000;
/** How long an ended record is remembered (6.1). */
export const REMEMBER_MS = 60 * 60_000;
/** The reaper's tick (6.4). */
export const TICK_MS = 60_000;
/** The tick's backstop past a session's own end (6.4). */
export const EXPIRY_GRACE_MS = 5_000;
/** What a shutdown waits for its Chromes (6.4: exit within 25 seconds). */
export const SHUTDOWN_WAIT_MS = 20_000;

/** The problems that refuse creates, with 503 and the code (3.2, 5.2). */
export const BLOCKING_PROBLEMS = Object.freeze(["chrome_stale", "firewall_unchecked", "launcher_unreachable", "preflight", "selftest_failed"]);

/**
 * THE LAUNCHER (5.1): process mode's (lib/launcher-process.mjs) or container
 * mode's client of the launcher service (lib/launcher-client.mjs, step 3).
 * launch() answers once Chrome's DevTools answers and its launch tab is
 * listed, within 8 seconds, or rejects with Chrome killed; reap() kills what
 * a state file names; sweep(keep) kills what no live session owns and
 * removes its leftovers. `keep` is a getter, read at the moment the sweep
 * acts: after its listing, and again before any removal (step 3's launcher
 * client and service do the same, and the service never runs a start inside
 * a sweep). Step 3 adds selfTest(image?), run with a slot held.
 * @typedef {{ id: string, viewport: { width: number, height: number }, timeoutSeconds: number, proof: boolean }} LaunchAsk
 * @typedef {{
 *   browserWs: string,
 *   devtoolsBase: string,
 *   tabTargetId: string,
 *   stop: () => Promise<void>,
 *   exited: Promise<string>,
 *   stateEntry: import("./state.mjs").StateEntry,
 * }} Launched
 * @typedef {{
 *   launch: (ask: LaunchAsk) => Promise<Launched>,
 *   reap: (entries: Array<Record<string, unknown>>) => Promise<number>,
 *   sweep: (keep: () => readonly string[]) => Promise<number>,
 * }} Launcher
 */

/**
 * @typedef {"starting" | "running" | "ending" | "ended"} SessionStatus
 * @typedef {{
 *   projectId: string,
 *   region: string,
 *   timeoutSeconds: number,
 *   viewport: { width: number, height: number },
 *   userMetadata: Record<string, string>,
 *   keepAlive?: boolean,
 *   exempt?: boolean,
 * }} CreateAsk
 * @typedef {{
 *   id: string,
 *   status: SessionStatus,
 *   projectId: string,
 *   region: string,
 *   userMetadata: Record<string, string>,
 *   viewport: { width: number, height: number },
 *   timeoutSeconds: number,
 *   keepAlive: boolean,
 *   exempt: boolean,
 *   createdAt: string,
 *   createdWall: number,
 *   startedAt: string | null,
 *   endedAt: string | null,
 *   expiresAt: string | null,
 *   deadlineMono: number,
 *   endedMono: number,
 *   connected: boolean,
 *   endReason: string | null,
 *   epoch: number,
 *   launched: Launched | null,
 *   client: { close: () => void } | null,
 *   timers: Array<ReturnType<typeof setTimeout>>,
 * }} Session
 * @typedef {{ ok: true, session: Session } | { ok: false, status: 429 | 503, error: string, why?: string }} CreateResult
 * @typedef {{ ok: true, session: Session } | { ok: false, status: 401 | 404 | 409 }} ClaimResult
 * @typedef {{ wall: () => number, mono: () => number }} Clock
 */

/** The host's clocks: the wall for the times the API shows, the monotonic one for every limit. */
export const SYSTEM_CLOCK = Object.freeze({ wall: () => Date.now(), mono: () => performance.now() });

/**
 * The session table.
 * @param {{
 *   cfg: { mode: "process" | "container", max: number, proof: boolean, connectBase: string, test?: { connectSeconds: number | null } },
 *   launcher: Launcher,
 *   state: { write: (s: import("./state.mjs").HostState) => void, read: () => import("./state.mjs").HostState | null },
 *   log: import("./log.mjs").Log,
 *   bootKey: Buffer,
 *   clock?: Clock,
 *   problems?: () => string[],
 * }} o
 */
export function createSessions(o) {
  const { cfg, launcher, state, log, bootKey } = o;
  const clock = o.clock ?? SYSTEM_CLOCK;
  const problems = o.problems ?? (() => []);
  const boot = crypto.randomUUID();
  const connectMs = (cfg.test?.connectSeconds ?? 0) > 0 ? Number(cfg.test?.connectSeconds) * 1000 : NEVER_CONNECTED_MS;
  const slots = createSlots(cfg.max);

  /** @type {Map<string, Session>} */
  const table = new Map();
  /** What runs, for the state file: id -> its entry, until its stop is done. */
  /** @type {Map<string, import("./state.mjs").StateEntry>} */
  const procs = new Map();
  /** @type {Set<Promise<void>>} */
  const stopping = new Set();
  /** Every create in flight, so a shutdown waits for its launch (and the stop that follows). */
  /** @type {Set<Promise<CreateResult>>} */
  const starts = new Set();
  /** The ids whose launch is in flight: live for the sweep even after a reset forgets them. */
  /** @type {Set<string>} */
  const launching = new Set();
  /** @type {Array<(s: Session, reason: string) => void>} */
  const endListeners = [];
  /** @type {{ creates: number, startFailures: number, ends: Record<string, number> }} */
  const counts = { creates: 0, startFailures: 0, ends: {} };
  let draining = false;
  let closing = false;

  const iso = (/** @type {number} */ ms) => new Date(ms).toISOString();
  const active = () => {
    let n = 0;
    for (const s of table.values()) if (s.status === "starting" || s.status === "running") n += 1;
    return n;
  };
  const running = () => {
    let n = 0;
    for (const s of table.values()) if (s.status === "running") n += 1;
    return n;
  };

  /** What the sweep keeps, read when it acts: every session not ended, every launch in flight, every Chrome still stopping. */
  const liveIds = () => {
    const ids = new Set(launching);
    for (const s of table.values()) if (s.status !== "ended") ids.add(s.id);
    for (const id of procs.keys()) ids.add(id);
    return [...ids];
  };

  function writeState() {
    try {
      state.write({ v: 1, boot, mode: cfg.mode, sessions: [...procs.values()] });
    } catch {
      log.event("state", "write_failed");
    }
  }

  /**
   * End a session, once (see the header).
   * @param {string} id
   * @param {string} reason
   * @returns {boolean} whether this call ended it
   */
  function end(id, reason) {
    const s = table.get(id);
    if (!s || s.status === "ending" || s.status === "ended") return false;
    const wasStarting = s.status === "starting";
    s.status = "ending";
    s.endReason = reason;
    s.endedAt = iso(clock.wall());
    s.endedMono = clock.mono();
    for (const t of s.timers) clearTimeout(t);
    s.timers = [];
    const client = s.client;
    s.client = null;
    try {
      client?.close();
    } catch {
      /* gone */
    }
    for (const fn of endListeners) {
      try {
        fn(s, reason);
      } catch {
        /* a listener never stops an end */
      }
    }
    counts.ends[reason] = (counts.ends[reason] ?? 0) + 1;
    log.event("session", "ended", reason, { running: running() });
    const launched = s.launched;
    s.launched = null;
    if (launched) {
      const p = launched
        .stop()
        .catch(() => undefined)
        .then(() => {
          procs.delete(id);
          s.status = "ended";
          writeState();
          stopping.delete(p);
        });
      stopping.add(p);
    } else if (!wasStarting) {
      s.status = "ended";
    }
    // A session ended while it starts finishes when its launch settles (create).
    return true;
  }

  /**
   * Start a session (the API has checked the ask).
   * @param {CreateAsk} ask
   * @returns {Promise<CreateResult>}
   */
  function create(ask) {
    const p = startSession(ask);
    starts.add(p);
    return p.finally(() => starts.delete(p));
  }

  /**
   * @param {CreateAsk} ask
   * @returns {Promise<CreateResult>}
   */
  async function startSession(ask) {
    if (closing || draining) return { ok: false, status: 503, error: "unavailable", why: "draining" };
    const blocked = problems().find((p) => BLOCKING_PROBLEMS.includes(p));
    if (blocked) return { ok: false, status: 503, error: "unavailable", why: blocked };
    if (active() + slots.held() >= cfg.max) return { ok: false, status: 429, error: "at_capacity" };
    const id = crypto.randomUUID();
    const wall = clock.wall();
    /** @type {Session} */
    const s = {
      id,
      status: "starting",
      projectId: ask.projectId,
      region: ask.region,
      userMetadata: { ...ask.userMetadata },
      viewport: { width: ask.viewport.width, height: ask.viewport.height },
      timeoutSeconds: ask.timeoutSeconds,
      keepAlive: ask.keepAlive === true,
      exempt: ask.exempt === true,
      createdAt: iso(wall),
      createdWall: wall,
      startedAt: null,
      endedAt: null,
      expiresAt: null,
      deadlineMono: 0,
      endedMono: 0,
      connected: false,
      endReason: null,
      epoch: 0,
      launched: null,
      client: null,
      timers: [],
    };
    // In the table before its folder or its Chrome exists (the sweep keeps it from here).
    table.set(id, s);
    launching.add(id);
    // Both clocks start at the create (6.1): its timeout, and the minute to connect.
    s.expiresAt = iso(wall + s.timeoutSeconds * 1000);
    s.deadlineMono = clock.mono() + s.timeoutSeconds * 1000;
    const timer = (/** @type {() => void} */ fn, /** @type {number} */ ms) => {
      const t = setTimeout(fn, ms);
      t.unref?.();
      s.timers.push(t);
    };
    timer(() => end(id, "timeout"), s.timeoutSeconds * 1000);
    if (!s.exempt) timer(() => void (!s.connected && end(id, "never_connected")), connectMs);
    /** @type {Launched} */
    let launched;
    try {
      launched = await launcher.launch({ id, viewport: s.viewport, timeoutSeconds: s.timeoutSeconds, proof: cfg.proof });
    } catch {
      launching.delete(id);
      for (const t of s.timers) clearTimeout(t);
      s.timers = [];
      if (table.get(id) === s) table.delete(id);
      s.status = "ended";
      counts.startFailures += 1;
      log.event("session", "start_failed");
      return { ok: false, status: 503, error: "unavailable", why: "chrome_did_not_start" };
    }
    if (s.status !== "starting") {
      // Ended while it started: a shutdown or proof mode's reset, or its own clock ran out first.
      const p = launched
        .stop()
        .catch(() => undefined)
        .then(() => {
          s.status = "ended";
          stopping.delete(p);
        });
      stopping.add(p);
      launching.delete(id);
      const why = s.endReason === "shutdown" || s.endReason === "reset" ? "draining" : "chrome_did_not_start";
      return { ok: false, status: 503, error: "unavailable", why };
    }
    s.launched = launched;
    procs.set(id, launched.stateEntry);
    launching.delete(id);
    s.status = "running";
    s.startedAt = iso(clock.wall());
    launched.exited.then(() => end(id, "chrome_exited"));
    counts.creates += 1;
    writeState();
    return { ok: true, session: s };
  }

  return {
    boot,
    create,
    end,
    /** @param {string} id */
    get: (id) => table.get(id),
    all: () => [...table.values()],
    /**
     * The sessions a list call shows: RUNNING (starting and running), COMPLETED (the remembered ended ones), or all.
     * @param {"RUNNING" | "COMPLETED" | null} status
     */
    list(status) {
      return [...table.values()].filter((s) => !status || (status === "RUNNING") === (s.status === "starting" || s.status === "running"));
    },
    /**
     * The session JSON of the API (3.2), the shape the stand-in answered.
     * @param {Session} s
     */
    json(s) {
      return {
        id: s.id,
        createdAt: s.createdAt,
        updatedAt: iso(clock.wall()),
        startedAt: s.startedAt ?? s.createdAt,
        endedAt: s.endedAt,
        expiresAt: s.expiresAt ?? iso(s.createdWall + s.timeoutSeconds * 1000),
        projectId: s.projectId,
        status: s.status === "starting" || s.status === "running" ? "RUNNING" : "COMPLETED",
        proxyBytes: 0,
        keepAlive: s.keepAlive,
        contextId: null,
        region: s.region,
        userMetadata: { ...s.userMetadata },
      };
    },
    /**
     * The release call: "released", "ended" when it had already ended (409), "unknown" (404).
     * @param {string} id
     * @returns {"released" | "ended" | "unknown"}
     */
    release(id) {
      const s = table.get(id);
      if (!s) return "unknown";
      if (s.status !== "starting" && s.status !== "running") return "ended";
      end(id, "released");
      return "released";
    },
    /**
     * The connect address of a running session: its token is good once.
     * @param {Session} s
     */
    connectUrl: (s) => `${cfg.connectBase}/connect/${s.id}?t=${connectToken(bootKey, s.id)}`,
    /**
     * A /connect upgrade's claim: 404 unknown or not running, 401 a wrong token, 409 once connected (during and after).
     * With `spend` false it only checks: the proxy spends the token once the websocket handshake has succeeded.
     * @param {string} id
     * @param {unknown} token
     * @param {boolean} [spend]
     * @returns {ClaimResult}
     */
    claim(id, token, spend = true) {
      const s = table.get(id);
      if (!s) return { ok: false, status: 404 };
      if (s.status !== "running" && !s.connected) return { ok: false, status: verifyConnect(bootKey, id, token) ? 404 : 401 };
      if (!spend) {
        if (!verifyConnect(bootKey, id, token)) return { ok: false, status: 401 };
        return s.connected ? { ok: false, status: 409 } : { ok: true, session: s };
      }
      const r = redeemConnect(bootKey, s, token);
      if (r === "invalid") return { ok: false, status: 401 };
      if (r === "used") return { ok: false, status: 409 };
      return { ok: true, session: s };
    },
    /**
     * The one client of a session, closed when it ends.
     * @param {string} id
     * @param {{ close: () => void }} client
     */
    attachClient(id, client) {
      const s = table.get(id);
      if (!s || s.status !== "running") {
        client.close();
        return false;
      }
      s.client = client;
      return true;
    },
    /**
     * The client left: keepAlive false ends the session.
     * @param {string} id
     */
    clientGone(id) {
      const s = table.get(id);
      if (!s) return;
      s.client = null;
      if (!s.keepAlive) end(id, "last_client_left");
    },
    /** @param {(s: Session, reason: string) => void} fn */
    onEnd(fn) {
      endListeners.push(fn);
    },
    /** @param {string} reason */
    holdSlot: (reason) => slots.holdSlot(reason, active()),
    status: () => ({ max: cfg.max, running: running(), starting: active() - running(), held: slots.held() }),
    counts: () => ({ creates: counts.creates, startFailures: counts.startFailures, ends: { ...counts.ends } }),
    draining: () => draining,
    drain() {
      draining = true;
    },
    undrain() {
      draining = false;
    },
    /** Every minute (6.4): the backstop past a session's end, the sweep, the forgetting. */
    async tick() {
      const now = clock.mono();
      for (const s of [...table.values()]) if (s.status === "running" && now > s.deadlineMono + EXPIRY_GRACE_MS) end(s.id, "timeout");
      try {
        await launcher.sweep(liveIds);
      } catch {
        log.event("reaper", "sweep_failed");
      }
      for (const s of [...table.values()]) if (s.status === "ended" && clock.mono() - s.endedMono >= REMEMBER_MS) table.delete(s.id);
    },
    /** At start (6.4): kill what the state file names, then every stray, then an empty state. */
    async recover() {
      let killed = 0;
      const prev = state.read();
      try {
        if (prev && prev.mode === cfg.mode) killed += await launcher.reap(/** @type {Array<Record<string, unknown>>} */ (prev.sessions));
        killed += await launcher.sweep(() => []);
      } catch {
        log.event("reaper", "start_failed");
      }
      writeState();
      log.event("reaper", "start", { killed });
      return killed;
    },
    /** Proof mode's reset: every session ended and forgotten. */
    reset() {
      for (const s of [...table.values()]) end(s.id, "reset");
      table.clear();
    },
    /** SIGTERM (6.4): no more creates, every session ended, every launch in flight settled and stopped, a last sweep, the state written. */
    async shutdown() {
      closing = true;
      for (const s of [...table.values()]) end(s.id, "shutdown");
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      let t;
      const settled = (async () => {
        // A launch in flight stops its own Chrome once it settles (its session is no longer starting).
        await Promise.allSettled([...starts]);
        await Promise.allSettled([...stopping]);
      })();
      await Promise.race([settled, new Promise((r) => (t = setTimeout(r, SHUTDOWN_WAIT_MS)))]);
      clearTimeout(t);
      try {
        // Whatever of ours is left, a launch past the wait included.
        await launcher.sweep(() => []);
      } catch {
        log.event("reaper", "sweep_failed");
      }
      writeState();
    },
  };
}

/** @typedef {ReturnType<typeof createSessions>} Sessions */
