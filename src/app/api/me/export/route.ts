import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getUserId, jsonError } from "@/lib/api-helpers";

/**
 * GDPR Article 15 / CCPA Right to Know — exports a copy of the requester's
 * personal data as JSON. Rate-limited by sessionless auth and scoped strictly
 * to the requesting user.
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
    ]);

    const payload = {
      exportedAt: new Date().toISOString(),
      legalBasis: "GDPR Art. 15 / CCPA Right to Know",
      subject: user,
      records: {
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
