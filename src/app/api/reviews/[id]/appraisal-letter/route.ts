import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

// GET: Generate appraisal letter data for a completed review
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id: reviewId } = await params;
  const orgId = getOrgId(session);

  const review = await prisma.review.findFirst({
    where: { id: reviewId },
    include: {
      subject: {
        select: {
          id: true, firstName: true, lastName: true, email: true, joinDate: true,
          department: { select: { name: true } },
          role: { select: { title: true } },
        },
      },
      reviewer: { select: { firstName: true, lastName: true, role: { select: { title: true } } } },
      cycle: { select: { name: true, type: true, startDate: true, endDate: true } },
    },
  });

  if (!review) return jsonError("Review not found", 404);
  if (review.status !== "COMPLETED") return jsonError("Review not yet completed", 400);

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true, logo: true },
  });

  // Get performance score
  const perfScore = await prisma.performanceScore.findFirst({
    where: { userId: review.subjectId },
    orderBy: { period: "desc" },
  });

  // Get performance band and hike recommendation
  const score = review.overallScore || review.calibratedScore || (review.compositeScore as number) || 0;
  const band = score >= 90 ? "Outstanding" : score >= 80 ? "Exceeds Expectations" : score >= 70 ? "Meets Expectations" : score >= 50 ? "Needs Improvement" : "Below Expectations";

  // Hike recommendation based on band
  const hikeRecommendation: Record<string, { min: number; max: number; label: string }> = {
    "Outstanding": { min: 15, max: 25, label: "15-25%" },
    "Exceeds Expectations": { min: 10, max: 15, label: "10-15%" },
    "Meets Expectations": { min: 5, max: 10, label: "5-10%" },
    "Needs Improvement": { min: 0, max: 5, label: "0-5%" },
    "Below Expectations": { min: 0, max: 0, label: "No hike recommended" },
  };

  const hike = hikeRecommendation[band] || hikeRecommendation["Meets Expectations"];

  // Extract assessment details
  const managerAssessment = review.managerAssessment as any;
  const selfRatings = review.selfRatings as any;

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
