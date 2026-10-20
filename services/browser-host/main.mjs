// @ts-check
// The WorkwrK browser host (docs/plans/browser-host.md): our own home for AI
// teammates' browsers, answering the Browserbase subset the app already
// speaks (section 0).
//
//   node services/browser-host/main.mjs            the host, by BROWSER_HOST_MODE
//   node services/browser-host/main.mjs --proof    process mode with the stand-in's
//                                                  fixtures, controls and log
//                                                  (scripts/browser-stand-in.mjs runs this)
//
// IN ORDER: the settings (lib/config.mjs, refusing to start on any problem,
// by code), the port claimed on 127.0.0.1 (so a second host on the same
// port stops before it touches anything), the reaper over what the last run
// left (6.4), then requests. The admin socket answers drain, undrain and
// status. SIGTERM ends every session and exits within 25 seconds; SIGUSR2
// drains.
//
// THE LIVE VIEW (lib/live.mjs, section 4): its page and assets through the
// API, its websocket on /live/{id}/ws, its tokens minted with the same boot
// key as the connect tokens, and every viewer closed when its session ends.
//
// CONTAINER MODE (section 5, step 3): Chrome runs in a container a session,
// made by the launcher service (lib/launcher-client.mjs; the host itself has
// no Docker access). Before any browser starts, and every minute, the
// preflight checks the machine (lib/preflight.mjs), and the boot self-test
// proves the current image sandboxed (lib/images.mjs), which also keeps the
// image current. Each failure is a problem: creates are refused 503 and
// /healthz answers 503 for those that need a person (3.2).
//
// DRAIN (SIGUSR2 or the admin socket) stops creates; one held over 40
// minutes is drain_stuck (8.4).

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createAdminSocket } from "./lib/admin-socket.mjs";
import { createApi } from "./lib/api.mjs";
import { createCdpProxy } from "./lib/cdp-proxy.mjs";
import { readHostConfig } from "./lib/config.mjs";
import { createImages, imagesFile, processChromeVersion } from "./lib/images.mjs";
import { createLauncherClient } from "./lib/launcher-client.mjs";
import { createProcessLauncher } from "./lib/launcher-process.mjs";
import { createLive, liveAssets } from "./lib/live.mjs";
import { createLog } from "./lib/log.mjs";
import { firewallOkAt, preflight, problemsOf } from "./lib/preflight.mjs";
import { createSessions, SYSTEM_CLOCK, TICK_MS } from "./lib/sessions.mjs";
import { createStateFile } from "./lib/state.mjs";
import { newBootKey } from "./lib/tokens.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The host's commit, written into VERSION by the archive step. */
function version() {
  try {
    const v = fs.readFileSync(path.join(HERE, "VERSION"), "utf8").trim();
    return /^[0-9a-f]{7,40}$/.test(v) ? v : "dev";
  } catch {
    return "dev";
  }
}

/** A drain held longer than this is drain_stuck (8.4: sessions last 31 minutes at most). */
export const DRAIN_STUCK_MS = 40 * 60_000;

/**
 * A small file's text, or null.
 * @param {string} p
 */
function readText(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/**
 * The Caddy version the maintenance job wrote (8.4 versions.json, in root's own folder), or null.
 * @param {string | null} file
 */
function caddyVersion(file) {
  if (!file) return null;
  try {
    const v = JSON.parse(readText(file) ?? "null")?.caddy;
    return typeof v === "string" && /^v?\d+\.\d+\.\d+[A-Za-z0-9.+-]{0,40}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Drain and undrain, from SIGUSR2 and the admin socket alike, with the
 * drain's start kept: one held past DRAIN_STUCK_MS is drain_stuck (8.4).
 * @param {Pick<import("./lib/sessions.mjs").Sessions, "drain" | "undrain" | "status">} sessions
 * @param {() => number} mono
 */
export function createDrains(sessions, mono) {
  /** @type {number | null} */
  let since = null;
  return {
    drain() {
      sessions.drain();
      since ??= mono();
    },
    undrain() {
      sessions.undrain();
      since = null;
    },
    status: () => sessions.status(),
    stuck: () => since !== null && mono() - since > DRAIN_STUCK_MS,
  };
}

/** The machine's facts the settings need. */
function machine() {
  return { memTotalBytes: os.totalmem(), cpus: os.availableParallelism?.() ?? os.cpus().length, tmpdir: os.tmpdir(), home: os.homedir() };
}

/**
 * @param {http.Server} server
 * @param {number} port
 * @param {string} host
 */
function listen(server, port, host) {
  return /** @type {Promise<void>} */ (
    new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        resolve();
      });
    })
  );
}

/**
 * Start the host. Answers its handle, or null when it refused to start (each reason logged by code).
 * @param {Record<string, string | undefined>} env
 * @param {readonly string[]} argv
 * @param {{ write?: (line: string) => void, signals?: boolean, launcherSocket?: string }} [o]
 *   launcherSocket: the launcher's socket in place of the fixed one (main.test.ts only)
 */
