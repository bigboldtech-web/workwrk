// @ts-check
// The firewall's loader and its 5-minute check (docs/plans/browser-host.md
// 5.4), run as root by install/firewall-check.sh:
//
//   firewall-check.sh load    workwrk-browser-firewall.service, before Docker starts
//   firewall-check.sh check   the 5-minute timer, and the host's ExecStartPre
//   firewall-check.sh print   the file it would write, to stdout
//
// LOAD writes the file from the host's current addresses, checks it with
// `nft -c -f`, loads it with `nft -f` (one transaction: the file declares,
// deletes and defines the table), then saves the table's listing with every
// counter at 0, and the file's SHA-256 beside it.
//
// CHECK regenerates the file and lists the table, counters at 0. It reloads
// (and saves again) only when the file's hash changed, the table is missing,
// or the listing's meaning differs from the saved one: by meaning, never by
// text, so a check that changes nothing keeps the counters, and a change is
// reloaded once. Then it writes firewall.ok with the time; the host refuses
// creates (503 firewall_unchecked) once that is over 10 minutes old.
//
// The saved listing lives in /run/workwrk-browser-firewall/, a folder of its
// own: the host's runtime folder is removed whenever the host stops, and a
// lost listing would reload (and zero every counter) at the next check.
//
// The commands are passed in, so the tests run no nft, ip or id.

import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { FIREWALL_FILE, firewallText, listingMeaning, publicAddresses, TABLE } from "../lib/firewall.mjs";

/** The files the loader and the check read and write. */
export const PATHS = Object.freeze({
  file: FIREWALL_FILE,
  env: "/etc/workwrk-browser-host/firewall.env",
  savedDir: "/run/workwrk-browser-firewall",
  ok: "/var/lib/workwrk-browser-host/firewall.ok",
});

/** The host's own user, the only one that reaches a session's DevTools port. */
export const HOST_USER = "wkbhost";

/**
 * @typedef {{
 *   run: (cmd: string, args: string[]) => Promise<{ code: number, stdout: string }>,
 *   readFile: (p: string) => string | null,
 *   writeFile: (p: string, text: string, mode: number) => void,
 *   now: () => number,
 *   log: (line: string) => void,
 * }} CheckDeps
 * @typedef {{ file: string, env: string, savedDir: string, ok: string }} CheckPaths
 */

/** @param {string} text */
const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

/**
 * BROWSER_HOST_BLOCK from firewall.env: the app server's IPv4 addresses, comma or space separated.
 * @param {string | null} envText
 * @returns {string[]}
 */
export function blockFrom(envText) {
  for (const line of String(envText ?? "").split("\n")) {
    const m = /^\s*BROWSER_HOST_BLOCK\s*=\s*"?([^"]*)"?\s*$/.exec(line);
    if (m) return m[1].split(/[\s,]+/).filter(Boolean);
  }
  return [];
}

/**
 * The file as it should be now.
 * @param {CheckDeps} deps
 * @param {CheckPaths} paths
 */
export async function currentText(deps, paths) {
  const ip = await deps.run("ip", ["-j", "-4", "addr", "show", "scope", "global"]);
  if (ip.code !== 0) throw new Error("firewall_ip_failed");
  const uid = await deps.run("id", ["-u", HOST_USER]);
  const hostUid = Number(uid.stdout.trim());
  if (uid.code !== 0 || !Number.isInteger(hostUid)) throw new Error("firewall_no_host_user");
  return firewallText({ hostV4: publicAddresses(JSON.parse(ip.stdout)), blockV4: blockFrom(deps.readFile(paths.env)), hostUid });
}

/**
 * The table's meaning now, or null when the table is missing.
 * @param {CheckDeps} deps
 */
async function meaningNow(deps) {
  const r = await deps.run("nft", ["-j", "list", "table", ...TABLE.split(" ")]);
  if (r.code !== 0) return null;
  try {
    return listingMeaning(JSON.parse(r.stdout));
  } catch {
    return null;
  }
}

