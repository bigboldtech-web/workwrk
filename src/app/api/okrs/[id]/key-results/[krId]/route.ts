// PATCH  /api/okrs/[id]/key-results/[krId] — edit a key result, including
//         linking (kpiId, validated against the caller's org) or unlinking
//         (kpiId: null) a role-level KPI gauge.
// DELETE /api/okrs/[id]/key-results/[krId] — remove the key result.
//
// While a KR is linked, it is measured BY the gauge: a hand-typed
// currentValue is ignored (derived wins — `currentValueIgnored` in the
// response says so) and the stored hand-typed number is left untouched,
// so unlinking later restores exactly what the owner last typed. Nothing
// here ever writes a KPI or KPIRecord.

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

const patchSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  unit: z.string().max(32).nullish(),
  startValue: z.number().finite().optional(),
  targetValue: z.number().finite().optional(),
  currentValue: z.number().finite().optional(),
  // undefined = leave the link alone; null = clear it; string = link.
  kpiId: z.string().min(1).nullish(),
});

async function findScopedKeyResult(okrId: string, krId: string, orgId: string) {
  return prisma.keyResult.findFirst({
    where: { id: krId, okrId, okr: { organizationId: orgId } },
    include: { okr: { select: { ownerId: true } } },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; krId: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id: okrId, krId } = await params;
  const orgId = getOrgId(session);

  const kr = await findScopedKeyResult(okrId, krId, orgId);
  if (!kr) return jsonError("Key Result not found", 404);

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid key result payload");
  const d = parsed.data;

  const link = await resolveKpiLink(d.kpiId, orgId);
  if (!link.ok) return jsonError(link.message);
  const nextKpiId = link.value === undefined ? kr.kpiId : link.value;

  const startValue = d.startValue ?? kr.startValue;
  const targetValue = d.targetValue ?? kr.targetValue;

  // Linked → the gauge is the truth; a hand-typed currentValue is ignored
  // and the stored one stays exactly as the owner last typed it.
  // Unlinked → apply the manual number and recompute progress.
  const currentValueIgnored = nextKpiId != null && d.currentValue !== undefined;
  const manualData =
    nextKpiId == null
      ? (() => {
          const currentValue = d.currentValue ?? kr.currentValue;
          return {
            currentValue,
            progress: keyResultProgress(
              startValue,
              targetValue,
              currentValue,
              inferKeyResultDirection({ startValue, targetValue }),
            ),
          };
        })()
      : {};

  const updated = await prisma.keyResult.update({
    where: { id: kr.id },
    data: {
      ...(d.title !== undefined && { title: d.title.trim() }),
      ...(d.unit !== undefined && { unit: d.unit ?? null }),
      startValue,
      targetValue,
      kpiId: nextKpiId,
      ...manualData,
    },
    include: { kpi: { select: KR_KPI_SELECT } },
  });

  const [keyResult] = await enrichKeyResults([updated], { userId: kr.okr.ownerId });
  const rollup = await persistOkrRollup(okrId);

  return jsonSuccess({ keyResult, currentValueIgnored, okr: rollup });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; krId: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id: okrId, krId } = await params;
  const orgId = getOrgId(session);

  const kr = await findScopedKeyResult(okrId, krId, orgId);
  if (!kr) return jsonError("Key Result not found", 404);

  await prisma.keyResult.delete({ where: { id: kr.id } });
  const rollup = await persistOkrRollup(okrId);

  return jsonSuccess({ message: "Deleted", okr: rollup });
}
