// @ts-check
// The stand-in's log, kept in proof mode only (docs/plans/browser-host.md
// Decision 17 and section 7), moved from scripts/browser-stand-in.mjs.
//
// Every entry is { seq, at, ...entry }: what was asked of the API and of the
// fixture sites, in order. It is appended to BROWSER_STAND_IN_LOG (default:
// the system temp folder) at the moment it is recorded, and the in-memory
// copy, which GET /__stand-in/log reads, gains the fields a request learns
// later (its route, the create's settings, a fixture's status). The entries
// hold no page text, no typed character and no password.

import fs from "node:fs";

/** @typedef {Record<string, unknown> & { seq: number, at: string }} ProofEntry */

/**
 * @param {string} file
 */
export function createProofLog(file) {
  let seq = 0;
  /** @type {ProofEntry[]} */
  let log = [];
  return {
    file,
    /**
     * @param {Record<string, unknown>} entry
     * @returns {ProofEntry}
     */
    record(entry) {
      const e = { seq: (seq += 1), at: new Date().toISOString(), ...entry };
      log.push(e);
      if (log.length > 20_000) log = log.slice(-10_000);
      try {
        fs.appendFileSync(file, `${JSON.stringify(e)}\n`);
      } catch {
        /* the in-memory log still has it */
      }
      return e;
    },
    /** @param {number} since */
    since: (since) => log.filter((e) => e.seq > since),
    /** The reset control: the log cleared and its numbering started again. */
    clear() {
      log = [];
      seq = 0;
    },
  };
}

/** @typedef {ReturnType<typeof createProofLog>} ProofLog */
