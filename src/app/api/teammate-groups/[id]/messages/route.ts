// GET  /api/teammate-groups/[id]/messages?before=<messageId>&take=1..100
//   A page of the person's group chat, oldest first, with the cards its
//   approval rows name and the group's members.
// POST /api/teammate-groups/[id]/messages
//   { message: string (1..20000) } or { resume: true, agentSlug }
//   The answers, streamed as Server-Sent Events (GroupStreamEvent,
//   src/lib/agents/teammate-thread.ts), one `data:` line of JSON per event.
//
// A MESSAGE, IN ORDER, and nothing is spent before the step that spends it
// (docs/plans/ai-teammates-phase2.md step 3, Decisions 13 to 15):
//   1. the AI app, and the group (the person's own, live: else 404)
//   2. the person, as a teammate acts for them (resolveActingPerson)
//   3. AI is set up for the workspace: else 503 not_configured
//   4. who answers (pickAnswerers): the teammates the message names, in
//      order, at most three, else the lead. Nobody who can answer: 409
//      no_one_to_answer, and nothing is saved
//   5. one AI question for the first who can answer (claimTeammateTurn): a
//      refusal answers 429 or 403 with its sentence, and nothing is saved
//   6. the message is saved, naming its answerers (meta.answerers)
//   7. each answerer in turn: one that cannot answer gets a line saying so;
//      the others each claim their own question (the first already has),
//      answer as themselves, and read the earlier answers as information.
//      The plan running out of questions stops the rest, each with a line.
//      Each later answerer is read again just before its turn, and one that
//      gets nothing back from the AI leaves a line too. A person who left
//      the group meanwhile stops the rest, and what was asked is cancelled.
// A continue ({ resume: true, agentSlug }) runs only the teammate whose
// request was decided, and hears only that teammate's outcomes.
// The turns run to the end and are saved even when the client goes away.
//
// Every refusal is { error: "<sentence>", code }.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApp } from "@/lib/app-gate";
import { isAiConfigured } from "@/lib/ai-client";
import { prisma } from "@/lib/prisma";
import { resolveActingPerson } from "@/lib/agents/acting";
import { claimUnreportedOutcomes, writeEventLine } from "@/lib/agents/actions";
import { abandonTurn, claimTeammateTurn, giveBackTurn, type TurnClaim } from "@/lib/agents/budget";
import { runTeammateTurn, teammateAgentFrom, type GroupTurn, type TurnResult } from "@/lib/agents/engine";
import { pickAnswerers, type GroupMember, type SkipReason } from "@/lib/agents/group-chat";
import { cancelLeftRequests, cancelRemovedRequests, groupMembersFor, groupNameOf, groupStillOpen, loadGroup, memberViews, namesLine, stillInGroup, type GroupRecord } from "@/lib/agents/group-server";
import { ACTION_ERRORS, GROUP_COPY, TEAMMATE_CHAT, TEAMMATE_ROUTE_ERRORS, TURN_ERRORS, pausedNotSent, removedComposer } from "@/lib/agents/teammate-copy";
import { MESSAGE_SELECT, invalidRequest, loadTeammate, messagesPage, teammateError } from "@/lib/agents/teammate-server";
import { messageViewFromRow, type AgentActionRow, type GroupStreamEvent, type TeammateMessageView, type TeammateStreamEvent } from "@/lib/agents/teammate-thread";

type Params = { params: Promise<{ id: string }> };

const notFound = () => teammateError(404, "not_found", GROUP_COPY.notFound);

export async function GET(req: Request, { params }: Params) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const { id } = await params;
  const g = await loadGroup(id, viewer);
  if (!g) return notFound();
  const page = await messagesPage(g.id, viewer.userId, new URL(req.url).searchParams);
  return NextResponse.json({ ...page, members: memberViews(g, viewer) });
}

const postSchema = z.object({
  message: z.string().max(20000).optional(),
  resume: z.literal(true).optional(),
  agentSlug: z.string().min(1).max(200).optional(),
});

