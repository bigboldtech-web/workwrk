import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getUserId, jsonError } from "@/lib/api-helpers";
import { subjectRowView } from "@/lib/people/review-visibility";

/**
 * The most messages of one teammate chat the export carries, newest kept
 * (review round 3 of Phase 3): one chat can run to tens of thousands of
 * rows, and the export is one response. A chat cut says how many it left
 * out, so the copy never reads as whole when it is not. Not exported: a
 * route file exports its handlers only.
 */
const TEAMMATE_CHAT_EXPORT_MAX = 5_000;

/**
 * The most teammate chat messages the whole export carries, across every
 * teammate and group chat (review round 4 of Phase 3): with only the per chat
 * cap, a person with many long chats read them all at once, side by side,
 * and the export could fail or run the server out of memory. Chats are read
 * one at a time, the most recently active first, each taking its newest
 * messages up to what is left of this and of TEAMMATE_CHAT_EXPORT_MAX; each
 * says how many it left out.
 */
const TEAMMATE_CHATS_EXPORT_BUDGET = 20_000;

/**
 * The most requests a teammate asked the person to approve that the export
 * carries, newest kept, with how many it left out (review round 4 of Phase
 * 3): each holds what it would send, an email's whole body among them.
 */
const TEAMMATE_REQUESTS_EXPORT_MAX = 5_000;

/** The chats with AI teammates: one per teammate, and the group chats (src/lib/agents/group-server.ts GROUP_KIND). */
const TEAMMATE_CHAT_KINDS = ["TEAMMATE", "TEAMMATE_GROUP"];

/**
 * The most characters of one tool call's input a teammate chat message
 * carries, its JSON cut there and marked (review round 5 of Phase 3). A
 * call's result is left out altogether (TOOL_CALLS_NOTE).
 */
const TEAMMATE_TOOL_INPUT_EXPORT_MAX = 2_000;

/**
 * The most bytes the teammate chat messages and requests add to the export
 * together, counted as the UTF-8 length of each row as exported (review
 * round 5 of Phase 3): a cap on rows alone let 20,000 messages, each holding
 * whole tool results, reach gigabytes in one response. Requests take it
 * first, then chats, most recently active first; once it runs out no more
 * rows are taken, and each list says how many it left out.
 */
const TEAMMATE_EXPORT_BYTE_BUDGET = 50 * 1024 * 1024;

/** Rows read at once from one chat or the requests: whole tool results are read, then dropped, a page at a time. */
const TEAMMATE_EXPORT_PAGE = 100;

/** The most activity rows and notifications the export carries, each the newest, with how many it left out (review round 5 of Phase 3). */
const ACTIVITY_EXPORT_MAX = 10_000;
const NOTIFICATIONS_EXPORT_MAX = 10_000;

/** The top-level reads run this many at a time, never all at once (review round 5 of Phase 3). */
const EXPORT_READS_AT_ONCE = 5;

/** What the export says beside the teammate chats about their tool calls (review round 5 of Phase 3). */
const TOOL_CALLS_NOTE = `Each teammate message's tool calls show the tool, whether it failed and what it was asked, cut at ${TEAMMATE_TOOL_INPUT_EXPORT_MAX.toLocaleString("en-US")} characters. What a tool returned is left out: those are your workspace's records the tool read, which can hold other people's data.`;

/** The UTF-8 length of a row as the export writes it. */
const bytesOf = (row: unknown): number => Buffer.byteLength(JSON.stringify(row) ?? "", "utf8");

/** A teammate chat message's tool calls as exported: name, whether it failed, the input cut at TEAMMATE_TOOL_INPUT_EXPORT_MAX. */
function exportedCalls(raw: unknown): Array<{ name: string | null; failed: boolean; input: unknown; inputCut?: true }> | null {
  if (!Array.isArray(raw)) return null;
  return raw.map((c) => {
    const call = c && typeof c === "object" ? (c as Record<string, unknown>) : {};
    const name = typeof call.name === "string" ? call.name : null;
    const failed = call.state === "failed" || (call.state === undefined && typeof call.errorText === "string" && call.errorText.length > 0);
    const text = call.input === undefined || call.input === null ? null : JSON.stringify(call.input);
    if (text === null || text === undefined) return { name, failed, input: null };
    if (text.length <= TEAMMATE_TOOL_INPUT_EXPORT_MAX) return { name, failed, input: call.input };
    return { name, failed, input: text.slice(0, TEAMMATE_TOOL_INPUT_EXPORT_MAX), inputCut: true as const };
  });
}

