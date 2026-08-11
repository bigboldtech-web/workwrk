import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";
import { isHrAdminLevel } from "@/lib/alignment-scope";
import { getTeamUserIds } from "@/lib/team";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const orgId = getOrgId(session);
  const callerId = getUserId(session);
  const hrAdmin = isHrAdminLevel(session);

  // Below hr-admin the caller sees only review rows they are IN: their
  // own, ones they review, and (managers) their report tree's.
  let reviewsWhere: { OR: Array<Record<string, unknown>> } | undefined;
  let treeIds: string[] = [callerId];
  if (!hrAdmin) {
    treeIds = isManager(session) ? await getTeamUserIds(orgId, callerId) : [callerId];
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

  // Peer feedback: below hr-admin, a row is visible only to its giver,
  // its receiver, or a manager with the subject in their tree — and an
  // anonymous giver stays anonymous (field names kept, values nulled).
  const reviews = cycle.reviews.map((review) => ({
    ...review,
    peerFeedback: review.peerFeedback
      .filter(
        (pf) =>
          hrAdmin ||
          pf.giverId === callerId ||
          pf.receiverId === callerId ||
          treeSet.has(review.subjectId),
      )
      .map((pf) =>
        pf.anonymous && !hrAdmin && pf.giverId !== callerId
          ? { ...pf, giverId: null, giver: null }
          : pf,
      ),
  }));

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
