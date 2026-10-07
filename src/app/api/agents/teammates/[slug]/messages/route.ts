// GET  /api/agents/teammates/[slug]/messages?before=<messageId>&take=1..100
//   A page of this person's chat with the teammate, oldest first, with the
//   cards its approval rows name (their own actions only). No chat yet:
//   session null and nothing in it.
// POST /api/agents/teammates/[slug]/messages
//   { message: string (1..20000), practice?: boolean } or { resume: true }
//   One turn of the teammate as this person, streamed as Server-Sent Events
//   (TeammateStreamEvent, src/lib/agents/teammate-thread.ts), one `data:` line
//   of JSON per event, as Ask AI's stream route frames them.
//
// A TURN, IN ORDER, and nothing is spent before the step that spends it:
//   1. the AI app (requireApp), and the teammate this person can use
//   2. the teammate is on: paused 409 agent_paused, removed 409 agent_removed
//   3. AI is set up for the workspace: else 503 not_configured
//   4. the person, as a teammate acts for them (resolveActingPerson)
//   5. their one chat with it (getOrCreateTeammateSession)
//   6. one AI question and the turn's AgentRun (claimTeammateTurn): 429
//      rate_limited, 403 agent_cap or ai_limit, each with its sentence
//   7. a continue claims what was decided since the teammate last heard
//      (claimUnreportedOutcomes); nothing: the question goes back, 409
//      nothing_to_continue
//   8. a message is saved (meta.practice for a practice run)
//   9. the turn streams; a turn that failed before any text or tool gives
//      its question back
// The turn runs to the end and is saved even when the client goes away: a
// closed stream only stops the events (Ask AI's clientGone).
//
// docs/plans/ai-teammates.md 4. Every refusal is { error: "<sentence>", code }.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApp } from "@/lib/app-gate";
import { isAiConfigured } from "@/lib/ai-client";
import { prisma } from "@/lib/prisma";
import { resolveActingPerson } from "@/lib/agents/acting";
import { claimUnreportedOutcomes } from "@/lib/agents/actions";
import { abandonTurn, claimTeammateTurn, giveBackTurn } from "@/lib/agents/budget";
import { getOrCreateTeammateSession, runTeammateTurn, teammateAgentFrom, type TurnResult } from "@/lib/agents/engine";
import { ACTION_ERRORS, TEAMMATE_CHAT, TEAMMATE_ROUTE_ERRORS, TURN_ERRORS, pausedNotSent, removedComposer } from "@/lib/agents/teammate-copy";
import {
  MESSAGE_SELECT,
  invalidRequest,
  liveChatWhere,
  loadTeammate,
  messagesPage,
  teammateError,
  teammateNotFound,
} from "@/lib/agents/teammate-server";
import { messageViewFromRow, type AgentActionRow, type TeammateMessageView, type TeammateStreamEvent } from "@/lib/agents/teammate-thread";

type Params = { params: Promise<{ slug: string }> };


export async function GET(req: Request, { params }: Params) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const { slug } = await params;
  const agent = await loadTeammate(slug, viewer, { includeRemoved: true });
  if (!agent) return teammateNotFound();

  const chat = await prisma.chatSession.findFirst({ where: liveChatWhere(agent, viewer.userId), select: { id: true } });
  if (!chat) return NextResponse.json({ session: null, messages: [], actions: {}, hasMore: false });
  return NextResponse.json(await messagesPage(chat.id, viewer.userId, new URL(req.url).searchParams));
}

const postSchema = z.object({
  message: z.string().max(20000).optional(),
  practice: z.boolean().optional(),
  resume: z.literal(true).optional(),
});

