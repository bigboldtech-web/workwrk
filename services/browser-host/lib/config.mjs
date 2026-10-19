// @ts-check
// The host's settings, read once at start (docs/plans/browser-host.md
// Decisions 5, 11 and 18, sections 3.1, 5 and 6.2).
//
// TWO MODES:
//   - container mode (production): one container a session, through the
//     launcher service. Every value is required; there are no defaults, so a
//     missing line in host.env refuses the start instead of guessing.
//   - process mode (this laptop and the proofs only): Chrome runs as a child
//     of the host. Refused with NODE_ENV=production, and whenever the host
//     would answer beyond 127.0.0.1. Its defaults are the proofs' own: region
//     us-east-1, app origin http://localhost:3016, public URL
//     http://127.0.0.1:<port>.
//   - proof mode (--proof, process mode only) adds the stand-in's fixture
//     sites, its controls and its log (Decision 17).
//
// THE KEY: the host keeps only the SHA-256 of the app's key
// (BROWSER_HOST_KEY_SHA256, one hash or two for a rotation). Process mode
// may take BROWSER_HOST_KEY in the clear: it is hashed here and the caller
// drops it. Container mode refuses a clear key.
//
// TEST WINDOWS (process mode outside production only, else ignored):
//   BROWSER_HOST_TEST_CONNECT_SECONDS   a session nobody connects to ends after this (default 60)
//   BROWSER_HOST_TEST_CONTROL_SECONDS   a control view's lifetime (step 2; default 900)
//   BROWSER_HOST_TEST_FIREWALL_SECONDS  firewall_unchecked is raised this long after the start
//
// Pure: everything it reads is passed in (`env`, `argv` and the machine's facts).

import crypto from "node:crypto";
import path from "node:path";

import { computeMax, SHIM_MIB } from "./limits.mjs";

/** The app's region label shape (src/lib/browser/config.ts REGION). */
export const REGION = /^[a-z]{2}-[a-z]+-\d$/;

const HEX64 = /^[0-9a-f]{64}$/;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);
const DEFAULT_PORT = 8789;

/** Process and proof mode's defaults: the proofs' own (docs/plans/browser-host.md 12.1). */
export const PROCESS_DEFAULTS = Object.freeze({ region: "us-east-1", appOrigin: "http://localhost:3016" });

/** Container mode's fixed places (install/, 8.3). */
export const CONTAINER_STATE_DIR = "/var/lib/workwrk-browser-host";
export const CONTAINER_ADMIN_SOCKET = "/run/workwrk-browser-host/admin.sock";

/**
 * @typedef {{
 *   mode: "process" | "container",
 *   proof: boolean,
 *   production: boolean,
 *   listen: "127.0.0.1",
 *   port: number,
 *   publicUrl: string,
 *   publicOrigin: string,
 *   connectBase: string,
 *   appOrigin: string,
 *   region: string,
 *   keyHashes: Buffer[],
 *   sessionMb: number,
 *   shimMb: number,
 *   maxOverride: number | null,
 *   max: number,
 *   stateDir: string,
 *   adminSocket: string,
 *   chrome: string | null,
 *   home: string,
 *   fixturePort: number | null,
 *   proofLog: string | null,
 *   test: { connectSeconds: number | null, controlSeconds: number | null, firewallSeconds: number | null },
 * }} HostConfig
 */

/** @typedef {{ memTotalBytes: number, cpus: number, tmpdir: string, home: string }} MachineFacts */

/** @param {string | undefined} v */
const trimmed = (v) => (typeof v === "string" ? v.trim() : "");

/**
 * A whole number in [lo, hi], or null when unset; undefined when set but bad.
 * @param {string | undefined} v
 * @param {number} lo
 * @param {number} hi
 * @returns {number | null | undefined}
 */
