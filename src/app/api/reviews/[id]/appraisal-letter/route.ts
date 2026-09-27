import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { cycleViewerCtx, orgScoring } from "@/lib/performance/review-cycle.server";
import { bandOf } from "@/lib/performance/review-cycle";

// GET /api/reviews/[cycleId]/appraisal-letter?reviewId=: the letter for one
// completed review. The route takes the CYCLE id like every sibling route,
// with the review in ?reviewId= (spec-teams-performance /reviews/[id] Data:
// the client called it with a review id while every sibling passes a cycle
// id). A call with no ?reviewId= still reads [id] as a review id, for one
// release, so an old link keeps working.
//
// Readers: the subject, the reviewer, anyone above the subject in the chain,
// the People team and Admin. The band is the org's own (Settings > Scoring
// and reviews > Performance bands), not a fifth hard-coded table.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const orgId = getOrgId(session);
  const callerId = getUserId(session);
  const qReview = new URL(req.url).searchParams.get("reviewId");
  const reviewId = qReview ?? id;

  const review = await prisma.review.findFirst({
    // Org-scoped: an appraisal letter carries a person's PII + comp data,
    // so it must never resolve a review from another organization.
    where: { id: reviewId, subject: { organizationId: orgId }, ...(qReview ? { cycleId: id } : {}) },
    include: {
      subject: {
        select: {
          id: true, firstName: true, lastName: true, email: true, joinDate: true,
          department: { select: { name: true } },
          role: { select: { title: true } },
        },
      },
      reviewer: { select: { id: true, firstName: true, lastName: true, role: { select: { title: true } } } },
      cycle: { select: { name: true, type: true, startDate: true, endDate: true } },
    },
  });

  if (!review) return jsonError("Review not found", 404);
  if (review.status !== "COMPLETED") return jsonError("Review not yet completed", 400);

  // Authorize: only the subject, the reviewer, or someone with manage rights
  // over the subject (self / report tree / org-wide) may read the letter.
  const isSubject = review.subject?.id === callerId;
  const isReviewer = review.reviewer?.id === callerId;
  const ctx = await cycleViewerCtx();
  const above = !!ctx && (ctx.peopleTeamOrAdmin || ctx.chain.has(review.subjectId));
  if (!isSubject && !isReviewer && !above) {
    return jsonError("You can only view appraisal letters for yourself or your reports.", 403);
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true, logo: true },
  });

  // Get performance score
  const perfScore = await prisma.performanceScore.findFirst({
    where: { userId: review.subjectId },
    orderBy: { period: "desc" },
  });

  // The performance band from the org's bands, and the increment ladder by
  // the band's rank (top band first), so a renamed band keeps its ladder.
  const score = review.overallScore ?? review.calibratedScore ?? review.compositeScore ?? 0;
  const scoring = await orgScoring(orgId);
  const found = bandOf(score, scoring.bands);
  const band = found?.label ?? "";
  const rank = found ? [...scoring.bands].sort((a, b) => b.min - a.min).findIndex((b) => b.label === found.label && b.min === found.min) : -1;
  const LADDER = [
    { min: 15, max: 25, label: "15-25%" },
    { min: 10, max: 15, label: "10-15%" },
    { min: 5, max: 10, label: "5-10%" },
    { min: 0, max: 5, label: "0-5%" },
  ];
  const hike = rank >= 0 && rank < LADDER.length ? LADDER[rank] : { min: 0, max: 0, label: "No hike recommended" };

  // Extract assessment details (Json columns → indexable record).
  const managerAssessment = review.managerAssessment as Record<string, unknown> | null;
  const selfRatings = review.selfRatings as Record<string, unknown> | null;

  const letter = {
    // Company
    companyName: org?.name || "Company",
    companyLogo: org?.logo || null,

    // Employee
    employeeName: `${review.subject.firstName} ${review.subject.lastName}`,
    employeeEmail: review.subject.email,
    department: review.subject.department?.name || "",
    role: review.subject.role?.title || "",
    joinDate: review.subject.joinDate,

    // Review
    cycleName: review.cycle.name,
    cycleType: review.cycle.type,
    periodStart: review.cycle.startDate,
    periodEnd: review.cycle.endDate,
    reviewerName: review.reviewer ? `${review.reviewer.firstName} ${review.reviewer.lastName}` : "",
    reviewerRole: review.reviewer?.role?.title || "",

    // Scores
    overallScore: score,
    performanceBand: band,
    outcome: review.outcome,
    compositeScore: perfScore?.score || null,

    // Hike
    hikeRecommendation: hike,

    // Assessment Details
    managerComments: managerAssessment?.overallComments || "",
    recommendation: managerAssessment?.recommendation || "",
    kraRatings: managerAssessment?.kraRatings || [],
    behavioralRatings: managerAssessment?.behavioral || {},

    // Self
    selfReflection: selfRatings?.reflection || {},

    // Metadata
    generatedAt: new Date().toISOString(),
    reviewId: review.id,
  };

  return jsonSuccess(letter);
}
