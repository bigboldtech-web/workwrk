// What an MCP tool is (docs/plans/mcp-server.md 4.1, 2.5), shared by the
// read tools, the write tools and the registry. Types, and two builders.

import type { ActingPerson } from "@/lib/agents/acting";
import type { McpContext } from "./auth";
import type { MCP_TOOL_TEXT } from "./mcp-copy";
import type { ProtocolVersion } from "./protocol";
import type { JsonSchema } from "./schema-check";

export type McpToolName = keyof typeof MCP_TOOL_TEXT;

/** One tools/call, as a tool's body sees it: the person it acts as, always present here. */
export interface McpCall {
  ctx: McpContext;
  person: ActingPerson;
  version: ProtocolVersion;
  now: Date;
  /**
   * A write: how many changes it may make (the day's reservation, at least
   * 1; a create makes no more subtasks than this allows). 1 for a read.
   */
  allowance: number;
  /**
   * A write says what it has made so far, as soon as it has made anything
   * (step 3 review, M2): should it then fail, the registry still counts,
   * audits and remembers that, and answers with this payload instead of an
   * error, so a retry never makes it twice.
   */
  made: (progress: WriteProgress) => void;
}

/** What a write has made so far, and a payload (valid for its outputSchema) that says so. */
export interface WriteProgress {
  effect: WriteEffect;
  payload: Record<string, unknown>;
}

/**
 * What a write changed (step 3), for the registry: the audit row's target,
 * the objects whose remembered answers a write drops (dedupe.ts), and how
 * many changes it made (a task and each of its subtasks), which the write
 * limits and the day's count charge.
 */
export interface WriteEffect {
  target: { type: "item" | "doc" | "reminder" | "kudos"; id: string };
  /** Every object it changed, "item:<id>", "doc:<id>", "reminder:<id>", "kudos:<id>". */
  touched: string[];
  /** One, plus one for each subtask a create made; 0 when the body found it already made (giveKudos's own resend check). */
  changes: number;
}

/**
 * What a tool's body answers:
 *   data      the payload at each shrink step (fitResult, data.ts), smaller
 *             as the step grows, null when nothing more can be cut, with
 *             the summary sentence for the payload that fits; a write's
 *             also says what it changed (effect), and once it changed
 *             anything is answered with its smallest step even when that
 *             is over the budget, never with an error;
 *   refused   a refusal, always sent in the data block (2.4), since its
 *             words may name something from the workspace or the input. A
 *             write that refused changed nothing.
 */
export type ToolAnswer =
  | { kind: "data"; build: (step: number) => Record<string, unknown> | null; summary: (payload: Record<string, unknown>) => string; effect?: WriteEffect }
  | { kind: "refused"; reason: string; detail?: Record<string, unknown> };

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface McpTool {
  name: McpToolName;
  scope: "read" | "write";
  inputSchema: JsonSchema & { type: "object" };
  outputSchema: JsonSchema & { type: "object" };
  annotations: ToolAnnotations;
  /** The body; a tool without one is defined but not offered. */
  run?: (call: McpCall, input: Record<string, unknown>) => Promise<ToolAnswer>;
  /**
   * A write whose repeat with the same input within 60 seconds is a retry,
   * answered with the first answer (4.6): one that makes or adds to
   * something. Never one that sets a value (update_task's other fields,
   * move_task).
   */
  dedupe?: (input: Record<string, unknown>) => boolean;
  /** A write's most possible changes (a create's task and its subtasks); 1 when absent (step 3 review, M1). */
  cost?: (input: Record<string, unknown>) => number;
}

/** A refusal (2.4), with any detail the app can act on (the ids of several Lists of one name). */
export function refused(reason: string, detail?: Record<string, unknown>): ToolAnswer {
  return { kind: "refused", reason, ...(detail && Object.keys(detail).length ? { detail } : {}) };
}

/** A payload that never shrinks (one small object), with what a write changed. */
export function fixed(payload: Record<string, unknown>, summary: string, effect?: WriteEffect): ToolAnswer {
  return { kind: "data", build: (step) => (step === 0 ? payload : null), summary: () => summary, ...(effect ? { effect } : {}) };
}
