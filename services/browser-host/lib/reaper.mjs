// @ts-check
// The process mode reaper (docs/plans/browser-host.md 6.4, Decision 9):
// what the last run left, and any Chrome no session owns.
//
// AT START, over the state file: each entry's process group is killed only
// while `ps -o lstart=` of its pid still matches the start time written when
// it launched (a pid the system gave to another process since is left
// alone), and its profile is removed. Then every process whose command line
// holds `--user-data-dir=<state dir>/profiles/` is killed and that folder
// emptied.
//
// EVERY MINUTE, the same sweep, keeping what a live session owns. What it
// keeps is a getter, read after the process listing and again before the
// folders are removed: a session is in the table before its folder or its
// Chrome exists, so whatever the listing saw, the getter read after it
// knows (a create that lands while ps runs is never killed or emptied).
//
// It never kills by name: only a pid whose start time matches our own
// record, or a process holding our own profile folder in its command line.
// The system calls are passed in, so the tests run none.

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * @typedef {{
 *   processes: () => Promise<Array<{ pid: number, args: string }>>,
 *   startTime: (pid: number) => Promise<string | null>,
 *   kill: (pid: number, signal: NodeJS.Signals) => boolean,
 *   alive: (pid: number) => boolean,
 *   sleep: (ms: number) => Promise<void>,
 *   rm: (p: string) => Promise<void>,
 *   list: (dir: string) => Promise<string[]>,
 * }} ReaperDeps
 */

/** How long a process has after SIGTERM before SIGKILL. */
export const KILL_GRACE_MS = 2000;

/**
 * SIGTERM, then SIGKILL after the grace, to a process group (negative) or one pid.
 * @param {number} target a pid, or minus a group id
 * @param {number} pid the process to watch
 * @param {ReaperDeps} deps
 */
export async function terminate(target, pid, deps) {
  // Never 0, 1 or minus 1: those would reach every process we may signal.
  if (!Number.isInteger(pid) || pid <= 1 || !Number.isInteger(target) || Math.abs(target) <= 1) return false;
  if (!deps.kill(target, "SIGTERM")) return false;
  for (let waited = 0; waited < KILL_GRACE_MS && deps.alive(pid); waited += 100) await deps.sleep(100);
  if (deps.alive(pid)) deps.kill(target, "SIGKILL");
  return true;
}

/**
 * Kill what the state file names (see the header), and remove each profile.
 * @param {Array<{ id?: unknown, pid?: unknown, pgid?: unknown, started?: unknown, profile?: unknown }>} entries
 * @param {{ profilesDir: string, deps: ReaperDeps }} o
 * @returns {Promise<number>} how many were killed
 */
export async function reapEntries(entries, o) {
  let killed = 0;
  for (const e of entries) {
    const pid = Number(e.pid);
    const pgid = Number(e.pgid);
    if (!Number.isInteger(pid) || pid <= 1) continue;
    const started = await o.deps.startTime(pid);
    if (started !== null && typeof e.started === "string" && started === e.started) {
      // Still ours: the group Chrome leads (it was spawned detached).
      if (await terminate(Number.isInteger(pgid) && pgid > 1 ? -pgid : pid, pid, o.deps)) killed += 1;
    }
    if (typeof e.profile === "string" && inside(e.profile, o.profilesDir)) await o.deps.rm(e.profile);
  }
  return killed;
}

/**
 * Kill every process holding a profile under `profilesDir` that no live
 * session owns, and remove every such profile.
 * @param {() => readonly string[]} keep the live session ids, read when the sweep acts
 * @param {{ profilesDir: string, deps: ReaperDeps }} o
 * @returns {Promise<number>} how many were killed
 */
export async function sweepProfiles(keep, o) {
  const marker = `--user-data-dir=${o.profilesDir}${path.sep}`;
  let killed = 0;
  const procs = await o.deps.processes();
  // Read after the listing: every Chrome it saw was in the table before it started.
  const keepSet = new Set(keep());
  await Promise.all(
    procs.map(async (p) => {
      const at = p.args.indexOf(marker);
      if (at < 0 || p.pid === process.pid) return;
      const id = p.args.slice(at + marker.length).split(/[\s/]/)[0];
      if (keepSet.has(id)) return;
      if (await terminate(p.pid, p.pid, o.deps)) killed += 1;
    }),
  );
  const names = await o.deps.list(o.profilesDir);
  // Read again after the folder listing: a folder made since was made by a session already in the table.
  const keepNow = new Set(keep());
  for (const name of names) {
    if (!keepNow.has(name)) await o.deps.rm(path.join(o.profilesDir, name));
  }
  return killed;
}

/**
 * Whether `p` is strictly inside `dir`.
 * @param {string} p
 * @param {string} dir
 */
function inside(p, dir) {
  const rel = path.relative(dir, p);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Run a command, answering its stdout, or null when it failed.
 * @param {string} cmd
 * @param {string[]} args
 * @returns {Promise<string | null>}
 */
function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024, timeout: 10_000 }, (err, stdout) => resolve(err ? null : String(stdout)));
  });
}

/**
 * The real system calls (ps, kill, fs).
 * @returns {ReaperDeps}
 */
export function systemDeps() {
  return {
    async processes() {
      const out = await run("ps", ["-A", "-ww", "-o", "pid=", "-o", "args="]);
      if (!out) return [];
      return out
        .split("\n")
        .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
        .filter((m) => m !== null)
        .map((m) => ({ pid: Number(/** @type {RegExpExecArray} */ (m)[1]), args: /** @type {RegExpExecArray} */ (m)[2] }));
    },
    async startTime(pid) {
      const out = await run("ps", ["-o", "lstart=", "-p", String(pid)]);
      const t = out?.trim() ?? "";
      return t ? t.replace(/\s+/g, " ") : null;
    },
    kill(pid, signal) {
      try {
        process.kill(pid, signal);
        return true;
      } catch {
        return false;
      }
    },
    alive(pid) {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    rm: (p) => fs.promises.rm(p, { recursive: true, force: true }),
    async list(dir) {
      try {
        return await fs.promises.readdir(dir);
      } catch {
        return [];
      }
    },
  };
}
