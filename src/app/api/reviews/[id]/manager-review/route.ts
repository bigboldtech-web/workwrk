// /api/reviews/[id]/manager-review: the Manager review (spec-teams-performance
// /reviews/[id] Team and the manager review drawer).
//
// GET            the reviews the caller writes in this cycle (reviewerId =
//                caller), kept for API callers.
// GET ?subjectId= one person's review for the drawer: the review, their self
//                review, their peer feedback (anonymous to everyone but the
//                People team and Admin; a peer's written answers are shown
//                to the manager, never to the subject), their KRAs, the
//                numbers the system already knows for the cycle window,
//                and `canWrite`. Readers: the reviewer, anyone above the
//                subject in the chain, the People team and Admin. Never the
//                subject (their own review lives in My review).
// PATCH          { reviewId, managerAssessment, managerComments, outcome?,
//                submit }: the reviewer only. Ratings are 1 to 5, the
//                outcome one of the five (Exit recommendation included), and
//                a submitted review is frozen once calibration starts
//                (review-cycle.ts managerMayWrite).

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { cycleViewerCtx, orgScoring, reviewMetrics } from "@/lib/performance/review-cycle.server";
import { cleanManagerAssessment, isOutcome, managerMayWrite, managerRatingFrom } from "@/lib/performance/review-cycle";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id: cycleId } = await params;
  const userId = getUserId(session);
  const orgId = getOrgId(session);
  const subjectId = new URL(req.url).searchParams.get("subjectId");

  if (subjectId) {
    const ctx = await cycleViewerCtx();
    if (!ctx || ctx.isGuest) return jsonError("Not found", 404);
    const review = await prisma.review.findFirst({
      where: { cycleId, subjectId, cycle: { organizationId: orgId } },
      include: {
        cycle: { select: { id: true, name: true, status: true, startDate: true, endDate: true } },
        subject: {
          select: {
            id: true, firstName: true, lastName: true, email: true, avatar: true,
            department: { select: { name: true } },
            role: { select: { title: true } },
          },
        },
        reviewer: { select: { id: true, firstName: true, lastName: true } },
        peerFeedback: {
          select: {
            id: true, status: true, anonymous: true, rating: true, collaborationRating: true,
            strengths: true, improvements: true, comments: true,
            giver: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    });
    if (!review || subjectId === ctx.userId) return jsonError("Not found", 404);
    const allowed = ctx.peopleTeamOrAdmin || review.reviewerId === ctx.userId || ctx.chain.has(subjectId);
    if (!allowed) return jsonError("Not found", 404);

    const [kras, metrics, scoring] = await Promise.all([
      prisma.kRAAssignment.findMany({
        where: { userId: subjectId, status: "ACTIVE", kra: { organizationId: orgId } },
        select: { weightage: true, kra: { select: { id: true, name: true, weight: true } } },
        orderBy: { kra: { name: "asc" } },
      }),
      reviewMetrics(subjectId, orgId, { start: review.cycle.startDate, end: review.cycle.endDate }),
      orgScoring(orgId),
    ]);
    const submittedPeers = review.peerFeedback.filter((pf) => pf.status === "SUBMITTED");
    return jsonSuccess({
      review: { ...review, peerFeedback: undefined },
      peerFeedback: submittedPeers.map((pf) => (pf.anonymous && !ctx.peopleTeamOrAdmin ? { ...pf, giver: null } : pf)),
      peersAsked: review.peerFeedback.length,
      kras: kras.map((k) => ({ id: k.kra.id, name: k.kra.name, weight: k.weightage || k.kra.weight || null })),
      metrics,
      scale: scoring.scale,
      canWrite: review.reviewerId === ctx.userId && managerMayWrite(review.cycle.status, review.status),
    });
  }

  const reviews = await prisma.review.findMany({
    where: { cycleId, reviewerId: userId, cycle: { organizationId: orgId } },
    include: {
      subject: {
        select: {
          id: true, firstName: true, lastName: true, email: true,
          department: { select: { name: true } },
          role: { select: { title: true } },
        },
      },
      peerFeedback: {
        where: { status: "SUBMITTED" },
        select: {
          rating: true, strengths: true, improvements: true,
          collaborationRating: true, anonymous: true,
          giver: { select: { firstName: true, lastName: true } },
        },
      },
    },
    orderBy: { subject: { firstName: "asc" } },
  });

  // An anonymous peer stays anonymous to the manager too.
  return jsonSuccess(
    reviews.map((r) => ({
      ...r,
      peerFeedback: r.peerFeedback.map((pf) => (pf.anonymous ? { ...pf, giver: null } : pf)),
    })),
  );
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  // The gate is the row itself: only the reviewer recorded on this review
  // (the subject's manager at launch) may write it, whatever their access
  // level.

  const { id: cycleId } = await params;
  const userId = getUserId(session);

  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const reviewId = typeof body.reviewId === "string" ? body.reviewId : "";
  const submit = body.submit === true;
  if (!reviewId) return jsonError("reviewId is required");
  if (body.outcome !== undefined && body.outcome !== null && body.outcome !== "" && !isOutcome(body.outcome)) {
    return jsonError("Unknown outcome", 400);
  }

  const review = await prisma.review.findFirst({
    where: { id: reviewId, cycleId, reviewerId: userId, cycle: { organizationId: getOrgId(session) } },
    include: { cycle: { select: { status: true, name: true } } },
  });
  if (!review) return jsonError("Review not found or you are not the reviewer", 404);
  if (!managerMayWrite(review.cycle.status, review.status)) {
    return jsonError(
      review.status === "COMPLETED" || review.cycle.status === "COMPLETED" || review.cycle.status === "CANCELLED"
        ? "This review is closed"
        : "Calibration has started, so a submitted manager review can no longer change",
      409,
    );
  }

  const assessment = cleanManagerAssessment(body.managerAssessment);
  const outcome = isOutcome(body.outcome) ? (body.outcome as string) : assessment.recommendation || null;
  if (submit && !outcome) return jsonError("Pick an outcome before you submit", 400);
  const managerRating = managerRatingFrom(assessment.behavioral);
  const comments = typeof body.managerComments === "string" ? body.managerComments.slice(0, 10_000) : assessment.overallComments;

  const nextStatus = submit ? "MANAGER_REVIEW" : review.status;
  const updated = await prisma.review.update({
    where: { id: reviewId },
    data: {
      managerAssessment: { ...assessment, overallComments: comments, recommendation: outcome ?? "" },
      managerRating: managerRating ?? undefined,
      managerComments: comments,
      ...(submit ? { outcome: outcome as "PROMOTION_ELIGIBLE" | "HIKE_ELIGIBLE" | "STATUS_QUO" | "PIP_REQUIRED" | "EXIT_RECOMMENDATION" } : {}),
      status: nextStatus,
    },
  });

  // The subject learns that it is written, never what (they read it once
  // the cycle is finalized).
  if (submit && review.status !== "MANAGER_REVIEW" && review.subjectId !== userId) {
    await prisma.notification.create({
      data: {
        title: `Your manager review for ${review.cycle.name} is in`,
        message: "You will see the result when the cycle is finalized.",
        type: "review",
        link: `/reviews/${cycleId}`,
        userId: review.subjectId,
      },
    }).catch((e: unknown) => console.error("manager review notification", e));
  }

  return jsonSuccess(updated);
}
