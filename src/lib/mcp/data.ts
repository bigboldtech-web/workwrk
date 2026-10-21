// What the MCP server sends back as data, and how big it may be
// (docs/plans/mcp-server.md Decision 13, 2.5, 4.4, 4.5).
//
// CONTENT WRITTEN BY OTHERS IS DATA. Every result is a summary sentence in
// our own words, then one <workwrk_data> block holding the JSON. Inside it,
// every "<" and ">" is written \u003c and \u003e (still valid JSON, read back
// as the same text), after plainData has turned look-alike brackets into
// real ones and dropped the invisible characters that hide or reorder text
// (src/lib/agents/plain-data.ts, the teammates' rule): nothing a task title,
// a comment or a doc says can close the block. structuredContent is the same
// object with every string through plainData.
//
// THE BUDGET (review M5). The escaped block is at most 30,000 characters,
// each "<" or ">" counting the six it is written as. A result that is over
// shrinks, in a fixed order, until it fits: list rows are cut at a row (with
// nextCursor), then for get_task the comments, the description and the
// subtasks, each with its flag, then for get_doc the window halves (with
// nextOffset and truncated). A result that still does not fit answers tooBig.
//
// Pure.

import { plainData } from "@/lib/agents/plain-data";

/** The most characters the escaped data block may hold. */
export const DATA_BUDGET = 30_000;

/** A JSON text made safe for the block: plain, then every bracket escaped. */
export function escapeJson(json: string): string {
  return plainData(json).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

/** The escaped JSON of a payload, as the block carries it. */
export function blockJson(payload: unknown): string {
  return escapeJson(JSON.stringify(payload ?? null));
}

/** The block's size: what the budget counts. */
export function blockSize(payload: unknown): number {
  return blockJson(payload).length;
}

/** The data block itself. */
export function dataBlock(payload: unknown): string {
  return `<workwrk_data>${blockJson(payload)}</workwrk_data>`;
}

/** A sentence of ours, then the data block. */
export function withData(sentence: string, payload: unknown): string {
  return `${sentence}\n\n${dataBlock(payload)}`;
}

/** Every string in a value through plainData (structuredContent). */
export function plainDeep<T>(value: T): T {
  if (typeof value === "string") return plainData(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => plainDeep(v)) as unknown as T;
  if (value instanceof Date) return value;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = plainDeep(v);
    return out as T;
  }
  return value;
}

/**
 * The first shrink step whose payload fits the budget. `build(step)` gives
 * the payload at that step, smaller as the step grows, or null when there
 * is nothing more to cut.
 */
export function fitResult<T>(build: (step: number) => T | null, budget = DATA_BUDGET): { ok: true; payload: T; step: number } | { ok: false } {
  for (let step = 0; step < 64; step += 1) {
    const payload = build(step);
    if (payload === null) return { ok: false };
    if (blockSize(payload) <= budget) return { ok: true, payload, step };
  }
  return { ok: false };
}

/**
 * The most leading rows of a list that fit (4.5 step 1), cut at a row.
 * `make(rows, cut)` builds the payload; `cut` says rows were left out, so
 * it sets nextCursor from the last row kept. Null when not even one row fits.
 */
export function fitRows<R, T>(rows: readonly R[], make: (rows: R[], cut: boolean) => T, budget = DATA_BUDGET): T | null {
  const whole = make([...rows], false);
  if (blockSize(whole) <= budget) return whole;
  // The largest k in 0..n-1 whose payload fits, by halving.
  let lo = 0;
  let hi = rows.length - 1;
  let best: T | null = null;
  while (lo <= hi) {
    const k = Math.floor((lo + hi) / 2);
    const p = make(rows.slice(0, k), true);
    if (blockSize(p) <= budget) {
      best = k > 0 ? p : best;
      lo = k + 1;
    } else hi = k - 1;
  }
  return best;
}

/** A string cut to `max` characters, never inside a surrogate pair. */
export function cutText(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  let end = Math.max(0, max);
  const code = text.charCodeAt(end - 1);
  if (end > 0 && code >= 0xd800 && code <= 0xdbff) end -= 1;
  return { text: text.slice(0, end), truncated: true };
}

// ── get_task (4.5 step 2) ──

/** The task's parts the ladder cuts. */
export interface TaskParts {
  description: string;
  subtasks: unknown[];
  /** Newest last, at most 21 (one more than shown says there are more). */
  comments: Array<{ text: string } & Record<string, unknown>>;
  /** More comments exist than were read. */
  moreComments: boolean;
}

/** One rung: how many comments of how many characters, the description's and the subtasks' caps. */
export interface TaskRung {
  comments: number;
  commentChars: number;
  description: number;
  subtasks: number;
}

/**
 * The ladder (4.5): the comments first (20, 10, 5, 0, each at 2,000 then
 * 500 characters), then the description (4,000, 1,000, 200), then the
 * subtasks (50, 20).
 */
export const TASK_LADDER: readonly TaskRung[] = (() => {
  const out: TaskRung[] = [];
  for (const n of [20, 10, 5]) for (const chars of [2000, 500]) out.push({ comments: n, commentChars: chars, description: 4000, subtasks: 50 });
  for (const d of [4000, 1000, 200]) out.push({ comments: 0, commentChars: 0, description: d, subtasks: 50 });
  out.push({ comments: 0, commentChars: 0, description: 200, subtasks: 20 });
  return out;
})();

/** The task's parts at one rung, with each flag. */
export function taskAtRung(parts: TaskParts, rung: TaskRung) {
  const d = cutText(parts.description, rung.description);
  const latest = rung.comments > 0 ? parts.comments.slice(-rung.comments) : [];
  const comments = latest.map((c) => {
    const t = cutText(c.text, rung.commentChars);
    return { ...c, text: t.text, truncated: t.truncated };
  });
  return {
    description: d.text,
    descriptionTruncated: d.truncated,
    subtasks: parts.subtasks.slice(0, rung.subtasks),
    subtasksTruncated: parts.subtasks.length > rung.subtasks,
    comments,
    commentsTruncated: parts.moreComments || parts.comments.length > comments.length,
  };
}

// ── get_doc (4.5 step 3) ──

/** The first window, in characters; it halves while the block is over. */
export const DOC_WINDOW = 20_000;
/** The smallest window tried before tooBig. */
export const DOC_WINDOW_MIN = 200;

/** The window of text at one step: 20,000 characters, halved per step. Null past the smallest. */
export function docWindow(text: string, offset: number, step: number): { text: string; offset: number; nextOffset: number | null; length: number; truncated: boolean } | null {
  const size = Math.floor(DOC_WINDOW / 2 ** step);
  if (size < DOC_WINDOW_MIN) return null;
  const cut = cutText(text.slice(offset), size);
  const end = offset + cut.text.length;
  const nextOffset = end < text.length ? end : null;
  return { text: cut.text, offset, nextOffset, length: text.length, truncated: nextOffset !== null };
}
