import { canManageReviewCycle, chainOf, isPeopleTeamOrAdmin, mayStartReviewCycles } from "@/lib/people/review-cycle-access";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { isHrAdminLevel } from "@/lib/alignment-scope";
import { parsePaginationParams, paginatedResult, skipTake } from "@/lib/pagination";
import { logActivity } from "@/lib/activity";
import type { Prisma, CycleStatus } from "@/generated/prisma";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const pagination = parsePaginationParams(req);

  const where: Prisma.ReviewCycleWhereInput = { organizationId: getOrgId(session) };
  if (status) where.status = status as CycleStatus;
  if (pagination.search) {
    where.name = { contains: pagination.search, mode: "insensitive" };
  }

  // A review's scores/outcomes are between the subject, their reporting
  // line and HR, never org-public. Below the People team and Admin, the
  // review rows are filtered to ones the caller is IN: their own, ones they
  // review, and their reporting chain's (solid plus dotted, whatever their
  // access level). And the CYCLES themselves are filtered the same way: a
  // cycle that touches none of those rows is not discoverable, the same
  // answer as the /reviews/[id] page's 404, except to the person who
  // started it (a Draft has no rows yet).
  let reviewsWhere: Prisma.ReviewWhereInput | undefined;
  if (!isHrAdminLevel(session) && !(await isPeopleTeamOrAdmin(session))) {
    const callerId = getUserId(session);
    const subjectIds = [callerId, ...(await chainOf(callerId))];
    reviewsWhere = { OR: [{ subjectId: { in: subjectIds } }, { reviewerId: callerId }] };
    where.AND = [{ OR: [{ reviews: { some: reviewsWhere } }, { createdById: callerId }] }];
  }

  const [cycles, total] = await Promise.all([
    prisma.reviewCycle.findMany({
      where,
      include: {
        reviews: {
          ...(reviewsWhere ? { where: reviewsWhere } : {}),
          select: {
            id: true,
            status: true,
            overallScore: true,
            outcome: true,
            subject: { select: { id: true, firstName: true, lastName: true } },
            reviewer: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        // Count must share the SAME scope as the `reviews` rows above,
        // otherwise a non-hr manager gets a filtered numerator over an
        // org-wide denominator and the dashboard understates completion.
        _count: { select: { reviews: reviewsWhere ? { where: reviewsWhere } : true } },
      },
      orderBy: { startDate: "desc" },
      ...skipTake(pagination),
    }),
    prisma.reviewCycle.count({ where }),
  ]);

  return jsonSuccess(paginatedResult(cycles, total, pagination));
}

const CYCLE_STATUSES: ReadonlySet<string> = new Set(["DRAFT", "ACTIVE", "IN_CALIBRATION", "COMPLETED", "CANCELLED"]);

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!(await mayStartReviewCycles(session))) return jsonError("Forbidden", 403);

  const body = await req.json();
  const { name, type, startDate, endDate } = body;

  if (!name || !type || !startDate || !endDate) {
    return jsonError("Name, type, start date and end date are required");
  }

  // Phase 6: the cycle records who started it. A manager's cycle covers
  // their chain (review-cycle-rules.ts launchAudience clips it at launch);
  // the People team and Admin start org cycles.
  const peopleOrAdmin = await isPeopleTeamOrAdmin(session);
  const cycle = await prisma.reviewCycle.create({
    data: {
      name,
      type,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      organizationId: getOrgId(session),
      createdById: getUserId(session),
      ...(peopleOrAdmin ? {} : { audienceType: "USERS", userIds: await chainOf(getUserId(session)) }),
    },
  });

  logActivity({
    type: "review_cycle.create",
    actorId: getUserId(session),
    organizationId: getOrgId(session),
    description: `Created review cycle: ${cycle.name}`,
    targetId: cycle.id,
    targetType: "ReviewCycle",
    metadata: { name, type, startDate, endDate },
  });

  return jsonSuccess(cycle, 201);
}

export async function PATCH(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const body = await req.json();
  const { id, name, type, startDate, endDate, status } = body;

  if (!id) return jsonError("Cycle id is required");

  const existing = await prisma.reviewCycle.findFirst({
    where: { id, organizationId: getOrgId(session) },
  });
  if (!existing) return jsonError("Review cycle not found", 404);
  // Phase 6: the People team and Admin, or the manager who started it.
  if (!(await canManageReviewCycle(session, existing))) {
    return jsonError("Only the People team, an Admin or the manager who started this cycle can change it", 403);
  }
  if (status !== undefined && !CYCLE_STATUSES.has(status)) return jsonError("Unknown status", 400);

  // A cycle only leaves DRAFT through POST /api/reviews/[id]/launch — the
  // sole creator of per-person Review rows. Flipping status directly used
  // to produce ACTIVE cycles with zero reviews: nobody had anything to
  // fill in, so the whole flow looked alive while doing nothing. Block
  // the raw transition (CANCELLED stays allowed — killing an unlaunched
  // draft is legitimate).
  if (
    status !== undefined &&
    existing.status === "DRAFT" &&
    status !== "DRAFT" &&
    status !== "CANCELLED"
  ) {
    const reviewCount = await prisma.review.count({ where: { cycleId: id } });
    if (reviewCount === 0) {
      return jsonError(
        "This cycle has no reviews yet. Launch it first to generate a review for every employee.",
        409,
      );
    }
  }

  const cycle = await prisma.reviewCycle.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(type !== undefined && { type }),
      ...(startDate !== undefined && { startDate: new Date(startDate) }),
      ...(endDate !== undefined && { endDate: new Date(endDate) }),
      ...(status !== undefined && { status }),
    },
  });

  // Audit-log review-cycle mutations — status transitions in
  // particular (DRAFT → OPEN → CLOSED) are HR-compliance signals.
  logActivity({
    type: "review_cycle.update",
    actorId: getUserId(session),
    organizationId: getOrgId(session),
    description: `Updated review cycle: ${cycle.name}`,
    targetId: cycle.id,
    targetType: "ReviewCycle",
    metadata: {
      ...(name !== undefined && { name }),
      ...(type !== undefined && { type }),
      ...(status !== undefined && { status, previousStatus: existing.status }),
    },
  });

  return jsonSuccess(cycle);
}

export async function DELETE(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return jsonError("Cycle id is required");

  const existing = await prisma.reviewCycle.findFirst({
    where: { id, organizationId: getOrgId(session) },
  });
  if (!existing) return jsonError("Review cycle not found", 404);
  // Deleting a cycle deletes every review in it: the People team and Admin
  // only, never the manager who started it (Cancel is theirs).
  if (!(await isPeopleTeamOrAdmin(session))) {
    return jsonError("Only the People team or an Admin can delete a review cycle", 403);
  }

  await prisma.reviewCycle.delete({ where: { id } });
  logActivity({
    type: "review_cycle.delete",
    actorId: getUserId(session),
    organizationId: getOrgId(session),
    description: `Deleted review cycle: ${existing.name}`,
    targetId: existing.id,
    targetType: "ReviewCycle",
  });

  return jsonSuccess({ message: "Review cycle deleted" });
}
