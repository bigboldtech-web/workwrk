import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const orgId = getOrgId(session);

  const cycle = await prisma.reviewCycle.findFirst({
    where: { id, organizationId: orgId },
    include: {
      reviews: {
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

  // Calculate stats
  const total = cycle.reviews.length;
  const selfDone = cycle.reviews.filter((r) => r.status !== "PENDING").length;
  const managerDone = cycle.reviews.filter((r) => ["CALIBRATION", "COMPLETED"].includes(r.status)).length;
  const calibrated = cycle.reviews.filter((r) => r.calibratedScore != null).length;
  const completed = cycle.reviews.filter((r) => r.status === "COMPLETED").length;

  return jsonSuccess({
    ...cycle,
    stats: { total, selfDone, managerDone, calibrated, completed },
  });
}
