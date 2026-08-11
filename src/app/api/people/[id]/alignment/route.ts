// GET /api/people/[id]/alignment — one person's live alignment picture.
//
//  - kras: the KRAs + KPI gauges this person holds (KRAAssignment, seeded
//    from their role's templates by src/lib/alignment-assign.ts). Each KPI
//    carries THIS PERSON's latest usable reading (their own KPIRecords —
//    a gauge is read per-person) and its health against the healthy line.
//    A KPI with no targetValue reports "no_target": no line is invented.
//  - okrs: the person's OWN objectives for the requested cycle
//    (?quarter=, default = current), with KR→KPI links resolved and
//    derived currentValue/progress. OKRs attach to the person, never the
//    role — two holders of the same role share kras but never okrs.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import {
  enrichKeyResultGroups,
  kpiDirection,
  kpiHealth,
  KPI_ORDER,
  KR_KPI_SELECT,
  latestKpiValues,
  rollUpOkrProgress,
} from "@/lib/alignment";

function currentQuarter(): string {
  const d = new Date();
  return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);

  const person = await prisma.user.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      avatar: true,
      role: { select: { id: true, title: true } },
    },
  });
  if (!person) return jsonError("User not found", 404);

  const quarter = new URL(req.url).searchParams.get("quarter") || currentQuarter();

  const [assignments, okrs] = await Promise.all([
    prisma.kRAAssignment.findMany({
      where: { userId: id, status: "ACTIVE", kra: { organizationId: orgId } },
      select: {
        id: true,
        weightage: true,
        period: true,
        kra: {
          select: {
            id: true,
            name: true,
            description: true,
            category: true,
            roleId: true,
            kpis: {
              select: {
                id: true, name: true, description: true, unit: true, type: true,
                frequency: true, targetValue: true, targetLabel: true,
                lowerIsBetter: true, direction: true, ownership: true, isNorthStar: true,
              },
              orderBy: KPI_ORDER,
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.oKR.findMany({
      where: { organizationId: orgId, ownerId: id, quarter },
      include: {
        keyResults: {
          include: { kpi: { select: KR_KPI_SELECT } },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: [{ position: "asc" }, { createdAt: "desc" }],
    }),
  ]);

  // This person's latest usable reading per gauge (their own records only).
  const kpiIds = assignments.flatMap((a) => a.kra.kpis.map((k) => k.id));
  const latest = await latestKpiValues(kpiIds, { userId: id });

  const kras = assignments.map((a) => ({
    assignmentId: a.id,
    weightage: a.weightage,
    period: a.period,
    id: a.kra.id,
    name: a.kra.name,
    description: a.kra.description,
    category: a.kra.category,
    roleId: a.kra.roleId,
    kpis: a.kra.kpis.map((kpi) => {
      const reading = latest.get(kpi.id);
      return {
        ...kpi,
        // Resolved direction — the enum when set, else the legacy boolean.
        direction: kpiDirection(kpi),
        latestValue: reading?.value ?? null,
        latestPeriod: reading?.period ?? null,
        health: kpiHealth(kpi, reading?.value ?? null),
      };
    }),
  }));

  // KPI-linked KRs report the gauge's latest reading (read-side derivation).
  const groups = await enrichKeyResultGroups(
    okrs.map((o) => ({ userId: o.ownerId, keyResults: o.keyResults })),
  );
  const enrichedOkrs = okrs.map((o, i) => {
    const keyResults = groups[i];
    return { ...o, keyResults, progress: rollUpOkrProgress(keyResults) ?? o.progress };
  });

  return jsonSuccess({ user: person, quarter, kras, okrs: enrichedOkrs });
}
