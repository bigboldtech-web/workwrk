import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const body = await req.json();
  const { weightage, period, status } = body;

  const orgId = getOrgId(session);

  const existing = await prisma.kRAAssignment.findFirst({
    where: { id, kra: { organizationId: orgId } },
  });
  if (!existing) return jsonError("Assignment not found", 404);

  // The person's other KRA weights in this period (for the soft over-100
  // signal below). Zero unless the weightage is actually changing.
  let othersTotal = 0;
  // Per-weight bound stays hard (1..100); the SUM is a soft warning, not a block.
  if (weightage != null && weightage !== existing.weightage) {
    if (weightage <= 0 || weightage > 100) {
      return jsonError("Weightage must be between 1 and 100");
    }

    const targetPeriod = period || existing.period;
    const otherAssignments = await prisma.kRAAssignment.findMany({
      where: {
        userId: existing.userId,
        period: targetPeriod,
        id: { not: id },
        status: { not: "ARCHIVED" },
      },
    });
    othersTotal = otherAssignments.reduce((sum, a) => sum + a.weightage, 0);
  }

  const assignment = await prisma.kRAAssignment.update({
    where: { id },
    data: {
      ...(weightage != null && { weightage }),
      ...(period != null && { period }),
      ...(status != null && { status }),
    },
    include: {
      kra: { select: { id: true, name: true, category: true } },
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  // Soft signal, matching POST /api/kra-assignments: edits are never hard-
  // rejected for exceeding 100% (that would trap a person already over the
  // budget and unable to rebalance). Save, then warn.
  const newTotal = weightage != null ? othersTotal + weightage : null;
  const weightWarning =
    newTotal != null && newTotal > 100
      ? `KRA weights now total ${newTotal}% for this person — over the 100% budget. Saved; trim another KRA to rebalance.`
      : null;

  return jsonSuccess({ ...assignment, weightTotal: newTotal, weightWarning });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);

  const existing = await prisma.kRAAssignment.findFirst({
    where: { id, kra: { organizationId: orgId } },
  });
  if (!existing) return jsonError("Assignment not found", 404);

  await prisma.kRAAssignment.delete({ where: { id } });

  return jsonSuccess({ message: "Assignment deleted" });
}
