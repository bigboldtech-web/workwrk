// @ts-check
// The server's daily maintenance (docs/plans/browser-host.md 8.4), run as
// root by install/maint.sh from workwrk-browser-maint.timer at 04:30 server
// time. Ubuntu's own security pocket updates every night through
// unattended-upgrades, with no automatic reboot; this job keeps the rest
// current without ending a browser mid-task:
//
//   1. apt-get update; note any pending upgrade of docker-ce, docker-ce-cli,
//      containerd.io, docker-buildx-plugin, caddy or nodejs (each held to its
//      major by the install's apt pins), whether a reboot is required, and
//      which of Docker, containerd, the host's units or Caddy needrestart
//      says still run on a library a nightly security update replaced
//      (needrestart never restarts those itself: needrestart-workwrk.conf).
//   2. Nothing pending: write versions.json (Caddy, Node, the kernel), stop.
//   3. Something pending: drain through the host's admin socket; wait until
//      nothing runs, starts or holds a slot (sessions last 31 minutes at
//      most), for up to 40 minutes; stop the host and the launcher, so an
//      upgrade that restarts Docker cannot bounce the host undrained; apply
//      the upgrades with `apt-get install --only-upgrade`, or reboot;
//      restart Docker's units if needrestart named them; start the launcher
//      and the host (a start is undrained) and restart Caddy; write
//      versions.json; log one line of package names and versions.
//   4. A drain past 40 minutes is drain_stuck (the host answers 503 on
//      /healthz for it): the job logs it and applies anyway, since every
//      session has outlived its own limit by then.
//   5. A host that does not answer the drain, or a status while it waits,
//      gets nothing applied: no answer is never read as nothing running.
//
// versions.json is written into /var/lib/workwrk-browser-maint, a folder
// root owns, by root-write.mjs (step 3 review, H1); the host only reads it.
//
//   maint.sh             the daily job
//   maint.sh drain-wait  drain and wait, for install.sh --update (exit 2 when the host does not answer)
//   maint.sh versions    write versions.json alone (install.sh)
//
// The commands are passed in, so the tests run no apt, systemctl or socket.

import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { pathToFileURL } from "node:url";

import { ROOT_DIRS, writeRootFile } from "./root-write.mjs";

/** The packages this job keeps current (Ubuntu's own come through unattended-upgrades). */
export const WATCHED = Object.freeze(["docker-ce", "docker-ce-cli", "containerd.io", "docker-buildx-plugin", "caddy", "nodejs"]);
/** How long a drain may take before it is drain_stuck. */
export const DRAIN_WAIT_MS = 40 * 60_000;
/** How often a drain asks what still runs. */
export const DRAIN_POLL_MS = 30_000;
/** Stopped before anything is applied: the host first, then the launcher. */
export const STOP_UNITS = Object.freeze(["workwrk-browser-host.service", "workwrk-browser-launcher.service"]);
/** Started after: the launcher before the host. Caddy is restarted. */
export const START_UNITS = Object.freeze(["workwrk-browser-launcher.service", "workwrk-browser-host.service"]);
/** The units of ours needrestart may name; Docker's two go first when they need it. */
const OURS = /^(containerd|docker|caddy|workwrk-browser-[a-z-]+)\.service$/;
const ENGINE_UNITS = Object.freeze(["containerd.service", "docker.service"]);
/** The files and the socket it uses. */
export const MAINT_PATHS = Object.freeze({
  rebootFlag: "/var/run/reboot-required",
  versions: `${ROOT_DIRS.maint}/versions.json`,
  admin: "/run/workwrk-browser-host/admin.sock",
});

/**
 * @typedef {{
 *   exec: (cmd: string, args: string[], env?: Record<string, string>) => Promise<{ code: number, stdout: string }>,
 *   exists: (p: string) => boolean,
 *   admin: (op: "drain" | "undrain" | "status") => Promise<Record<string, unknown> | null>,
 *   sleep: (ms: number) => Promise<void>,
 *   now: () => number,
 *   writeFile: (p: string, text: string) => void,
 *   log: (line: string) => void,
 * }} MaintDeps
 */

/**
 * The watched packages with an upgrade waiting, from `apt list --upgradable`.
 * @param {string} text
 * @returns {Array<{ name: string, version: string }>}
 */