type Reads = ReadonlyArray<() => Promise<unknown>>;

/** Run the reads EXPORT_READS_AT_ONCE at a time, answers in their order. */
async function inGroups<T extends Reads>(reads: T): Promise<{ -readonly [K in keyof T]: T[K] extends () => Promise<infer R> ? R : never }> {
  const out: unknown[] = [];
  for (let i = 0; i < reads.length; i += EXPORT_READS_AT_ONCE) {
    out.push(...(await Promise.all(reads.slice(i, i + EXPORT_READS_AT_ONCE).map((read) => read()))));
  }
  return out as { -readonly [K in keyof T]: T[K] extends () => Promise<infer R> ? R : never };
}

/**
 * GDPR Article 15 / CCPA Right to Know — exports a copy of the requester's
 * personal data as JSON. Rate-limited by sessionless auth and scoped strictly
 * to the requesting user.
 *
 * AI TEAMMATES' RECORDS ARE IN IT (review round 3 of Phase 3): the person's
 * Google connections for their teammates (the account's address, products,
 * status and dates; never a token, sealed or not), what they allowed each
 * teammate (AgentPersonSetting), every request a teammate asked them to
 * approve with what it would send or change (AgentAction), and their chats
 * with their teammates, each at most TEAMMATE_CHAT_EXPORT_MAX messages.
 * Since review round 4, at most TEAMMATE_CHATS_EXPORT_BUDGET chat messages
 * and TEAMMATE_REQUESTS_EXPORT_MAX requests in all, newest kept, each list
 * saying how many it left out.
 *
 * BOUNDED IN BYTES TOO (review round 5 of Phase 3). A teammate message's
 * call record holds whole tool results, so the rows alone could reach
 * gigabytes, and activity rows and notifications had no cap at all. A tool
 * call now carries its name, whether it failed and its input cut at
 * TEAMMATE_TOOL_INPUT_EXPORT_MAX, never its result (the workspace's records
 * the tool read, which can hold other people's data; TOOL_CALLS_NOTE says
 * so in the export); messages and requests share TEAMMATE_EXPORT_BYTE_BUDGET,
 * read a page at a time; activity rows and notifications keep the newest
 * ACTIVITY_EXPORT_MAX and NOTIFICATIONS_EXPORT_MAX; and the reads run
 * EXPORT_READS_AT_ONCE at a time.
 */