export async function run(env, argv, o = {}) {
  const log = createLog({ tag: "host", write: o.write });
  const cfg = readHostConfig(env, argv, machine());
  // The key in the clear is hashed by now: it is dropped (3.1).
  delete env.BROWSER_HOST_KEY;
  if (env !== process.env) delete process.env.BROWSER_HOST_KEY;
  if ("refusals" in cfg) {
    for (const r of cfg.refusals) log.event("refused", r);
    return null;
  }
  fs.mkdirSync(cfg.stateDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(cfg.stateDir, 0o700);
  const container = cfg.mode === "container";
  // Written by root's firewall check in a folder root owns; the host only reads it (H1).
  const firewallOkFile = cfg.firewallOk;

  const startedMono = SYSTEM_CLOCK.mono();
  /** The last preflight's refusals (container mode): until the first one runs, the launcher is unproven. */
  /** @type {string[]} */
  let refusals = container ? ["launcher_socket"] : [];
  /** @type {ReturnType<typeof createImages> | null} */
  let images = null;
  /** Process mode's Chrome, read at start (H15). */
  /** @type {string | null} */
  let processChrome = null;
  /** Docker, containerd and runc, from the launcher's versions operation at each preflight. */
  /** @type {Record<string, string | null>} */
  let engineVersions = { docker: null, containerd: null, runc: null };

  /** @type {ReturnType<typeof createLauncherClient> | null} */
  const client = container ? createLauncherClient({ socketPath: o.launcherSocket ?? String(cfg.launcherSocket), log }) : null;
  const problems = () => {
    /** @type {string[]} */
    const now = [];
    if (client) {
      now.push(...problemsOf(refusals));
      if (!client.reachable()) now.push("launcher_unreachable");
      // No image manager yet means no self-test has passed.
      now.push(...(images ? images.problems() : ["selftest_failed"]));
    } else {
      // Process mode has no firewall; its test window raises the problem a proof forces (H15).
      const fw = cfg.test.firewallSeconds;
      if (fw !== null && SYSTEM_CLOCK.mono() - startedMono >= fw * 1000) now.push("firewall_unchecked");
    }
    if (drains.stuck()) now.push("drain_stuck");
    return [...new Set(now)];
  };
  const launcher = client ?? createProcessLauncher(cfg);
  const state = createStateFile(cfg.stateDir);
  // One boot key for the connect and live tokens: a restart voids every one (3.3).
  const bootKey = newBootKey();
  const sessions = createSessions({ cfg, launcher, state, log, bootKey, problems });
  const drains = createDrains(sessions, SYSTEM_CLOCK.mono);
  let lastRefusals = "";
  /** The preflight (container mode), at start and every minute. */
  const runPreflight = async () => {
    if (!client) return;
    refusals = await preflight({
      readFile: readText,
      listDir: (p) => {
        try {
          return fs.readdirSync(p);
        } catch {
          return null;
        }
      },
      now: () => Date.now(),
      firewallOk: String(firewallOkFile),
      versions: async () => {
        const v = await client.versions();
        engineVersions = { docker: v?.docker ?? null, containerd: v?.containerd ?? null, runc: v?.runc ?? null };
        return v;
      },
    }).catch(() => ["launcher_socket"]);
    // Logged when they change, by code.
    const key = refusals.join(",");
    if (key !== lastRefusals) {
      if (refusals.length === 0) log.event("preflight", "ok");
      for (const r of refusals) log.event("preflight", "refused", r);
    }
    lastRefusals = key;
  };

  // Proof mode's fixtures, controls and log, loaded only here (boundaries.test.ts).
  /** @type {import("./lib/api.mjs").ApiHooks} */
  let apiHooks = {};
  /** @type {import("./lib/cdp-proxy.mjs").ProxyHooks} */
  let proxyHooks = {};
  /** @type {http.Server | null} */
  let fixtureServer = null;
  if (cfg.proof) {
    const { createProofLog } = await import("./proof/log.mjs");
    const { createFixtures } = await import("./proof/fixtures.mjs");
    const { createControls } = await import("./proof/controls.mjs");
    const proofLog = createProofLog(cfg.proofLog ?? path.join(os.tmpdir(), "browser-stand-in-requests.jsonl"));
    const fixtures = createFixtures({ record: proofLog.record });
    const controls = createControls({ cfg, sessions, log: proofLog, fixtures });
    apiHooks = { entry: (e) => proofLog.record({ kind: "api", ...e }), rule: controls.ruleFor, control: controls.handle };
    proxyHooks = {
      refused: (p) => void proofLog.record({ kind: "api", route: "connect.refused", path: p }),
      connected: (id) => void proofLog.record({ kind: "api", route: "connect", session: id }),
      disconnected: (id) => void proofLog.record({ kind: "api", route: "disconnect", session: id, clients: 0 }),
    };
    fixtureServer = http.createServer((req, res) => fixtures.handle(req, res));
  }

  const proxy = createCdpProxy({ sessions, log, hooks: proxyHooks });
  /** @type {ReturnType<typeof createApi> | null} */
  let apiRef = null;
  // Every viewer of a session is closed when it ends (sessions.onEnd), before its Chrome stops.
  const live = createLive({ cfg, sessions, bootKey, log, blocked: (addr) => apiRef?.authBlocked(addr) ?? 0 });
  const api = createApi({
    cfg: { ...cfg, version: version() },
    sessions,
    log,
    problems,
    liveUrl: (s, mode) => live.urlFor(s, mode),
    live: { assets: liveAssets(), revoke: (id) => live.revoke(id) },
    versions: () => ({ node: process.versions.node, kernel: os.release(), ...engineVersions, caddy: container ? caddyVersion(cfg.versionsFile) : null }),
    health: () => {
      const fw = container && firewallOkFile ? firewallOkAt(readText(firewallOkFile)) : null;
      const major = processChrome ? Number(processChrome.split(".")[0]) : null;
      return {
        ...(images ? images.health() : { chrome: processChrome, chromeMajor: Number.isInteger(major) ? major : null, imageBuiltAt: null, imageAgeDays: null }),
        firewallCheckedAt: fw === null ? null : new Date(fw).toISOString(),
      };
    },
    counts: () => ({ connectsRefused: proxy.tally().refused, live: live.counts() }),
    hooks: apiHooks,
  });
  apiRef = api;

  // Requests wait until the reaper has run, so nothing it sweeps is a new session's.
  /** @type {(v?: unknown) => void} */
  let markReady = () => undefined;
  const ready = new Promise((r) => (markReady = r));
  const server = http.createServer((req, res) => void ready.then(() => api.handle(req, res)));
  server.on("upgrade", (req, socket, head) => {
    socket.on("error", () => undefined);
    void ready.then(() => {
      try {
        if (!proxy.upgrade(req, socket, head) && !live.upgrade(req, socket, head)) {
          socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
          socket.destroy();
        }
      } catch {
        // One bad request never stops the host.
        socket.destroy();
        log.event("connect", "error");
      }
    });
  });
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;

  try {
    await listen(server, cfg.port, cfg.listen);
    if (fixtureServer && cfg.fixturePort) await listen(fixtureServer, cfg.fixturePort, cfg.listen);
  } catch {
    log.event("refused", "port_in_use");
    server.close();
    fixtureServer?.close();
    return null;
  }

  await sessions.recover();
  if (client) {
    await runPreflight();
    // The image manager holds a slot for every build and self-test (Decision 18).
    images = createImages({ launcher: client, holdSlot: (r) => sessions.holdSlot(r), draining: () => sessions.draining(), store: imagesFile(cfg.stateDir), log });
  } else if (!cfg.proof) {
    // Process mode's Chrome version for /health, before the minute's sweep starts (proof mode starts no Chrome of its own).
    processChrome = await processChromeVersion(launcher, (r) => sessions.holdSlot(r), crypto.randomUUID());
  }
  const admin = createAdminSocket({ path: cfg.adminSocket, sessions: drains, log });
  try {
    await admin.listen();
  } catch {
    log.event("admin", "listen_failed");
  }
  markReady();
  // The boot self-test, or a first build: requests are answered meanwhile, creates refused until it passes.
  if (images) void images.boot();
  const tick = setInterval(() => {
    void sessions.tick();
    if (client) void runPreflight().then(() => images?.tick());
  }, TICK_MS);
  tick.unref();
  log.event("start", cfg.mode, cfg.proof ? "proof" : "host", { max: cfg.max });

  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    clearInterval(tick);
    server.close();
    fixtureServer?.close();
    await sessions.shutdown();
    client?.close();
    await admin.close().catch(() => undefined);
    proxy.close();
    live.close();
    log.event("stop", sessions.status());
  }
  if (o.signals !== false) {
    const onStop = () => void stop().finally(() => process.exit(0));
    process.once("SIGTERM", onStop);
    process.once("SIGINT", onStop);
    process.on("SIGUSR2", () => {
      drains.drain();
      log.event("admin", "drain");
    });
  }

  return { cfg, sessions, server, fixtureServer, stop };
}

// Run when this file is the entry point, not when a launcher imports it.
/** Whether this file is the entry point. */
function isEntry() {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(fs.realpathSync(String(process.argv[1]))).href;
  } catch {
    return false;
  }
}
if (isEntry()) {
  run(process.env, process.argv.slice(2)).then((h) => {
    if (!h) process.exit(1);
  });
}
