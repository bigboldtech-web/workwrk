// /api/reviews/[id]/manager-review: the Manager review (spec-teams-performance
// /reviews/[id] Team and the manager review drawer).
//
// GET            the reviews the caller writes in this cycle, kept for API
//                callers: whoever writes each manager half now
//                (review-cycle.server.ts reviewsWrittenBy), never by an
//                Agent's launch stamp.
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
//
// A review nobody writes (writerFrom answers null: an Agent's stamp with no
// manager above, or a stored loop) is written by the People team and Admins
// until someone is named Reports to (docs-found fixes batch 5). Before, the
// PATCH refused everyone, Admins included, though the drawer said they could.
// Their write leaves the stamp as it is, so the review stays theirs to share
// until followReportingLine moves it to the new manager; never the subject's
// own, and never an Agent's.
//
// Several people write such a review, and each write replaces the whole
// assessment (batch 6): GET answers `managerVersion`, the drawer sends back
// the one it last saw, and a write is refused (409 review_changed) when
// someone else changed the manager half since, so the second writer's save
// never silently erases the first's. The drawer stops saving and keeps the
// text on screen and on the device. A retried write that already landed is
// no conflict. The manager the line names writes alone, unchecked as before.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { cycleViewerCtx, orgScoring, reviewMetrics, reviewerFacts, reviewsWrittenBy, writerFrom } from "@/lib/performance/review-cycle.server";
import { cleanManagerAssessment, isOutcome, isReviewDraft, managerHalfVersion, managerMayWrite, wouldBlankDraft, managerRatingFrom } from "@/lib/performance/review-cycle";

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
            id: true, firstName: true, lastName: true, email: true, avatar: true, managerId: true,
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
    // The writer of an open review is whoever the subject reports to NOW
    // (review-cycle.ts effectiveReviewerId): a former manager keeps no
    // reach through the stamp launch left behind.
    // Never an Agent, who is nobody's manager (reviewerFacts).
    const facts = await reviewerFacts(orgId, [review]);
    const writer = writerFrom({ id: review.id, subjectId: review.subjectId, reviewerId: review.reviewerId, status: review.status, cycleStatus: review.cycle.status }, facts);
    const allowed = ctx.peopleTeamOrAdmin || (!!writer && writer === ctx.userId) || ctx.chain.has(subjectId);
    // Nobody's manager writes it: the People team and Admins do (batch 5).
    const writesUnclaimed = !writer && writesUnclaimedReview(ctx, review.subjectId);
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
    // The drawer names who writes it: the writer, never a stale stamp (an
    // Agent's included), and nobody while nobody does.
    const reviewer = !writer
      ? null
      : writer === review.reviewer.id
        ? review.reviewer
        : await prisma.user.findUnique({ where: { id: writer }, select: { id: true, firstName: true, lastName: true } });
    return jsonSuccess({
      review: { ...review, reviewerId: writer, reviewer, subject: { ...review.subject, managerId: undefined }, peerFeedback: undefined },
      peerFeedback: submittedPeers.map((pf) => (pf.anonymous && !ctx.peopleTeamOrAdmin ? { ...pf, giver: null } : pf)),
      peersAsked: review.peerFeedback.length,
      kras: kras.map((k) => ({ id: k.kra.id, name: k.kra.name, weight: k.weightage || k.kra.weight || null })),
      metrics,
      scale: scoring.scale,
      canWrite: (writer === ctx.userId || writesUnclaimed) && managerMayWrite(review.cycle.status, review.status),
      writesUnclaimed,
      managerVersion: managerHalfVersion(review),
    });
  }

  // Never by the stamp: an Agent's launch stamp lists nothing, and the
  // manager above an Agent lists the reviews of the people under them.
  const written = await reviewsWrittenBy(orgId, userId, { cycleId });
  const reviews = await prisma.review.findMany({
    where: { id: { in: written.map((r) => r.id) }, cycleId, cycle: { organizationId: orgId } },
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

  const found = await prisma.review.findFirst({
    where: { id: reviewId, cycleId, cycle: { organizationId: getOrgId(session) } },
    include: { cycle: { select: { status: true, name: true } }, subject: { select: { managerId: true } } },
  });
  // Only the reviewer the reporting line names today writes it (review-cycle.ts
  // effectiveReviewerId); the stamp is healed to them on this write.
  // Never an Agent, who is nobody's manager (reviewerFacts).
  // The subject only by the launch rule for someone with no manager (writerFrom).
  const facts = found ? await reviewerFacts(getOrgId(session), [found]) : null;
  const writer = found && facts ? writerFrom({ id: found.id, subjectId: found.subjectId, reviewerId: found.reviewerId, status: found.status, cycleStatus: found.cycle.status }, facts) : null;
  // Nobody writes it (writer null): the People team and Admins may (batch 5).
  const unclaimed = !!found && !!facts && writer === null && writesUnclaimedReview(await cycleViewerCtx(), found.subjectId);
  const review = found && facts && (writer === userId || unclaimed) ? found : null;
  if (!review) return jsonError("Review not found or you are not the reviewer", 404);
  if (!managerMayWrite(review.cycle.status, review.status)) {
    return jsonError(
      review.status === "COMPLETED" || review.cycle.status === "COMPLETED" || review.cycle.status === "CANCELLED"
        ? "This review is closed"
        : "Calibration has started, so a submitted manager review can no longer change",
      409,
    );
  }

  // Never overwrite a stored manager draft with nothing (review-cycle.ts isReviewDraft).
  if (!isReviewDraft(body.managerAssessment)) return jsonError("Nothing to save: the review did not arrive. Your draft is unchanged.", 400);
  const assessment = cleanManagerAssessment(body.managerAssessment);
  if (wouldBlankDraft(review.managerAssessment, { ...assessment, overallComments: typeof body.managerComments === "string" ? body.managerComments : assessment.overallComments }, body.allowEmpty === true)) {
    return jsonError("Nothing to save: this would empty the written review. It is unchanged.", 400);
  }
  const outcome = isOutcome(body.outcome) ? (body.outcome as string) : assessment.recommendation || null;
  if (submit && !outcome) return jsonError("Pick an outcome before you submit", 400);
  const managerRating = managerRatingFrom(assessment.behavioral);
  const comments = typeof body.managerComments === "string" ? body.managerComments.slice(0, 10_000) : assessment.overallComments;

  const write = {
    managerAssessment: { ...assessment, overallComments: comments, recommendation: outcome ?? "" },
    // The assessment is replaced whole, so the rating follows it: behaviours
    // cleared means no rating (null), never a stale number the composite
    // and calibration would keep reading.
    managerRating: managerRating ?? null,
    managerComments: comments,
    // The status is written only by a submit (batch 7). A draft save wrote
    // back the status of the first read, so a self review the subject
    // submitted in between (PENDING to SELF_ASSESSMENT) was set back to
    // PENDING, on both paths: the version check passes it on purpose (only
    // the manager half is hashed).
    ...(submit ? { outcome: outcome as "PROMOTION_ELIGIBLE" | "HIKE_ELIGIBLE" | "STATUS_QUO" | "PIP_REQUIRED" | "EXIT_RECOMMENDATION", status: "MANAGER_REVIEW" as const } : {}),
    // The writer the line names takes the stamp; the People team writing
    // an unclaimed review leaves it, so it stays theirs to share.
    ...(!unclaimed && review.reviewerId !== userId ? { reviewerId: userId } : {}),
  };
  const seen = typeof body.managerVersion === "string" ? body.managerVersion : null;
  let updated: Awaited<ReturnType<typeof prisma.review.update>> | null;
  if (unclaimed && seen) {
    // Several writers (batch 6): the write holds only while the manager half
    // is still the one this writer saw, or already is what they write (a
    // retry that landed). Conditioned on the row as read, so a write landing
    // in between is read again, never overwritten.
    const writing = managerHalfVersion(write);
    let done = false;
    for (let attempt = 0; attempt < 3 && !done; attempt += 1) {
      const now = await prisma.review.findUnique({ where: { id: reviewId }, select: { updatedAt: true, managerAssessment: true, managerComments: true } });
      if (!now) return jsonError("Review not found or you are not the reviewer", 404);
      const stored = managerHalfVersion(now);
      if (stored !== seen && stored !== writing) {
        return NextResponse.json(
          { error: "Someone else saved this review while you had it open. Open it again to see theirs", code: "review_changed" },
          { status: 409 },
        );
      }
      done = (await prisma.review.updateMany({ where: { id: reviewId, updatedAt: now.updatedAt }, data: write })).count === 1;
    }
    if (!done) return NextResponse.json({ error: "This review is changing right now. Try again in a moment", code: "review_busy" }, { status: 503, headers: { "Retry-After": "1" } });
    updated = await prisma.review.findUnique({ where: { id: reviewId } });
  } else {
    updated = await prisma.review.update({ where: { id: reviewId }, data: write });
  }
  if (!updated) return jsonError("Review not found or you are not the reviewer", 404);

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

  return jsonSuccess({ ...updated, managerVersion: managerHalfVersion(updated) });
}

/**
 * May this viewer write a review nobody's manager writes? The People team and
 * Admins, never an Agent, and never the subject themselves.
 */
function writesUnclaimedReview(ctx: { userId: string; peopleTeamOrAdmin: boolean; isAgent: boolean; isGuest: boolean } | null, subjectId: string): boolean {
  return !!ctx && ctx.peopleTeamOrAdmin && !ctx.isAgent && !ctx.isGuest && ctx.userId !== subjectId;
}
