// POST /api/sidekick/chat
//
// Body: { sessionId, message }
//
// Agentic loop (Phase D3):
//   1. Append the user message to the session
//   2. Load prior conversation history
//   3. Resolve tools for this session (cross + agent's product tools)
//   4. Call Claude with tools enabled
//   5. While stop_reason === "tool_use": execute the tool(s) server-
//      side, append tool results, call Claude again
//   6. Persist the assistant message + each tool call as toolCalls JSON
//   7. Return everything
//
// Limit: max 5 iterations to prevent runaway loops. Each tool exec is
// logged as an AgentRun row when the session is agent-scoped, for
// audit + cost analytics.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAnthropicForOrg, modelFor } from "@/lib/ai-client";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { TOOLS, toolsForSession } from "@/lib/agents/tools";

const SIDEKICK_DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_TOOL_ITERATIONS = 5;

const DEFAULT_SYSTEM_PROMPT = `You are Sidekick, the AI assistant inside WorkwrK — a modular Work OS.

You help the user with everyday work tasks across whatever products their team has installed: boards (Work), SOPs, OKRs, Meetings, Culture, CRM, ITSM, Marketing, Dev, Legal, and more.

When the user asks you to do something you can act on inside WorkwrK (create a task, log a lead, file a ticket, send kudos, etc.) and you have a tool for it, USE THE TOOL. Don't just describe what you would do — actually do it.

When the user asks for advice or drafting (writing copy, brainstorming, summarizing), respond directly with markdown.

Keep responses concise. Use markdown for structure when helpful.`;

const inputSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1).max(20000),
});

interface ToolCallLog {
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
  result: unknown;
  errorText: string | null;
  durationMs: number;
}

async function ctxAndSession(sessionId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const userId = (session.user as { id?: string }).id;
  if (!userId) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };

  const chat = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId, archivedAt: null },
    include: {
      agent: {
        select: { id: true, name: true, systemPrompt: true, modelOverride: true, status: true, productSlug: true },
      },
    },
  });
  if (!chat) return { error: NextResponse.json({ error: "session not found" }, { status: 404 }) };
  return { userId, chat };
}

