// POST /api/sidekick/chat/stream
//
// SSE variant of /api/sidekick/chat. Same agentic loop (tools, max 5
// iterations, tool-result append, persistence to ChatMessage), but
// streams Claude's text deltas over Server-Sent Events so the UI can
// render the response as it's generated.
//
// Wire protocol — every event is a single SSE `data:` line containing
// JSON. Event types:
//   {type:"user_message",  message:{...}}     — the persisted user msg
//   {type:"text_delta",    text:"…"}          — incremental text from Claude
//   {type:"tool_use",      name, input}       — tool invoked by Claude
//   {type:"tool_result",   name, isError}     — server-side result returned
//   {type:"done",          message:{...},    — final assistant msg + usage
//                           tokensIn, tokensOut, finishReason}
//   {type:"error",         message:"…"}       — fatal error mid-stream
//
// Prompt caching: the system prompt + tool definitions are stable
// across turns within a session, so we put a `cache_control: ephemeral`
// breakpoint on the last system block. Per the Anthropic API the
// render order is tools → system → messages, so that single breakpoint
// caches tools + system together (5-minute TTL by default; min cacheable
// prefix on Sonnet 4.6 is 2048 tokens — easily met once tools are in).

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
  if (!session?.user) return { status: 401 as const };
  const userId = (session.user as { id?: string }).id;
  if (!userId) return { status: 401 as const };

  const chat = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId, archivedAt: null },
    include: {
      agent: {
        select: { id: true, name: true, systemPrompt: true, modelOverride: true, status: true, productSlug: true },
      },
    },
  });
  if (!chat) return { status: 404 as const };
  return { status: 200 as const, userId, chat };
}