/** The stream events a teammate's turn passes on as they are: its words, calls, cards and lines. */
const PASSED_ON: ReadonlySet<TeammateStreamEvent["type"]> = new Set(["text_delta", "tool_use", "tool_result", "approval", "event"]);

function claimRefusal(claim: Extract<TurnClaim, { ok: false }>): NextResponse {
  if (claim.code === "rate_limited") return teammateError(429, "rate_limited", claim.message, { "Retry-After": String(claim.retryAfter ?? 60) });
  if (claim.code === "not_found") return notFound();
  return teammateError(403, claim.code, claim.message);
}

function groupTurn(g: GroupRecord, self: GroupMember, members: readonly GroupMember[], messageId: string | null): GroupTurn {
  return { name: groupNameOf(g), selfAgentId: self.agentId, members: members.map((m) => ({ agentId: m.agentId, name: m.name })), messageId };
}

export async function POST(req: Request, { params }: Params) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidRequest();
  const resume = parsed.data.resume === true;
  const message = parsed.data.message ?? "";
  if (resume ? message.length > 0 || !parsed.data.agentSlug : !message.trim()) return invalidRequest();

  const { id } = await params;
  const g = await loadGroup(id, viewer);
  if (!g) return notFound();
  const acting = await resolveActingPerson(viewer.organizationId, viewer.userId);
  if (!acting.ok) return teammateError(403, "person_cannot", ACTION_ERRORS.personCannot);
  const person = acting.person;
  if (!(await isAiConfigured(viewer.organizationId))) return teammateError(503, "not_configured", TEAMMATE_CHAT.notSetUp);
  const members = groupMembersFor(g, person.viewer);
  const records = new Map(g.members.map((m) => [m.agent.id, m.agent]));
  const claimFor = (m: GroupMember, what: string, trigger: "CHAT" | "RESUME") =>
    claimTeammateTurn({
      organizationId: viewer.organizationId,
      agentId: m.agentId,
      userId: person.userId,
      what,
      trigger,
      sessionId: g.id,
      routineId: null,
      practice: false,
      rateLimit: true,
    });

  // ── A continue: only the teammate whose request was decided ──
  if (resume) {
    const self = members.find((m) => m.slug === parsed.data.agentSlug);
    // A teammate removed from the group has nothing to continue here: its
    // own refusal, never "the group chat can't be found" (review round 1).
    if (!self) return teammateError(409, "not_in_group", GROUP_COPY.notInGroup);
    if (self.status === "DISABLED" && self.usable) return teammateError(409, "agent_paused", pausedNotSent(self.name));
    if (self.status !== "ENABLED" || !self.usable) return teammateError(409, "agent_removed", removedComposer(self.name));
    const claim = await claimFor(self, "AI teammate continue", "RESUME");
    if (!claim.ok) return claimRefusal(claim);
    let outcomes: AgentActionRow[];
    try {
      outcomes = await claimUnreportedOutcomes(g.id, self.agentId);
    } catch (err) {
      console.error(`[agents] group continue ${claim.runId} not started: ${err instanceof Error ? err.message.split("\n").pop() : String(err)}`);
      await abandonTurn(claim.runId, claim.questionId);
      return teammateError(500, "failed", TURN_ERRORS.noAnswer);
    }
    if (outcomes.length === 0) {
      await abandonTurn(claim.runId, claim.questionId);
      return teammateError(409, "nothing_to_continue", TEAMMATE_ROUTE_ERRORS.nothingToContinue);
    }
    return stream(async (send, pass) => {
      send({ type: "answer_start", agentId: self.agentId });
      const result = await runOne(() =>
        runTeammateTurn({
          agent: teammateAgentFrom(records.get(self.agentId)!),
          person,
          sessionId: g.id,
          trigger: "RESUME",
          userText: null,
          practice: false,
          routine: null,
          runId: claim.runId,
          questionId: claim.questionId,
          streaming: true,
          outcomes,
          group: groupTurn(g, self, members, null),
          emit: pass,
        }),
        claim.runId,
      );
      if (result?.giveBack) await giveBackTurn(claim.runId, claim.questionId);
      if (!(await groupStillOpen(person.viewer, g.id).catch(() => true))) await cancelLeftRequests(g.id, person.userId).catch(() => 0);
      send({ type: "answer_done", agentId: self.agentId, messages: result?.messages ?? [], error: result ? result.error : TURN_ERRORS.noAnswer });
      send({ type: "done", messages: result?.messages ?? [], error: result ? result.error : TURN_ERRORS.noAnswer });
    });
  }

  // ── A message ──
  const pick = pickAnswerers(message, members);
  const firstUp = pick.answerers.find((a) => a.skip === null)?.member ?? null;
  if (!firstUp) {
    const named = pick.answerers.length > 0 ? pick.answerers.map((a) => a.member.name) : members.map((m) => m.name);
    return teammateError(409, "no_one_to_answer", GROUP_COPY.noOneCanAnswer(namesLine(named)));
  }
  const firstClaim = await claimFor(firstUp, "AI teammate group message", "CHAT");
  if (!firstClaim.ok) return claimRefusal(firstClaim);

  let userView: TeammateMessageView | null;
  try {
    const row = await prisma.chatMessage.create({
      data: { sessionId: g.id, role: "USER", content: message, meta: { answerers: pick.answerers.map((a) => a.member.agentId) } },
      select: MESSAGE_SELECT,
    });
    userView = messageViewFromRow(row);
    await prisma.chatSession.updateMany({ where: { id: g.id }, data: { updatedAt: new Date() } }).catch(() => {});
  } catch (err) {
    console.error(`[agents] group message ${firstClaim.runId} not saved: ${err instanceof Error ? err.message.split("\n").pop() : String(err)}`);
    await abandonTurn(firstClaim.runId, firstClaim.questionId);
    return teammateError(500, "not_saved", TEAMMATE_ROUTE_ERRORS.messageNotSaved);
  }
  if (!userView) return teammateError(500, "not_saved", TEAMMATE_ROUTE_ERRORS.messageNotSaved);
  const userMessageId = userView.id;
  const answererViews = memberViews(g, person.viewer);
  const views = pick.answerers.flatMap((a) => answererViews.filter((v) => v.agentId === a.member.agentId));

  return stream(async (send, pass) => {
    send({ type: "user_message", message: userView, answerers: views });
    const all: TeammateMessageView[] = [];
    let outOfQuestions: string | null = null;
    const skipLine = async (m: GroupMember, reason: string) => {
      const line = await writeEventLine(g.id, { text: GROUP_COPY.skippedLine(m.name, reason), event: "group_skipped", agentId: m.agentId, replyTo: userMessageId });
      if (line) {
        all.push(line);
        send({ type: "skipped", agentId: m.agentId, message: line });
      }
    };
    for (const { member, skip } of pick.answerers) {
      if (outOfQuestions !== null) {
        await skipLine(member, outOfQuestions);
        continue;
      }
      const first = member.agentId === firstUp.agentId;
      // Each later answerer is read again just before its turn: one paused,
      // removed or no longer the person's to use while the others answered
      // does not run (review of step 3), and the turn uses it as it is now.
      let record = records.get(member.agentId)!;
      let skipNow: SkipReason | null = skip;
      if (!first && !skipNow) {
        // Removed from this group meanwhile: it does not answer, and spends nothing (review round 1).
        if (!(await stillInGroup(g.id, member.agentId).catch(() => true))) {
          await skipLine(member, GROUP_COPY.notMemberReason);
          continue;
        }
        const now = await loadTeammate(member.slug, person.viewer, { includeRemoved: true }).catch(() => null);
        if (!now) skipNow = "no_access";
        else {
          record = now;
          skipNow = now.status === "ARCHIVED" ? "removed" : now.status === "DISABLED" ? "paused" : null;
        }
      }
      if (skipNow) {
        await skipLine(member, GROUP_COPY.skipReason[skipNow]);
        continue;
      }
      let claim: TurnClaim;
      try {
        claim = first ? firstClaim : await claimFor(member, "AI teammate group message", "CHAT");
      } catch (err) {
        console.error(`[agents] group answerer not claimed: ${err instanceof Error ? err.message.split("\n").pop() : String(err)}`);
        await skipLine(member, GROUP_COPY.noAnswerReason);
        continue;
      }
      if (!claim.ok) {
        if (claim.code === "ai_limit") outOfQuestions = claim.message;
        await skipLine(member, claim.message);
        continue;
      }
      send({ type: "answer_start", agentId: member.agentId });
      const result = await runOne(() =>
        runTeammateTurn({
          agent: teammateAgentFrom(record),
          person,
          sessionId: g.id,
          trigger: "CHAT",
          userText: null,
          userMessageId,
          practice: false,
          routine: null,
          runId: claim.runId,
          questionId: claim.questionId,
          streaming: true,
          group: groupTurn(g, member, members, userMessageId),
          emit: pass,
        }),
        claim.runId,
      );
      if (result?.giveBack) await giveBackTurn(claim.runId, claim.questionId);
      if (result) all.push(...result.messages);
      send({ type: "answer_done", agentId: member.agentId, messages: result?.messages ?? [], error: result ? result.error : TURN_ERRORS.noAnswer });
      // An answer that got nothing back, or came back and could not be saved,
      // leaves a line, so the chat says who did not answer and why (review
      // round 1: a failed save left no trace, and the page waited for it).
      if (!result || result.failedBeforeAnything) await skipLine(member, GROUP_COPY.noAnswerReason);
      else if (result.error === TURN_ERRORS.notSaved) await skipLine(member, GROUP_COPY.notSavedReason);
      // Removed from the group while it answered: what it asked is cancelled.
      if (!(await stillInGroup(g.id, member.agentId).catch(() => true))) await cancelRemovedRequests(g.id, person.userId, member.agentId).catch(() => 0);
      // The person left the group while this one answered: what it asked is
      // cancelled (nothing can show it now), and nobody else answers.
      if (!(await groupStillOpen(person.viewer, g.id).catch(() => true))) {
        await cancelLeftRequests(g.id, person.userId).catch(() => 0);
        break;
      }
    }
    send({ type: "done", messages: all, error: null });
  });
}

