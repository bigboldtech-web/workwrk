import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";
import { isOrgWideAlignment } from "@/lib/alignment-scope";
import { getTeamUserIds } from "@/lib/team";

/**
 * Changing or removing someone's KRA assignment follows the rule that giving
 * one does (POST /api/kra-assignments): an org-wide role anywhere, a manager
 * or team lead only for the people in their own report tree (pen test
 * 2026-11-28, V-13: any team lead rewrote or removed the KRA weights of
 * anyone, executives and other managers' reports included, and the weights
 * feed the performance score).
 */
async function mayChangeAssignmentOf(session: unknown, orgId: string, personId: string): Promise<boolean> {
  if (isOrgWideAlignment(session)) return true;
  // Never one's own: the report tree starts at the caller, and changing one's
  // own weights moves one's own performance score (the step 3 review).
  if (personId === getUserId(session)) return false;
  const teamIds = await getTeamUserIds(orgId, getUserId(session));
  return teamIds.includes(personId);
}

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
  if (!(await mayChangeAssignmentOf(session, orgId, existing.userId))) {
    return jsonError("You can only change KRAs of people who report to you.", 403);
  }

  // The person's other KRA weights in this period (for the soft over-100
  // signal below). Zero unless the weightage is actually changing.
  let othersTotal = 0;
  // Per-weight bound stays hard (1..100); the SUM is a soft warning, not a block.
  if (weightage != null && weightage !== existing.weightage) {
    if (weightage <= 0 || weightage > 100) {
      return jsonError("Weightage must be between 1 and 100");
    }

    const targetPeriod = period || existing.period;
    // This workspace's weights only (docs/plans/workspace-status-2.md, the
    // final review, product M5): another workspace's KRAs of theirs never
    // count toward the total here.
    const otherAssignments = await prisma.kRAAssignment.findMany({
      where: {
        userId: existing.userId,
        period: targetPeriod,
        id: { not: id },
        status: { not: "ARCHIVED" },
        kra: { organizationId: orgId },
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
  if (!(await mayChangeAssignmentOf(session, orgId, existing.userId))) {
    return jsonError("You can only remove KRAs of people who report to you.", 403);
  }

  await prisma.kRAAssignment.delete({ where: { id } });

  return jsonSuccess({ message: "Assignment deleted" });
}