export async function POST(req: Request, { params }: Params) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidRequest();
  const resume = parsed.data.resume === true;
  const message = parsed.data.message ?? "";
  // One or the other: a message with words in it, or a continue.
  if (resume ? message.length > 0 : !message.trim()) return invalidRequest();
  const practice = !resume && parsed.data.practice === true;

  const { slug } = await params;
  const agent = await loadTeammate(slug, viewer, { includeRemoved: true });
  if (!agent) return teammateNotFound();
  if (agent.status === "ARCHIVED") return teammateError(409, "agent_removed", removedComposer(agent.name));
  if (agent.status !== "ENABLED") return teammateError(409, "agent_paused", pausedNotSent(agent.name));
  if (!(await isAiConfigured(agent.organizationId))) return teammateError(503, "not_configured", TEAMMATE_CHAT.notSetUp);
  // requireApp vouched for the person; the turn needs them as a teammate
  // acts for them (their level here, their zone).
  const acting = await resolveActingPerson(viewer.organizationId, viewer.userId);
  if (!acting.ok) return teammateError(403, "person_cannot", ACTION_ERRORS.personCannot);
  const person = acting.person;

  const chat = await getOrCreateTeammateSession(agent, viewer.userId);
  const claim = await claimTeammateTurn({
    organizationId: agent.organizationId,
    agentId: agent.id,
    userId: viewer.userId,
    what: resume ? "AI teammate continue" : "AI teammate message",
    trigger: resume ? "RESUME" : "CHAT",
    sessionId: chat.id,
    routineId: null,
    practice,
    rateLimit: true,
  });
  if (!claim.ok) {
    if (claim.code === "rate_limited") {
      return teammateError(429, "rate_limited", claim.message, { "Retry-After": String(claim.retryAfter ?? 60) });
    }
    if (claim.code === "not_found") return teammateNotFound();
    return teammateError(403, claim.code, claim.message);
  }

  // A continue: what was decided since the teammate last heard, claimed now
  // so two continues never tell it twice. A message: the person's words,
  // saved before the turn reads them.
  let outcomes: AgentActionRow[] = [];
  let userView: TeammateMessageView | null = null;
  try {
    if (resume) {
      outcomes = await claimUnreportedOutcomes(chat.id);
    } else {
      const row = await prisma.chatMessage.create({
        data: { sessionId: chat.id, role: "USER", content: message, ...(practice ? { meta: { practice: true } } : {}) },
        select: MESSAGE_SELECT,
      });
      userView = messageViewFromRow(row);
    }
  } catch (err) {
    console.error(`[agents] turn ${claim.runId} not started: ${err instanceof Error ? err.message.split("\n").pop() : String(err)}`);
    await abandonTurn(claim.runId, claim.questionId);
    return resume ? teammateError(500, "failed", TURN_ERRORS.noAnswer) : teammateError(500, "not_saved", TEAMMATE_ROUTE_ERRORS.messageNotSaved);
  }
  if (resume && outcomes.length === 0) {
    await abandonTurn(claim.runId, claim.questionId);
    return teammateError(409, "nothing_to_continue", TEAMMATE_ROUTE_ERRORS.nothingToContinue);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // A client that went away makes enqueue throw: from then on the events
      // stop, and the turn still runs to the end and is saved.
      let clientGone = false;
      function send(event: TeammateStreamEvent) {
        if (clientGone) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          clientGone = true;
        }
      }
      // A comment line every 15 s while the turn runs: a long tool input
      // streams no text, and a proxy cuts a silent connection, which broke
      // turns off mid-answer (as in Ask AI's stream route). The client's
      // parser (splitSse) skips comment lines.
      const beat = setInterval(() => {
        if (clientGone) return;
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          clientGone = true;
        }
      }, 15_000);
      try {

      // The saved message first, so the thread can swap its optimistic bubble.
      if (userView) send({ type: "user_message", message: userView });

      let result: TurnResult | null = null;
      try {
        result = await runTeammateTurn({
          agent: teammateAgentFrom(agent),
          person,
          sessionId: chat.id,
          trigger: resume ? "RESUME" : "CHAT",
          userText: resume ? null : message,
          userMessageId: userView?.id ?? null,
          practice,
          routine: null,
          runId: claim.runId,
          questionId: claim.questionId,
          streaming: true,
          outcomes,
          emit: send,
        });
      } catch (err) {
        // runTeammateTurn answers its own failures; this is anything else.
        // What it did is unknown, so its question is kept.
        console.error(`[agents] turn ${claim.runId} threw: ${err instanceof Error ? err.message.split("\n").pop() : String(err)}`);
      }
      // Only a turn the model never answered gives its question back (TurnResult.giveBack).
      if (result?.giveBack) await giveBackTurn(claim.runId, claim.questionId);
      send(result ? { type: "done", messages: result.messages, error: result.error } : { type: "error", message: TURN_ERRORS.noAnswer });

      if (!clientGone) {
        try {
          controller.close();
        } catch {
          // Closed by the client already.
        }
      }
      } finally {
        clearInterval(beat);
      }
    },
    cancel() {
      // The client disconnected. start() keeps running to save the turn;
      // send() becomes a no-op once enqueue throws.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
