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

  // If weightage is changing, validate total doesn't exceed 100%
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
    const othersTotal = otherAssignments.reduce((sum, a) => sum + a.weightage, 0);
    if (othersTotal + weightage > 100) {
      return jsonError(
        `Total weightage would be ${othersTotal + weightage}%. Others: ${othersTotal}%, this: ${weightage}%. Must not exceed 100%.`
      );
    }
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

  return jsonSuccess(assignment);
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
