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
import { alignmentPersonCard } from "@/lib/people/alignment-card.server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { buildPersonAlignment } from "@/lib/person-alignment";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const quarter = new URL(req.url).searchParams.get("quarter");

  // By the seat held HERE, a membership one too (pen test 2026-11-28, V-43,
  // the step 4c review): someone here through a membership could not open
  // their own career home.
  const me = await alignmentPersonCard(orgId, userId);
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
