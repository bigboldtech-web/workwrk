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
 */
export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const userId = getUserId(session);

  try {
    const [
      user,
      notifications,
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
      activityLogs,
      consentRecords,
      teammateConnections,
      teammateSettings,
      teammateRequestsNewest,
      teammateRequestsTotal,
      teammateChats,
      teammateMemories,
      teammateRoutines,
    ] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true, email: true, firstName: true, lastName: true,
          avatar: true, phone: true, dateOfBirth: true, status: true,
          joinDate: true, createdAt: true, updatedAt: true,
          organizationId: true, accessLevel: true,
        },
      }),
      prisma.notification.findMany({ where: { userId } }),
      prisma.kPIRecord.findMany({ where: { userId } }),
      prisma.kRAAssignment.findMany({ where: { userId } }),
      prisma.review.findMany({ where: { subjectId: userId } }),
      prisma.review.findMany({ where: { reviewerId: userId } }),
      prisma.peerFeedback.findMany({ where: { giverId: userId } }),
      prisma.peerFeedback.findMany({ where: { receiverId: userId } }),
      prisma.meetingAttendee.findMany({ where: { userId } }),
      prisma.actionItem.findMany({ where: { assigneeId: userId } }),
      prisma.checkIn.findMany({ where: { userId } }),
      prisma.kudos.findMany({ where: { giverId: userId } }),
      prisma.kudos.findMany({ where: { receiverId: userId } }),
      prisma.idea.findMany({ where: { submitterId: userId } }),
      prisma.ideaVote.findMany({ where: { userId } }),
      prisma.ideaComment.findMany({ where: { userId } }),
      prisma.activityLog.findMany({ where: { actorId: userId } }),
      prisma.consentRecord.findMany({ where: { userId } }),
      // Never the sealed tokens: what the person can be shown of a connection.
      prisma.teammateConnection.findMany({
        where: { userId },
        orderBy: { connectedAt: "asc" },
        select: { organizationId: true, provider: true, products: true, accountEmail: true, status: true, connectedAt: true, lastUsedAt: true },
      }),
      prisma.agentPersonSetting.findMany({
        where: { userId },
        select: { agentId: true, connectorProducts: true, approvalRules: true, createdAt: true, updatedAt: true, agent: { select: { name: true, organizationId: true } } },
      }),
      // The newest, at most TEAMMATE_REQUESTS_EXPORT_MAX, and how many there are.
      prisma.agentAction.findMany({
        where: { actingForId: userId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: TEAMMATE_REQUESTS_EXPORT_MAX,
        select: {
          id: true, organizationId: true, agentId: true, toolName: true, status: true, preview: true, input: true, editedInput: true,
          createdAt: true, decidedAt: true, executedAt: true, expiresAt: true,
        },
      }),
      prisma.agentAction.count({ where: { actingForId: userId } }),
      // The most recently active first: they take the message budget first.
      prisma.chatSession.findMany({
        where: { userId, kind: { in: TEAMMATE_CHAT_KINDS } },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        select: { id: true, organizationId: true, kind: true, title: true, agentId: true, createdAt: true, updatedAt: true },
      }),
      // What the person's teammates remember about them (person scope), and
      // the routines that work as them (lead, after review round 3 of Phase 3).
      prisma.agentMemory.findMany({
        where: { scope: "person", scopeId: userId },
        orderBy: { createdAt: "asc" },
        select: { key: true, value: true, source: true, createdAt: true, updatedAt: true, agent: { select: { name: true, organizationId: true } } },
      }),
      prisma.agentRoutine.findMany({
        where: { actingForId: userId },
        orderBy: { createdAt: "asc" },
        select: { name: true, prompt: true, schedule: true, status: true, createdAt: true, lastRunAt: true, agent: { select: { name: true, organizationId: true } } },
      }),
    ]);

    // Each chat's newest messages, oldest first, and how many were left out:
    // one chat at a time, within what is left of the whole budget (see
    // TEAMMATE_CHATS_EXPORT_BUDGET). A chat past the budget is still listed,
    // every message counted as left out.
    const teammateRequests = [...teammateRequestsNewest].reverse();
    const chats = [];
    let budget = TEAMMATE_CHATS_EXPORT_BUDGET;
    for (const c of teammateChats) {
      const total = await prisma.chatMessage.count({ where: { sessionId: c.id } });
      const take = Math.min(TEAMMATE_CHAT_EXPORT_MAX, budget, total);
      const newest =
        take > 0
          ? await prisma.chatMessage.findMany({
              where: { sessionId: c.id },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take,
              select: { id: true, role: true, kind: true, content: true, toolCalls: true, createdAt: true },
            })
          : [];
      budget -= newest.length;
      const { updatedAt, ...chat } = c;
      chats.push({ ...chat, lastActiveAt: updatedAt, messages: newest.reverse(), messagesLeftOut: Math.max(0, total - newest.length) });
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      legalBasis: "GDPR Art. 15 / CCPA Right to Know",
      subject: user,
      records: {
        notifications,
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
        activityLogs,
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
        // What each request would send or change, as the person approved it
        // when they changed it on the card (editedInput), else as asked.
        // Oldest first, the newest TEAMMATE_REQUESTS_EXPORT_MAX.
        teammateRequests: teammateRequests.map((r) => ({
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
        })),
        teammateRequestsLeftOut: Math.max(0, teammateRequestsTotal - teammateRequests.length),
        // The most recently active first (they took the budget first).
        teammateChats: chats,
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
