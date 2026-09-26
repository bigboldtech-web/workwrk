import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { canManageReviewCycle, cycleSubjectReach } from "@/lib/people/review-cycle-access";

// GET: Get calibration view — all reviews with composite scores
export async function GET(
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

  // Performance data is people data (Phase 6 worst-case rule): the People
  // team and Admin see every row; everyone else, the manager who started
  // the cycle included, sees only the people in their CURRENT reporting
  // chain, so a person who moved to another manager leaves the old one's
  // view. The route used to hand every review in the cycle, org-wide, to
  // any manager. Nobody in reach and not the runner: no calibration view.
  const reach = await cycleSubjectReach(session);
  const chain = reach ? [...reach] : null;
  if (chain && chain.length === 0 && !(await canManageReviewCycle(session, cycle))) {
    return jsonError("Forbidden", 403);
  }

  const reviews = await prisma.review.findMany({
    where: { cycleId, ...(chain ? { subjectId: { in: chain } } : {}) },
    include: {
      subject: {
        select: {
          id: true, firstName: true, lastName: true,
          department: { select: { name: true } },
          role: { select: { title: true } },
        },
      },
      peerFeedback: {
        where: { status: "SUBMITTED" },
        select: { rating: true, collaborationRating: true },
      },
    },
  });

  // Calculate composite scores for each review
  const calibrationData = reviews.map((review) => {
    // KPI achievement (40%)
    const kpiScore = review.kpiScore ?? 0;

    // Manager rating (30%) — convert 1-5 to 0-100 if stored as behavioral avg
    const managerRating = review.managerRating ?? 0;

    // Self rating (15%) — average of KRA self-ratings
    let selfRating = 0;
    if (review.selfRatings) {
      const sr = review.selfRatings as any;
      const kraRatings = sr.kraRatings || [];
      if (kraRatings.length > 0) {
        const avg = kraRatings.reduce((sum: number, r: any) => sum + (r.rating || 0), 0) / kraRatings.length;
        selfRating = Math.round(avg * 20); // Convert 1-5 to 0-100
      }
    }

    // Peer rating (15%) — average of all peer feedback ratings
    const peerRatings = review.peerFeedback
      .map((f) => f.collaborationRating ?? f.rating)
      .filter((r): r is number => r != null);
    const peerRating = peerRatings.length > 0
      ? Math.round((peerRatings.reduce((a, b) => a + b, 0) / peerRatings.length) * 20)
      : 0;

    // Composite: KPI(40%) + Manager(30%) + Self(15%) + Peer(15%)
    const compositeScore = Math.round(
      (kpiScore * 0.4) + (managerRating * 0.3) + (selfRating * 0.15) + (peerRating * 0.15)
    );

    return {
      reviewId: review.id,
      subject: review.subject,
      kpiScore,
      selfRating,
      managerRating,
      peerRating,
      compositeScore,
      calibratedScore: review.calibratedScore,
      calibrationNotes: review.calibrationNotes,
      outcome: review.outcome,
      status: review.status,
    };
  });

  // Bell curve distribution
  const distribution = { top: 0, high: 0, mid: 0, low: 0, bottom: 0 };
  calibrationData.forEach((d) => {
    const score = d.calibratedScore ?? d.compositeScore;
    if (score >= 90) distribution.top++;
    else if (score >= 75) distribution.high++;
    else if (score >= 60) distribution.mid++;
    else if (score >= 40) distribution.low++;
    else distribution.bottom++;
  });

  const allTop = calibrationData.every((d) => (d.calibratedScore ?? d.compositeScore) >= 75);

  return jsonSuccess({
    cycle,
    calibrationData: calibrationData.sort((a, b) => (b.calibratedScore ?? b.compositeScore) - (a.calibratedScore ?? a.compositeScore)),
    distribution,
    warning: allTop && calibrationData.length > 3 ? "All ratings are in the top band. Consider reviewing calibration for accuracy." : null,
  });
}

// PATCH: Adjust calibration score for a review
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id: cycleId } = await params;
  const body = await req.json();
  const { reviewId, calibratedScore, calibrationNotes } = body;

  if (!reviewId) return jsonError("reviewId is required");
  if (calibratedScore == null) return jsonError("calibratedScore is required");

  // The review must belong to this cycle in this org, and calibrating is the
  // cycle owner's act (the People team, Admin, or the manager who started it).
  const cycle = await prisma.reviewCycle.findFirst({ where: { id: cycleId, organizationId: getOrgId(session) } });
  if (!cycle) return jsonError("Review cycle not found", 404);
  if (!(await canManageReviewCycle(session, cycle))) {
    return jsonError("Only the People team, an Admin or the manager who started this cycle can calibrate it", 403);
  }
  const review = await prisma.review.findFirst({
    where: { id: reviewId, cycleId },
  });
  if (!review) return jsonError("Review not found", 404);
  const reach = await cycleSubjectReach(session);
  if (reach && !reach.has(review.subjectId)) {
    return jsonError("This person no longer reports to you, so their calibration is the People team's", 403);
  }

  const updated = await prisma.review.update({
    where: { id: reviewId },
    data: {
      calibratedScore,
      calibrationNotes: calibrationNotes ?? undefined,
      status: "CALIBRATION",
      calibratedById: getUserId(session),
      calibratedAt: new Date(),
    },
  });

  // Update cycle status to IN_CALIBRATION if not already
  await prisma.reviewCycle.update({
    where: { id: cycleId },
    data: { status: "IN_CALIBRATION" },
  });

  return jsonSuccess(updated);
}
