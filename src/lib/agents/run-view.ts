// One agent run as the Agents page shows it (spec-ai-automation section 2,
// /agents: the Run history tab and the agent run detail). Pure, so the list
// route, the detail route and the tests read an AgentRun row the same way.
//
// An AgentRun is written in two shapes:
//   autonomous (a schedule or Run now, src/lib/agents/autonomous.ts)
//     input  { trigger: "SCHEDULED" | "MANUAL", prompt }
//     output { text, toolCalls: [{ name, input, result, errorText, durationMs }], finishReason }
//   from a chat with the agent (the stream route, one row per tool call)
//     input  { toolName, input }
//     output the tool's raw result

import { toolSentence } from "./tool-verbs";

export type RunTrigger = "SCHEDULED" | "MANUAL" | "CHAT";
export type RunStatus = "SUCCEEDED" | "FAILED" | "RUNNING";

export interface RunToolCall {
  name: string;
  input: Record<string, unknown> | null;
  result: unknown;
  error: string | null;
  durationMs: number | null;
}

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
  return t === "SCHEDULED" || t === "MANUAL" ? t : "CHAT";
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
    return [{
      name: call.name,
      input: rec(call.input),
      result: call.result ?? null,
      error: errorText ?? resultError(call.result),
      durationMs: typeof call.durationMs === "number" ? call.durationMs : null,
    }];
  });
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
