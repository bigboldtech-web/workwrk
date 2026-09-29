// /api/reviews/[id]/calibration (spec-teams-performance /reviews/[id]
// Calibration).
//
// GET    every review in reach with its numbers: KPI, self, manager, peer,
//        SOP compliance, the composite from Settings > Scoring and reviews >
//        Score weights (a part with no data is left out, never counted as
//        zero), the performance band from Settings > Performance bands, the
//        calibrated score, the 9-box potential and the outcome; plus the
//        distribution over the org's own bands.
// PATCH  { reviewId | reviewIds, calibratedScore?, calibrationNotes?,
//        potential?, outcome? }: the cycle's runner (People team, Admin, the
//        manager who started it), while the cycle is In calibration. A
//        changed score needs a "why". It never moves the cycle: Start
//        calibration and Finalize are the only moves (the old PATCH flipped
//        an Active cycle into calibration on any Adjust click).
//
// Reach: the People team and Admin see every row; anyone else sees the
// people in their CURRENT chain only, so a person who moved to another
// manager leaves the old one's view.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { canManageReviewCycle, cycleSubjectReach, notOwnReview } from "@/lib/people/review-cycle-access";
import { calibrationNumbers, orgScoring, sopScoresFor } from "@/lib/performance/review-cycle.server";
import { bandOf, isOutcome } from "@/lib/performance/review-cycle";
import { logActivity } from "@/lib/activity";