export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const userId = getUserId(session);

  try {
    const [
      user,
      notificationsNewest,
      notificationsTotal,
      kpiRecords,
      kraAssignments,
      reviewsAsSubject,
      reviewsAsReviewer,
      feedbackGiven,
      feedbackReceived,
      meetingAttendances,
      actionItems,
      checkIns,
      kudosGiven,
      kudosReceived,
      ideasSubmitted,
      ideaVotes,
      ideaComments,
      activityLogsNewest,
      activityLogsTotal,
      consentRecords,
      teammateConnections,
      teammateSettings,
      teammateRequestsTotal,
      teammateChats,
      teammateMemories,
      teammateRoutines,
    ] = await inGroups([
      () =>
        prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true, email: true, firstName: true, lastName: true,
            avatar: true, phone: true, dateOfBirth: true, status: true,
            joinDate: true, createdAt: true, updatedAt: true,
            organizationId: true, accessLevel: true,
          },
        }),
      // The newest NOTIFICATIONS_EXPORT_MAX, and how many there are.
      () => prisma.notification.findMany({ where: { userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: NOTIFICATIONS_EXPORT_MAX }),
      () => prisma.notification.count({ where: { userId } }),
      () => prisma.kPIRecord.findMany({ where: { userId } }),
      () => prisma.kRAAssignment.findMany({ where: { userId } }),
      () => prisma.review.findMany({ where: { subjectId: userId } }),
      () => prisma.review.findMany({ where: { reviewerId: userId } }),
      () => prisma.peerFeedback.findMany({ where: { giverId: userId } }),
      () => prisma.peerFeedback.findMany({ where: { receiverId: userId } }),
      () => prisma.meetingAttendee.findMany({ where: { userId } }),
      () => prisma.actionItem.findMany({ where: { assigneeId: userId } }),
      () => prisma.checkIn.findMany({ where: { userId } }),
      () => prisma.kudos.findMany({ where: { giverId: userId } }),
      () => prisma.kudos.findMany({ where: { receiverId: userId } }),
      () => prisma.idea.findMany({ where: { submitterId: userId } }),
      () => prisma.ideaVote.findMany({ where: { userId } }),
      () => prisma.ideaComment.findMany({ where: { userId } }),
      // The newest ACTIVITY_EXPORT_MAX, and how many there are.
      () => prisma.activityLog.findMany({ where: { actorId: userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: ACTIVITY_EXPORT_MAX }),
      () => prisma.activityLog.count({ where: { actorId: userId } }),
      () => prisma.consentRecord.findMany({ where: { userId } }),
      // Never the sealed tokens: what the person can be shown of a connection.
      () =>
        prisma.teammateConnection.findMany({
          where: { userId },
          orderBy: { connectedAt: "asc" },
          select: { organizationId: true, provider: true, products: true, accountEmail: true, status: true, connectedAt: true, lastUsedAt: true },
        }),
      () =>
        prisma.agentPersonSetting.findMany({
          where: { userId },
          select: { agentId: true, connectorProducts: true, approvalRules: true, createdAt: true, updatedAt: true, agent: { select: { name: true, organizationId: true } } },
        }),
      // How many requests there are; the newest are read a page at a time below.
      () => prisma.agentAction.count({ where: { actingForId: userId } }),
      // The most recently active first: they take the message budget first.
      () =>
        prisma.chatSession.findMany({
          where: { userId, kind: { in: TEAMMATE_CHAT_KINDS } },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          select: { id: true, organizationId: true, kind: true, title: true, agentId: true, createdAt: true, updatedAt: true },
        }),
      // What the person's teammates remember about them (person scope), and
      // the routines that work as them (lead, after review round 3 of Phase 3).
      () =>
        prisma.agentMemory.findMany({
          where: { scope: "person", scopeId: userId },
          orderBy: { createdAt: "asc" },
          select: { key: true, value: true, source: true, createdAt: true, updatedAt: true, agent: { select: { name: true, organizationId: true } } },
        }),
      () =>
        prisma.agentRoutine.findMany({
          where: { actingForId: userId },
          orderBy: { createdAt: "asc" },
          select: { name: true, prompt: true, schedule: true, status: true, createdAt: true, lastRunAt: true, agent: { select: { name: true, organizationId: true } } },
        }),
    ] as const);

    // What is left of TEAMMATE_EXPORT_BYTE_BUDGET; once a row would pass
    // it, no more rows are taken (see the constant).
    let bytesLeft = TEAMMATE_EXPORT_BYTE_BUDGET;
    let bytesOut = false;
    const take = (row: unknown): boolean => {
      if (bytesOut) return false;
      const size = bytesOf(row);
      if (size > bytesLeft) {
        bytesOut = true;
        return false;
      }
      bytesLeft -= size;
      return true;
    };

    // The requests first: the newest, a page at a time, at most
    // TEAMMATE_REQUESTS_EXPORT_MAX, oldest first in the export. What each
    // would send or change, as the person approved it when they changed it
    // on the card (editedInput), else as asked.
    const requestsNewest = [];
    let requestCursor: string | null = null;
    while (requestsNewest.length < TEAMMATE_REQUESTS_EXPORT_MAX && !bytesOut) {
      const want = Math.min(TEAMMATE_EXPORT_PAGE, TEAMMATE_REQUESTS_EXPORT_MAX - requestsNewest.length);
      const page: Array<{
        id: string; organizationId: string; agentId: string | null; toolName: string; status: string; preview: unknown; input: unknown; editedInput: unknown;
        createdAt: Date; decidedAt: Date | null; executedAt: Date | null; expiresAt: Date;
      }> = await prisma.agentAction.findMany({
        where: { actingForId: userId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: want,
        ...(requestCursor ? { cursor: { id: requestCursor }, skip: 1 } : {}),
        select: {
          id: true, organizationId: true, agentId: true, toolName: true, status: true, preview: true, input: true, editedInput: true,
          createdAt: true, decidedAt: true, executedAt: true, expiresAt: true,
        },
      });
      for (const r of page) {
        const row = {
          id: r.id,
          organizationId: r.organizationId,
          agentId: r.agentId,
          tool: r.toolName,
          status: r.status,
          title: typeof (r.preview as { title?: unknown } | null)?.title === "string" ? (r.preview as { title: string }).title : null,
          input: r.editedInput ?? r.input,
          createdAt: r.createdAt,
          decidedAt: r.decidedAt,
          executedAt: r.executedAt,
          expiresAt: r.expiresAt,
        };
        if (!take(row)) break;
        requestsNewest.push(row);
      }
      if (page.length < want) break;
      requestCursor = page[page.length - 1].id;
    }
    const teammateRequests = requestsNewest.reverse();

    // Then each chat's newest messages, oldest first, and how many were left
    // out: one chat at a time, a page at a time, within what is left of the
    // row budget (TEAMMATE_CHATS_EXPORT_BUDGET) and the byte budget. A chat
    // past either is still listed, every message counted as left out.
    const chats = [];
    let rowsLeft = TEAMMATE_CHATS_EXPORT_BUDGET;
    for (const c of teammateChats) {
      const total = await prisma.chatMessage.count({ where: { sessionId: c.id } });
      const wanted = bytesOut ? 0 : Math.min(TEAMMATE_CHAT_EXPORT_MAX, rowsLeft, total);
      const newest = [];
      let cursor: string | null = null;
      while (newest.length < wanted && !bytesOut) {
        const want = Math.min(TEAMMATE_EXPORT_PAGE, wanted - newest.length);
        const page: Array<{ id: string; role: string; kind: string | null; content: string; toolCalls: unknown; createdAt: Date }> = await prisma.chatMessage.findMany({
          where: { sessionId: c.id },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: want,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          select: { id: true, role: true, kind: true, content: true, toolCalls: true, createdAt: true },
        });
        for (const m of page) {
          const row = { id: m.id, role: m.role, kind: m.kind, content: m.content, toolCalls: exportedCalls(m.toolCalls), createdAt: m.createdAt };
          if (!take(row)) break;
          newest.push(row);
        }
        if (page.length < want) break;
        cursor = page[page.length - 1].id;
      }
      rowsLeft -= newest.length;
      const { updatedAt, ...chat } = c;
      chats.push({ ...chat, lastActiveAt: updatedAt, messages: newest.reverse(), messagesLeftOut: Math.max(0, total - newest.length) });
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      legalBasis: "GDPR Art. 15 / CCPA Right to Know",
      subject: user,
      records: {
        // The newest NOTIFICATIONS_EXPORT_MAX, oldest first.
        notifications: [...notificationsNewest].reverse(),
        notificationsLeftOut: Math.max(0, notificationsTotal - notificationsNewest.length),
        kpiRecords,
        kraAssignments,
        // The subject's own rows keep the product's rules (review-visibility):
        // no manager draft, calibration or 9-box potential.
        reviewsAsSubject: reviewsAsSubject.map((r) => subjectRowView(r, userId)),
        reviewsAsReviewer,
        feedbackGiven,
        // DECIDED: the subject reads the aggregate of peer feedback, never
        // the written answers, a single peer's rating or who wrote them.
        feedbackReceived: feedbackReceived.map((f) => ({ ...f, giverId: null, rating: null, collaborationRating: null, strengths: null, improvements: null, comments: null })),
        meetingAttendances,
        actionItems,
        checkIns,
        kudosGiven,
        kudosReceived,
        ideasSubmitted,
        ideaVotes,
        ideaComments,
        // The newest ACTIVITY_EXPORT_MAX, oldest first.
        activityLogs: [...activityLogsNewest].reverse(),
        activityLogsLeftOut: Math.max(0, activityLogsTotal - activityLogsNewest.length),
        consentRecords,
        teammateConnections,
        teammateAllows: teammateSettings.map((t) => ({
          agentId: t.agentId,
          teammate: t.agent?.name ?? null,
          organizationId: t.agent?.organizationId ?? null,
          googleProductsAllowed: t.connectorProducts,
          approvalRules: t.approvalRules,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        })),
        // Oldest first, the newest TEAMMATE_REQUESTS_EXPORT_MAX within the byte budget.
        teammateRequests,
        teammateRequestsLeftOut: Math.max(0, teammateRequestsTotal - teammateRequests.length),
        // The most recently active first (they took the budget first).
        teammateChats: chats,
        teammateChatsNote: TOOL_CALLS_NOTE,
        teammateMemories: teammateMemories.map((m) => ({
          teammate: m.agent?.name ?? null,
          organizationId: m.agent?.organizationId ?? null,
          key: m.key,
          value: m.value,
          savedFrom: m.source,
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
        })),
        teammateRoutines: teammateRoutines.map((r) => ({
          teammate: r.agent?.name ?? null,
          organizationId: r.agent?.organizationId ?? null,
          name: r.name,
          prompt: r.prompt,
          schedule: r.schedule,
          status: r.status,
          createdAt: r.createdAt,
          lastRunAt: r.lastRunAt,
        })),
      },
    };

    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="workwrk-data-export-${userId}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[export] failed:", err);
    return jsonError("Failed to build export", 500);
  }
}