export function upgradable(text) {
  /** @type {Array<{ name: string, version: string }>} */
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    const m = /^([a-z0-9][a-z0-9.+-]*)\/\S+\s+(\S+)\s+\S+\s+\[upgradable from:/.exec(line.trim());
    if (m && WATCHED.includes(m[1]) && !out.some((p) => p.name === m[1])) out.push({ name: m[1], version: m[2] });
  }
  return out;
}

/**
 * The units of ours still running on a replaced library, from `needrestart -b -r l`.
 * @param {string} text
 */
export function staleUnits(text) {
  /** @type {string[]} */
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    const m = /^NEEDRESTART-SVC:\s*(\S+)\s*$/.exec(line.trim());
    if (m && OURS.test(m[1]) && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * Drain the host and wait until nothing runs, starts or holds a slot, for up
 * to DRAIN_WAIT_MS. A host that does not answer the drain or a status is
 * `answered: false`, and nothing may be applied then.
 * @param {MaintDeps} deps
 * @returns {Promise<{ answered: boolean, drained: boolean, stuck: boolean }>}
 */
export async function drainAndWait(deps) {
  const started = deps.now();
  const d = await deps.admin("drain");
  if (!d || d.ok !== true) return { answered: false, drained: false, stuck: false };
  for (;;) {
    const st = await deps.admin("status");
    const r = st && st.ok === true && st.result && typeof st.result === "object" ? /** @type {Record<string, unknown>} */ (st.result) : null;
    if (!r || ![r.running, r.starting, r.held].every((n) => Number.isInteger(n))) return { answered: false, drained: true, stuck: false };
    if (r.running === 0 && r.starting === 0 && r.held === 0) return { answered: true, drained: true, stuck: false };
    if (deps.now() - started >= DRAIN_WAIT_MS) return { answered: true, drained: true, stuck: true };
    await deps.sleep(DRAIN_POLL_MS);
  }
}

/**
 * versions.json: Caddy, Node and the kernel, for /health (8.5).
 * @param {MaintDeps} deps
 */
export async function writeVersions(deps) {
  const first = async (/** @type {string} */ cmd, /** @type {string[]} */ args) => {
    const r = await deps.exec(cmd, args).catch(() => ({ code: 1, stdout: "" }));
    const v = r.code === 0 ? r.stdout.trim().split(/\s+/)[0] ?? "" : "";
    return /^[A-Za-z0-9.+_~:-]{1,60}$/.test(v) ? v : null;
  };
  const versions = { caddy: await first("caddy", ["version"]), node: await first("node", ["--version"]), kernel: await first("uname", ["-r"]), at: new Date(deps.now()).toISOString() };
  deps.writeFile(MAINT_PATHS.versions, `${JSON.stringify(versions)}\n`);
  return versions;
}

/**
 * One day's maintenance (see the header).
 * @param {MaintDeps} deps
 * @returns {Promise<{ pending: string[], stale: string[], reboot: boolean, answered: boolean, drained: boolean, stuck: boolean, applied: boolean, rebooted: boolean }>}
 */
export async function maintain(deps) {
  const result = { pending: /** @type {string[]} */ ([]), stale: /** @type {string[]} */ ([]), reboot: false, answered: false, drained: false, stuck: false, applied: false, rebooted: false };
  const update = await deps.exec("apt-get", ["update", "-q"], { DEBIAN_FRONTEND: "noninteractive" });
  if (update.code !== 0) deps.log("[maint] apt_update_failed");
  const list = await deps.exec("apt", ["list", "--upgradable"]);
  const pending = upgradable(list.stdout);
  result.pending = pending.map((p) => p.name);
  result.reboot = deps.exists(MAINT_PATHS.rebootFlag);
  const nr = await deps.exec("needrestart", ["-b", "-r", "l"]).catch(() => ({ code: 1, stdout: "" }));
  result.stale = staleUnits(nr.stdout);
  if (pending.length === 0 && !result.reboot && result.stale.length === 0) {
    await writeVersions(deps);
    deps.log("[maint] nothing_pending");
    return result;
  }
  const drain = await drainAndWait(deps);
  result.answered = drain.answered;
  result.drained = drain.drained;
  result.stuck = drain.stuck;
  if (!drain.answered) {
    // Fail closed: a host that does not answer may still be running browsers.
    deps.log("[maint] host_unanswered not_applying");
    await writeVersions(deps);
    return result;
  }
  if (drain.stuck) deps.log("[maint] drain_stuck applying_anyway");
  // The host and the launcher go first, so a Docker upgrade's own restart cannot bounce the host undrained.
  await deps.exec("systemctl", ["stop", ...STOP_UNITS]);
  if (pending.length > 0) {
    const r = await deps.exec("apt-get", ["install", "-y", "-q", "--only-upgrade", "-o", "Dpkg::Options::=--force-confold", ...pending.map((p) => p.name)], { DEBIAN_FRONTEND: "noninteractive" });
    result.applied = r.code === 0;
    deps.log(`[maint] ${result.applied ? "applied" : "apply_failed"} ${pending.map((p) => `${p.name}=${p.version}`).join(" ")}`);
  }
  if (deps.exists(MAINT_PATHS.rebootFlag)) {
    await writeVersions(deps);
    deps.log("[maint] rebooting");
    result.rebooted = true;
    await deps.exec("systemctl", ["reboot"]);
    return result;
  }
  // Docker's own units first, when they run on a replaced library; then the launcher and the host (a start is undrained), then Caddy.
  const engine = ENGINE_UNITS.filter((u) => result.stale.includes(u));
  if (engine.length > 0) await deps.exec("systemctl", ["restart", ...engine]);
  await deps.exec("systemctl", ["start", ...START_UNITS]);
  await deps.exec("systemctl", ["restart", "caddy.service"]);
  const v = await writeVersions(deps);
  deps.log(`[maint] restarted caddy=${v.caddy ?? "unknown"} node=${v.node ?? "unknown"} kernel=${v.kernel ?? "unknown"}`);
  return result;
}

/**
 * One request on the host's admin socket, or null when it does not answer.
 * @param {string} socketPath
 * @param {"drain" | "undrain" | "status"} op
 * @returns {Promise<Record<string, unknown> | null>}
 */
export function adminRequest(socketPath, op) {
  return new Promise((resolve) => {
    const s = net.connect(socketPath);
    let buf = "";
    const done = (/** @type {Record<string, unknown> | null} */ v) => {
      clearTimeout(timer);
      s.destroy();
      resolve(v);
    };
    const timer = setTimeout(() => done(null), 5000);
    s.setEncoding("utf8");
    s.on("connect", () => s.write(`${JSON.stringify({ op })}\n`));
    s.on("data", (d) => {
      buf += d;
      const at = buf.indexOf("\n");
      if (at < 0) return;
      try {
        done(JSON.parse(buf.slice(0, at)));
      } catch {
        done(null);
      }
    });
    s.on("error", () => done(null));
  });
}

/** The real commands and files. @returns {MaintDeps} */
export function systemMaintDeps() {
  return {
    exec: (cmd, args, env) =>
      new Promise((resolve) => {
        execFile(cmd, args, { env: { ...process.env, ...(env ?? {}) }, maxBuffer: 16 * 1024 * 1024, timeout: 30 * 60_000 }, (err, stdout) => {
          const code = err ? (typeof (/** @type {{ code?: unknown }} */ (err).code) === "number" ? Number(/** @type {{ code?: unknown }} */ (err).code) : 1) : 0;
          resolve({ code, stdout: String(stdout ?? "") });
        });
      }),
    exists: (p) => fs.existsSync(p),
    admin: (op) => adminRequest(MAINT_PATHS.admin, op),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    writeFile: (p, text) => writeRootFile(p, text, 0o644),
    log: (line) => void process.stderr.write(`${line}\n`),
  };
}

/** Whether this file is the entry point. */
function isEntry() {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(fs.realpathSync(String(process.argv[1]))).href;
  } catch {
    return false;
  }
}

if (isEntry()) {
  const deps = systemMaintDeps();
  const what = process.argv[2] ?? "run";
  const job =
    what === "drain-wait"
      ? drainAndWait(deps).then((r) => {
          deps.log(`[maint] drain ${!r.answered ? "unanswered" : r.stuck ? "stuck" : "done"}`);
          if (!r.answered) process.exit(2);
        })
      : what === "run"
        ? maintain(deps).then(() => undefined)
        : what === "versions"
          ? writeVersions(deps).then(() => undefined)
          : Promise.reject(new Error("maint_bad_command"));
  job.catch(() => {
    deps.log("[maint] failed");
    process.exit(1);
  });
}
