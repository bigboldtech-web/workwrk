import { canManageReviewCycle, cycleSubjectReach } from "@/lib/people/review-cycle-access";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
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

  const { id: cycleId } = await params;
  const orgId = getOrgId(session);

  const cycle = await prisma.reviewCycle.findFirst({
    where: { id: cycleId, organizationId: orgId },
  });
  if (!cycle) return jsonError("Review cycle not found", 404);
  // Phase 6: the People team and Admin, or the manager who started it.
  if (!(await canManageReviewCycle(session, cycle))) {
    return jsonError("Only the People team, an Admin or the manager who started this cycle can finalize it", 403);
  }

  const body = await req.json();
  const { outcomes } = body;
  // outcomes: [{ reviewId, outcome, overallScore }]

  if (!outcomes || !Array.isArray(outcomes)) {
    return jsonError("outcomes array is required");
  }

  // Every outcome must be a real ReviewOutcome, and every review must
  // belong to THIS cycle: the update used to take any review id in the
  // database, so a finalize could complete another org's review.
  const OUTCOMES = new Set(["PROMOTION_ELIGIBLE", "HIKE_ELIGIBLE", "STATUS_QUO", "PIP_REQUIRED", "EXIT_RECOMMENDATION"]);
  for (const o of outcomes as { outcome?: unknown }[]) {
    if (typeof o?.outcome !== "string" || !OUTCOMES.has(o.outcome)) return jsonError("Unknown outcome", 400);
  }
  // A runner who is not the People team or Admin decides outcomes only for
  // the people who report to them NOW (a PIP or an exit is never set by a
  // former manager).
  const reach = await cycleSubjectReach(session);
  if (reach) {
    const ids = (outcomes as { reviewId?: unknown }[]).map((o) => String(o?.reviewId ?? ""));
    const rows = await prisma.review.findMany({ where: { id: { in: ids }, cycleId }, select: { subjectId: true } });
    if (rows.some((r) => !reach.has(r.subjectId))) {
      return jsonError("Some of these people no longer report to you, so their outcome is the People team's", 403);
    }
  }
  const updates = outcomes.map((o: { reviewId: string; outcome: string; overallScore?: number }) =>
    prisma.review.updateMany({
      where: { id: o.reviewId, cycleId, ...(reach ? { subjectId: { in: [...reach] } } : {}) },
      data: {
        outcome: o.outcome as "PROMOTION_ELIGIBLE" | "HIKE_ELIGIBLE" | "STATUS_QUO" | "PIP_REQUIRED" | "EXIT_RECOMMENDATION",
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
    type: "review",
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

  // Fan out email queuing in parallel — each sendEmail does its own pref
  // check + queue insert, and failures for one recipient must not block
  // the others.
  const { subject, html } = reviewCompletedTemplate({
    reviewCycleName: cycle.name,
    reviewLink: `${baseUrl}/reviews/${cycleId}`,
  });
  await Promise.all(
    subjectUsers.map((user) =>
      sendEmail({
        to: user.email,
        subject,
        html,
        template: "review-completed",
        variables: { reviewCycleName: cycle.name },
        organizationId: orgId,
        userId: user.id,
        category: "review",
      }).catch((emailErr) => {
        console.error("[ReviewFinalize] Email send failed:", emailErr);
      }),
    ),
  );

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
