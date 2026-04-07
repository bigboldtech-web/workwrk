import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { sendEmail } from "@/lib/email";
import { reviewCompletedTemplate } from "@/lib/email-templates";
import { broadcastWebhook } from "@/lib/webhooks";
import { triggerRecalculation } from "@/services/performanceScoreService";

// POST: Finalize outcomes for reviews in a cycle
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id: cycleId } = await params;
  const orgId = getOrgId(session);

  const cycle = await prisma.reviewCycle.findFirst({
    where: { id: cycleId, organizationId: orgId },
  });
  if (!cycle) return jsonError("Review cycle not found", 404);

  const body = await req.json();
  const { outcomes } = body;
  // outcomes: [{ reviewId, outcome, overallScore }]

  if (!outcomes || !Array.isArray(outcomes)) {
    return jsonError("outcomes array is required");
  }

  // Update each review with its final outcome
  const updates = outcomes.map((o: { reviewId: string; outcome: string; overallScore?: number }) =>
    prisma.review.update({
      where: { id: o.reviewId },
      data: {
        outcome: o.outcome as any,
        overallScore: o.overallScore ?? undefined,
        status: "COMPLETED",
      },
    })
  );

  await Promise.all(updates);

  // Mark cycle as completed
  await prisma.reviewCycle.update({
    where: { id: cycleId },
    data: { status: "COMPLETED" },
  });

  // Notify all employees their review is complete
  const reviews = await prisma.review.findMany({
    where: { cycleId },
    select: { subjectId: true },
  });

  const notifications = reviews.map((r) => ({
    title: "Review Completed",
    message: `Your ${cycle.name} review is complete. View your results.`,
    type: "REVIEW",
    link: `/reviews/${cycleId}`,
    userId: r.subjectId,
  }));

  await prisma.notification.createMany({ data: notifications });

  // Send review completed emails
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const subjectUsers = await prisma.user.findMany({
    where: { id: { in: reviews.map((r) => r.subjectId) } },
    select: { id: true, email: true },
  });

  for (const user of subjectUsers) {
    const { subject, html } = reviewCompletedTemplate({
      reviewCycleName: cycle.name,
      reviewLink: `${baseUrl}/reviews/${cycleId}`,
    });

    try {
      await sendEmail({
        to: user.email,
        subject,
        html,
        template: "review-completed",
        variables: { reviewCycleName: cycle.name },
        organizationId: orgId,
        userId: user.id,
        category: "review",
      });
    } catch (emailErr) {
      console.error("[ReviewFinalize] Email send failed:", emailErr);
    }
  }

  logActivity({
    type: "reviews_finalized",
    actorId: getUserId(session),
    organizationId: orgId,
    description: `Finalized ${outcomes.length} reviews in ${cycle.name}`,
    targetId: cycleId,
    targetType: "review_cycle",
  });

  broadcastWebhook({
    organizationId: orgId,
    event: "reviews_finalized",
    payload: { cycleId, cycleName: cycle.name, reviewCount: outcomes.length },
  });

  // Auto-recalculate performance scores for all reviewed users
  for (const r of reviews) {
    triggerRecalculation(r.subjectId, orgId);
  }

  return jsonSuccess({ message: `${outcomes.length} reviews finalized` });
}
