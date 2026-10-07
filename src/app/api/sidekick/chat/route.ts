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
//
// ASK FIRST (follow-up 1.5c), as the stream route: every call goes through
// executeAskAiCall (src/lib/agents/ask-ai-calls.ts), so what other people
// would see waits for the person on a card (an APPROVAL row after the
// answer, `approval` in the answer), and the call after a waiting one may
// use no tool. This route is the same door as the stream: never a way round
// the cards.

import { requireApp } from "@/lib/app-gate";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAnthropicForOrg, modelFor } from "@/lib/ai-client";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { toolsForSession } from "@/lib/agents/tools";
import { askAiAgent, teammateChatRefusal } from "@/lib/agents/session-guard";
import { executeAskAiCall, personOnce, type AskAiCallState, type AskAiTurn } from "@/lib/agents/ask-ai-calls";
import { ASK_AI_APPROVAL_PROMPT, claimAskAiNote, releaseAskAiNote, saveApprovalRow, withNote } from "@/lib/agents/ask-ai-turn";
import { wrapToolData } from "@/lib/agents/executor";
import { isModuleActive } from "@/lib/entitlements";
import { claimAiAction, releaseAiQuestion } from "@/lib/ai-allowance";
import { aiCostCents } from "@/lib/ai-cost";

const SIDEKICK_DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_TOOL_ITERATIONS = 5;

const DEFAULT_SYSTEM_PROMPT = `You are Ask AI, the assistant inside WorkwrK, a people and project management workspace.

You help the user with everyday work: their Spaces, Lists and tasks, docs, forms and tables, SOPs, goals, KRAs and KPIs, meetings, weekly reviews and kudos. You act as the user, so you can only see and change what they can.

When the user asks you to do something you can act on inside WorkwrK (create a task, schedule a meeting, send kudos and so on) and you have a tool for it, use the tool. Do not just describe what you would do: do it.

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
  /** How it ended; "waiting" for a request on a card. */
  state: AskAiCallState;
  actionId: string | null;
}

async function ctxAndSession(sessionId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const userId = (session.user as { id?: string }).id;
  if (!userId) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  // Only in the workspace the person is in now: a chat belongs to the
  // workspace it was started in, and someone removed from that workspace
  // must not keep spending its AI questions or writing into it through an
  // old chat.
  const orgId = (session.user as { organizationId?: string }).organizationId;
  if (!orgId) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };

  const chat = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId, organizationId: orgId, archivedAt: null },
    include: {
      agent: {
        select: {
          id: true, name: true, systemPrompt: true, modelOverride: true, status: true, productSlug: true,
          // Who may use it (src/lib/agents/session-guard.ts askAiAgent).
          organizationId: true, visibility: true, ownerId: true,
        },
      },
    },
  });
  if (!chat) return { error: NextResponse.json({ error: "session not found" }, { status: 404 }) };
  // An AI teammate's chat runs only through its own route, which asks before
  // anything other people will see; this loop never does. 409 before any
  // question is spent or anything is written.
  const refused = teammateChatRefusal(chat);
  if (refused) return { error: refused };
  return { userId, chat };
}

// Augment the system prompt with the user's current app+board context
// so the model doesn't have to ask "which board?", it already knows.
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
      `Default the user's questions to this surface unless they explicitly point elsewhere, they almost certainly mean this board when they say "this", "here", "the deals", "the leads", etc.\n`
    );
  }
  return (
    `## Current context\n` +
    `The user is inside **${productName}**. Default their questions to this product unless they say otherwise.\n`
  );
}

