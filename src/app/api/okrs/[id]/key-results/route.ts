// POST /api/okrs/[id]/key-results — add a key result to an objective.
//
// `kpiId` (optional) links the KR UP at a role-level KPI gauge, validated
// against the caller's org. While linked, the KR is measured BY that
// gauge: currentValue/progress are derived from the KPI's latest record
// on read, so a hand-typed currentValue is not stored as the truth — the
// response says so via `currentValueIgnored` and the KR's `isDerived`.

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import {
  enrichKeyResults,
  inferKeyResultDirection,
  keyResultProgress,
  KR_KPI_SELECT,
  persistOkrRollup,
  resolveKpiLink,
} from "@/lib/alignment";

const createSchema = z.object({
  title: z.string().min(1).max(300),
  unit: z.string().max(32).nullish(),
  startValue: z.number().finite().optional(),
  targetValue: z.number().finite().optional(),
  currentValue: z.number().finite().optional(),
  kpiId: z.string().min(1).nullish(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id: okrId } = await params;
  const orgId = getOrgId(session);

  const okr = await prisma.oKR.findFirst({
    where: { id: okrId, organizationId: orgId },
    select: { id: true, ownerId: true },
  });
  if (!okr) return jsonError("OKR not found", 404);

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid key result payload");
  const d = parsed.data;

  // Validate the KPI link against the caller's org BEFORE writing anything.
  const link = await resolveKpiLink(d.kpiId, orgId);
  if (!link.ok) return jsonError(link.message);
  const kpiId = link.value ?? null;

  const startValue = d.startValue ?? 0;
  const targetValue = d.targetValue ?? 100;
  // A linked KR is measured by its gauge — a hand-typed currentValue is
  // ignored (derived wins). Unlinked KRs keep the classic manual number.
  const currentValueIgnored = kpiId != null && d.currentValue !== undefined;
  const currentValue = kpiId == null ? (d.currentValue ?? 0) : 0;
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
    },
    include: { kpi: { select: KR_KPI_SELECT } },
  });

  const [keyResult] = await enrichKeyResults([created], { userId: okr.ownerId });
  // Keep the objective's stored summary in step with its live KR numbers.
  const rollup = await persistOkrRollup(okrId);

  return jsonSuccess({ keyResult, currentValueIgnored, okr: rollup }, 201);
}
