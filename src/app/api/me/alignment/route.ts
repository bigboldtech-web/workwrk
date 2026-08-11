// GET /api/me/alignment — the signed-in person's own alignment picture:
// the data source for the employee door ("MY job title, MY KRAs, MY
// goals"). No access gate beyond the session: this endpoint only ever
// reads the caller's own rows.
//
//  - role:           their job title, with its description as the JD.
//  - kras / okrs:    via src/lib/person-alignment.ts (same builder the
//                    manager door reads, so both always agree): inherited
//                    KRAs with nested KPI gauges — resolved direction,
//                    ownership, isNorthStar, targetValue-or-null, their
//                    latest reading + health, current-period record with
//                    approval status — and their current-cycle OKRs with
//                    KR→KPI links resolved.
//  - pendingReviews: review rows about THEM that are still in flight.
//  - assets:         equipment currently assigned to them.
//
// ?quarter= switches the OKR cycle (default: current quarter).

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { buildPersonAlignment } from "@/lib/person-alignment";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const quarter = new URL(req.url).searchParams.get("quarter");

  const me = await prisma.user.findFirst({
    where: { id: userId, organizationId: orgId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      avatar: true,
      role: {
        select: {
          id: true,
          title: true,
          // The JD — Role.description is the mission statement the
          // career home renders under "My role".
          description: true,
          level: true,
          department: { select: { id: true, name: true } },
        },
      },
      manager: { select: { id: true, firstName: true, lastName: true } },
      department: { select: { id: true, name: true } },
    },
  });
  if (!me) return jsonError("User not found", 404);

  const [alignment, pendingReviews, assets] = await Promise.all([
    buildPersonAlignment(orgId, userId, { quarter }),
    prisma.review.findMany({
      where: {
        subjectId: userId,
        status: { not: "COMPLETED" },
        cycle: { organizationId: orgId },
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
        cycle: {
          select: { id: true, name: true, type: true, startDate: true, endDate: true, status: true },
        },
        reviewer: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.asset.findMany({
      where: { assignedToId: userId, organizationId: orgId, returnedAt: null },
      select: {
        id: true,
        name: true,
        type: true,
        brand: true,
        model: true,
        serialNumber: true,
        condition: true,
        status: true,
        assignedAt: true,
        warrantyExpiry: true,
      },
      orderBy: { assignedAt: "desc" },
    }),
  ]);

  const { role, ...user } = me;

  return jsonSuccess({
    user,
    role,
    ...alignment,
    pendingReviews,
    assets,
  });
}
