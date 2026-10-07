// One agent run as the Agents page shows it (spec-ai-automation section 2,
// /agents: the Run history tab and the agent run detail). Pure, so the list
// route, the detail route and the tests read an AgentRun row the same way.
//
// An AgentRun is written in three shapes:
//   autonomous (a schedule or Run now, src/lib/agents/autonomous.ts)
//     input  { trigger: "SCHEDULED" | "MANUAL", prompt }
//     output { text, toolCalls: [{ name, input, result, errorText, durationMs }], finishReason }
//   from a chat with the agent (the stream route, one row per tool call)
//     input  { toolName, input }
//     output the tool's raw result
//   one AI teammate turn (src/lib/agents/budget.ts and engine.ts)
//     input  { trigger: "CHAT" | "RESUME" | "ROUTINE", practice, routineId }
//     output { text, toolCalls: [{ ..., state, actionId }], finishReason, practice }
//
// A teammate's continue after the person decided on its requests (RESUME)
// reads as a chat run: it is the same chat going on, started by the person's
// own decision in it. A routine's run reads as its own trigger.

import type { CallState } from "./teammate-thread";
import { toolOutcome, toolOutcomeSentence, toolSentence } from "./tool-verbs";

export type RunTrigger = "SCHEDULED" | "MANUAL" | "CHAT" | "ROUTINE" | "DELEGATED";
export type RunStatus = "SUCCEEDED" | "FAILED" | "RUNNING";

export interface RunToolCall {
  name: string;
  input: Record<string, unknown> | null;
  result: unknown;
  error: string | null;
  durationMs: number | null;
  /** A teammate's call: how it ended (waiting for approval and practice never ran). Absent on older rows. */
  state?: CallState;
}

const CALL_STATE_LIST: readonly CallState[] = ["ran", "failed", "waiting", "practice"];
const CALL_STATES: ReadonlySet<string> = new Set<string>(CALL_STATE_LIST);

export interface RunRowLike {
  status: string;
  startedAt: Date | string;
  endedAt: Date | string | null;
  input: unknown;
  output: unknown;
  error: string | null;
}

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function runTrigger(input: unknown): RunTrigger {
  const t = rec(input)?.trigger;
  return t === "SCHEDULED" || t === "MANUAL" || t === "ROUTINE" || t === "DELEGATED" ? t : "CHAT";
}

/** PENDING (the row is written before the model answers) reads as Running. */
export function runStatus(status: string): RunStatus {
  if (status === "SUCCEEDED" || status === "SUCCESS" || status === "COMPLETED") return "SUCCEEDED";
  if (status === "FAILED" || status === "ERROR") return "FAILED";
  return "RUNNING";
}

export function runDurationMs(startedAt: Date | string, endedAt: Date | string | null): number | null {
  if (!endedAt) return null;
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/** The error a tool returned in its own result ({ error: "..." }), if any. */
export function resultError(result: unknown): string | null {
  const e = rec(result)?.error;
  return typeof e === "string" && e.trim() ? e.trim() : null;
}

export function runToolCalls(row: Pick<RunRowLike, "input" | "output" | "error" | "startedAt" | "endedAt">): RunToolCall[] {
  const input = rec(row.input);
  if (input && typeof input.toolName === "string") {
    return [{
      name: input.toolName,
      input: rec(input.input),
      result: row.output ?? null,
      error: row.error ?? resultError(row.output),
      durationMs: runDurationMs(row.startedAt, row.endedAt),
    }];
  }
  const calls = rec(row.output)?.toolCalls;
  if (!Array.isArray(calls)) return [];
  return calls.slice(0, 20).flatMap((c) => {
    const call = rec(c);
    if (!call || typeof call.name !== "string") return [];
    const errorText = typeof call.errorText === "string" && call.errorText ? call.errorText : null;
    const state = typeof call.state === "string" && CALL_STATES.has(call.state) ? (call.state as CallState) : null;
    return [{
      name: call.name,
      input: rec(call.input),
      result: call.result ?? null,
      error: errorText ?? resultError(call.result),
      durationMs: typeof call.durationMs === "number" ? call.durationMs : null,
      ...(state ? { state } : {}),
    }];
  });
}

/**
 * Where a run's chat opens, for a run whose chat is the viewer's own: an AI
 * teammate's chat by the teammate's slug (there is one per person), an Ask
 * AI chat by its id. Null when the run has no chat.
 */
export function runChatHref(sessionId: string | null, kind: string | null | undefined, agentSlug: string): string | null {
  if (!sessionId) return null;
  if (kind === "TEAMMATE_GROUP") return `/agents?group=${encodeURIComponent(sessionId)}`;
  return kind === "TEAMMATE" ? `/agents?chat=${encodeURIComponent(agentSlug)}` : `/sidekick?session=${encodeURIComponent(sessionId)}`;
}

/** Markdown down to one plain line: no headings, bullets, emphasis or code ticks. */
export function plainLine(text: string, max = 160): string {
  const line = text
    .split("\n")
    .map((l) => l.replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s*)/, "").trim())
    .find((l) => l.length > 0) ?? "";
  const clean = line.replace(/[*_`~]+/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/**
 * The one-line summary a run row shows: what the agent said (autonomous),
 * or what the tool did (a chat run), or why it failed.
 */
export function runSummary(row: RunRowLike): string {
  const status = runStatus(row.status);
  const input = rec(row.input);
  if (input && typeof input.toolName === "string") {
    // A call that only asked the person (Ask AI's waiting requests) never
    // reads as done: "Would send kudos to Max".
    const outcome = toolOutcome(input.toolName, row.output);
    if (outcome.state === "waiting") return toolOutcomeSentence(input.toolName, rec(input.input), outcome).text;
    const err = row.error ?? resultError(row.output);
    return toolSentence(input.toolName, rec(input.input), Boolean(err)).text;
  }
  const text = rec(row.output)?.text;
  if (typeof text === "string" && text.trim()) return plainLine(text);
  if (status === "FAILED") return "The run didn't finish.";
  if (status === "RUNNING") return "Running now.";
  const calls = runToolCalls(row);
  return calls.length > 0 ? `${calls.length} ${calls.length === 1 ? "action" : "actions"}` : "Nothing to report.";
}

/**
 * Whether this viewer may read what an autonomous run found: its words, the
 * inputs it searched with and the raw results. An autonomous run acts with
 * the rights of the admin who started or created the agent, so its results
 * can hold work (private Spaces, people data) a Member cannot open. The
 * Owner, Admins and the person who pressed Run now read it all; everyone
 * else reads that it ran, when, how it went and which tools it used.
 */
export function canReadRunDetail(run: { triggeredBy: string | null }, viewer: { userId: string; admin: boolean }): boolean {
  return viewer.admin || (run.triggeredBy !== null && run.triggeredBy === viewer.userId);
}

/** The one-line summary for a viewer who may not read the run's words. */
export function runSummaryWithheld(row: RunRowLike): string {
  const status = runStatus(row.status);
  if (status === "FAILED") return "The run didn't finish.";
  if (status === "RUNNING") return "Running now.";
  const calls = runToolCalls(row);
  return calls.length > 0 ? `Finished · ${calls.length} ${calls.length === 1 ? "action" : "actions"}` : "Finished";
}

/** The tool rows with what went in and what came back taken out. */
export function withheldToolCalls(row: Pick<RunRowLike, "input" | "output" | "error" | "startedAt" | "endedAt">): RunToolCall[] {
  return runToolCalls(row).map((c) => ({ name: c.name, input: null, result: null, error: c.error ? "It failed." : null, durationMs: c.durationMs }));
}
