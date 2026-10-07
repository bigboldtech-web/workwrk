// GET  /api/conversations/[id]/teammates
//   Whether a teammate can be asked here, and which: the person's usable,
//   ENABLED teammates (at most 50, by name), empty when it can't.
// POST /api/conversations/[id]/teammates
//   { body, teammate (a slug), clientId, parentId?, mentions? }
//   The person's message, posted, then one turn of that teammate as them,
//   whose answer is posted where they asked, streamed as Server-Sent Events:
//   message (the person's message, saved), then answer, no_answer or error.
//
// docs/plans/ai-teammates-phase2.md step 6, Decisions 8 to 12, 24, 27, 30
// and 32. IN ORDER, and nothing is posted or spent before its step:
//   1. the conversation, with the right to post (requireConversation); a
//      message already sent with this key answers with that one, before any
//      refusal, and starts no turn (and spends none of the limit below)
//   2. a teammate may be asked here (talkAddressRefusal): a member, no
//      Guests, at most 250 people, not archived, a direct message, a group
//      or a private channel
//   3. the person, as a teammate acts for them
//   4. the teammate, one this person may use (another person's private one
//      answers as one that does not exist), and on
//   5. the body names it ("@<Name>"): it was picked from the @ list
//   6. (the key, read with step 1)
//   7. five asks a minute per person
//   8. AI is set up
//   9. mentions and the thread, checked as a plain message's
//  10. one AI question for the turn (claimTeammateTurn): refused, nothing
//      is posted
//  11. the person's message, posted with the request's state
//  12. the turn; its answer is posted as the person, marked as from the
//      teammate, where the request was, if the turn finished, the request
//      (and its thread) is still there, they may still post there and no
//      Guest has joined; else it stays in their chat with the teammate. The
//      answer keeps the list of who was here (readers): anyone added later
//      sees that a teammate answered, never what it said.
// The turn runs to the end when the client leaves. Every refusal is
// { error: "<sentence>", code }.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAiConfigured } from "@/lib/ai-client";
import { rateLimit } from "@/lib/rate-limit-memory";
import { publishToConversation, publishToUser } from "@/lib/realtime-bus";
import { canPost } from "@/lib/talk-access";
import { loadConversationRole, requireConversation } from "@/lib/talk-gate";
import { afterMessageSent, insertConversationMessage } from "@/lib/talk-post";
import { resolveActingPerson } from "@/lib/agents/acting";
import { writeEventLine } from "@/lib/agents/actions";
import { abandonTurn, claimTeammateTurn, giveBackTurn } from "@/lib/agents/budget";
import { clampText } from "@/lib/agents/clamp";
import { getOrCreateTeammateSession, runTeammateTurn, teammateAgentFrom, type TalkPlaceKind, type TurnResult } from "@/lib/agents/engine";
import { hueForAgent } from "@/lib/agents/hues";
import { TALK_TEAMMATE_LIMITS, addressedIn, talkAddressRefusal, type TalkAddressRefusal } from "@/lib/agents/talk-address";
import { auditTalkAnswer, conversationAudience, noticeTalkApprovals, recordTalkOutcome, setRequestState, talkContext } from "@/lib/agents/talk-turn";
import { agentUsableWhere, canUseAgent } from "@/lib/agents/teammate-access";
import { ACTION_ERRORS, TALK_TEAMMATE_COPY, TEAMMATE_CHAT, TURN_ERRORS, pausedNotSent } from "@/lib/agents/teammate-copy";
import { invalidRequest, loadTeammate, teammateError, teammateNotFound } from "@/lib/agents/teammate-server";
import { cleanOutwardText, placeOf, talkAudience } from "@/lib/agents/teammate-tools";
import { requireApp } from "@/lib/app-gate";

type Params = { params: Promise<{ id: string }> };

const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_BODY = 8000;

