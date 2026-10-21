// The tools a connection sees and how one call runs
// (docs/plans/mcp-server.md 2.3, 2.4, 2.5, 4.1, 4.6, 7, 3.10).
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
//      two step and password holds; then the day's caps (usage.ts: 5,000
//      calls, and for a write 1,000 changes);
//   3. plainData on every string, then the tool's own schema (badInput);
//   4. for a write: a retry of a creating write or an append in the last 60
//      seconds is answered with the first answer (dedupe.ts, 4.6); then the
//      write bursts (limits.ts: 10 changes in 10 seconds, 30 a minute),
//      tooFast past them;
//   5. the body, as the person, through the app's own gates, inside
//      runAsMcp (via.ts), so every activity row it writes says "via <app>
//      (MCP)";
//   6. the usage counts (a call; a refusal; each change, a subtask
//      included), and for a write that changed something ONE audit row
//      (mcp.tool.<tool>, section 7: the person as actor and actingFor, the
//      app as "<label> (MCP)", the target, the tool and the connection,
//      the address and user agent, never a title). A refusal changed
//      nothing: no audit row, one refusal counted. Any write drops every
//      remembered answer about what it touched;
//   7. fitResult: the payload that fits the budget, or tooBig.
// Our own fixed sentences go plain (readOnly, the holds, aiOff, dailyCap,
// tooFast, tooBig); every refusal from a body and every input problem goes
// in the data block, after a fixed lead (2.4).
//
// Server-only (the bodies read prisma).

import { logActivity } from "@/lib/activity";
import type { McpScope } from "@/lib/oauth/metadata";
import type { McpContext } from "./auth";
import { fitResult, plainDeep, withData } from "./data";
import { beginDedupe, dedupeKey, forgetTouching, type DedupeStart } from "./dedupe";
import { admitWrite, chargeWrites } from "./limits";
import { MCP_AUDIT_COPY, MCP_RPC_COPY, MCP_SUMMARY_COPY, MCP_TOOL_COPY, MCP_TOOL_TEXT, MCP_VIA_COPY } from "./mcp-copy";
import { RpcError, type ProtocolVersion } from "./protocol";
import { plainArguments, schemaCheck } from "./schema-check";
import type { McpTool, McpToolName, WriteEffect } from "./tool-types";
import { READ_TOOLS } from "./tools/read";
import { WRITE_TOOLS } from "./tools/write";
import { countCall, countRefused, countWrite, dayCapReached, type UsageGrant } from "./usage";
import { runAsMcp } from "./via";

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

/** Where a request came from, for the audit row (never logged). */
export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

/** The audit row of one write that changed something (section 7). Never a title, never what was written. */
async function auditWrite(ctx: McpContext, tool: McpToolName, effect: WriteEffect, meta: RequestMeta): Promise<void> {
  const g = ctx.grant;
  await logActivity({
    type: `mcp.tool.${tool}`,
    actorId: g.userId,
    actingForId: g.userId,
    actorType: "mcp",
    actorLabel: MCP_VIA_COPY.actorLabel(g.appName),
    organizationId: g.organizationId,
    description: (MCP_AUDIT_COPY.tools as Record<string, string>)[tool] ?? MCP_AUDIT_COPY.toolChange,
    targetType: effect.target.type,
    targetId: effect.target.id,
    metadata: { tool, grantId: g.id, clientId: g.clientId, redirectHost: g.redirectHost },
    ipAddress: meta.ip ?? null,
    userAgent: meta.userAgent ? meta.userAgent.slice(0, 500) : null,
    severity: "info",
  });
}

/** A remembered answer, given again: the same payload (marked duplicate where the tool says so) and our sentence. */
function replay(version: ProtocolVersion, payload: Record<string, unknown>): Record<string, unknown> {
  return dataResult(version, MCP_SUMMARY_COPY.duplicate, "duplicate" in payload ? { ...payload, duplicate: true } : payload);
}

/** One tools/call (see the file header). Throws RpcError for an unknown tool. */
export async function runTool(
  ctx: McpContext,
  version: ProtocolVersion,
  name: string,
  args: Record<string, unknown>,
  now: Date = new Date(),
  meta: RequestMeta = {},
): Promise<Record<string, unknown>> {
  const tool = offeredTool(name);
  if (!tool || !tool.run) throw new RpcError(-32602, MCP_RPC_COPY.invalidParams, { reason: MCP_RPC_COPY.unknownTool });
  const usage = usageOf(ctx);
  const plain = async (sentence: string) => {
    await countRefused(usage, now);
    return errorResult(sentence);
  };
  const write = tool.scope === "write";
  if (write && !ctx.scopes.includes("mcp:write")) return plain(E.readOnly);
  if (ctx.blocked === "ai_off" || !ctx.person) return plain(E.aiOff);
  if (ctx.blocked === "mfa") return plain(E.holdMfa);
  if (ctx.blocked === "password") return plain(E.holdPassword);
  if (await dayCapReached(ctx.grant.id, { write }, now)) return plain(E.dailyCap);
  await countCall(usage, now);

  const checked = schemaCheck(tool.inputSchema, plainArguments(args) as Record<string, unknown>);
  if (!checked.ok) {
    await countRefused(usage, now);
    return errorResult(withData(E.badInput, { problems: checked.problems }));
  }
  const input = checked.value;
  const at = now.getTime();

  // A retry of a creating write or an append: the first answer, and nothing made twice.
  const key = write && tool.dedupe?.(input) ? dedupeKey(ctx.grant.id, tool.name, input) : null;
  let settle: Extract<DedupeStart, { kind: "claimed" }>["settle"] | null = null;
  for (let tries = 0; key && !settle && tries < 3; tries += 1) {
    const start = beginDedupe(key, at);
    if (start.kind === "hit") return replay(version, start.entry.payload);
    if (start.kind === "claimed") settle = start.settle;
    else {
      // A first call with this input is still running: its answer, unless it changed nothing.
      const first = await start.first;
      if (first) return replay(version, first.payload);
    }
  }
  try {
    if (write) {
      const room = admitWrite(ctx.grant.id, at);
      if (!room.ok) return plain(E.tooFast(room.retryAfter));
    }
    const person = ctx.person;
    const answer = await runAsMcp({ app: ctx.grant.appName, clientId: ctx.grant.clientId, grantId: ctx.grant.id }, () =>
      tool.run!({ ctx, person, version, now }, input),
    );
    if (answer.kind === "refused") {
      await countRefused(usage, now);
      return errorResult(withData(E.refusedLead, { reason: answer.reason, ...(answer.detail ?? {}) }));
    }
    const effect = write ? answer.effect : undefined;
    if (effect && effect.changes > 0) {
      chargeWrites(ctx.grant.id, effect.changes - 1, at);
      await countWrite(usage, now, effect.changes);
      await auditWrite(ctx, tool.name, effect, meta);
    }
    if (effect) forgetTouching(effect.touched);
    const fit = fitResult(answer.build);
    if (!fit.ok) return plain(E.tooBig);
    const summary = answer.summary(fit.payload);
    settle?.(effect ? { payload: fit.payload, summary, touched: effect.touched } : null);
    return dataResult(version, summary, fit.payload);
  } finally {
    settle?.(null);
  }
}