export async function POST(req: Request) {
  // The ai app key first (access 5.2.1): Guests 404, and a hidden app or AI
  // features turned off answer 403 app_off before anything is written.
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const body = await req.json().catch(() => null);
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const c = await ctxAndSession(parsed.data.sessionId);
  if ("error" in c) return c.error;

  // One message is one of the plan's AI questions (src/lib/ai-allowance.ts):
  // the person's per-minute limit, then the question claimed before anything
  // is written, and handed back if the model fails.
  const claim = await claimAiAction(c.chat.organizationId, c.userId, "Ask AI message");
  if (!claim.ok) return claim.response;

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
  //   - `agent.productSlug`, agent-bound session (Ria the SDR, etc.)
  //   - `chat.productContext`, board-opened session (clicked Sidekick
  //     while on /crm/pipeline). No agent persona, just contextual.
  // Both feed into `toolsForSession` so the model gets the right
  // create-tools lit up either way. Board context also augments the
  // system prompt so the model knows which surface the user is on.
  // The agent only while it is on and the person may still use it: one that
  // became someone else's private teammate runs as plain Ask AI.
  const agentScoped = askAiAgent(c.chat.agent, gate.viewer);
  const productScope = agentScoped?.productSlug ?? c.chat.productContext ?? null;
  const contextPrefix = await buildContextPrefix(c.chat.productContext, c.chat.boardContext, c.chat.organizationId);
  const basePrompt = agentScoped?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const systemPrompt = `${contextPrefix ? `${contextPrefix}\n${basePrompt}` : basePrompt}\n\n${ASK_AI_APPROVAL_PROMPT}`;
  const availableTools = toolsForSession({ agentProductSlug: productScope, tablesOn: await isModuleActive(c.chat.organizationId, "workwrk-tables") });
  const toolDefs = availableTools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));

  const resolved = await getAnthropicForOrg(c.chat.organizationId);
  const model = agentScoped?.modelOverride ?? modelFor(resolved, SIDEKICK_DEFAULT_MODEL);

  // 4. Agentic loop. What was decided on Ask AI's requests since it last
  // heard is told once, with the person's message.
  const person = personOnce(c.chat.organizationId, c.userId);
  const decided = await claimAskAiNote(c.chat.id, (await person())?.firstName ?? "The user");
  const messages: Anthropic.MessageParam[] = withNote(
    history.map((m) => ({
      role: m.role === "USER" ? "user" : "assistant",
      content: m.content,
    })),
    decided.note,
  );
  const turn: AskAiTurn = {
    organizationId: c.chat.organizationId,
    userId: c.userId,
    sessionId: c.chat.id,
    turnKey: userMessage.id,
    enabled: new Set(toolDefs.map((t) => t.name)),
    counters: { proposals: 0 },
    person,
  };
  const waitingActions: Array<{ id: string; title: string | null }> = [];
  // Once a request waits for the person, the model may only say so.
  let waiting = false;

  let assistantText = "";
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let finishReason: string | null = null;
  let errorText: string | null = null;
  let modelGaveNothing = false;
  const toolCallsLog: ToolCallLog[] = [];

  try {
    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      const result: Anthropic.Message = await resolved.client.messages.create({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        tools: toolDefs.length > 0 ? (toolDefs as unknown as Anthropic.Tool[]) : undefined,
        ...(toolDefs.length > 0 && waiting ? { tool_choice: { type: "none" as const } } : {}),
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
        // Runs it, or asks the person first (src/lib/agents/ask-ai-calls.ts).
        const startedAt = Date.now();
        const call = await executeAskAiCall(turn, tu.name, tu.input);
        const outcome = call.result;
        const execErr = call.state === "failed" ? call.errorText : null;
        const durationMs = Date.now() - startedAt;

        toolCallsLog.push({
          toolUseId: tu.id,
          name: tu.name,
          input: tu.input,
          result: outcome,
          errorText: execErr,
          durationMs,
          state: call.state,
          actionId: call.actionId,
        });
        if (call.action) {
          waiting = true;
          waitingActions.push({ id: call.action.id, title: call.action.preview.title });
        }

        // Log to AgentRun if agent-scoped, for telemetry.
        // A call that waits for the person is no run of the agent's: its
        // request is the record, and an approval audits what it did.
        if (agentScoped && call.state !== "waiting") {
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

        // Read as information inside <tool_data>, never as instructions.
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: wrapToolData(tu.name, outcome),
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
    // Nothing answered and nothing done: the question goes back.
    modelGaveNothing = !assistantText && toolCallsLog.length === 0;
    if (!assistantText) {
      assistantText = `Sorry, I hit an error reaching the model.\n\n\`${errorText}\``;
    }
  }
  if (modelGaveNothing) {
    await releaseAiQuestion(claim.id);
    // It never heard them: the next turn tells it.
    await releaseAskAiNote(c.chat.id, decided.ids);
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
      // The person's message this answers, so a reader matches them without guessing by order.
      meta: { replyTo: userMessage.id },
    },
  });

  // The card for what it asked, below the answer.
  const card = await saveApprovalRow(c.chat.id, assistantMessage.createdAt, waitingActions, userMessage.id);

  // An estimate at approximate Sonnet prices (src/lib/ai-cost.ts).
  const costCents = aiCostCents(totalTokensIn, totalTokensOut);

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
    approval: card ? { id: card.id, actionIds: waitingActions.map((w) => w.id), createdAt: card.createdAt } : null,
    error: errorText,
  });
}
