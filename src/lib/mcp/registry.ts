// The tools a connection sees and how one call runs
// (docs/plans/mcp-server.md 2.3, 2.4, 2.5, 4.1).
//
// tools/list: the read tools for a read connection, the write tools too for
// one that holds mcp:write, each with its title, description (ending with
// the data note), input schema, output schema and annotations. Under
// 2025-03-26 there is no title and no outputSchema, and a result carries no
// structuredContent; annotations go in both. Only a tool with a body is
// listed.
//
// tools/call (runTool), in order:
//   1. an unknown name (or one not offered) is -32602; a write tool on a
//      read connection answers readOnly;
//   2. what blocks every call without ending the connection: AI off, the
//      two step and password holds; then the day's cap (usage.ts);
//   3. plainData on every string, then the tool's own schema (badInput);
//   4. the body, as the person, through the app's own gates;
//   5. the usage counts (a call, and a refusal when it refused);
//   6. fitResult: the payload that fits the budget, or tooBig.
// Our own fixed sentences go plain (readOnly, the holds, aiOff, dailyCap,
// tooBig); every refusal from a body and every input problem goes in the
// data block, after a fixed lead (2.4).
//
// Server-only (the bodies read prisma).

import type { McpScope } from "@/lib/oauth/metadata";
import type { McpContext } from "./auth";
import { fitResult, plainDeep, withData } from "./data";
import { MCP_RPC_COPY, MCP_TOOL_COPY, MCP_TOOL_TEXT } from "./mcp-copy";
import { RpcError, type ProtocolVersion } from "./protocol";
import { plainArguments, schemaCheck } from "./schema-check";
import type { McpTool } from "./tool-types";
import { READ_TOOLS } from "./tools/read";
import { WRITE_TOOLS } from "./tools/write";
import { countCall, countRefused, dayCapReached, type UsageGrant } from "./usage";

const E = MCP_TOOL_COPY.errors;

/** Every tool defined, read then write. */
export const MCP_TOOLS: readonly McpTool[] = [...READ_TOOLS, ...WRITE_TOOLS];

const BY_NAME = new Map<string, McpTool>(MCP_TOOLS.map((t) => [t.name, t]));

/** A tool by name, only when it is offered (has a body). */
export function offeredTool(name: string): McpTool | null {
  const t = BY_NAME.get(name);
  return t && t.run ? t : null;
}

/** The tools a connection with these scopes may see. */
export function toolsFor(scopes: readonly McpScope[]): McpTool[] {
  const write = scopes.includes("mcp:write");
  return MCP_TOOLS.filter((t) => t.run && (t.scope === "read" || write));
}

/** One tool as tools/list gives it, in this version's form. */
export function describeTool(t: McpTool, version: ProtocolVersion): Record<string, unknown> {
  const text = MCP_TOOL_TEXT[t.name];
  const modern = version !== "2025-03-26";
  return {
    name: t.name,
    ...(modern ? { title: text.title } : {}),
    description: `${text.description} ${MCP_TOOL_COPY.dataNote}`,
    inputSchema: t.inputSchema,
    ...(modern ? { outputSchema: t.outputSchema } : {}),
    annotations: { ...t.annotations },
  };
}

/** tools/list's tools. */
export function listTools(scopes: readonly McpScope[], version: ProtocolVersion): Record<string, unknown>[] {
  return toolsFor(scopes).map((t) => describeTool(t, version));
}

/** A tool error (isError, no structuredContent). */
export function errorResult(text: string): Record<string, unknown> {
  return { content: [{ type: "text", text }], isError: true };
}

/** A tool's data result: the summary, the data block, and structuredContent where the version has it. */
export function dataResult(version: ProtocolVersion, summary: string, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    content: [{ type: "text", text: withData(summary, payload) }],
    ...(version !== "2025-03-26" ? { structuredContent: plainDeep(payload) } : {}),
  };
}

function usageOf(ctx: McpContext): UsageGrant {
  return { id: ctx.grant.id, organizationId: ctx.grant.organizationId, clientId: ctx.grant.clientId, userId: ctx.grant.userId };
}

/** One tools/call (see the file header). Throws RpcError for an unknown tool. */
export async function runTool(ctx: McpContext, version: ProtocolVersion, name: string, args: Record<string, unknown>, now: Date = new Date()): Promise<Record<string, unknown>> {
  const tool = offeredTool(name);
  if (!tool || !tool.run) throw new RpcError(-32602, MCP_RPC_COPY.invalidParams, { reason: MCP_RPC_COPY.unknownTool });
  const usage = usageOf(ctx);
  const plain = async (sentence: string) => {
    await countRefused(usage, now);
    return errorResult(sentence);
  };
  if (tool.scope === "write" && !ctx.scopes.includes("mcp:write")) return plain(E.readOnly);
  if (ctx.blocked === "ai_off" || !ctx.person) return plain(E.aiOff);
  if (ctx.blocked === "mfa") return plain(E.holdMfa);
  if (ctx.blocked === "password") return plain(E.holdPassword);
  if (await dayCapReached(ctx.grant.id, { write: tool.scope === "write" }, now)) return plain(E.dailyCap);
  await countCall(usage, now);

  const checked = schemaCheck(tool.inputSchema, plainArguments(args) as Record<string, unknown>);
  if (!checked.ok) {
    await countRefused(usage, now);
    return errorResult(withData(E.badInput, { problems: checked.problems }));
  }
  const answer = await tool.run({ ctx, person: ctx.person, version, now }, checked.value);
  if (answer.kind === "refused") {
    await countRefused(usage, now);
    return errorResult(withData(E.refusedLead, { reason: answer.reason }));
  }
  const fit = fitResult(answer.build);
  if (!fit.ok) return plain(E.tooBig);
  return dataResult(version, answer.summary(fit.payload), fit.payload);
}
