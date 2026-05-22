// Autonomous-agent runtime — the "AI controls the people" pillar.
//
// Sidekick's /api/sidekick/chat route runs the same agentic loop, but
// it's wrapped in a user-driven chat session. Autonomous runs need a
// session-less variant that:
//   - Is triggered by a schedule (or a manual "Run now") instead of a
//     chat message.
//   - Pulls the agent's `autonomousPrompt` as the synthetic user
//     message.
//   - Persists results as a standalone AgentRun row (no ChatSession
//     attached) so /dashboard can surface them as "what your agents
//     got done while you were away."
//
// Reuses the same TOOLS registry + Anthropic client + iteration cap
// as the chat loop. Differences:
//   - No chat history (each autonomous run is stateless from prior
//     autonomous runs by default; future: feed AgentMemory rows).
//   - No optimistic UI — the runner writes AgentRun on completion.
//
// The cron tickable endpoint (/api/cron/run-due-agents) loops over
// every enabled agent whose nextRunAt has passed and calls
// `runAgentAutonomously` for each. Manual "Run now" UI calls the same
// function so the audit trail is identical.

import { prisma } from "@/lib/prisma";
import { getAnthropicForOrg, modelFor } from "@/lib/ai-client";
import type Anthropic from "@anthropic-ai/sdk";
import { TOOLS, toolsForSession } from "@/lib/agents/tools";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_TOOL_ITERATIONS = 5;

export type AutonomousTrigger = "MANUAL" | "SCHEDULED";

export interface RunResult {
  runId: string;
  status: "SUCCEEDED" | "FAILED";
  output: string;
  tokensIn: number;
  tokensOut: number;
  toolCallCount: number;
  durationMs: number;
  errorText?: string;
}

interface ToolCallLog {
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
  result: unknown;
  errorText: string | null;
  durationMs: number;
}

/**
 * Compute the next run time given a schedule string. v1 supports a
 * tiny vocabulary — "hourly", "daily", "weekly", "every <N> minutes",
 * "every <N> hours". Cron expressions are parsed loosely (first field
 * = minute; we just bucket everything to the next hour for now). This
 * is intentionally minimal so it works without pulling cron-parser as
 * a dep; we'll swap in a real parser when the user needs precision.
 */
export function computeNextRunAt(schedule: string, from: Date = new Date()): Date {
  const s = schedule.trim().toLowerCase();
  const now = new Date(from);

  // Simple keywords first — these cover 90% of org usage.
  if (s === "hourly" || s === "@hourly") return new Date(now.getTime() + 60 * 60 * 1000);
  if (s === "daily" || s === "@daily") {
    const next = new Date(now);
    next.setDate(now.getDate() + 1);
    next.setHours(9, 0, 0, 0); // 9am next day
    return next;
  }
  if (s === "weekly" || s === "@weekly") {
    const next = new Date(now);
    next.setDate(now.getDate() + 7);
    next.setHours(9, 0, 0, 0);
    return next;
  }

  // "every N minutes" / "every N hours"
  const everyMin = s.match(/^every\s+(\d+)\s+minute/);
  if (everyMin) return new Date(now.getTime() + parseInt(everyMin[1], 10) * 60 * 1000);
  const everyHr = s.match(/^every\s+(\d+)\s+hour/);
  if (everyHr) return new Date(now.getTime() + parseInt(everyHr[1], 10) * 60 * 60 * 1000);

  // Unknown schedule — default to one hour out so a bad string doesn't
  // cause a fire-loop.
  return new Date(now.getTime() + 60 * 60 * 1000);
}

/**
 * Run an agent autonomously — no chat session, no user, no history.
 * Output written as an AgentRun row. Caller is responsible for
 * deciding *when* this fires; this function just executes.
 */
