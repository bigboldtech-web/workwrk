// @ts-check
// The state file (docs/plans/browser-host.md 6.4): what a restart must find
// to kill what the last run left.
//
// <state dir>/state.json, mode 0600, written to state.json.tmp, synced and
// renamed on every start and end. It holds { v: 1, boot, mode, sessions }.
// A process entry is { id, pid, pgid, started: <ps lstart>, profile }; a
// container entry { id, container, network }. Never a token, the metadata
// or an address.

import fs from "node:fs";
import path from "node:path";

/**
 * @typedef {{ id: string, pid: number, pgid: number, started: string, profile: string }} ProcessEntry
 * @typedef {{ id: string, container: string, network: string }} ContainerEntry
 * @typedef {ProcessEntry | ContainerEntry} StateEntry
 * @typedef {{ v: 1, boot: string, mode: "process" | "container", sessions: StateEntry[] }} HostState
 */

const ENTRY_KEYS = {
  process: ["id", "pid", "pgid", "started", "profile"],
  container: ["id", "container", "network"],
};

/**
 * Only an entry's own fields, whatever else an object carries.
 * @param {"process" | "container"} mode
 * @param {Record<string, unknown>} e
 * @returns {StateEntry}
 */
export function entryOf(mode, e) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const k of ENTRY_KEYS[mode]) out[k] = e[k];
  return /** @type {StateEntry} */ (out);
}

/**
 * The state file in `dir`.
 * @param {string} dir
 */
export function createStateFile(dir) {
  const file = path.join(dir, "state.json");
  const tmp = `${file}.tmp`;
  return {
    file,
    /**
     * @param {HostState} state
     */
    write(state) {
      const text = JSON.stringify({ v: 1, boot: state.boot, mode: state.mode, sessions: state.sessions.map((e) => entryOf(state.mode, /** @type {Record<string, unknown>} */ (e))) });
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const fd = fs.openSync(tmp, "w", 0o600);
      try {
        fs.writeSync(fd, text);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.chmodSync(tmp, 0o600);
      fs.renameSync(tmp, file);
    },
    /** @returns {HostState | null} */
    read() {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.sessions)) return null;
        return parsed;
      } catch {
        return null;
      }
    },
  };
}

/** @typedef {ReturnType<typeof createStateFile>} StateFile */