const REFUSAL: Record<TalkAddressRefusal, { status: number; code: string; error: string }> = {
  guest: { status: 403, code: "guest_cannot", error: TALK_TEAMMATE_COPY.guestCannot },
  public_channel: { status: 403, code: "public_channel", error: TALK_TEAMMATE_COPY.publicChannel },
  has_guests: { status: 403, code: "has_guests", error: TALK_TEAMMATE_COPY.hasGuests },
  not_member: { status: 403, code: "not_member", error: TALK_TEAMMATE_COPY.notMember },
  archived: { status: 403, code: "archived", error: TALK_TEAMMATE_COPY.archived },
  too_many_people: { status: 403, code: "too_many_people", error: TALK_TEAMMATE_COPY.tooManyPeople },
};

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const { error, ctx } = await requireConversation(id, { floor: "view" });
  if (error) return error;
  const app = await requireApp("ai");
  if ("error" in app) return NextResponse.json({ addressable: false, reason: "ai_off", teammates: [] });
  const viewer = app.viewer;
  // What needs no member read first: a public channel of any size answers
  // without one (review round 8). Then one bounded read.
  const early = talkAddressRefusal(ctx.conversation, ctx.viewer, { isMember: ctx.viewer.isMember, hasGuests: false });
  if (early) return NextResponse.json({ addressable: false, reason: early, teammates: [] });
  const audience = await conversationAudience(id, ctx.gate.organizationId);
  const reason = talkAddressRefusal(ctx.conversation, ctx.viewer, { isMember: ctx.viewer.isMember, hasGuests: audience.hasGuests, tooManyPeople: audience.tooMany });
  if (reason) return NextResponse.json({ addressable: false, reason, teammates: [] });
  const rows = await prisma.agent.findMany({
    where: { organizationId: viewer.organizationId, status: "ENABLED", ...agentUsableWhere(viewer.userId) },
    select: { slug: true, name: true, hue: true, avatar: true, organizationId: true, visibility: true, ownerId: true },
    orderBy: { name: "asc" },
    take: 80,
  });
  const teammates = rows
    .filter((r) => canUseAgent(r, viewer))
    .slice(0, 50)
    .map((r) => ({ slug: r.slug, name: r.name, hue: hueForAgent({ hue: r.hue, slug: r.slug }), avatar: r.avatar }));
  return NextResponse.json({ addressable: true, reason: null, teammates });
}

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const { error, ctx } = await requireConversation(id, { floor: "edit", allow: canPost, what: "post here" });
  if (error) return error;
  const app = await requireApp("ai");
  if ("error" in app) return app.error;
  const payload = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const body = typeof payload?.body === "string" ? payload.body.trim() : "";
  const slug = typeof payload?.teammate === "string" ? payload.teammate : "";
  const clientId = typeof payload?.clientId === "string" && CLIENT_ID.test(payload.clientId) ? payload.clientId : null;
  if (!body || body.length > MAX_BODY || !slug || slug.length > 200 || !clientId) return invalidRequest();

  // Sent already with this key: that message, and no second turn, before
  // any refusal, as a plain send answers it (a Retry of a send whose answer
  // was lost must get its message back even if the teammate was paused or a
  // Guest joined since). It spends none of the per-minute limit. A removed
  // one is refused: its words stay in the person's "Not sent" row.
  const already = await sentWith(id, ctx.gate.userId, clientId);
  if (already?.deletedAt) return teammateError(409, "removed", TALK_TEAMMATE_COPY.removedAfterSent);
  if (already) return stream(async (send) => send({ type: "message", message: already }));

  // 2. A teammate may be asked here: what needs no member read first, then
  // this person's per-minute limit, so no script can make every try read a
  // big conversation's members (review round 8), then one bounded read.
  const early = talkAddressRefusal(ctx.conversation, ctx.viewer, { isMember: ctx.viewer.isMember, hasGuests: false });
  if (early) return teammateError(REFUSAL[early].status, REFUSAL[early].code, REFUSAL[early].error);
  const limited = rateLimit(`talk-teammate:${ctx.gate.userId}`, { max: TALK_TEAMMATE_LIMITS.perMinute, windowMs: 60_000 });
  if (!limited.ok) return teammateError(429, "rate_limited", TALK_TEAMMATE_COPY.tooMany(limited.retryAfter), { "Retry-After": String(limited.retryAfter) });
  const readers = await conversationAudience(id, ctx.gate.organizationId);
  const refusal = talkAddressRefusal(ctx.conversation, ctx.viewer, { isMember: ctx.viewer.isMember, hasGuests: readers.hasGuests, tooManyPeople: readers.tooMany });
  if (refusal) return teammateError(REFUSAL[refusal].status, REFUSAL[refusal].code, REFUSAL[refusal].error);

  // 3 to 5. The person, the teammate, and that the body names it.
  const acting = await resolveActingPerson(ctx.gate.organizationId, ctx.gate.userId);
  if (!acting.ok) return teammateError(403, "person_cannot", ACTION_ERRORS.personCannot);
  const person = acting.person;
  const agent = await loadTeammate(slug, person.viewer);
  if (!agent) return teammateNotFound();
  if (agent.status !== "ENABLED") return teammateError(409, "agent_paused", pausedNotSent(agent.name));
  if (!addressedIn(body, agent.name)) return teammateError(400, "not_addressed", TALK_TEAMMATE_COPY.notAddressed);

  // 8. AI set up (the per-minute limit was spent above, before any member read).
  if (!(await isAiConfigured(person.organizationId))) return teammateError(503, "not_configured", TEAMMATE_CHAT.notSetUp);

  // 9. Mentions and the thread, as a plain message checks them.
  const meta = payload?.metadata && typeof payload.metadata === "object" ? (payload.metadata as Record<string, unknown>) : {};
  const mentions = await validMentions(id, person.userId, meta.mentions);
  let parentId: string | null = null;
  if (typeof payload?.parentId === "string" && payload.parentId) {
    const parent = await prisma.conversationMessage.findFirst({ where: { id: payload.parentId, conversationId: id, parentId: null }, select: { id: true } });
    if (!parent) return teammateError(400, "invalid", TALK_TEAMMATE_COPY.threadGone);
    parentId = parent.id;
  }

  // 10. One question, in the person's own chat with the teammate.
  const session = await getOrCreateTeammateSession(agent, person.userId);
  const claim = await claimTeammateTurn({
    organizationId: person.organizationId,
    agentId: agent.id,
    userId: person.userId,
    what: "AI teammate in Talk",
    trigger: "TALK",
    sessionId: session.id,
    routineId: null,
    practice: false,
    rateLimit: true,
  });
  if (!claim.ok) {
    if (claim.code === "rate_limited") return teammateError(429, "rate_limited", claim.message, { "Retry-After": String(claim.retryAfter ?? 60) });
    if (claim.code === "not_found") return teammateNotFound();
    return teammateError(403, claim.code, claim.message);
  }

  // 11. The person's message, with the request it carries. A failure that
  // is not the duplicate key gives the question back: no turn ran.
  const now = new Date();
  const posted = await insertConversationMessage({
    conversationId: id,
    authorId: person.userId,
    membershipId: ctx.membershipId,
    body,
    parentId,
    metadata: { ...(mentions.length > 0 ? { mentions } : {}), teammate: { id: agent.id, slug: agent.slug, name: agent.name, state: "running", runId: claim.runId } },
    clientId,
    now,
  }).catch(async (err: unknown) => {
    console.error(`[agents] talk request not saved: ${err instanceof Error ? err.message.split("\n").pop() : String(err)}`);
    await abandonTurn(claim.runId, claim.questionId);
    return null;
  });
  if (!posted) return teammateError(500, "not_saved", TALK_TEAMMATE_COPY.notSent);
  if (!posted.ok) {
    // Two sends with one key at once: the first one's message, and this turn never runs.
    await abandonTurn(claim.runId, claim.questionId);
    const first = await sentWith(id, person.userId, clientId);
    if (first) return stream(async (send) => send({ type: "message", message: first }));
    return teammateError(500, "not_saved", TALK_TEAMMATE_COPY.notSent);
  }
  const request = posted.message;
  await afterMessageSent({
    conversationId: id,
    conversation: { type: ctx.conversation.type, name: ctx.conversation.name },
    message: request,
    authorId: person.userId,
    text: body,
    mentions,
    parentId,
    isCallCard: false,
    now,
  });

  return stream(async (send) => {
    send({ type: "message", message: { ...request, replyCount: 0 } });
    // Neither may stop the turn: the question is spent and the request posted.
    const placeKind = PLACE_KIND[ctx.conversation.type];
    const place = await placeOf({ id, type: ctx.conversation.type, name: ctx.conversation.name }, person.userId).catch(() => TALK_TEAMMATE_COPY.placeFallback);
    await writeEventLine(session.id, {
      text: TALK_TEAMMATE_COPY.askedLine(place, clampText(body, 300)),
      event: "talk_asked",
      agentId: agent.id,
      link: { kind: "talk", conversationId: id, messageId: request.id },
    }).catch((err: unknown) => console.error(`[agents] talk asked line ${request.id} not saved: ${err instanceof Error ? err.message.split("\n").pop() : String(err)}`));
    let result: TurnResult | null = null;
    try {
      const [audience, context] = await Promise.all([
        talkAudience(id).catch(() => 0),
        talkContext({ conversationId: id, parentId, before: request.createdAt, beforeId: request.id, person, readers: [...new Set([person.userId, ...readers.ids])] }).catch(() => []),
      ]);
      result = await runTeammateTurn({
        agent: teammateAgentFrom(agent),
        person,
        sessionId: session.id,
        trigger: "TALK",
        userText: body,
        practice: false,
        routine: null,
        runId: claim.runId,
        questionId: claim.questionId,
        streaming: false,
        origin: { kind: "talk", conversationId: id, messageId: request.id, place, placeKind, audience, context, readerIds: [...new Set([person.userId, ...readers.ids])] },
      });
    } catch (err) {
      console.error(`[agents] talk turn ${claim.runId} threw: ${err instanceof Error ? err.message.split("\n").pop() : String(err)}`);
    }
    if (result?.giveBack) await giveBackTurn(claim.runId, claim.questionId);

    // What it asked for waits in the person's chat with it: one Inbox row points there.
    if (result && result.proposedActionIds.length > 0) await noticeTalkApprovals(person.userId, agent, result.proposedActionIds, place);

    // The answer, where the request was, only for a turn that finished (a
    // half answer, cut short or declined, is never posted as the person),
    // while the request and its thread are still there (a removed request
    // was taken back), and only if the person may still post there and no
    // Guest has joined meanwhile. Else it stays in their chat with it.
    const saveState = (state: "answered" | "no_answer" | "failed", answerId: string | null) =>
      setRequestState(request.id, { id: agent.id, slug: agent.slug, name: agent.name, state, runId: claim.runId, ...(answerId ? { answerId } : {}) }).catch((err) =>
        console.error(`[agents] talk request ${request.id} state not saved: ${err instanceof Error ? err.message.split("\n").pop() : String(err)}`),
      );
    const text = result && !result.error ? cleanOutwardText(result.text, { talk: true, max: TALK_TEAMMATE_LIMITS.answerMax }) : "";
    let answered: Awaited<ReturnType<typeof insertConversationMessage>> | null = null;
    if (text) {
      const still = await loadConversationRole(id, ctx.gate).catch(() => null);
      // Who reads it now: the answer keeps this list and reaches only them.
      const readersNow = await conversationAudience(id, ctx.gate.organizationId).catch(() => ({ ids: [] as string[], tooMany: true, hasGuests: true }));
      const guestsNow = readersNow.hasGuests;
      const standing = await requestStanding(id, request.id, parentId).catch(() => false);
      // The person may still be acted for, and the teammate is still on and
      // theirs to use: one deactivated, or a teammate removed or paused,
      // during the turn posts nothing as them (review round 7).
      const actingNow = await resolveActingPerson(ctx.gate.organizationId, ctx.gate.userId).catch(() => null);
      const agentNow = actingNow?.ok ? await loadTeammate(slug, actingNow.person.viewer).catch(() => null) : null;
      // Nobody who joined during the turn reads an answer drawn from a
      // context checked against the people here when it began (review round 2).
      const sameReaders = readersNow.ids.every((uid) => uid === person.userId || readers.ids.includes(uid));
      const allowed =
        standing &&
        sameReaders &&
        agentNow?.status === "ENABLED" &&
        still !== null &&
        canPost(still.conversation, still.role) &&
        talkAddressRefusal(still.conversation, still.viewer, { isMember: still.viewer.isMember, hasGuests: guestsNow, tooManyPeople: readersNow.tooMany }) === null;
      if (allowed) {
        const at = new Date();
        const answerReaders = [...new Set([person.userId, ...readersNow.ids])];
        answered = await insertConversationMessage({
          conversationId: id,
          authorId: person.userId,
          // Never the person's read cursor: they are not the one typing.
          membershipId: null,
          body: text,
          parentId,
          metadata: {
            kind: "agent_post",
            agent: { id: agent.id, name: agent.name },
            replyTo: request.id,
            runId: claim.runId,
            via: "talk",
            readers: answerReaders,
          },
          clientId: `tm_${request.id}`,
          now: at,
        }).catch((err: unknown) => {
          console.error(`[agents] talk answer to ${request.id} not posted: ${err instanceof Error ? err.message.split("\n").pop() : String(err)}`);
          return null;
        });
        if (answered?.ok) {
          // The request reads answered at once, before the notices: a stop
          // between the two never leaves "didn't answer here" above a
          // posted answer (review round 3).
          await saveState("answered", answered.message.id);
          await afterMessageSent({
            conversationId: id,
            conversation: { type: still.conversation.type, name: still.conversation.name },
            message: answered.message,
            authorId: person.userId,
            text,
            mentions: [],
            parentId,
            isCallCard: false,
            now: at,
            // Its Inbox notices go to its readers only: someone added since never gets its opening words (review round 2).
            onlyUserIds: answerReaders,
            // And name the teammate, as the feed's "via" does: the person never read these words first (review round 7).
            senderLabel: TALK_TEAMMATE_COPY.noticeSender(agent.name, person.name),
          });
          await auditTalkAnswer({ person, agent, what: TALK_TEAMMATE_COPY.answeredIn(placeKind === "dm" ? TALK_TEAMMATE_COPY.auditDmPlace : place), conversationId: id, messageId: answered.message.id, runId: claim.runId }).catch(() => {});
        }
      }
    }
    if (result?.assistantMessageId) await recordTalkOutcome(result.assistantMessageId, answered?.ok ? answered.message.id : null);
    if (!answered?.ok) await saveState(!result ? "failed" : "no_answer", null);
    // Every open pane reads the request again: without this a turn that
    // posted nothing kept "working on it" on everyone's screen until the
    // stale mark, since only a new message nudged them.
    publishToConversation(id, { type: "message", conversationId: id });
    publishToUser(person.userId, { type: "agent.changed", agentId: agent.id });
    if (answered?.ok) send({ type: "answer", message: { ...answered.message, replyCount: 0 } });
    else if (result) send({ type: "no_answer", reason: TALK_TEAMMATE_COPY.didntAnswer(agent.name) });
    else send({ type: "error", message: TURN_ERRORS.noAnswer });
  });
}

