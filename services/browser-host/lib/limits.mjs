// @ts-check
// How many browsers the host runs at once (docs/plans/browser-host.md
// Decision 18 and 6.2), and the held slots that count beside them.
//
//   max = min(floor((MemTotal - 2 GiB) / (S + shim)), 2 x vCPUs, 100)
//
// S is the memory a session may use (container mode: BROWSER_HOST_SESSION_MEMORY_MB,
// default 1280; process mode: 1024), and shim is 32 MiB a session for its
// containerd shim and bridge in container mode, none in process mode. The
// override (BROWSER_HOST_MAX) only ever lowers the max. A max below 1 means
// the host refuses to start.
//
// Pure: no clock, no I/O.

export const MIB = 1024 * 1024;
export const GIB = 1024 * MIB;

/** What the host keeps for itself, the launcher, Caddy and the kernel. */
export const RESERVE_BYTES = 2 * GIB;

/** The most sessions any host runs, however large the server. */
export const HARD_MAX = 100;

/** Container mode's allowance a session for its shim and bridge. */
export const SHIM_MIB = 32;

/**
 * The max for a server.
 * @param {number} memTotalBytes
 * @param {number} cpus
 * @param {number} sessionMb
 * @param {number | null | undefined} override
 * @param {number} [shimMb]
 * @returns {number}
 */
export function computeMax(memTotalBytes, cpus, sessionMb, override, shimMb = SHIM_MIB) {
  const perSession = (sessionMb + shimMb) * MIB;
  const byMemory = perSession > 0 ? Math.floor((memTotalBytes - RESERVE_BYTES) / perSession) : 0;
  const byCpu = 2 * Math.max(0, Math.floor(cpus));
  let max = Math.max(0, Math.min(byMemory, byCpu, HARD_MAX));
  if (typeof override === "number" && Number.isInteger(override) && override >= 0) max = Math.min(max, override);
  return max;
}

/**
 * @typedef {{
 *   max: number,
 *   held: () => number,
 *   reasons: () => string[],
 *   holdSlot: (reason: string, active: number) => (() => void) | null,
 * }} Slots
 */

/**
 * The held slots: the image build and every self-test hold one while they
 * run (Decision 18), and creates count them as taken.
 * @param {number} max
 * @returns {Slots}
 */
export function createSlots(max) {
  /** @type {Map<number, string>} */
  const held = new Map();
  let next = 0;
  return {
    max,
    held: () => held.size,
    reasons: () => [...held.values()],
    holdSlot(reason, active) {
      if (active + held.size >= max) return null;
      next += 1;
      const key = next;
      held.set(key, reason);
      return () => void held.delete(key);
    },
  };
}