/** One teammate's turn: runTeammateTurn answers its own failures; anything else is logged and keeps the question (what it did is unknown). */
async function runOne(run: () => Promise<TurnResult>, runId: string): Promise<TurnResult | null> {
  try {
    return await run();
  } catch (err) {
    console.error(`[agents] group turn ${runId} threw: ${err instanceof Error ? err.message.split("\n").pop() : String(err)}`);
    return null;
  }
}

/**
 * The SSE response. `send` writes one event; `pass` hands a teammate turn's
 * own events on (its words, calls, cards and lines). A client that went
 * away stops the events, never the turns. A comment line every 15 s keeps a
 * proxy from cutting a silent stream (as the one-teammate route does).
 */
function stream(work: (send: (e: GroupStreamEvent) => void, pass: (e: TeammateStreamEvent) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let clientGone = false;
      const write = (chunk: string) => {
        if (clientGone) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          clientGone = true;
        }
      };
      const send = (e: GroupStreamEvent) => write(`data: ${JSON.stringify(e)}\n\n`);
      const pass = (e: TeammateStreamEvent) => {
        if (PASSED_ON.has(e.type)) send(e as GroupStreamEvent);
      };
      const beat = setInterval(() => write(": keepalive\n\n"), 15_000);
      try {
        await work(send, pass);
      } catch (err) {
        console.error(`[agents] group stream failed: ${err instanceof Error ? err.message.split("\n").pop() : String(err)}`);
        send({ type: "error", message: TURN_ERRORS.noAnswer });
      } finally {
        clearInterval(beat);
        if (!clientGone) {
          try {
            controller.close();
          } catch {
            // Closed by the client already.
          }
        }
      }
    },
    cancel() {
      // The client disconnected: the turns keep running and are saved.
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
