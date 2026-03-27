import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getUserId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";

// GET: Get peer feedback requests for current user (to give) or for a review (as manager)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id: cycleId } = await params;
  const userId = getUserId(session);
  const { searchParams } = new URL(req.url);
  const reviewId = searchParams.get("reviewId");

  // If reviewId provided, get feedback for that review (manager viewing)
  if (reviewId) {
    const feedback = await prisma.peerFeedback.findMany({
      where: { reviewId },
      include: {
        giver: { select: { id: true, firstName: true, lastName: true } },
        receiver: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    return jsonSuccess(feedback);
  }

  // Otherwise, get feedback requests where current user is the giver
  const feedback = await prisma.peerFeedback.findMany({
    where: {
      giverId: userId,
      review: { cycleId },
    },
    include: {
      receiver: { select: { id: true, firstName: true, lastName: true } },
      review: { select: { id: true, cycleId: true, cycle: { select: { name: true } } } },
    },
  });

  return jsonSuccess(feedback);
}

// POST: Request peer feedback (manager selects peers for a reviewee)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id: cycleId } = await params;
  const body = await req.json();
  const { reviewId, peerIds, anonymous } = body;

  if (!reviewId || !peerIds || !Array.isArray(peerIds) || peerIds.length === 0) {
    return jsonError("reviewId and peerIds array are required");
  }

  const review = await prisma.review.findFirst({
    where: { id: reviewId, cycleId },
    include: { cycle: { select: { name: true } }, subject: { select: { firstName: true, lastName: true } } },
  });
  if (!review) return jsonError("Review not found", 404);

  // Create peer feedback records
  const feedbackData = peerIds.map((peerId: string) => ({
    reviewId,
    giverId: peerId,
    receiverId: review.subjectId,
    anonymous: anonymous ?? true,
    status: "PENDING",
  }));

  await prisma.peerFeedback.createMany({
    data: feedbackData,
    skipDuplicates: true,
  });

  // Notify peers
  const notifications = peerIds.map((peerId: string) => ({
    title: "Peer Feedback Requested",
    message: `Please provide feedback for ${review.subject.firstName} ${review.subject.lastName} as part of ${review.cycle.name}.`,
    type: "REVIEW",
    link: `/reviews/${cycleId}`,
    userId: peerId,
  }));

  await prisma.notification.createMany({ data: notifications });

  return jsonSuccess({ message: `${peerIds.length} peer feedback requests created` }, 201);
}

// PATCH: Submit peer feedback
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id: cycleId } = await params;
  const userId = getUserId(session);
  const body = await req.json();
  const { feedbackId, strengths, improvements, collaborationRating, comments } = body;

  if (!feedbackId) return jsonError("feedbackId is required");

  const feedback = await prisma.peerFeedback.findFirst({
    where: { id: feedbackId, giverId: userId, review: { cycleId } },
  });
  if (!feedback) return jsonError("Feedback request not found", 404);
  if (feedback.status === "SUBMITTED") return jsonError("Feedback already submitted");

  const updated = await prisma.peerFeedback.update({
    where: { id: feedbackId },
    data: {
      strengths,
      improvements,
      collaborationRating,
      comments,
      rating: collaborationRating,
      status: "SUBMITTED",
    },
  });

  return jsonSuccess(updated);
}