function whole(v, lo, hi) {
  const t = trimmed(v);
  if (!t) return null;
  if (!/^\d{1,9}$/.test(t)) return undefined;
  const n = Number(t);
  return n >= lo && n <= hi ? n : undefined;
}

/**
 * An origin with nothing else: no user, password, path, query or fragment.
 * @param {string} raw
 * @returns {URL | null}
 */
function originOnly(raw) {
  const t = raw.replace(/\/+$/, "");
  if (!t || !URL.canParse(t)) return null;
  const u = new URL(t);
  if (u.username || u.password || u.search || u.hash || (u.pathname && u.pathname !== "/")) return null;
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  return u;
}

/**
 * Whether a host name is WorkwrK's own, where the app's session cookie may
 * reach (Decision 2: the host lives on a domain of its own).
 * @param {string} hostname
 */
function underWorkwrk(hostname) {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  return h === "workwrk.com" || h.endsWith(".workwrk.com");
}

/**
 * The SHA-256 of a key's bytes.
 * @param {string} key
 * @returns {Buffer}
 */
export function sha256(key) {
  return crypto.createHash("sha256").update(Buffer.from(key, "utf8")).digest();
}

/**
 * The host's settings, or every reason it refuses to start (codes only, never a value read).
 * @param {Record<string, string | undefined>} env
 * @param {readonly string[]} argv
 * @param {MachineFacts} machine
 * @returns {HostConfig | { refusals: string[] }}
 */
