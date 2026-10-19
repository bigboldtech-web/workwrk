// @ts-check
// The host's log lines (docs/plans/browser-host.md section 7): an event name,
// a status code, a duration in milliseconds and counts, for journald.
//
//   [host] api create 201 2140ms
//   [host] session ended timeout running=3
//
// NOTHING ELSE CAN REACH A LINE. A part is a lower-case word (an event or a
// reason code we wrote), a number, { ms: n } for a duration, or { name: n }
// for a count. Anything else, an id, a token, an address, a path, a query, a
// header, a body or a host name, is written as "?": a caller that passes one
// by mistake loses the value, never leaks it.

const WORD = /^[a-z][a-z0-9_]{0,47}$/;

/** @typedef {string | number | Record<string, number>} LogPart */

/**
 * One part as it may appear in a line.
 * @param {unknown} p
 * @returns {string}
 */
export function safePart(p) {
  if (typeof p === "number") return Number.isFinite(p) ? String(Math.round(p)) : "?";
  if (typeof p === "string") return WORD.test(p) ? p : "?";
  if (p && typeof p === "object" && !Array.isArray(p)) {
    const out = [];
    for (const [k, v] of Object.entries(p)) {
      const n = typeof v === "number" && Number.isFinite(v) ? String(Math.round(v)) : "?";
      if (k === "ms") out.push(`${n}ms`);
      else out.push(`${WORD.test(k) ? k : "?"}=${n}`);
    }
    return out.length ? out.join(" ") : "?";
  }
  return "?";
}

/**
 * The line a set of parts makes.
 * @param {string} tag
 * @param {unknown[]} parts
 */
export function logLine(tag, parts) {
  return `[${WORD.test(tag) ? tag : "?"}] ${parts.map(safePart).join(" ")}`;
}

/** @typedef {{ event: (...parts: unknown[]) => void }} Log */

/**
 * A log writing whole lines to `write` (stderr by default).
 * @param {{ tag?: string, write?: (line: string) => void }} [o]
 * @returns {Log}
 */
export function createLog(o = {}) {
  const tag = o.tag ?? "host";
  const write = o.write ?? ((line) => void process.stderr.write(`${line}\n`));
  return {
    event: (...parts) => {
      try {
        write(logLine(tag, parts));
      } catch {
        // A log that cannot be written never stops the host.
      }
    },
  };
}

/** A log that writes nothing (tests). */
export const SILENT_LOG = createLog({ write: () => undefined });