export async function runAgentAutonomously(args: {
  agentId: string;
  trigger: AutonomousTrigger;
  triggeredBy?: string | null;
}): Promise<RunResult> {
  const startedAt = new Date();
  const agent = await prisma.agent.findUnique({
    where: { id: args.agentId },
    select: {
      id: true,
      organizationId: true,
      name: true,
      systemPrompt: true,
      productSlug: true,
      modelOverride: true,
      status: true,
      autonomousPrompt: true,
      scheduleCron: true,
      autonomousEnabled: true,
      createdById: true,
    },
  });
  if (!agent) {
    throw new Error("Agent not found");
  }
  if (agent.status !== "ENABLED") {
    throw new Error("Agent is not enabled");
  }

  // Tool handlers require a userId — autonomous runs don't have a
  // live actor, so we fall back through: the explicit triggeredBy,
  // then the agent's creator, then any org admin, then any org user.
  // The handler treats the user as audit-only; access is org-scoped.
  let actingUserId: string | null = args.triggeredBy ?? agent.createdById ?? null;
  if (!actingUserId) {
    const fallback = await prisma.user.findFirst({
      where: {
        organizationId: agent.organizationId,
        status: "ACTIVE",
      },
      orderBy: [
        // Prefer admins so the audit trail attributes to a real owner.
        { accessLevel: "asc" },
        { createdAt: "asc" },
      ],
      select: { id: true },
    });
    actingUserId = fallback?.id ?? null;
  }
  if (!actingUserId) {
    throw new Error("No org user available to attribute autonomous run to");
  }
  const userMessage = (agent.autonomousPrompt ?? "").trim() ||
    "Run your usual scheduled check. Summarize what you found and call any tools you need to keep things moving.";

  // Pre-create the AgentRun in PENDING so the dashboard can see it
  // mid-flight (and so a partial run survives a crash).
  const runRow = await prisma.agentRun.create({
    data: {
      agentId: agent.id,
      triggeredBy: args.triggeredBy ?? null,
      input: { trigger: args.trigger, prompt: userMessage } as object,
      status: "PENDING",
      startedAt,
    },
  });

  const availableTools = toolsForSession({ agentProductSlug: agent.productSlug ?? null });
  const toolDefs = availableTools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));

  let resolved;
  try {
    resolved = await getAnthropicForOrg(agent.organizationId);
  } catch (err) {
    const errorText = err instanceof Error ? err.message : "Failed to resolve AI client";
    await prisma.agentRun.update({
      where: { id: runRow.id },
      data: {
        status: "FAILED",
        error: errorText,
        endedAt: new Date(),
      },
    });
    return {
      runId: runRow.id,
      status: "FAILED",
      output: "",
      tokensIn: 0,
      tokensOut: 0,
      toolCallCount: 0,
      durationMs: Date.now() - startedAt.getTime(),
      errorText,
    };
  }
  const model = agent.modelOverride ?? modelFor(resolved, DEFAULT_MODEL);

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage },
  ];
  let assistantText = "";
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let finishReason: string | null = null;
  let errorText: string | null = null;
  const toolCallsLog: ToolCallLog[] = [];

  try {
    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      const result: Anthropic.Message = await resolved.client.messages.create({
        model,
        max_tokens: 4096,
        system: agent.systemPrompt,
        tools: toolDefs.length > 0 ? (toolDefs as unknown as Anthropic.Tool[]) : undefined,
        messages,
      });

      totalTokensIn += result.usage?.input_tokens ?? 0;
      totalTokensOut += result.usage?.output_tokens ?? 0;
      finishReason = result.stop_reason ?? null;

      const textBlocks: string[] = [];
      const toolUses: { id: string; name: string; input: Record<string, unknown> }[] = [];
      for (const block of result.content) {
        if (block.type === "text" && "text" in block) {
          textBlocks.push(block.text);
        } else if (block.type === "tool_use" && "name" in block && "input" in block && "id" in block) {
          toolUses.push({
            id: block.id,
            name: block.name,
            input: (block.input as Record<string, unknown>) ?? {},
          });
        }
      }
      if (textBlocks.length > 0) assistantText = textBlocks.join("\n\n");

      if (toolUses.length === 0 || result.stop_reason !== "tool_use") break;

      messages.push({ role: "assistant", content: result.content as Anthropic.ContentBlock[] });

      const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const tool = TOOLS[tu.name];
        const toolStart = Date.now();
        let outcome: unknown;
        let execErr: string | null = null;
        if (!tool) {
          execErr = `Unknown tool: ${tu.name}`;
          outcome = { error: execErr };
        } else {
          try {
            // Autonomous runs have no live actor, so we attribute to
            // `actingUserId` (resolved above — explicit trigger →
            // agent creator → any active org admin).
            outcome = await tool.handler(
              { orgId: agent.organizationId, userId: actingUserId },
              tu.input,
            );
          } catch (e) {
            execErr = e instanceof Error ? e.message : "tool execution failed";
            outcome = { error: execErr };
          }
        }
        toolCallsLog.push({
          toolUseId: tu.id,
          name: tu.name,
          input: tu.input,
          result: outcome,
          errorText: execErr,
          durationMs: Date.now() - toolStart,
        });
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(outcome),
          is_error: !!execErr,
        });
      }
      messages.push({ role: "user", content: toolResultBlocks });
    }
  } catch (err) {
    errorText = err instanceof Error ? err.message : "Model request failed";
  }

  // Pricing approx — same numbers as the chat route.
  const costCents = totalTokensIn && totalTokensOut
    ? Math.ceil((totalTokensIn * 0.0003 + totalTokensOut * 0.0015) * 100)
    : 0;
  const endedAt = new Date();
  const durationMs = endedAt.getTime() - startedAt.getTime();
  const ok = !errorText;

  await prisma.agentRun.update({
    where: { id: runRow.id },
    data: {
      status: ok ? "SUCCEEDED" : "FAILED",
      output: {
        text: assistantText,
        toolCalls: toolCallsLog,
        finishReason,
      } as object,
      error: errorText,
      endedAt,
      tokensIn: totalTokensIn,
      tokensOut: totalTokensOut,
      costCents,
    },
  });

  // Update the agent's last/next run timestamps so the scheduler
  // doesn't re-pick it within the same window.
  const next = agent.scheduleCron ? computeNextRunAt(agent.scheduleCron, endedAt) : null;
  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      lastRunAt: endedAt,
      nextRunAt: next,
    },
  });

  return {
    runId: runRow.id,
    status: ok ? "SUCCEEDED" : "FAILED",
    output: assistantText,
    tokensIn: totalTokensIn,
    tokensOut: totalTokensOut,
    toolCallCount: toolCallsLog.length,
    durationMs,
    errorText: errorText ?? undefined,
  };
}