export function readHostConfig(env, argv, machine) {
  /** @type {string[]} */
  const refusals = [];
  const production = trimmed(env.NODE_ENV) === "production";
  const modeRaw = trimmed(env.BROWSER_HOST_MODE) || "process";
  if (modeRaw !== "process" && modeRaw !== "container") refusals.push("mode");
  /** @type {"process" | "container"} */
  const mode = modeRaw === "container" ? "container" : "process";
  const proof = argv.includes("--proof");
  const processMode = mode === "process";
  if (processMode && production) refusals.push("process_in_production");
  if (proof && !processMode) refusals.push("proof_needs_process");

  // The host answers on 127.0.0.1 only, in both modes (3, Decision 5).
  const listenRaw = trimmed(env.BROWSER_HOST_LISTEN);
  if (listenRaw && listenRaw !== "127.0.0.1") refusals.push("listen");

  const portRead = whole(env.BROWSER_HOST_PORT, 1, 65535);
  if (portRead === undefined) refusals.push("port");
  const port = portRead ?? DEFAULT_PORT;

  // The public URL: what the connect and live view addresses are built on.
  const publicRaw = trimmed(env.BROWSER_HOST_PUBLIC_URL) || (processMode ? `http://127.0.0.1:${port}` : "");
  const pub = originOnly(publicRaw);
  if (!pub) refusals.push("public_url");
  else if (processMode && !LOOPBACK_HOSTS.has(pub.hostname)) refusals.push("public_url");
  else if (!processMode && (pub.protocol !== "https:" || underWorkwrk(pub.hostname))) refusals.push("public_url");

  const appRaw = trimmed(env.BROWSER_HOST_APP_ORIGIN) || (processMode ? PROCESS_DEFAULTS.appOrigin : "");
  const app = originOnly(appRaw);
  if (!app) refusals.push("app_origin");
  else if (!processMode && app.protocol !== "https:") refusals.push("app_origin");

  const region = trimmed(env.BROWSER_HOST_REGION) || (processMode ? PROCESS_DEFAULTS.region : "");
  if (!REGION.test(region)) refusals.push("region");

  // The key, kept only as its hash.
  /** @type {Buffer[]} */
  let keyHashes = [];
  const clear = typeof env.BROWSER_HOST_KEY === "string" ? env.BROWSER_HOST_KEY : "";
  const hashesRaw = trimmed(env.BROWSER_HOST_KEY_SHA256);
  if (clear && !processMode) refusals.push("clear_key_in_container");
  if (hashesRaw) {
    const parts = hashesRaw.split(",").map((h) => h.trim().toLowerCase());
    if (parts.length > 2 || !parts.every((h) => HEX64.test(h))) refusals.push("key_hash");
    else keyHashes = parts.map((h) => Buffer.from(h, "hex"));
  } else if (clear && processMode) {
    if (clear.length > 200) refusals.push("key");
    else keyHashes = [sha256(clear)];
  }
  if (keyHashes.length === 0 && !refusals.includes("key_hash") && !refusals.includes("clear_key_in_container") && !refusals.includes("key")) refusals.push("key");

  // The max, from memory and CPU (Decision 18).
  const sessionMbRead = whole(env.BROWSER_HOST_SESSION_MEMORY_MB, 1024, 4096);
  if (sessionMbRead === undefined) refusals.push("session_memory");
  const sessionMb = processMode ? 1024 : (sessionMbRead ?? 1280);
  const shimMb = processMode ? 0 : SHIM_MIB;
  const overrideRead = whole(env.BROWSER_HOST_MAX, 0, 1000);
  if (overrideRead === undefined) refusals.push("max_override");
  const maxOverride = overrideRead ?? null;
  const max = computeMax(machine.memTotalBytes, machine.cpus, sessionMb, maxOverride, shimMb);
  if (max < 1) refusals.push("max");

  // Where it keeps its state: its own folder a port in process mode, so a
  // restart on the same port finds what the last run left (6.4).
  const stateRaw = trimmed(env.BROWSER_HOST_STATE_DIR);
  if (stateRaw && !path.isAbsolute(stateRaw)) refusals.push("state_dir");
  const stateDir = stateRaw || (processMode ? path.join(machine.tmpdir, `workwrk-browser-host-${port}`) : CONTAINER_STATE_DIR);
  const adminSocket = processMode ? path.join(stateDir, "admin.sock") : CONTAINER_ADMIN_SOCKET;

  // Proof mode's fixture sites, on the next port unless told.
  let fixturePort = null;
  let proofLog = null;
  if (proof) {
    const fp = whole(env.BROWSER_HOST_FIXTURE_PORT, 1, 65535);
    if (fp === undefined || fp === port) refusals.push("fixture_port");
    fixturePort = fp ?? port + 1;
    if (fixturePort > 65535) refusals.push("fixture_port");
    // The stand-in's own log name (section 7), kept for every proof.
    proofLog = trimmed(env.BROWSER_STAND_IN_LOG) || path.join(machine.tmpdir, "browser-stand-in-requests.jsonl");
  }

  // Test windows: process mode outside production only.
  const testing = processMode && !production;
  /** @param {string | undefined} v @param {number} hi */
  const window = (v, hi) => {
    if (!testing) return null;
    const n = whole(v, 1, hi);
    if (n === undefined) {
      refusals.push("test_window");
      return null;
    }
    return n;
  };
  const test = {
    connectSeconds: window(env.BROWSER_HOST_TEST_CONNECT_SECONDS, 600),
    controlSeconds: window(env.BROWSER_HOST_TEST_CONTROL_SECONDS, 900),
    firewallSeconds: window(env.BROWSER_HOST_TEST_FIREWALL_SECONDS, 86_400),
  };

  if (refusals.length > 0 || !pub || !app) return { refusals: [...new Set(refusals)] };
  const publicOrigin = pub.origin;
  return {
    mode,
    proof,
    production,
    listen: "127.0.0.1",
    port,
    publicUrl: publicOrigin,
    publicOrigin,
    connectBase: publicOrigin.replace(/^http/, "ws"),
    appOrigin: app.origin,
    region,
    keyHashes,
    sessionMb,
    shimMb,
    maxOverride,
    max,
    stateDir,
    adminSocket,
    chrome: trimmed(env.CHROME) || null,
    home: machine.home,
    fixturePort,
    proofLog,
    test,
  };
}
