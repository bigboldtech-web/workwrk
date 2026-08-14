import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess, requirePermission } from "@/lib/api-helpers";
import { canTouchUserAlignment } from "@/lib/alignment-scope";
import { getTeamUserIds } from "@/lib/team";

// Roles that may assign org-wide; everyone else is scoped to their own
// report tree. Mirrors the scope logic on GET /api/kras.
const ORG_WIDE_ASSIGNERS = new Set(["COMPANY_ADMIN", "SUPER_ADMIN", "C_LEVEL", "VP", "DIRECTOR", "HR"]);

// Soft over-100 signal attached to a saved assignment. `weightTotal` is
// the person's running KRA-weight sum after the write; `weightWarning` is
// non-null only when that sum breaches 100 — advisory copy the UI can
// surface. We never reject: an existing >100 state must stay fixable.
function weightSignal(weightTotal: number): { weightTotal: number; weightWarning: string | null } {
  return {
    weightTotal,
    weightWarning:
      weightTotal > 100
        ? `KRA weights now total ${weightTotal}% for this person — over the 100% budget. Saved; trim another KRA to rebalance.`
        : null,
  };
}

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  const managerId = searchParams.get("managerId");
  const period = searchParams.get("period");

  const orgId = getOrgId(session);
  const callerId = getUserId(session);
  const callerLevel = (session.user as { accessLevel?: string }).accessLevel ?? "";
  const isOrgWide = ORG_WIDE_ASSIGNERS.has(callerLevel);

  // If managerId is provided, get assignments for all direct reports.
  // Only that manager themselves (or an org-wide level) may ask.
  if (managerId) {
    if (managerId !== callerId && !isOrgWide) {
      return jsonError("You can only view your own team's assignments.", 403);
    }
    const directReports = await prisma.user.findMany({
      where: { managerId, organizationId: orgId },
      select: { id: true },
    });
    const reportIds = directReports.map((r) => r.id);

    const assignments = await prisma.kRAAssignment.findMany({
      where: {
        userId: { in: reportIds },
        kra: { organizationId: orgId },
        ...(period ? { period } : {}),
      },
      include: {
        kra: { select: { id: true, name: true, category: true } },
        user: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return jsonSuccess(assignments);
  }

  // If no userId, check if requesting all org assignments (door 3 only —
  // the org-wide grid is admin / exec / HR territory).
  const all = searchParams.get("all");
  if (all === "true") {
    if (!isOrgWide) {
      return jsonError("Org-wide assignments are visible to admins, execs and HR only.", 403);
    }
    const page = parseInt(searchParams.get("page") || "1");
    const limit = Math.min(parseInt(searchParams.get("limit") || "100"), 200);
    const skip = (page - 1) * limit;

    const assignments = await prisma.kRAAssignment.findMany({
      where: { kra: { organizationId: orgId } },
      include: {
        kra: { select: { id: true, name: true, category: true, kpis: { select: { id: true, name: true, unit: true } } } },
        user: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip,
    });
    return jsonSuccess(assignments);
  }

  // Get assignments for a specific user or current user. Reading another
  // person's assignments (and their KPI records nested below) requires
  // self / report-tree / org-wide standing.
  const targetUserId = userId || callerId;
  if (!(await canTouchUserAlignment(session, targetUserId))) {
    return jsonError("You can only view KRA assignments for yourself or your reports.", 403);
  }

  const assignments = await prisma.kRAAssignment.findMany({
    where: {
      userId: targetUserId,
      kra: { organizationId: orgId },
      ...(period ? { period } : {}),
    },
    include: {
      kra: {
        select: {
          id: true,
          name: true,
          description: true,
          category: true,
          // Which job title owns this KRA — lets the UI flag orphans.
          role: { select: { id: true, title: true } },
          kpis: {
            select: {
              id: true,
              name: true,
              description: true,
              type: true,
              unit: true,
              frequency: true,
              targetValue: true,
              targetLabel: true,
              lowerIsBetter: true,
              records: {
                where: { userId: targetUserId },
                orderBy: { period: "desc" },
                take: 6,
              },
            },
          },
        },
      },
      user: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return jsonSuccess(assignments);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePermission(session, "kras", "assign");
  if (denied) return denied;

  const body = await req.json();
  const { userId, kraId, weightage, period, status } = body;

  if (!userId || !kraId) {
    return jsonError("userId and kraId are required");
  }
  if (weightage == null || weightage <= 0 || weightage > 100) {
    return jsonError("Weightage must be between 1 and 100");
  }

  const orgId = getOrgId(session);

  // Verify KRA belongs to this org
  const kra = await prisma.kRA.findFirst({
    where: { id: kraId, organizationId: orgId },
  });
  if (!kra) return jsonError("KRA not found", 404);

  // Verify user belongs to this org
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId: orgId },
  });
  if (!user) return jsonError("User not found", 404);

  // Governance: managers may only assign KRAs to people in their own
  // report tree. Org-wide roles (admin / exec / HR) assign anywhere.
  const callerLevel = (session.user as { accessLevel?: string }).accessLevel ?? "";
  if (!ORG_WIDE_ASSIGNERS.has(callerLevel)) {
    const teamIds = await getTeamUserIds(orgId, getUserId(session));
    if (!teamIds.includes(userId)) {
      return jsonError("You can only assign KRAs to people who report to you.", 403);
    }
  }

  // Check if this KRA is already assigned to this user
  const existing = await prisma.kRAAssignment.findUnique({
    where: { userId_kraId: { userId, kraId } },
  });

  if (existing) {
    // Update weightage if already assigned. Over-100 is SURFACED, not
    // blocked: a hard reject would trap a person already sitting above
    // 100% (from role-seed defaults or legacy data) — they could never
    // save the very edit that rebalances them. We save and warn instead,
    // handing back the running total so the UI can nudge a trim.
    const otherAssignments = await prisma.kRAAssignment.findMany({
      where: { userId, status: { not: "ARCHIVED" }, id: { not: existing.id } },
    });
    const othersTotal = otherAssignments.reduce((sum, a) => sum + a.weightage, 0);
    const weightTotal = othersTotal + weightage;

    const assignment = await prisma.kRAAssignment.update({
      where: { id: existing.id },
      data: { weightage, status: status || existing.status },
      include: {
        kra: { select: { id: true, name: true, category: true } },
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    return jsonSuccess({ ...assignment, ...weightSignal(weightTotal) });
  }

  // Running total across the person's active KRAs after this add. Over
  // 100 is warned, never blocked (see the update branch above).
  const existingAssignments = await prisma.kRAAssignment.findMany({
    where: { userId, status: { not: "ARCHIVED" } },
  });
  const currentTotal = existingAssignments.reduce((sum, a) => sum + a.weightage, 0);
  const weightTotal = currentTotal + weightage;

  const assignment = await prisma.kRAAssignment.create({
    data: {
      userId,
      kraId,
      weightage,
      period: period || "ongoing",
      status: status || "ACTIVE",
    },
    include: {
      kra: { select: { id: true, name: true, category: true } },
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  // Notify the user
  await prisma.notification.create({
    data: {
      userId,
      type: "kra_assigned",
      title: "New KRA Assigned",
      message: `You have been assigned the KRA: ${kra.name} (${weightage}% weightage)`,
      link: "/kra-kpi",
    },
  });

  return jsonSuccess({ ...assignment, ...weightSignal(weightTotal) }, 201);
}
