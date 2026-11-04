// GET /api/me/kras — KRAs assigned to the current user, each with
// their KPIs and current-period KPIRecord (if any). Used by the
// MyAlignment block on /today.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const u = session.user as { id?: string; organizationId?: string };
  if (!u.id || !u.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // This workspace's KRAs only (docs/plans/workspace-status-2.md, the final
  // review, product M5): an assignment names no workspace, so a person
  // whose account was in another workspace when its job title seeded theirs
  // (after accepting its invitation) holds that workspace's rows too, and
  // they showed and counted here.
  const assignments = await prisma.kRAAssignment.findMany({
    where: { userId: u.id, status: "ACTIVE", kra: { organizationId: u.organizationId } },
    include: {
      kra: {
        include: {
          kpis: { select: { id: true, name: true, unit: true, frequency: true, targetValue: true, lowerIsBetter: true } },
          _count: { select: { assignments: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    kras: assignments.map((a) => ({
      assignmentId: a.id,
      weightage: a.weightage,
      period: a.period,
      kra: {
        id: a.kra.id,
        name: a.kra.name,
        description: a.kra.description,
        category: a.kra.category,
        kpis: a.kra.kpis,
        teamSize: a.kra._count.assignments,
      },
    })),
  });
}
