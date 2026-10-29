// POST /api/okrs/[id]/key-results, add a key result to an objective.
//
// A List source (docs/plans/recurring-goals.md C3, C8, H; only while
// RECURRING_GOALS is on) is connected by the caller, who must be able to
// open its Lists now; they become its connector (sourceById), and it counts
// at once.
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
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { Prisma } from "@/generated/prisma";
import { CHECK_IN_INSTEAD, KPI_NEEDS_MONTHS, settleOnRead } from "@/lib/goals/goal-periods.server";
import { parseTargetSource } from "@/lib/goals/target-source";
import { connectSourceProblem, refreshGoalSources } from "@/lib/goals/goal-source.server";
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

/** One thing measures a target: a KPI or a List, never both (C2). */
const ONE_MEASURE = "A target is measured by one thing: check-ins, a List or a KPI.";

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
  // A List source (C3, C8, H): Can view on its Lists now, by the person
  // connecting it, who becomes its connector.
  const connectorId = getUserId(session);
  if (source.list) {
    if (kpiId) return jsonError(ONE_MEASURE, 400);
    const problem = await connectSourceProblem(orgId, connectorId, source.list);
    if (problem) return jsonError(problem, 400);
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
      ...(source.value !== undefined ? { source: (source.value as Prisma.InputJsonValue | null) ?? Prisma.DbNull } : {}),
      ...(source.list ? { sourceById: connectorId } : {}),
    },
    include: { kpi: { select: KR_KPI_SELECT } },
  });

  // A repeating goal: the new target gets its row in the period running now
  // (settle adds every missing row, never one in a period that has ended),
  // and a KPI row makes that period wait for the KPI month (B7, the close
  // holds settle runs).
  if (okr.repeat) await settleOnRead(orgId, [okrId], "a new target");
  // A List source counts at once, so the target opens with its number.
  if (source.list) await countNow(orgId, created.id);

  const fresh = source.list ? await prisma.keyResult.findUnique({ where: { id: created.id }, include: { kpi: { select: KR_KPI_SELECT } } }) : null;
  const [keyResult] = await enrichKeyResults([fresh ?? created], { userId: okr.ownerId });
  // Keep the objective's stored summary in step with its live KR numbers.
  const rollup = await persistGoalRollupChain(okrId);

  return jsonSuccess({ keyResult, currentValueIgnored, okr: rollup }, 201);
}

/** Count a newly connected List source now; a failure leaves it for the next refresh. */
async function countNow(orgId: string, keyResultId: string): Promise<void> {
  try {
    await refreshGoalSources(orgId, { keyResultIds: [keyResultId], force: true });
  } catch (e) {
    console.error("[key-results] the first count of a List source failed; the next refresh counts it:", e instanceof Error ? e.message : e);
  }
}
