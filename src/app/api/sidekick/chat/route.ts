// POST /api/sidekick/chat
//
// Body: { sessionId, message }
//
// 1. Append the user message to the session
// 2. Load prior messages as conversation context
// 3. Call Claude via the org's AI client (BYOK if Enterprise)
// 4. Persist the assistant response + token telemetry
// 5. Return the assistant message
//
// Non-streaming v1. Streaming + tool calling come in D3/D4.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAnthropicForOrg, modelFor } from "@/lib/ai-client";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

// Default model for Sidekick. Sonnet 4.6 is the cost/quality sweet spot
// for general chat. Org BYOK preferredModel overrides this.
const SIDEKICK_DEFAULT_MODEL = "claude-sonnet-4-6";

const DEFAULT_SYSTEM_PROMPT = `You are Sidekick, the AI assistant inside WorkwrK — a modular Work OS.

You help the user with everyday work tasks across whatever products their team has installed: boards (Work), SOPs, OKRs, Meetings, Culture, CRM, ITSM, Marketing, Dev, Legal, and more.

When the user asks you to do something you can act on inside WorkwrK (create a board, write a doc, brainstorm OKRs, analyze data, summarize a meeting, draft a contract clause, etc.), give them a clear, structured response they can copy or refine.

Keep responses concise and useful. Use markdown for structure when helpful (lists, headings, code blocks). When appropriate, suggest the next step the user can take.

You do NOT have direct access to read or write the user's WorkwrK data yet — that capability ships in Phase D3 when tool calling is wired. For now you can reason about anything they describe in the conversation.`;

const inputSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1).max(20000),
});

async function ctxAndSession(sessionId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const userId = (session.user as { id?: string }).id;
  if (!userId) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };

  // Load chat session WITH its scoped agent (if any) so we can pull
  // agent-specific systemPrompt + modelOverride in one query.
  const chat = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId, archivedAt: null },
    include: { agent: { select: { id: true, name: true, systemPrompt: true, modelOverride: true, status: true } } },
  });
  if (!chat) return { error: NextResponse.json({ error: "session not found" }, { status: 404 }) };
  return { userId, chat };
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const c = await ctxAndSession(parsed.data.sessionId);
  if ("error" in c) return c.error;

  // 1. Append the user message right away — even if Claude errors, the
  //    user's input is preserved for next time.
  const userMessage = await prisma.chatMessage.create({
    data: {
      sessionId: c.chat.id,
      role: "USER",
      content: parsed.data.message,
    },
  });

  // 1b. Auto-title the session from the first user message if untitled.
  if (!c.chat.title) {
    const title = parsed.data.message.length > 60
      ? parsed.data.message.slice(0, 57) + "…"
      : parsed.data.message;
    await prisma.chatSession.update({ where: { id: c.chat.id }, data: { title } });
  }

  // 2. Build conversation history. Limit to last 30 turns to keep the
  //    request size sane on long sessions; older context still in DB.
  const history = await prisma.chatMessage.findMany({
    where: { sessionId: c.chat.id, role: { in: ["USER", "ASSISTANT"] } },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  history.reverse();

  // 3. Pick system prompt + model. Agent-scoped sessions use the
  //    agent's prompt; the agent's modelOverride wins over the org's
  //    BYOK preferredModel which wins over the Sidekick default.
  const agentScoped = c.chat.agent && c.chat.agent.status === "ENABLED" ? c.chat.agent : null;
  const systemPrompt = agentScoped?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

  const resolved = await getAnthropicForOrg(c.chat.organizationId);
  const model = agentScoped?.modelOverride ?? modelFor(resolved, SIDEKICK_DEFAULT_MODEL);

  let assistantText = "";
  let tokensIn: number | null = null;
  let tokensOut: number | null = null;
  let finishReason: string | null = null;
  let errorText: string | null = null;

  try {
    const result = await resolved.client.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: history.map((m) => ({
        role: m.role === "USER" ? "user" : "assistant",
        content: m.content,
      })),
    });
    // The SDK returns content blocks; concatenate any text blocks.
    assistantText = result.content
      .filter((b) => b.type === "text")
      .map((b) => ("text" in b ? b.text : ""))
      .join("\n\n");
    tokensIn = result.usage?.input_tokens ?? null;
    tokensOut = result.usage?.output_tokens ?? null;
    finishReason = result.stop_reason ?? null;
  } catch (err) {
    errorText = err instanceof Error ? err.message : "Claude request failed";
    assistantText = `Sorry — I hit an error reaching the model.\n\n\`${errorText}\``;
  }

  // 4. Persist assistant message + update session telemetry.
  const assistantMessage = await prisma.chatMessage.create({
    data: {
      sessionId: c.chat.id,
      role: "ASSISTANT",
      content: assistantText,
      modelUsed: model,
      tokensIn,
      tokensOut,
      finishReason,
    },
  });

  // Rough cost computation (cents). Sonnet 4.6: $3/M input, $15/M output.
  // These are approximate — adjust as pricing changes.
  const costCents = tokensIn != null && tokensOut != null
    ? Math.ceil((tokensIn * 0.0003 + tokensOut * 0.0015) * 100)
    : 0;

  await prisma.chatSession.update({
    where: { id: c.chat.id },
    data: {
      lastModel: model,
      totalTokensIn: { increment: tokensIn ?? 0 },
      totalTokensOut: { increment: tokensOut ?? 0 },
      totalCostCents: { increment: costCents },
    },
  });

  return NextResponse.json({
    userMessage: { id: userMessage.id, role: "USER", content: userMessage.content, createdAt: userMessage.createdAt },
    assistantMessage: {
      id: assistantMessage.id,
      role: "ASSISTANT",
      content: assistantMessage.content,
      modelUsed: assistantMessage.modelUsed,
      tokensIn,
      tokensOut,
      finishReason,
      createdAt: assistantMessage.createdAt,
    },
    error: errorText,
  });
}
