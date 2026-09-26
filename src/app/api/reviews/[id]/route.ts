import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { isHrAdminLevel } from "@/lib/alignment-scope";
import { chainOf, canManageReviewCycle, isPeopleTeamOrAdmin } from "@/lib/people/review-cycle-access";
import { peerAggregate } from "@/lib/people/anonymity";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const orgId = getOrgId(session);
  const callerId = getUserId(session);
  const hrAdmin = isHrAdminLevel(session) || (await isPeopleTeamOrAdmin(session));

  // Below hr-admin the caller sees only review rows they are IN: their
  // own, ones they review, and (managers) their report tree's.
  let reviewsWhere: { OR: Array<Record<string, unknown>> } | undefined;
  let treeIds: string[] = [callerId];
  if (!hrAdmin) {
    // The reporting chain (solid plus dotted), whatever the caller's access
    // level: the same facts the page faces read (reviews/[id]/page.tsx).
    treeIds = [callerId, ...(await chainOf(callerId))];
    reviewsWhere = { OR: [{ subjectId: { in: treeIds } }, { reviewerId: callerId }] };
  }
  const treeSet = new Set(treeIds);

  const cycle = await prisma.reviewCycle.findFirst({
    where: { id, organizationId: orgId },
    include: {
      reviews: {
        ...(reviewsWhere ? { where: reviewsWhere } : {}),
        include: {
          subject: {
            select: {
              id: true, firstName: true, lastName: true, email: true,
              department: { select: { id: true, name: true } },
              role: { select: { id: true, title: true } },
            },
          },
          reviewer: {
            select: { id: true, firstName: true, lastName: true },
          },
          peerFeedback: {
            select: {
              id: true, giverId: true, receiverId: true, rating: true,
              strengths: true, improvements: true, collaborationRating: true,
              comments: true, anonymous: true, status: true,
              giver: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
      },
    },
  });

  if (!cycle) return jsonError("Review cycle not found", 404);

  // A cycle that touches nothing of the caller's (no row of theirs, none
  // they review, nobody in their chain) is not discoverable to them, the
  // same answer as the page's 404: its shell is never returned. Its creator
  // still sees it (a Draft has no rows yet).
  if (!hrAdmin && cycle.reviews.length === 0 && !(await canManageReviewCycle(session, cycle))) {
    return jsonError("Review cycle not found", 404);
  }

  // Peer feedback: below hr-admin, a row is visible only to its giver,
  // its receiver, or a manager with the subject in their tree — and an
  // anonymous giver stays anonymous (field names kept, values nulled).
  const reviews = cycle.reviews.map((review) => {
    // DECIDED (Phase 6): the subject of peer feedback sees the aggregate
    // rating only, and only once four peers have answered (the anonymity
    // floor): never a peer's own row, rating, answers or name. The rows they
    // wrote themselves about someone else are theirs to see.
    if (!hrAdmin && review.subjectId === callerId) {
      return {
        ...review,
        peerFeedback: review.peerFeedback.filter((pf) => pf.giverId === callerId && pf.receiverId !== callerId),
        peerSummary: peerAggregate(review.peerFeedback.filter((pf) => pf.receiverId === callerId)),
      };
    }
    return {
    ...review,
    peerFeedback: review.peerFeedback
      .filter(
        (pf) =>
          hrAdmin ||
          pf.giverId === callerId ||
          pf.receiverId === callerId ||
          treeSet.has(review.subjectId),
      )
      .map((pf) => {
        // DECIDED (Phase 6): the subject of peer feedback sees the aggregate
        // rating only, never the written answers and never who wrote them.
        // The report-tree check above includes the caller themself, so a
        // manager used to read the full text of the feedback about them.
        if (!hrAdmin && pf.receiverId === callerId && pf.giverId !== callerId) {
          return {
            ...pf,
            giverId: null,
            giver: null,
            anonymous: true,
            strengths: null,
            improvements: null,
            comments: null,
          };
        }
        return pf.anonymous && !hrAdmin && pf.giverId !== callerId
          ? { ...pf, giverId: null, giver: null }
          : pf;
      }),
    };
  });

  // Calculate stats
  const total = reviews.length;
  const selfDone = reviews.filter((r) => r.status !== "PENDING").length;
  const managerDone = reviews.filter((r) => ["CALIBRATION", "COMPLETED"].includes(r.status)).length;
  const calibrated = reviews.filter((r) => r.calibratedScore != null).length;
  const completed = reviews.filter((r) => r.status === "COMPLETED").length;

  return jsonSuccess({
    ...cycle,
    reviews,
    stats: { total, selfDone, managerDone, calibrated, completed },
  });
}
