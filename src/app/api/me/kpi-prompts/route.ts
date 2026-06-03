// GET /api/me/kpi-prompts — KPIRecord rows for the current user that
// are pending input (status = PENDING) plus any submitted-but-rejected
// ones that need re-submission. Used by the MyAlignment block to nudge
// the user to score their KPIs on the right cadence.

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

  const records = await prisma.kPIRecord.findMany({
    where: {
      userId: u.id,
      status: { in: ["PENDING", "REJECTED"] },
    },
    include: {
      kpi: { select: { id: true, name: true, unit: true, frequency: true, targetValue: true, lowerIsBetter: true } },
    },
    orderBy: [{ status: "asc" }, { period: "desc" }],
    take: 50,
  });

  return NextResponse.json({
    prompts: records.map((r) => ({
      id: r.id,
      period: r.period,
      status: r.status,
      targetValue: r.targetValue,
      actualValue: r.actualValue,
      score: r.score,
      kpi: r.kpi,
    })),
  });
}
