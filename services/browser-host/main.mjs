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
// STEP 1 runs process mode only. Container mode's launcher client, its
// preflight, the boot self-test and the firewall arrive in step 3, and the
// live view in step 2; their seams are marked below.

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createAdminSocket } from "./lib/admin-socket.mjs";
import { createApi } from "./lib/api.mjs";
import { createCdpProxy } from "./lib/cdp-proxy.mjs";
import { readHostConfig } from "./lib/config.mjs";
import { createProcessLauncher } from "./lib/launcher-process.mjs";
import { createLog } from "./lib/log.mjs";
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
 * @param {{ write?: (line: string) => void, signals?: boolean }} [o]
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
  if (cfg.mode !== "process") {
    // Step 3: lib/launcher-client.mjs, the launcher service's socket client, and lib/preflight.mjs.
    log.event("refused", "container_mode_not_built");
    return null;
  }
  fs.mkdirSync(cfg.stateDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(cfg.stateDir, 0o700);

  const startedMono = SYSTEM_CLOCK.mono();
  const problems = () => {
    /** @type {string[]} */
    const now = [];
    // Process mode has no firewall; its test window raises the problem a proof forces (H15).
    const fw = cfg.test.firewallSeconds;
    if (fw !== null && SYSTEM_CLOCK.mono() - startedMono >= fw * 1000) now.push("firewall_unchecked");
    return now;
  };
  const launcher = createProcessLauncher(cfg);
  const state = createStateFile(cfg.stateDir);
  const sessions = createSessions({ cfg, launcher, state, log, bootKey: newBootKey(), problems });

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
  const api = createApi({
    cfg: { ...cfg, version: version() },
    sessions,
    log,
    problems,
    // Step 2: the live token minted here (lib/tokens.mjs mintLive), and the /live routes.
    versions: () => ({ node: process.versions.node, kernel: os.release(), docker: null, containerd: null, runc: null, caddy: null }),
    counts: () => ({ connectsRefused: proxy.tally().refused }),
    hooks: apiHooks,
  });

  // Requests wait until the reaper has run, so nothing it sweeps is a new session's.
  /** @type {(v?: unknown) => void} */
  let markReady = () => undefined;
  const ready = new Promise((r) => (markReady = r));
  const server = http.createServer((req, res) => void ready.then(() => api.handle(req, res)));
  server.on("upgrade", (req, socket, head) => {
    socket.on("error", () => undefined);
    void ready.then(() => {
      try {
        // Step 2: /live/{id}/ws.
        if (!proxy.upgrade(req, socket, head)) {
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
  const admin = createAdminSocket({ path: cfg.adminSocket, sessions, log });
  try {
    await admin.listen();
  } catch {
    log.event("admin", "listen_failed");
  }
  markReady();
  const tick = setInterval(() => void sessions.tick(), TICK_MS);
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
    await admin.close().catch(() => undefined);
    proxy.close();
    log.event("stop", sessions.status());
  }
  if (o.signals !== false) {
    const onStop = () => void stop().finally(() => process.exit(0));
    process.once("SIGTERM", onStop);
    process.once("SIGINT", onStop);
    process.on("SIGUSR2", () => {
      sessions.drain();
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
