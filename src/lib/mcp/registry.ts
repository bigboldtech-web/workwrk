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
//      read connection answers readOnly (Decision 12, an isError result),
//      with the insufficient_scope challenge in _meta["mcp/www_authenticate"]
//      for a client that reads it (auth.ts insufficientScopeChallenge; final
//      review, contract L1);
//   2. what blocks every call without ending the connection: AI off, the
//      two step and password holds; then the day's caps (usage.ts: 5,000
//      calls, and for a write 1,000 changes);
//   3. the tool's own schema (badInput), a read's strings through plainData
//      first; a write's arguments are the person's words, as written;
//   4. for a write: a retry of a creating write or an append in the last 60
//      seconds is answered with the first answer (dedupe.ts, 4.6); then the
//      write's whole cost (a create: its task and every subtask asked) is
//      charged to the bursts (limits.ts: room for one more change needed,
//      10 in 10 seconds, 30 a minute, tooFast past them) and reserved from
//      the day in one conditional UPDATE (usage.ts reserveWrites: never past
//      1,000; dailyCap when nothing is left), before it runs (review M1);
//   5. the body, as the person, through the app's own gates, inside
//      runAsMcp (via.ts), so every activity row it writes says "via <app>
//      (MCP)". It may make only the changes reserved, and says what it has
//      made as it goes (call.made): a failure after that is answered with
//      what was made, never an error (review M2);
//   6. the usage counts (a call; a refusal; what was charged and reserved
//      but not made given back), and for a write that changed something
//      ONE audit row (mcp.tool.<tool>, section 7: the person as actor and
//      actingFor, the app as "<label> (MCP)", the target, the tool and the
//      connection, the address and user agent, never a title). A refusal,
//      or a write that changed nothing, writes no audit row. Any write drops
//      every remembered answer about what it touched;
//   7. fitResult: the payload that fits the budget, else tooBig; a write
//      that changed something gets its smallest step instead (review M2).
// Our own fixed sentences go plain (readOnly, the holds, aiOff, dailyCap,
// tooFast, tooBig); every refusal from a body and every input problem goes
// in the data block, after a fixed lead (2.4).
//
// Server-only (the bodies read prisma).

import { logActivity } from "@/lib/activity";
import type { McpScope } from "@/lib/oauth/metadata";
import { insufficientScopeChallenge, type McpContext } from "./auth";
import { fitResult, plainDeep, withData } from "./data";
import { beginDedupe, dedupeKey, forgetTouching, type DedupeStart } from "./dedupe";
import { admitWrite, refundWrites } from "./limits";
import { MCP_AUDIT_COPY, MCP_RPC_COPY, MCP_SUMMARY_COPY, MCP_TOOL_COPY, MCP_TOOL_TEXT, MCP_VIA_COPY } from "./mcp-copy";
import { RpcError, type ProtocolVersion } from "./protocol";
import { plainArguments, schemaCheck } from "./schema-check";
import type { McpTool, McpToolName, ToolAnswer, WriteEffect, WriteProgress } from "./tool-types";
import { READ_TOOLS } from "./tools/read";
import { WRITE_TOOLS } from "./tools/write";
import { countCall, countRefused, countWrite, dayCapReached, releaseWrites, reserveWrites, type UsageGrant } from "./usage";
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

/** The smallest payload a build gives (its last step), for a write that changed something and must not answer tooBig. */
function smallestStep(build: (step: number) => Record<string, unknown> | null): Record<string, unknown> | null {
  let last: Record<string, unknown> | null = null;
  for (let step = 0; step < 50; step += 1) {
    const p = build(step);
    if (!p) break;
    last = p;
  }
  return last;
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
  if (write && !ctx.scopes.includes("mcp:write")) {
    const refusal = await plain(E.readOnly);
    return { ...refusal, _meta: { "mcp/www_authenticate": [insufficientScopeChallenge()] } };
  }
  if (ctx.blocked === "ai_off" || !ctx.person) return plain(E.aiOff);
  if (ctx.blocked === "mfa") return plain(E.holdMfa);
  if (ctx.blocked === "password") return plain(E.holdPassword);
  if (await dayCapReached(ctx.grant.id, { write }, now)) return plain(E.dailyCap);
  await countCall(usage, now);

  // What a write WRITES stays the person's words (step 3 review, low 10):
  // plainData is for what an answer echoes back (data.ts), so only a read's
  // arguments go through it here.
  const checked = schemaCheck(tool.inputSchema, (write ? args : plainArguments(args)) as Record<string, unknown>);
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
  const person = ctx.person;
  // A write's whole cost, charged to the bursts and reserved from the day before it runs (M1).
  const cost = write ? Math.max(1, Math.floor(tool.cost?.(input) ?? 1)) : 0;
  let charged = 0;
  let reserved = 0;
  let changes = 0;
  try {
    if (write) {
      const room = admitWrite(ctx.grant.id, at, cost);
      if (!room.ok) return plain(E.tooFast(room.retryAfter));
      charged = cost;
      reserved = await reserveWrites(usage, now, cost);
      if (reserved === 0) return plain(E.dailyCap);
    }
    // What the write has made so far (M2): a failure after it still answers, counts, audits and is remembered.
    const progress: { last: WriteProgress | null } = { last: null };
    let answer: ToolAnswer;
    try {
      answer = await runAsMcp({ app: ctx.grant.appName, clientId: ctx.grant.clientId, grantId: ctx.grant.id }, () =>
        tool.run!({ ctx, person, version, now, allowance: write ? reserved : 1, made: (p) => (progress.last = p) }, input),
      );
    } catch (err) {
      const made = progress.last;
      if (!made) throw err;
      console.warn("[mcp] tools_call partial");
      answer = { kind: "data", build: (step) => (step === 0 ? made.payload : null), summary: () => MCP_SUMMARY_COPY.partialWrite, effect: made.effect };
    }
    if (answer.kind === "refused") {
      await countRefused(usage, now);
      return errorResult(withData(E.refusedLead, { reason: answer.reason, ...(answer.detail ?? {}) }));
    }
    const effect: WriteEffect | undefined = write ? answer.effect : undefined;
    changes = effect?.changes ?? 0;
    // Never more than was reserved; should a body ever make more, the day still counts every one.
    if (changes > reserved) await countWrite(usage, now, changes - reserved);
    if (effect) forgetTouching(effect.touched);
    if (effect && changes > 0) await auditWrite(ctx, tool.name, effect, meta);
    const fit = fitResult(answer.build);
    // Once a write changed something it is never answered with an error: its smallest step, over the budget or not (M2).
    const payload = fit.ok ? fit.payload : changes > 0 ? smallestStep(answer.build) : null;
    if (!payload) return plain(E.tooBig);
    const summary = fit.ok ? answer.summary(payload) : `${answer.summary(payload)} ${MCP_SUMMARY_COPY.shortened}`;
    settle?.(effect ? { payload, summary, touched: effect.touched } : null);
    return dataResult(version, summary, payload);
  } finally {
    settle?.(null);
    if (write) {
      // Give back what was charged and reserved but not made; a call that made nothing keeps one burst charge.
      refundWrites(ctx.grant.id, charged - Math.max(changes, charged > 0 ? 1 : 0), at);
      await releaseWrites(usage, now, reserved - changes);
    }
  }
}
