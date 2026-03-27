import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonSuccess } from "@/lib/api-helpers";

// GET: Monthly "Most Recognized" leaderboard
export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);

  // Current month boundaries
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  // Get all kudos this month grouped by receiver
  const monthlyKudos = await prisma.kudos.findMany({
    where: {
      organizationId: orgId,
      createdAt: { gte: monthStart, lte: monthEnd },
    },
    select: { receiverId: true, companyValue: true },
  });

  // Count per receiver
  const receiverCounts: Record<string, { count: number; values: string[] }> = {};
  for (const k of monthlyKudos) {
    if (!receiverCounts[k.receiverId]) {
      receiverCounts[k.receiverId] = { count: 0, values: [] };
    }
    receiverCounts[k.receiverId].count++;
    if (k.companyValue && !receiverCounts[k.receiverId].values.includes(k.companyValue)) {
      receiverCounts[k.receiverId].values.push(k.companyValue);
    }
  }

  // Sort by count, take top 10
  const sorted = Object.entries(receiverCounts)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 10);

  if (sorted.length === 0) {
    return jsonSuccess({ leaderboard: [], month: monthStart.toISOString(), totalKudos: 0 });
  }

  // Fetch user details
  const userIds = sorted.map(([id]) => id);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      avatar: true,
      role: { select: { title: true } },
      department: { select: { name: true } },
    },
  });

  const leaderboard = sorted.map(([userId, data]) => {
    const user = users.find((u) => u.id === userId);
    return {
      userId,
      name: user ? `${user.firstName} ${user.lastName}` : "Unknown",
      avatar: user?.avatar || null,
      role: user?.role?.title || "No role",
      department: user?.department?.name || "",
      kudosCount: data.count,
      topValues: data.values.slice(0, 3),
    };
  });

  // Top company values this month
  const valueCounts: Record<string, number> = {};
  for (const k of monthlyKudos) {
    if (k.companyValue) {
      valueCounts[k.companyValue] = (valueCounts[k.companyValue] || 0) + 1;
    }
  }
  const topValues = Object.entries(valueCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([value, count]) => ({ value, count }));

  return jsonSuccess({
    leaderboard,
    month: monthStart.toISOString(),
    totalKudos: monthlyKudos.length,
    topValues,
  });
}
