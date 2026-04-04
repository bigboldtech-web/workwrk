import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { getLatestScore, getScoreHistory } from "@/services/performanceScoreService";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const { id } = await params;

  const user = await prisma.user.findFirst({
    where: { id, organizationId: orgId },
    include: {
      department: { select: { id: true, name: true, color: true } },
      role: { select: { id: true, title: true } },
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

  return jsonSuccess({
    ...user,
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

  const allowedFields = ["firstName", "lastName", "phone", "avatar", "status", "departmentId", "roleId", "accessLevel", "managerId", "dateOfBirth", "officeId"];
  const data: any = {};
  for (const key of allowedFields) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  // Convert date strings to Date objects
  if (data.dateOfBirth) data.dateOfBirth = new Date(data.dateOfBirth);

  const user = await prisma.user.update({
    where: { id },
    data,
  });

  return jsonSuccess({ ...user, passwordHash: undefined });
}

// DELETE: Soft delete a user
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const { id } = await params;

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
