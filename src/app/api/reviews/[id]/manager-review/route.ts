import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";

// GET: Get all reviews where current user is the reviewer (team reviews)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id: cycleId } = await params;
  const userId = getUserId(session);

  const reviews = await prisma.review.findMany({
    where: { cycleId, reviewerId: userId },
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

  return jsonSuccess(reviews);
}

// PATCH: Submit manager review for a specific reviewee
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id: cycleId } = await params;
  const userId = getUserId(session);

  const body = await req.json();
  const { reviewId, managerAssessment, managerRating, managerComments, outcome, submit } = body;

  if (!reviewId) return jsonError("reviewId is required");

  const review = await prisma.review.findFirst({
    where: { id: reviewId, cycleId, reviewerId: userId },
  });

  if (!review) return jsonError("Review not found or you are not the reviewer", 404);
  if (review.status === "COMPLETED") {
    return jsonError("Review already completed");
  }

  // managerAssessment: {
  //   kraRatings: [{kraId, kraName, rating, comments}],
  //   behavioral: {quality, reliability, collaboration, initiative, growth},
  //   overallComments: string,
  //   recommendation: string
  // }

  // Calculate average of behavioral ratings if provided
  let avgManagerRating = managerRating;
  if (!avgManagerRating && managerAssessment?.behavioral) {
    const b = managerAssessment.behavioral;
    const ratings = [b.quality, b.reliability, b.collaboration, b.initiative, b.growth].filter((r: any) => r != null);
    if (ratings.length > 0) {
      avgManagerRating = Math.round((ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length) * 20); // Convert 1-5 to 0-100
    }
  }

  const updated = await prisma.review.update({
    where: { id: reviewId },
    data: {
      managerAssessment: managerAssessment ?? undefined,
      managerRating: avgManagerRating ?? undefined,
      managerComments: managerComments ?? undefined,
      outcome: submit ? (outcome ?? undefined) : undefined,
      status: submit ? "MANAGER_REVIEW" : review.status,
    },
  });

  // Notify employee if submitted
  if (submit) {
    await prisma.notification.create({
      data: {
        title: "Manager Review Submitted",
        message: `Your manager has completed their review for ${review.cycleId}.`,
        type: "REVIEW",
        link: `/reviews/${cycleId}`,
        userId: review.subjectId,
      },
    });
  }

  return jsonSuccess(updated);
}
