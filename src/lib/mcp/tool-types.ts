// What an MCP tool is (docs/plans/mcp-server.md 4.1, 2.5), shared by the
// read tools, the write tools and the registry. Types only.

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
}

/**
 * What a tool's body answers:
 *   data      the payload at each shrink step (fitResult, data.ts), smaller
 *             as the step grows, null when nothing more can be cut, with
 *             the summary sentence for the payload that fits;
 *   refused   a refusal, always sent in the data block (2.4), since its
 *             words may name something from the workspace or the input.
 */
export type ToolAnswer =
  | { kind: "data"; build: (step: number) => Record<string, unknown> | null; summary: (payload: Record<string, unknown>) => string }
  | { kind: "refused"; reason: string };

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
  /** The body; a tool without one is defined but not offered yet (the write tools until step 3). */
  run?: (call: McpCall, input: Record<string, unknown>) => Promise<ToolAnswer>;
}

/** A refusal (2.4). */
export function refused(reason: string): ToolAnswer {
  return { kind: "refused", reason };
}

/** A payload that never shrinks (one small object). */
export function fixed(payload: Record<string, unknown>, summary: string): ToolAnswer {
  return { kind: "data", build: (step) => (step === 0 ? payload : null), summary: () => summary };
}
