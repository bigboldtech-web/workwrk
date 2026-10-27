// POST /api/okrs/[id]/key-results, add a key result to an objective.
//
// `kpiId` (optional) links the KR UP at a role-level KPI gauge, validated
// against the caller's org. While linked, the KR is measured BY that
// gauge: currentValue/progress are derived from the KPI's latest record
// on read, so a hand-typed currentValue is not stored as the truth, the
// response says so via `currentValueIgnored` and the KR's `isDerived`.

import { NextRequest } from "next/server";
import { goalEditDenial } from "@/lib/goal-audience";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { Prisma } from "@/generated/prisma";
import { CHECK_IN_INSTEAD, KPI_NEEDS_MONTHS, settleOnRead } from "@/lib/goals/goal-periods.server";
import { parseTargetSource } from "@/lib/goals/target-source";
import {
  enrichKeyResults,
  inferKeyResultDirection,
  keyResultProgress,
  KR_KPI_SELECT,
  persistGoalRollupChain,
  resolveKpiLink,
} from "@/lib/alignment";

const createSchema = z.object({
  title: z.string().min(1).max(300),
  unit: z.string().max(32).nullish(),
  startValue: z.number().finite().optional(),
  targetValue: z.number().finite().optional(),
  currentValue: z.number().finite().optional(),
  kpiId: z.string().min(1).nullish(),
  // Repeating goals (docs/plans/recurring-goals.md B4, C6): what each period
  // starts at, and a quarterly or yearly goal's KPI months combined.
  periodStart: z.enum(["START", "LAST"]).nullish(),
  source: z.unknown().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id: okrId } = await params;
  const orgId = getOrgId(session);

  const okr = await prisma.oKR.findFirst({
    where: { id: okrId, organizationId: orgId },
    select: { id: true, level: true, ownerId: true, departmentId: true, repeat: true },
  });
  if (!okr) return jsonError("OKR not found", 404);

  // Adding a KR is a WRITE on the objective, owner / tree-manager /
  // org-wide only.
  const denied = await goalEditDenial(session, okr);
  if (denied) return jsonError(denied.error, denied.status);

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid key result payload");
  const d = parsed.data;

  // Validate the KPI link against the caller's org BEFORE writing anything.
  const link = await resolveKpiLink(d.kpiId, orgId);
  if (!link.ok) return jsonError(link.message);
  const kpiId = link.value ?? null;

  // A repeating goal's numbers are its periods' (B8): this period's number
  // moves by a check-in, never by a value typed here. A weekly goal reads no
  // KPI (C6), and a source is refused while the switch is off (2.0).
  const source = parseTargetSource(d.source);
  if (!source.ok) return jsonError(source.error, 400);
  if (okr.repeat) {
    if (d.currentValue !== undefined) return jsonError(CHECK_IN_INSTEAD, 409);
    if (kpiId && okr.repeat === "WEEKLY") return jsonError(KPI_NEEDS_MONTHS, 400);
  }

  const startValue = d.startValue ?? 0;
  const targetValue = d.targetValue ?? 100;
  // A linked KR is measured by its gauge, a hand-typed currentValue is
  // ignored (derived wins). Unlinked KRs keep the classic manual number.
  // Default the current to the START, not 0: a target that opens at
  // start=40 must read 40 (0% of the 40→90 journey), so the first "increase
  // by 2" check-in lands at 42, not 2, which is what a 0 default produced.
  const currentValueIgnored = kpiId != null && d.currentValue !== undefined;
  const currentValue = kpiId == null ? (d.currentValue ?? startValue) : 0;
  const progress =
    kpiId == null
      ? keyResultProgress(
          startValue,
          targetValue,
          currentValue,
          inferKeyResultDirection({ startValue, targetValue }),
        )
      : 0;

  const created = await prisma.keyResult.create({
    data: {
      title: d.title.trim(),
      unit: d.unit ?? null,
      startValue,
      targetValue,
      currentValue,
      progress,
      kpiId,
      okrId,
      ...(d.periodStart !== undefined ? { periodStart: d.periodStart ?? null } : {}),
      ...(source.value !== undefined ? { source: source.value ?? Prisma.DbNull } : {}),
    },
    include: { kpi: { select: KR_KPI_SELECT } },
  });

  // A repeating goal: the new target gets its row in the period running now
  // (settle adds every missing row, never one in a period that has ended),
  // and a KPI row makes that period wait for the KPI month (B7, the close
  // holds settle runs).
  if (okr.repeat) await settleOnRead(orgId, [okrId], "a new target");

  const [keyResult] = await enrichKeyResults([created], { userId: okr.ownerId });
  // Keep the objective's stored summary in step with its live KR numbers.
  const rollup = await persistGoalRollupChain(okrId);

  return jsonSuccess({ keyResult, currentValueIgnored, okr: rollup }, 201);
}
