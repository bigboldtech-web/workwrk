// @ts-check
// Process mode (docs/plans/browser-host.md 5.1, Decision 5): each session's
// Chrome is a child of the host, on this machine only, for the laptop and
// the proofs. Container mode (lib/launcher-client.mjs, step 3) answers the
// same interface; lib/sessions.mjs never knows which one runs.
//
//   - Chrome is CHROME, else the newest chrome-headless-shell under
//     ~/.cache/chrome-headless, else Google Chrome on macOS. It is spawned
//     detached, so its whole process group can be killed.
//   - Its profile is <state dir>/profiles/<id>.
//   - DevTools listens on 127.0.0.1, on a port Chrome picks.
//   - Stderr is read until "DevTools listening on ws://...", then drained and
//     discarded: never kept, never logged. A pipe never read would block Chrome.
//   - Ready means DevTools answers and the launch tab is listed, within 8
//     seconds; else Chrome is killed and the launch rejects.
//   - stop() sends SIGTERM to the group, SIGKILL 2 seconds later, then
//     removes the profile.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { chromeArgs } from "./chrome-args.mjs";
import { reapEntries, sweepProfiles, systemDeps, terminate } from "./reaper.mjs";

/** How long Chrome has to answer (3.2: 503 chrome_did_not_start past it). */
export const LAUNCH_MS = 8000;

/**
 * @typedef {import("./sessions.mjs").LaunchAsk} LaunchAsk
 * @typedef {import("./sessions.mjs").Launched} Launched
 * @typedef {import("./sessions.mjs").Launcher} Launcher
 */

/**
 * The Chrome binary for process mode, or null when there is none.
 * @param {string | null} chrome CHROME, when set
 * @param {string} home
 * @returns {string | null}
 */
export function chromePath(chrome, home = os.homedir()) {
  if (chrome && fs.existsSync(chrome)) return chrome;
  const root = path.join(home, ".cache", "chrome-headless", "chrome-headless-shell");
  try {
    for (const build of fs.readdirSync(root).sort().reverse()) {
      for (const sub of fs.readdirSync(path.join(root, build))) {
        const bin = path.join(root, build, sub, "chrome-headless-shell");
        if (fs.existsSync(bin)) return bin;
      }
    }
  } catch {
    // None installed there.
  }
  const app = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return fs.existsSync(app) ? app : null;
}

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The launch tab: the page Chrome opened at launch.
 * @param {string} devtoolsBase
 * @param {number} deadline
 * @returns {Promise<string | null>}
 */
async function launchTab(devtoolsBase, deadline) {
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${devtoolsBase}/json/list`, { signal: AbortSignal.timeout(Math.max(100, deadline - Date.now())) });
      const list = await r.json();
      const page = Array.isArray(list) ? list.find((t) => t && t.type === "page" && typeof t.id === "string") : null;
      if (page) return String(page.id);
    } catch {
      // Not answering yet.
    }
    await sleep(100);
  }
  return null;
}

/**
 * Process mode's launcher.
 * @param {{ stateDir: string, chrome: string | null, home: string, fixturePort: number | null }} cfg
 * @param {{ deps?: import("./reaper.mjs").ReaperDeps, launchMs?: number }} [o]
 * @returns {Launcher & { profilesDir: string }}
 */
export function createProcessLauncher(cfg, o = {}) {
  const deps = o.deps ?? systemDeps();
  const launchMs = o.launchMs ?? LAUNCH_MS;
  const profilesDir = path.join(cfg.stateDir, "profiles");

  /** @param {LaunchAsk} ask @returns {Promise<Launched>} */
  async function launch(ask) {
    const deadline = Date.now() + launchMs;
    const bin = chromePath(cfg.chrome, cfg.home);
    if (!bin) throw new Error("chrome_not_found");
    const profile = path.join(profilesDir, ask.id);
    fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
    const args = [
      ...chromeArgs({ mode: "process", proof: ask.proof, viewport: ask.viewport, profile, fixturePort: cfg.fixturePort, headlessShell: bin.includes("headless-shell") }),
      "about:blank",
    ];
    const child = spawn(bin, args, { detached: true, stdio: ["ignore", "ignore", "pipe"] });
    const pid = child.pid ?? 0;
    let gone = false;
    /** @type {(why: string) => void} */
    let done = () => undefined;
    /** @type {Promise<string>} */
    const exited = new Promise((resolve) => (done = resolve));
    child.once("exit", (_code, signal) => {
      gone = true;
      done(signal ? "signal" : "exit");
    });
    child.once("error", () => {
      gone = true;
      done("error");
    });

    let stopping = /** @type {Promise<void> | null} */ (null);
    const stop = () =>
      (stopping ??= (async () => {
        if (!gone && pid > 1) await terminate(-pid, pid, deps);
        // Whatever of its group is left (a renderer the browser left behind).
        else if (pid > 1) deps.kill(-pid, "SIGKILL");
        for (let i = 0; i < 30 && !gone; i += 1) await sleep(100);
        await deps.rm(profile);
      })());

    try {
      if (pid <= 1) throw new Error("chrome_did_not_start");
      const browserWs = await new Promise((resolve, reject) => {
        let tail = "";
        const timer = setTimeout(() => reject(new Error("chrome_did_not_start")), Math.max(1, deadline - Date.now()));
        /** @param {Buffer} d */
        const onData = (d) => {
          tail = (tail + String(d)).slice(-8192);
          const m = /DevTools listening on (ws:\/\/\S+)/.exec(tail);
          if (!m) return;
          // Chrome's own output is never kept: drained from here on.
          tail = "";
          clearTimeout(timer);
          child.stderr?.off("data", onData);
          resolve(m[1]);
        };
        child.stderr?.on("data", onData);
        child.stderr?.on("error", () => undefined);
        // Drained for as long as Chrome writes, and dropped.
        child.stderr?.resume();
        exited.then(() => {
          clearTimeout(timer);
          reject(new Error("chrome_did_not_start"));
        });
      });
      const devtoolsBase = `http://127.0.0.1:${new URL(String(browserWs)).port}`;
      const tabTargetId = await launchTab(devtoolsBase, deadline);
      if (!tabTargetId) throw new Error("chrome_did_not_start");
      const started = (await deps.startTime(pid)) ?? "";
      return { browserWs: String(browserWs), devtoolsBase, tabTargetId, stop, exited, stateEntry: { id: ask.id, pid, pgid: pid, started, profile } };
    } catch (err) {
      await stop();
      throw err instanceof Error && err.message === "chrome_did_not_start" ? err : new Error("chrome_did_not_start");
    }
  }

  return {
    profilesDir,
    launch,
    reap: (entries) => reapEntries(entries, { profilesDir, deps }),
    sweep: (keep) => sweepProfiles(keep, { profilesDir, deps }),
  };
}