/** Whether the request, and the thread it is in, are still there (not removed). */
async function requestStanding(conversationId: string, requestId: string, parentId: string | null): Promise<boolean> {
  const ids = parentId ? [requestId, parentId] : [requestId];
  const live = await prisma.conversationMessage.count({ where: { id: { in: ids }, conversationId, deletedAt: null } });
  return live === ids.length;
}

const PLACE_KIND: Record<"DM" | "GROUP" | "CHANNEL", TalkPlaceKind> = { DM: "dm", GROUP: "group", CHANNEL: "channel" };

/** The message this person already sent here with this key, or null. */
async function sentWith(conversationId: string, authorId: string, clientId: string) {
  return prisma.conversationMessage.findFirst({
    where: { conversationId, authorId, clientId },
    include: { author: { select: { id: true, firstName: true, lastName: true, avatar: true } } },
  });
}

/** Mentions of people in this conversation only, never the sender. */
async function validMentions(conversationId: string, me: string, raw: unknown): Promise<string[]> {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const candidate = [...new Set(raw.filter((x): x is string => typeof x === "string"))].slice(0, 50);
  const valid = await prisma.conversationMember.findMany({ where: { conversationId, userId: { in: candidate } }, select: { userId: true } });
  return valid.map((v) => v.userId).filter((uid) => uid !== me);
}

type TalkTeammateEvent =
  | { type: "message"; message: unknown }
  | { type: "answer"; message: unknown }
  | { type: "no_answer"; reason: string }
  | { type: "error"; message: string };

/** The SSE answer: a keep-alive every 15 s, and the turn runs to the end when the client leaves. */
function stream(work: (send: (e: TalkTeammateEvent) => void) => Promise<void>): Response {
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
      const beat = setInterval(() => write(": keepalive\n\n"), 15_000);
      try {
        await work((e) => write(`data: ${JSON.stringify(e)}\n\n`));
      } catch (err) {
        console.error(`[agents] talk stream failed: ${err instanceof Error ? err.message.split("\n").pop() : String(err)}`);
        write(`data: ${JSON.stringify({ type: "error", message: TURN_ERRORS.noAnswer })}\n\n`);
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
      // The client left: the turn keeps running and its answer is posted.
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
