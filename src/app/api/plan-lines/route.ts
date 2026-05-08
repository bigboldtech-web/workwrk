// Plan lines — list + bulk upsert. Org-admin only.
//
// Lines are organized as a sparse grid: one row per (plan,
// scenario, account, costCenter, period). The UI sends an array;
// we upsert each so editing a cell is one round-trip.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  jsonError,
  jsonSuccess,
  isOrgAdmin,
} from "@/lib/api-helpers";

type LineInput = {
  scenarioId: string;
  accountId: string;
  costCenterId?: string | null;
  periodId: string;
  amount: number;
  driverId?: string | null;
  notes?: string | null;
};

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;
  const planId = sp.get("planId");
  if (!planId) return jsonError("planId required");

  const lines = await prisma.planLine.findMany({
    where: { organizationId: orgId, planId },
    orderBy: [{ accountId: "asc" }, { periodId: "asc" }],
    include: {
      account: { select: { id: true, code: true, name: true, type: true } },
      costCenter: { select: { id: true, code: true, name: true } },
      period: { select: { id: true, label: true, startDate: true } },
      scenario: { select: { id: true, name: true } },
    },
  });
  return jsonSuccess(lines);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const planId = typeof body.planId === "string" ? body.planId : "";
  const lines: LineInput[] = Array.isArray(body.lines) ? body.lines : [];
  if (!planId) return jsonError("planId required");
  if (lines.length === 0) return jsonError("lines required");
  if (lines.length > 1000) return jsonError("max 1000 lines per request");

  const orgId = getOrgId(session);
  const plan = await prisma.budgetPlan.findFirst({
    where: { id: planId, organizationId: orgId },
    select: { id: true, status: true },
  });
  if (!plan) return jsonError("plan not found", 404);
  if (plan.status === "ARCHIVED") return jsonError("plan is archived", 400);

  // Manual upsert loop — Postgres treats NULL costCenterId as
  // non-equal to other NULLs, so the composite unique constraint
  // can't be used as a Prisma `where: { ..._costCenterId... }` key
  // when costCenterId is null. Find-or-update keeps it correct.
  try {
    let upserted = 0;
    await prisma.$transaction(async (tx) => {
      for (const l of lines) {
        if (!l.scenarioId) throw new Error("each line needs scenarioId");
        if (!l.accountId) throw new Error("each line needs accountId");
        if (!l.periodId) throw new Error("each line needs periodId");
        const amount = Number(l.amount);
        if (!Number.isFinite(amount)) throw new Error("each line needs a numeric amount");

        const existing = await tx.planLine.findFirst({
          where: {
            organizationId: orgId,
            planId,
            scenarioId: l.scenarioId,
            accountId: l.accountId,
            costCenterId: l.costCenterId ?? null,
            periodId: l.periodId,
          },
          select: { id: true },
        });
        if (existing) {
          await tx.planLine.update({
            where: { id: existing.id },
            data: { amount, driverId: l.driverId ?? null, notes: l.notes ?? null },
          });
        } else {
          await tx.planLine.create({
            data: {
              organizationId: orgId,
              planId,
              scenarioId: l.scenarioId,
              accountId: l.accountId,
              costCenterId: l.costCenterId ?? null,
              periodId: l.periodId,
              amount,
              driverId: l.driverId ?? null,
              notes: l.notes ?? null,
            },
          });
        }
        upserted += 1;
      }
    });
    return jsonSuccess({ upserted });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "upsert failed";
    return jsonError(message, 400);
  }
}