// Augment the system prompt with the user's current app+board context
// so the model doesn't have to ask "which board?" — it already knows.
// We pull the product display name from the catalog and the board's
// display name + tagline from the boards registry. For Studio boards
// we hit the DB to enumerate the column list so the model can write
// correct `values` payloads on create/update_studio_item.
async function buildContextPrefix(
  productContext: string | null,
  boardContext: string | null,
  _organizationId: string,
): Promise<string | null> {
  if (!productContext) return null;


  const [{ PRODUCT_CATALOG }, { getBoard }] = await Promise.all([
    import("@/lib/products/catalog"),
    import("@/lib/products/boards"),
  ]);
  const product = PRODUCT_CATALOG.find((p) => p.slug === productContext);
  if (!product) return null;
  const productName = product.name;
  const board = boardContext ? getBoard(productContext, boardContext) : null;
  if (board) {
    return (
      `## Current context\n` +
      `The user is right now looking at the **${board.name}** board inside **${productName}**.\n` +
      (board.tagline ? `Board tagline: ${board.tagline}\n` : "") +
      `Default the user's questions to this surface unless they explicitly point elsewhere — they almost certainly mean this board when they say "this", "here", "the deals", "the leads", etc.\n`
    );
  }
  return (
    `## Current context\n` +
    `The user is inside **${productName}**. Default their questions to this product unless they say otherwise.\n`
  );
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const c = await ctxAndSession(parsed.data.sessionId);
  if ("error" in c) return c.error;

  // 1. Persist user message + auto-title.
  const userMessage = await prisma.chatMessage.create({
    data: {
      sessionId: c.chat.id,
      role: "USER",
      content: parsed.data.message,
    },
  });
  if (!c.chat.title) {
    const title = parsed.data.message.length > 60
      ? parsed.data.message.slice(0, 57) + "…"
      : parsed.data.message;
    await prisma.chatSession.update({ where: { id: c.chat.id }, data: { title } });
  }

  // 2. Load history.
  const history = await prisma.chatMessage.findMany({
    where: { sessionId: c.chat.id, role: { in: ["USER", "ASSISTANT"] } },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  history.reverse();

  // 3. Resolve agent + tools + system prompt + model.
  // Two sources of product scope on a session:
  //   - `agent.productSlug` — agent-bound session (Ria the SDR, etc.)
  //   - `chat.productContext` — board-opened session (clicked Sidekick
  //     while on /crm/pipeline). No agent persona, just contextual.
  // Both feed into `toolsForSession` so the model gets the right
  // create-tools lit up either way. Board context also augments the
  // system prompt so the model knows which surface the user is on.
  const agentScoped = c.chat.agent && c.chat.agent.status === "ENABLED" ? c.chat.agent : null;
  const productScope = agentScoped?.productSlug ?? c.chat.productContext ?? null;
  const contextPrefix = await buildContextPrefix(c.chat.productContext, c.chat.boardContext, c.chat.organizationId);
  const basePrompt = agentScoped?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const systemPrompt = contextPrefix ? `${contextPrefix}\n${basePrompt}` : basePrompt;
  const availableTools = toolsForSession({ agentProductSlug: productScope });
  const toolDefs = availableTools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));

  const resolved = await getAnthropicForOrg(c.chat.organizationId);
  const model = agentScoped?.modelOverride ?? modelFor(resolved, SIDEKICK_DEFAULT_MODEL);

  // 4. Agentic loop.
  const messages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role === "USER" ? "user" : "assistant",
    content: m.content,
  }));

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
        system: systemPrompt,
        tools: toolDefs.length > 0 ? (toolDefs as unknown as Anthropic.Tool[]) : undefined,
        messages,
      });

      totalTokensIn += result.usage?.input_tokens ?? 0;
      totalTokensOut += result.usage?.output_tokens ?? 0;
      finishReason = result.stop_reason ?? null;

      // Accumulate text + handle tool_use blocks
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
      if (textBlocks.length > 0) {
        assistantText = textBlocks.join("\n\n");
      }

      // No tool calls? We're done.
      if (toolUses.length === 0 || result.stop_reason !== "tool_use") {
        break;
      }

      // Append the assistant's tool_use turn verbatim.
      messages.push({
        role: "assistant",
        content: result.content as Anthropic.ContentBlock[],
      });

      // Execute every tool the model asked for, collect results.
      const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const tool = TOOLS[tu.name];
        const startedAt = Date.now();
        let outcome: unknown;
        let execErr: string | null = null;
        if (!tool) {
          execErr = `Unknown tool: ${tu.name}`;
          outcome = { error: execErr };
        } else {
          try {
            outcome = await tool.handler(
              { orgId: c.chat.organizationId, userId: c.userId },
              tu.input,
            );
          } catch (e) {
            execErr = e instanceof Error ? e.message : "tool execution failed";
            outcome = { error: execErr };
          }
        }
        const durationMs = Date.now() - startedAt;

        toolCallsLog.push({
          toolUseId: tu.id,
          name: tu.name,
          input: tu.input,
          result: outcome,
          errorText: execErr,
          durationMs,
        });

        // Log to AgentRun if agent-scoped, for telemetry.
        if (agentScoped) {
          prisma.agentRun
            .create({
              data: {
                agentId: agentScoped.id,
                triggeredBy: c.userId,
                input: { toolName: tu.name, input: tu.input } as object,
                output: outcome as object,
                status: execErr ? "FAILED" : "SUCCEEDED",
                error: execErr,
                startedAt: new Date(startedAt),
                endedAt: new Date(),
              },
            })
            .catch(() => {});
        }

        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(outcome),
          is_error: !!execErr,
        });
      }

      // Append tool results as a user message turn.
      messages.push({
        role: "user",
        content: toolResultBlocks,
      });
    }
  } catch (err) {
    errorText = err instanceof Error ? err.message : "Claude request failed";
    if (!assistantText) {
      assistantText = `Sorry — I hit an error reaching the model.\n\n\`${errorText}\``;
    }
  }

  // 5. Persist assistant message.
  const assistantMessage = await prisma.chatMessage.create({
    data: {
      sessionId: c.chat.id,
      role: "ASSISTANT",
      content: assistantText,
      modelUsed: model,
      tokensIn: totalTokensIn || null,
      tokensOut: totalTokensOut || null,
      finishReason,
      ...(toolCallsLog.length > 0
        ? { toolCalls: toolCallsLog as unknown as object }
        : {}),
    },
  });

  // Sonnet 4.6 pricing (approx): $3/M input, $15/M output.
  const costCents = totalTokensIn && totalTokensOut
    ? Math.ceil((totalTokensIn * 0.0003 + totalTokensOut * 0.0015) * 100)
    : 0;

  await prisma.chatSession.update({
    where: { id: c.chat.id },
    data: {
      lastModel: model,
      totalTokensIn: { increment: totalTokensIn },
      totalTokensOut: { increment: totalTokensOut },
      totalCostCents: { increment: costCents },
    },
  });

  return NextResponse.json({
    userMessage: {
      id: userMessage.id,
      role: "USER",
      content: userMessage.content,
      createdAt: userMessage.createdAt,
    },
    assistantMessage: {
      id: assistantMessage.id,
      role: "ASSISTANT",
      content: assistantMessage.content,
      modelUsed: assistantMessage.modelUsed,
      tokensIn: totalTokensIn,
      tokensOut: totalTokensOut,
      finishReason,
      toolCalls: toolCallsLog,
      createdAt: assistantMessage.createdAt,
    },
    error: errorText,
  });
}
