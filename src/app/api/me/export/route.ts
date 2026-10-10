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
      teammateRequests,
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
      prisma.agentAction.findMany({
        where: { actingForId: userId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true, organizationId: true, agentId: true, toolName: true, status: true, preview: true, input: true, editedInput: true,
          createdAt: true, decidedAt: true, executedAt: true, expiresAt: true,
        },
      }),
      prisma.chatSession.findMany({
        where: { userId, kind: { in: TEAMMATE_CHAT_KINDS } },
        orderBy: { createdAt: "asc" },
        select: { id: true, organizationId: true, kind: true, title: true, agentId: true, createdAt: true },
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

    // Each chat's newest messages, oldest first, and how many were left out.
    const chats = await Promise.all(
      teammateChats.map(async (c) => {
        const [total, newest] = await Promise.all([
          prisma.chatMessage.count({ where: { sessionId: c.id } }),
          prisma.chatMessage.findMany({
            where: { sessionId: c.id },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: TEAMMATE_CHAT_EXPORT_MAX,
            select: { id: true, role: true, kind: true, content: true, toolCalls: true, createdAt: true },
          }),
        ]);
        return { ...c, messages: newest.reverse(), messagesLeftOut: Math.max(0, total - newest.length) };
      }),
    );

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
