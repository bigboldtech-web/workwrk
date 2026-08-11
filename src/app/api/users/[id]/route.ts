import { NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { getLatestScore, getScoreHistory } from "@/services/performanceScoreService";
import { seedAlignmentForUser } from "@/lib/alignment-assign";
import { canTouchUserAlignment, isOrgAdminLevel } from "@/lib/alignment-scope";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const currentUserId = getUserId(session);
  const { id } = await params;

  // Three-door read: a person's records (KPI history, reviews, check-in
  // moods, score history) are visible to themselves, their reporting
  // line, and org-wide levels. Peers get the minimal directory card —
  // enough for @mentions and the org chart, nothing performance-shaped.
  const fullRead = await canTouchUserAlignment(session, id);
  if (!fullRead) {
    const peer = await prisma.user.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        avatar: true,
        status: true,
        role: { select: { id: true, title: true } },
        department: { select: { id: true, name: true, color: true } },
        office: { select: { id: true, name: true, city: true, country: true, isHeadquarters: true } },
        manager: { select: { id: true, firstName: true, lastName: true, avatar: true } },
      },
    });
    if (!peer) return jsonError("User not found", 404);
    return jsonSuccess({ ...peer, minimal: true });
  }

  const user = await prisma.user.findFirst({
    where: { id, organizationId: orgId },
    include: {
      department: { select: { id: true, name: true, color: true } },
      role: { select: { id: true, title: true } },
      office: { select: { id: true, name: true, city: true, country: true, isHeadquarters: true } },
      manager: { select: { id: true, firstName: true, lastName: true, avatar: true } },
      directReports: {
        select: { id: true, firstName: true, lastName: true, avatar: true, role: { select: { title: true } } },
      },
      skills: { orderBy: { selfRating: "desc" } },
      certifications: { orderBy: { issuedAt: "desc" } },
      kraAssignments: {
        include: { kra: { select: { name: true, category: true } } },
        where: { status: "ACTIVE" },
      },
      kpiRecords: {
        include: { kpi: { select: { name: true, unit: true } } },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      tasks: {
        orderBy: { date: "desc" },
        take: 10,
        select: { id: true, title: true, status: true, date: true, kra: { select: { name: true } } },
      },
      reviewsAsSubject: {
        include: {
          cycle: { select: { name: true } },
          reviewer: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
      checkIns: { orderBy: { createdAt: "desc" }, take: 10 },
      kudosReceived: {
        include: {
          giver: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          reactions: { select: { emoji: true, userId: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
      _count: { select: { kudosReceived: true, kudosGiven: true } },
    },
  });

  if (!user) return jsonError("User not found", 404);

  // Calculate performance summary
  const kpiScores = user.kpiRecords.filter((r) => r.score != null).map((r) => r.score!);
  const avgKPI = kpiScores.length > 0 ? Math.round(kpiScores.reduce((a, b) => a + b, 0) / kpiScores.length) : null;

  const recentMoods = user.checkIns.filter((c) => c.mood != null).map((c) => c.mood!);
  const avgMood = recentMoods.length > 0 ? Number((recentMoods.reduce((a, b) => a + b, 0) / recentMoods.length).toFixed(1)) : null;

  // Get composite performance score + history
  const [latestScore, scoreHistory] = await Promise.all([
    getLatestScore(id),
    getScoreHistory(id, 6),
  ]);

  const kudosReceived = user.kudosReceived.map((k) => {
    const byEmoji = new Map<string, number>();
    const mine: string[] = [];
    for (const r of k.reactions) {
      byEmoji.set(r.emoji, (byEmoji.get(r.emoji) || 0) + 1);
      if (r.userId === currentUserId) mine.push(r.emoji);
    }
    return {
      ...k,
      reactionCounts: Array.from(byEmoji.entries())
        .map(([emoji, count]) => ({ emoji, count }))
        .sort((a, b) => b.count - a.count),
      totalReactions: k.reactions.length,
      myReactions: mine,
    };
  });

  return jsonSuccess({
    ...user,
    kudosReceived,
    passwordHash: undefined,
    performanceSummary: {
      avgKPI,
      avgMood,
      activeKRAs: user.kraAssignments.length,
      latestReviewScore: user.reviewsAsSubject[0]?.overallScore ?? null,
      compositeScore: latestScore?.score ?? null,
      scoreBreakdown: latestScore?.breakdown ?? null,
    },
    scoreHistory,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const { id } = await params;
  const body = await req.json();
  const callerAccessLevel = (session.user as { accessLevel?: string }).accessLevel ?? "";
  const isAdmin = ["COMPANY_ADMIN", "SUPER_ADMIN"].includes(callerAccessLevel);

  // Verify target user is in same org
  const targetUser = await prisma.user.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, accessLevel: true, roleId: true },
  });
  if (!targetUser) return jsonError("User not found", 404);

  // Only COMPANY_ADMIN/SUPER_ADMIN can change accessLevel
  if (body.accessLevel !== undefined && !isAdmin) {
    return jsonError("Only Company Admin can change access levels", 403);
  }

  // Who may edit whom: self (personal fields only), a manager whose
  // report tree contains the target, or an org-wide level. Peers: no.
  const callerId = getUserId(session);
  const isSelf = id === callerId;
  if (!isSelf && !(await canTouchUserAlignment(session, id))) {
    return jsonError("You can only edit your own profile or your reports'.", 403);
  }
  // Employment fields (status, department, role, manager, office) are
  // management decisions — an employee editing their own row keeps to
  // personal fields (name, phone, avatar, date of birth).
  const MANAGER_TIER = new Set([
    "SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR", "MANAGER", "TEAM_LEAD", "HR",
  ]);
  if (isSelf && !MANAGER_TIER.has(String(callerAccessLevel ?? ""))) {
    const attempted = ["status", "departmentId", "roleId", "managerId", "officeId"]
      .filter((f) => body[f] !== undefined);
    if (attempted.length > 0) {
      return jsonError(`Ask your manager to change: ${attempted.join(", ")}`, 403);
    }
  }

  // Prevent locking out the last COMPANY_ADMIN
  if (body.accessLevel !== undefined && targetUser.accessLevel === "COMPANY_ADMIN" && body.accessLevel !== "COMPANY_ADMIN") {
    const adminCount = await prisma.user.count({
      where: { organizationId: orgId, accessLevel: "COMPANY_ADMIN", deletedAt: null },
    });
    if (adminCount <= 1) {
      return jsonError("Cannot demote the last Company Admin. Promote another user first.", 400);
    }
  }

  const allowedFields = ["firstName", "lastName", "phone", "avatar", "status", "departmentId", "roleId", "accessLevel", "managerId", "dateOfBirth", "officeId"];
  const data: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  // Convert date strings to Date objects
  if (data.dateOfBirth) data.dateOfBirth = new Date(data.dateOfBirth as string);

  const user = await prisma.user.update({
    where: { id },
    data: data as Prisma.UserUncheckedUpdateInput,
  });

  // Hybrid assignment: when the user moves into a (new) role, seed their
  // KRA/SOP defaults from that role's templates. Idempotent + best-effort
  // — a seeding hiccup must not fail the profile update.
  if (data.roleId && data.roleId !== targetUser.roleId) {
    try {
      await seedAlignmentForUser({
        userId: id,
        roleId: data.roleId as string,
        organizationId: orgId,
        assignedBy: getUserId(session),
      });
    } catch (e) {
      console.error("seedAlignmentForUser failed", e);
    }
  }

  return jsonSuccess({ ...user, passwordHash: undefined });
}

// DELETE: Soft delete a user
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const { id } = await params;

  // Removing (or restoring) a person is org-admin or reporting-line
  // territory — a manager cannot soft-delete someone outside their tree.
  if (!isOrgAdminLevel(session) && !(await canTouchUserAlignment(session, id))) {
    return jsonError("You can only remove people in your reporting line.", 403);
  }
  if (id === getUserId(session)) {
    return jsonError("You cannot remove yourself.", 400);
  }

  const user = await prisma.user.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, firstName: true, lastName: true, deletedAt: true },
  });
  if (!user) return jsonError("User not found", 404);

  const { searchParams } = new URL(req.url);
  const restore = searchParams.get("restore") === "true";

  if (restore) {
    // Restore a soft-deleted user
    await prisma.user.update({
      where: { id },
      data: { deletedAt: null, status: "ACTIVE" },
    });
    logActivity({
      type: "user_restored",
      actorId: getUserId(session),
      organizationId: orgId,
      description: `Restored ${user.firstName} ${user.lastName}`,
      targetId: id,
      targetType: "user",
    });
    return jsonSuccess({ message: `${user.firstName} ${user.lastName} has been restored` });
  }

  // Soft delete
  await prisma.user.update({
    where: { id },
    data: { deletedAt: new Date(), status: "INACTIVE" },
  });

  logActivity({
    type: "user_removed",
    actorId: getUserId(session),
    organizationId: orgId,
    description: `Removed ${user.firstName} ${user.lastName} from organization`,
    targetId: id,
    targetType: "user",
  });

  return jsonSuccess({ message: `${user.firstName} ${user.lastName} has been removed` });
}
