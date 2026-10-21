// Retried writes, answered once (docs/plans/mcp-server.md Decision 19, 4.6,
// review M4).
//
// An app that loses an answer (a timeout, a dropped connection) sends the
// same call again. For a write that MAKES something (a task, a comment, a
// doc, a reminder, a kudos) or ADDS to something (an append), a repeat
// within 60 seconds with the very same arguments, on the same connection, is
// that retry: it is answered with the first call's answer, and nothing is
// made twice. A repeat that arrives while the first is still running waits
// for it.
//
// ONLY WHAT CANNOT BE A NEW INTENT. A change that sets a value (update_task's
// status, dates, people, tags; move_task) is never deduped: "Done, Open,
// Done" is three changes the person asked for, and replaying the first Done
// would leave the task Open. And ANY write that touches an object drops
// every remembered answer about that object, on every connection: after
// "comment A, change the task, comment A", the second A is written, since
// the task is not the one the first A was about.
//
// What is remembered: the key (the SHA-256 of the connection, the tool and
// the arguments in a fixed key order), the answer the app was sent, and the
// objects the write touched. In memory, one pm2 instance, as every MCP
// limit; bounded, and a forgotten entry only means a retry is written again.
//
// Server-only.

import { createHash } from "node:crypto";

export const DEDUPE_TTL_MS = 60_000;
const MAX_ENTRIES = 20_000;

/** What a remembered write answered with. */
export interface DedupeEntry {
  payload: Record<string, unknown>;
  summary: string;
  /** The objects the write touched ("item:<id>", "doc:<id>"). */
  touched: string[];
  at: number;
}

const entries = new Map<string, DedupeEntry>();
const running = new Map<string, Promise<DedupeEntry | null>>();

/** Arguments as one string, every object's keys in order, so the same call always reads the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The key of one call: the connection, the tool and its arguments. */
export function dedupeKey(grantId: string, tool: string, args: Record<string, unknown>): string {
  return createHash("sha256").update(`${grantId}\n${tool}\n${canonicalJson(args)}`).digest("hex");
}

function prune(now: number): void {
  for (const [k, e] of entries) if (now - e.at >= DEDUPE_TTL_MS || e.at > now + DEDUPE_TTL_MS) entries.delete(k);
}

/** What a call meets under its key: a remembered answer, a first call still running, or the key, now its own. */
export type DedupeStart =
  | { kind: "hit"; entry: DedupeEntry }
  | { kind: "wait"; first: Promise<DedupeEntry | null> }
  | { kind: "claimed"; settle: (entry: Omit<DedupeEntry, "at"> | null) => void };

/**
 * One call under its key, decided at once (no await between the look and the
 * claim, so two calls sent together cannot both miss):
 *   hit      an answer from the last 60 seconds: give it again;
 *   wait     a first call with this key is still running: wait for its
 *            answer (null when it changed nothing; then start again);
 *   claimed  the call runs, and settles the key when it is done, with what
 *            it answered (remembered for 60 seconds) or null (a refusal or a
 *            failure: nothing is remembered). Settling twice does nothing.
 */
export function beginDedupe(key: string, now: number): DedupeStart {
  const e = entries.get(key);
  if (e) {
    if (now - e.at < DEDUPE_TTL_MS && e.at <= now + DEDUPE_TTL_MS) return { kind: "hit", entry: e };
    entries.delete(key);
  }
  const first = running.get(key);
  if (first) return { kind: "wait", first: first.catch(() => null) };
  let resolve!: (e: DedupeEntry | null) => void;
  const p = new Promise<DedupeEntry | null>((r) => {
    resolve = r;
  });
  running.set(key, p);
  let done = false;
  return {
    kind: "claimed",
    settle: (entry) => {
      if (done) return;
      done = true;
      if (running.get(key) === p) running.delete(key);
      if (!entry) {
        resolve(null);
        return;
      }
      if (entries.size >= MAX_ENTRIES) prune(now);
      if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
      const full = { ...entry, at: now };
      entries.set(key, full);
      resolve(full);
    },
  };
}

/** A write touched these objects: every remembered answer about any of them is dropped, on every connection. */
export function forgetTouching(touched: readonly string[]): void {
  if (touched.length === 0) return;
  const set = new Set(touched);
  for (const [k, e] of entries) if (e.touched.some((t) => set.has(t))) entries.delete(k);
}

/** Test seam: forget everything. */
export function resetDedupe(): void {
  entries.clear();
  running.clear();
}