async function buildContextPrefix(
  productContext: string | null,
  boardContext: string | null,
  organizationId: string,
): Promise<string | null> {
  if (!productContext) return null;
  if (productContext === "studio" && boardContext) {
    const board = await prisma.studioBoard.findFirst({
      where: { organizationId, slug: boardContext },
      select: { name: true, description: true, layout: true, fields: true },
    });
    if (!board) return null;
    const fields = (board.fields as Array<{ key: string; label: string; type: string; options?: { choices?: { value: string; label?: string }[] } }>) ?? [];
    const fieldList = fields.length === 0
      ? "(no columns defined yet)"
      : fields.map((f) => {
          const choices = f.options?.choices?.map((c) => c.value).join(" | ");
          const choicesNote = choices ? ` (choices: ${choices})` : "";
          return `- \`${f.key}\` · ${f.label} · ${f.type}${choicesNote}`;
        }).join("\n");
    return (
      `## Current context\n` +
      `The user is on **${board.name}**, a user-built Studio board (${board.layout.toLowerCase()} layout).` +
      (board.description ? ` Board purpose: ${board.description}` : "") +
      `\n\nColumns on this board:\n${fieldList}\n\n` +
      `Use \`boardSlug: "${boardContext}"\` for any \`*_studio_*\` tool call.\n`
    );
  }
  const [{ PRODUCT_CATALOG }, { getBoard }] = await Promise.all([
    import("@/lib/products/catalog"),
    import("@/lib/products/boards"),
  ]);
  const product = PRODUCT_CATALOG.find((p) => p.slug === productContext);
  if (!product) return null;
  const board = boardContext ? getBoard(productContext, boardContext) : null;
  if (board) {
    return (
      `## Current context\n` +
      `The user is right now looking at the **${board.name}** board inside **${product.name}**.\n` +
      (board.tagline ? `Board tagline: ${board.tagline}\n` : "") +
      `Default the user's questions to this surface unless they explicitly point elsewhere.\n`
    );
  }
  return (
    `## Current context\n` +
    `The user is inside **${product.name}**. Default their questions to this product unless they say otherwise.\n`
  );
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "invalid body" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const c = await ctxAndSession(parsed.data.sessionId);
  if (c.status === 401) return new Response("unauthorized", { status: 401 });
  if (c.status === 404) return new Response("session not found", { status: 404 });

  // 1. Persist user message + auto-title (sync — happens before stream opens).
  const userMessage = await prisma.chatMessage.create({
    data: { sessionId: c.chat.id, role: "USER", content: parsed.data.message },
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
  const agentScoped = c.chat.agent && c.chat.agent.status === "ENABLED" ? c.chat.agent : null;
  const productScope = agentScoped?.productSlug ?? c.chat.productContext ?? null;
  const contextPrefix = await buildContextPrefix(c.chat.productContext, c.chat.boardContext, c.chat.organizationId);
  const basePrompt = agentScoped?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const systemPromptText = contextPrefix ? `${contextPrefix}\n${basePrompt}` : basePrompt;
  const availableTools = toolsForSession({ agentProductSlug: productScope });
  const toolDefs = availableTools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));

  const resolved = await getAnthropicForOrg(c.chat.organizationId);
  const model = agentScoped?.modelOverride ?? modelFor(resolved, SIDEKICK_DEFAULT_MODEL);

  // 4. Build the SSE response.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(event: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

      // Ack the user message immediately so the UI can replace its optimistic
      // bubble before any text arrives.
      send({
        type: "user_message",
        message: {
          id: userMessage.id,
          role: "USER",
          content: userMessage.content,
          createdAt: userMessage.createdAt,
        },
      });

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
          // SDK streaming. system is passed as a text-block array so we can
          // attach cache_control — caches tools+system together.
          const messageStream = resolved.client.messages.stream({
            model,
            max_tokens: 4096,
            system: [
              {
                type: "text",
                text: systemPromptText,
                cache_control: { type: "ephemeral" },
              },
            ],
            tools: toolDefs.length > 0 ? (toolDefs as unknown as Anthropic.Tool[]) : undefined,
            messages,
          });

          // Forward text deltas to the client as they arrive. Tool input
          // deltas (input_json_delta) are skipped — the full input is
          // available on the final message and is more reliable to render.
          for await (const event of messageStream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              send({ type: "text_delta", text: event.delta.text });
            }
          }

          // Collect the final, fully-assembled message — this is the only
          // way to get tool_use blocks (which can't be partially streamed
          // and acted on safely).
          const result = await messageStream.finalMessage();
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
          if (textBlocks.length > 0) {
            // Replace per iteration — only the latest iteration's text counts.
            assistantText = textBlocks.join("\n\n");
          }

          if (toolUses.length === 0 || result.stop_reason !== "tool_use") break;

          // Append the assistant tool_use turn verbatim — required by the API
          // so the next request's messages array is well-formed.
          messages.push({
            role: "assistant",
            content: result.content as Anthropic.ContentBlock[],
          });

          // Execute each tool the model requested and stream notifications
          // for the UI to render a "Ran tool: X" chip in real time.
          const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
          for (const tu of toolUses) {
            send({ type: "tool_use", name: tu.name, input: tu.input });

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

            if (agentScoped) {
              prisma.agentRun.create({
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
              }).catch(() => {});
            }

            send({ type: "tool_result", name: tu.name, isError: !!execErr });

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
        errorText = err instanceof Error ? err.message : "Claude request failed";
        if (!assistantText) {
          assistantText = `Sorry — I hit an error reaching the model.\n\n\`${errorText}\``;
        }
        send({ type: "error", message: errorText });
      }

      // 5. Persist assistant message + usage telemetry.
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

      send({
        type: "done",
        message: {
          id: assistantMessage.id,
          role: "ASSISTANT",
          content: assistantText,
          modelUsed: model,
          tokensIn: totalTokensIn,
          tokensOut: totalTokensOut,
          finishReason,
          toolCalls: toolCallsLog.map((t) => ({ name: t.name, input: t.input })),
          createdAt: assistantMessage.createdAt,
        },
        error: errorText,
      });

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
