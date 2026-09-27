import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { viewerFromSession } from "@/lib/access/viewer";

// GET /api/kudos/leaderboard?period=month|quarter|all&limit=
// The Kudos Leaderboard view (spec-teams-performance /kudos): per person,
// kudos received and given in the period, their top value and when they
// were last thanked, sorted by received. Default period: this month; the
// default limit (10) is the older "Most recognized" card's, and the page
// asks for up to 100.
//
// The response keeps the older fields (leaderboard[].kudosCount,
// topValues, totalKudos, month) beside the new ones.
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const viewer = await viewerFromSession();
  if (viewer?.orgRole === "GUEST") return jsonError("Not found", 404);

  const orgId = getOrgId(session);
  const url = new URL(req.url);
  const period = url.searchParams.get("period") === "quarter" ? "quarter" : url.searchParams.get("period") === "all" ? "all" : "month";
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get("limit") || "10", 10) || 10), 100);

  const now = new Date();
  const start = period === "month"
    ? new Date(now.getFullYear(), now.getMonth(), 1)
    : period === "quarter"
      ? new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
      : null;
  const where = { organizationId: orgId, ...(start ? { createdAt: { gte: start } } : {}) };

  const [received, given, valueRows, total] = await Promise.all([
    prisma.kudos.groupBy({ by: ["receiverId"], where, _count: { _all: true }, _max: { createdAt: true } }),
    prisma.kudos.groupBy({ by: ["giverId"], where, _count: { _all: true } }),
    prisma.kudos.groupBy({ by: ["receiverId", "companyValue"], where: { ...where, companyValue: { not: null } }, _count: { _all: true } }),
    prisma.kudos.count({ where }),
  ]);

  const givenBy = new Map(given.map((g) => [g.giverId, g._count._all] as const));
  const valuesBy = new Map<string, Array<{ value: string; count: number }>>();
  for (const v of valueRows) {
    if (!v.companyValue) continue;
    const list = valuesBy.get(v.receiverId) ?? [];
    list.push({ value: v.companyValue, count: v._count._all });
    valuesBy.set(v.receiverId, list);
  }
  const sorted = [...received]
    .sort((a, b) => b._count._all - a._count._all || (b._max.createdAt?.getTime() ?? 0) - (a._max.createdAt?.getTime() ?? 0) || (a.receiverId < b.receiverId ? -1 : 1))
    .slice(0, limit);

  const users = sorted.length
    ? await prisma.user.findMany({
        where: { id: { in: sorted.map((r) => r.receiverId) } },
        select: { id: true, firstName: true, lastName: true, avatar: true, role: { select: { title: true } }, department: { select: { name: true } } },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u] as const));

  const leaderboard = sorted.map((r) => {
    const user = userById.get(r.receiverId);
    const values = (valuesBy.get(r.receiverId) ?? []).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    return {
      userId: r.receiverId,
      name: user ? `${user.firstName} ${user.lastName}`.trim() : "Unknown",
      firstName: user?.firstName ?? null,
      lastName: user?.lastName ?? null,
      avatar: user?.avatar || null,
      role: user?.role?.title || null,
      department: user?.department?.name || "",
      kudosCount: r._count._all,
      received: r._count._all,
      given: givenBy.get(r.receiverId) ?? 0,
      topValue: values[0]?.value ?? null,
      topValues: values.slice(0, 3).map((v) => v.value),
      lastReceived: r._max.createdAt ? r._max.createdAt.toISOString() : null,
    };
  });

  const valueCounts = new Map<string, number>();
  for (const v of valueRows) if (v.companyValue) valueCounts.set(v.companyValue, (valueCounts.get(v.companyValue) ?? 0) + v._count._all);
  const topValues = [...valueCounts.entries()].sort(([, a], [, b]) => b - a).slice(0, 5).map(([value, count]) => ({ value, count }));

  return jsonSuccess({
    leaderboard,
    period,
    month: (start ?? new Date(now.getFullYear(), now.getMonth(), 1)).toISOString(),
    totalKudos: total,
    people: received.length,
    topValues,
  });
}