/**
 * Write, check, load and save (see the header). Throws when nft refuses the file: nothing is loaded then.
 * @param {string} text
 * @param {CheckDeps} deps
 * @param {CheckPaths} paths
 */
async function load(text, deps, paths) {
  deps.writeFile(paths.file, text, 0o644);
  const check = await deps.run("nft", ["-c", "-f", paths.file]);
  if (check.code !== 0) throw new Error("firewall_check_refused");
  const applied = await deps.run("nft", ["-f", paths.file]);
  if (applied.code !== 0) throw new Error("firewall_load_failed");
  const meaning = await meaningNow(deps);
  if (meaning === null) throw new Error("firewall_missing_after_load");
  deps.writeFile(path.join(paths.savedDir, "firewall.loaded.json"), meaning, 0o600);
  deps.writeFile(path.join(paths.savedDir, "firewall.loaded.sha256"), sha256(text), 0o600);
}

/**
 * Why a check must reload, or null when the table is as loaded.
 * @param {{ hash: string, savedHash: string | null, meaning: string | null, saved: string | null }} s
 */
export function reloadReason(s) {
  if (s.meaning === null) return "missing";
  if (s.saved === null || s.savedHash === null) return "unsaved";
  if (s.hash !== s.savedHash.trim()) return "file_changed";
  if (s.meaning !== s.saved) return "listing_changed";
  return null;
}

/**
 * One run of the loader or the check.
 * @param {"load" | "check"} mode
 * @param {CheckDeps} deps
 * @param {CheckPaths} [paths]
 * @returns {Promise<{ reloaded: boolean, reason: string | null }>}
 */
export async function firewallRun(mode, deps, paths = PATHS) {
  const text = await currentText(deps, paths);
  /** @type {string | null} */
  let reason = "load";
  if (mode === "check") {
    reason = reloadReason({
      hash: sha256(text),
      savedHash: deps.readFile(path.join(paths.savedDir, "firewall.loaded.sha256")),
      meaning: await meaningNow(deps),
      saved: deps.readFile(path.join(paths.savedDir, "firewall.loaded.json")),
    });
  }
  if (reason !== null) await load(text, deps, paths);
  deps.writeFile(paths.ok, `${new Date(deps.now()).toISOString()}\n`, 0o644);
  deps.log(`[firewall] ${mode} ${reason === null ? "unchanged" : `reloaded ${reason}`}`);
  return { reloaded: reason !== null, reason };
}

/** The real commands and files. @returns {CheckDeps} */
export function systemCheckDeps() {
  return {
    run: (cmd, args) =>
      new Promise((resolve) => {
        execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024, timeout: 30_000 }, (err, stdout) => {
          const code = err ? (typeof (/** @type {{ code?: unknown }} */ (err).code) === "number" ? Number(/** @type {{ code?: unknown }} */ (err).code) : 1) : 0;
          resolve({ code, stdout: String(stdout ?? "") });
        });
      }),
    readFile: (p) => {
      try {
        return fs.readFileSync(p, "utf8");
      } catch {
        return null;
      }
    },
    writeFile: (p, text, mode) => {
      fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o755 });
      const tmp = `${p}.tmp`;
      fs.writeFileSync(tmp, text, { mode });
      fs.chmodSync(tmp, mode);
      fs.renameSync(tmp, p);
    },
    now: () => Date.now(),
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
  const mode = process.argv[2] ?? "check";
  const deps = systemCheckDeps();
  const main = async () => {
    if (mode === "print") {
      process.stdout.write(await currentText(deps, PATHS));
      return;
    }
    if (mode !== "load" && mode !== "check") throw new Error("firewall_bad_mode");
    await firewallRun(mode, deps);
  };
  main().catch((err) => {
    // Codes only: the error's own name, never a value read.
    const code = err instanceof Error && /^firewall_[a-z_]+$/.test(err.message) ? err.message : "firewall_error";
    process.stderr.write(`[firewall] ${code}\n`);
    process.exit(1);
  });
}