/** The most reviews one bulk calibration change may touch (an enterprise cycle's whole population fits). */
const MAX_BULK_CALIBRATION = 10_000;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id: cycleId } = await params;
  const orgId = getOrgId(session);

  const cycle = await prisma.reviewCycle.findFirst({ where: { id: cycleId, organizationId: orgId } });
  if (!cycle) return jsonError("Review cycle not found", 404);

  const reach = await cycleSubjectReach(session);
  const chain = reach ? [...reach] : null;
  const canManage = await canManageReviewCycle(session, cycle);
  if (chain && chain.length === 0 && !canManage) return jsonError("Forbidden", 403);

  const [reviews, scoring] = await Promise.all([
    prisma.review.findMany({
      where: { cycleId, ...(chain ? { subjectId: { in: chain } } : {}), ...notOwnReview(getUserId(session)) },
      include: {
        subject: {
          select: {
            id: true, firstName: true, lastName: true, avatar: true,
            department: { select: { name: true } },
            role: { select: { title: true } },
          },
        },
        peerFeedback: { where: { status: "SUBMITTED" }, select: { rating: true, collaborationRating: true } },
      },
      orderBy: { subject: { firstName: "asc" } },
    }),
    orgScoring(orgId),
  ]);
  const sop = await sopScoresFor(reviews.map((r) => r.subjectId), { start: cycle.startDate, end: cycle.endDate });

  const rows = reviews.map((review) => {
    const n = calibrationNumbers({
      kpiScore: review.kpiScore ?? null,
      managerRating: review.managerRating ?? null,
      selfRatings: review.selfRatings,
      peerRatings: review.peerFeedback.map((f) => f.collaborationRating ?? f.rating),
      sopScore: sop.get(review.subjectId) ?? null,
    }, scoring.weights);
    const finalScore = review.calibratedScore ?? n.composite;
    return {
      reviewId: review.id,
      subject: review.subject,
      status: review.status,
      kpiScore: n.kpi,
      selfRating: n.self,
      managerRating: n.manager,
      peerRating: n.peer,
      peerCount: review.peerFeedback.length,
      sopScore: n.sop,
      compositeScore: n.composite,
      calibratedScore: review.calibratedScore,
      calibrationNotes: review.calibrationNotes,
      band: bandOf(finalScore, scoring.bands)?.label ?? null,
      potential: review.potential ?? null,
      outcome: review.outcome,
    };
  });

  const distribution = scoring.bands
    .slice()
    .sort((a, b) => b.min - a.min)
    .map((b) => ({ label: b.label, min: b.min, max: b.max, count: rows.filter((r) => r.band === b.label).length }));
  const scored = rows.filter((r) => (r.calibratedScore ?? r.compositeScore) != null);
  const topTwo = new Set(distribution.slice(0, 2).map((d) => d.label));
  const allTop = scored.length > 3 && scored.every((r) => r.band && topTwo.has(r.band));

  return jsonSuccess({
    cycle,
    canManage,
    weights: scoring.weights,
    bands: scoring.bands,
    calibrationData: rows,
    distribution,
    warning: allTop ? "Everyone is in the top two bands. Check the calibration before you finalize." : null,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id: cycleId } = await params;
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  // Every selected review, never a silent prefix: a bulk change is all or
  // nothing, so the "Updated N people" the panel shows is always true.
  const ids = Array.isArray(body.reviewIds)
    ? [...new Set(body.reviewIds.filter((x): x is string => typeof x === "string" && x.length > 0))]
    : typeof body.reviewId === "string" ? [body.reviewId] : [];
  if (!ids.length) return jsonError("reviewId is required");
  if (ids.length > MAX_BULK_CALIBRATION) {
    return jsonError(`Select at most ${MAX_BULK_CALIBRATION.toLocaleString("en-US")} people at a time. Nothing was changed.`, 400);
  }

  const hasScore = body.calibratedScore !== undefined && body.calibratedScore !== null;
  const score = hasScore ? Number(body.calibratedScore) : null;
  if (hasScore && (!Number.isFinite(score) || (score as number) < 0 || (score as number) > 120)) return jsonError("The calibrated score must be 0 to 120", 400);
  const notes = typeof body.calibrationNotes === "string" ? body.calibrationNotes.trim().slice(0, 5000) : undefined;
  if (hasScore && !notes) return jsonError("Say why the score changes", 400);
  if (hasScore && ids.length > 1) return jsonError("A calibrated score is set one person at a time", 400);
  const potential = body.potential === undefined || body.potential === null ? undefined : Number(body.potential);
  if (potential !== undefined && ![1, 2, 3].includes(potential)) return jsonError("Potential must be Low, Medium or High", 400);
  const outcome = body.outcome === undefined || body.outcome === null || body.outcome === "" ? undefined : body.outcome;
  if (outcome !== undefined && !isOutcome(outcome)) return jsonError("Unknown outcome", 400);
  if (!hasScore && potential === undefined && outcome === undefined && notes === undefined) return jsonError("Nothing to change", 400);

  const cycle = await prisma.reviewCycle.findFirst({ where: { id: cycleId, organizationId: getOrgId(session) } });
  if (!cycle) return jsonError("Review cycle not found", 404);
  if (!(await canManageReviewCycle(session, cycle))) {
    return jsonError("Only the People team, an Admin or the manager who started this cycle can calibrate it", 403);
  }
  if (cycle.status !== "IN_CALIBRATION") return jsonError("Start calibration first", 409);

  const reviews = await prisma.review.findMany({ where: { id: { in: ids }, cycleId }, select: { id: true, subjectId: true, reviewerId: true, status: true } });
  if (reviews.length !== ids.length) return jsonError("Review not found", 404);
  const me = getUserId(session);
  if (reviews.some((r) => r.subjectId === me)) {
    return jsonError("Your own review is calibrated by someone else", 403);
  }
  const reach = await cycleSubjectReach(session);
  if (reach && reviews.some((r) => !reach.has(r.subjectId))) {
    return jsonError("Some of these people no longer report to you, so their calibration is the People team's", 403);
  }
  if (reviews.some((r) => r.status === "COMPLETED")) return jsonError("A finalized review can no longer change", 409);

  const actor = getUserId(session);
  if (!hasScore && reviews.length > 1) {
    // A bulk change writes the same fields to every row, so one statement
    // covers any selection size atomically.
    await prisma.review.updateMany({
      where: { id: { in: ids }, cycleId, status: { not: "COMPLETED" } },
      data: {
        ...(notes !== undefined ? { calibrationNotes: notes } : {}),
        ...(potential !== undefined ? { potential } : {}),
        ...(outcome !== undefined ? { outcome: outcome as "PROMOTION_ELIGIBLE" | "HIKE_ELIGIBLE" | "STATUS_QUO" | "PIP_REQUIRED" | "EXIT_RECOMMENDATION" } : {}),
      },
    });
  } else await prisma.$transaction(
    reviews.map((r) =>
      prisma.review.update({
        where: { id: r.id },
        data: {
          ...(hasScore ? { calibratedScore: score, status: "CALIBRATION" as const, calibratedById: actor, calibratedAt: new Date() } : {}),
          ...(notes !== undefined ? { calibrationNotes: notes } : {}),
          ...(potential !== undefined ? { potential } : {}),
          ...(outcome !== undefined ? { outcome: outcome as "PROMOTION_ELIGIBLE" | "HIKE_ELIGIBLE" | "STATUS_QUO" | "PIP_REQUIRED" | "EXIT_RECOMMENDATION" } : {}),
        },
      }),
    ),
  );

  logActivity({
    type: "review_cycle.calibrate",
    actorId: actor,
    organizationId: getOrgId(session),
    description: `Calibrated ${reviews.length} ${reviews.length === 1 ? "review" : "reviews"} in ${cycle.name}`,
    targetId: cycle.id,
    targetType: "ReviewCycle",
    metadata: { reviewIds: ids, ...(hasScore ? { calibratedScore: score, notes } : {}), ...(potential !== undefined ? { potential } : {}), ...(outcome !== undefined ? { outcome } : {}) },
  });

  return jsonSuccess({ updated: reviews.length });
}
