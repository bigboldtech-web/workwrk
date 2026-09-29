import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { cycleSubjectReach } from "@/lib/people/review-cycle-access";
import { isPeopleTeamOrAdmin } from "@/lib/people/review-cycle-access";
import { isInReportTree } from "@/lib/reporting-line";
import { peerAllowedWhere } from "@/lib/performance/review-cycle.server";

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
    // Phase 6 (a live anonymity leak): this branch returned every peer
    // feedback row for ANY review id, giver identity included, to any
    // signed-in user. The review must now be in this cycle and this org,
    // the caller must be its reviewer, above its subject in the chain, the
    // cycle's owner (People team, Admin, the manager who started it); the
    // subject never reads this list (they see the aggregate rating on the
    // cycle page), and an anonymous giver stays anonymous to everyone but
    // the People team and Admin.
    const review = await prisma.review.findFirst({
      where: { id: reviewId, cycleId, cycle: { organizationId: getOrgId(session) } },
      select: { id: true, subjectId: true, reviewerId: true },
    });
    if (!review || review.subjectId === userId) return jsonError("Not found", 404);
    const peopleOrAdmin = await isPeopleTeamOrAdmin(session);
    // The cycle's starting manager reads through their CURRENT chain only
    // (isInReportTree), like calibration and finalize (cycleSubjectReach):
    // a report who moved to another manager leaves the old one's reach.
    const allowed = peopleOrAdmin || review.reviewerId === userId || (await isInReportTree(userId, review.subjectId));
    if (!allowed) return jsonError("Not found", 404);
    const feedback = await prisma.peerFeedback.findMany({
      where: { reviewId },
      include: {
        giver: { select: { id: true, firstName: true, lastName: true } },
        receiver: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    return jsonSuccess(
      feedback.map((f) => (f.anonymous && !peopleOrAdmin ? { ...f, giverId: null, giver: null } : f)),
    );
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

  const { id: cycleId } = await params;
  const body = await req.json();
  const { reviewId, peerIds, anonymous } = body;

  if (!reviewId || !peerIds || !Array.isArray(peerIds) || peerIds.length === 0) {
    return jsonError("reviewId and peerIds array are required");
  }

  const orgId = getOrgId(session);
  const review = await prisma.review.findFirst({
    where: { id: reviewId, cycleId, cycle: { organizationId: orgId } },
    include: { cycle: { select: { name: true, status: true } }, subject: { select: { firstName: true, lastName: true } } },
  });
  if (!review) return jsonError("Review not found", 404);
  if (review.cycle.status !== "ACTIVE" && review.cycle.status !== "IN_CALIBRATION") return jsonError("This cycle no longer takes feedback", 409);
  // Who picks the peers: the review's reviewer, anyone with the subject in
  // their reporting chain, or the People team and Admin, whatever their
  // access level (the same facts the /reviews/[id] team face reads).
  const callerId = getUserId(session);
  if (review.reviewerId !== callerId) {
    const reach = await cycleSubjectReach(session);
    if (reach && !reach.has(review.subjectId)) return jsonError("Forbidden", 403);
  }

  // Peers are anyone active in the org but the subject (peerAllowedWhere:
  // the rule before Phase 6, kept so no runner loses who they could ask;
  // the picker SUGGESTS the people who work with them and finds anyone
  // else by name), each once. A bulk request (skipInvalid) keeps the ones
  // that fit this subject and reports the rest instead of failing the batch.
  const requested = [...new Set(peerIds.filter((p: unknown): p is string => typeof p === "string" && p.length > 0))];
  if (requested.length > 5) return jsonError("Ask up to five people at a time", 400);
  const candidate = peerAllowedWhere(orgId, review.subjectId);
  const valid = await prisma.user.findMany({
    where: { AND: [candidate, { id: { in: requested } }] },
    select: { id: true },
  });
  const validPeerIds = valid.map((u) => u.id);
  const skipInvalid = body.skipInvalid === true;
  if (validPeerIds.length === 0) {
    if (skipInvalid) return jsonSuccess({ created: 0, skipped: requested.length }, 200);
    return jsonError("Pick people who are active in your organization, other than the person being reviewed");
  }
  if (!skipInvalid && validPeerIds.length !== requested.length) return jsonError("Some of the people picked have left, or are the person being reviewed");

  // Create peer feedback records
  const feedbackData = validPeerIds.map((peerId: string) => ({
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
  const notifications = validPeerIds.map((peerId: string) => ({
    title: `Feedback on ${review.subject.firstName} ${review.subject.lastName}`.trim(),
    message: `${review.cycle.name}: your name is not shown to them.`,
    type: "review",
    link: `/reviews/${cycleId}?tab=peer`,
    userId: peerId,
  }));

  await prisma.notification.createMany({ data: notifications });

  return jsonSuccess({ message: `${validPeerIds.length} peer feedback requests created`, created: validPeerIds.length, skipped: requested.length - validPeerIds.length }, 201);
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
  if (feedback.status === "SUBMITTED") return jsonError("Feedback already submitted", 409);
  const cyc = await prisma.reviewCycle.findFirst({ where: { id: cycleId, organizationId: getOrgId(session) }, select: { status: true } });
  if (!cyc || (cyc.status !== "ACTIVE" && cyc.status !== "IN_CALIBRATION")) return jsonError("This cycle no longer takes feedback", 409);
  if (typeof collaborationRating !== "number" || !Number.isInteger(collaborationRating) || collaborationRating < 1 || collaborationRating > 5) {
    return jsonError("Rate how they collaborate, 1 to 5", 400);
  }
  const t = (v: unknown) => (typeof v === "string" ? v.slice(0, 10_000) : null);

  const updated = await prisma.peerFeedback.update({
    where: { id: feedbackId },
    data: {
      strengths: t(strengths),
      improvements: t(improvements),
      collaborationRating,
      comments: t(comments),
      rating: collaborationRating,
      status: "SUBMITTED",
    },
  });

  return jsonSuccess(updated);
}
