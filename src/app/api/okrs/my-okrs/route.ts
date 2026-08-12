import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonSuccess } from "@/lib/api-helpers";
import { enrichKeyResultGroups, KR_KPI_SELECT, rollUpOkrProgress } from "@/lib/alignment";
import type { Prisma } from "@/generated/prisma";

/**
 * GET /api/okrs/my-okrs
 * Returns OKRs relevant to the current user:
 * - Company OKRs (level=COMPANY)
 * - Team OKRs where user's department matches
 * - Individual OKRs where user is the owner
 *
 * Each Key Result gets the last 8 check-ins so the client can render
 * a sparkline + "stale check-in" nudge without an extra round trip.
 *
 * Query param: quarter (optional, default = current quarter)
 */
export async function GET(req: Request) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const url = new URL(req.url);
  const quarter = url.searchParams.get("quarter") || (() => {
    const d = new Date();
    const q = Math.floor(d.getMonth() / 3) + 1;
    return `Q${q} ${d.getFullYear()}`;
  })();

  // Get the user's department
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { departmentId: true },
  });

  const or: Prisma.OKRWhereInput[] = [
    { level: "COMPANY" },
    { ownerId: userId },
  ];
  if (me?.departmentId) {
    or.push({ level: "DEPARTMENT", departmentId: me.departmentId });
  }
  const where: Prisma.OKRWhereInput = { organizationId: orgId, quarter, OR: or };

  const okrs = await prisma.oKR.findMany({
    where,
    include: {
      keyResults: {
        select: {
          id: true, title: true, startValue: true, currentValue: true,
          targetValue: true, unit: true, progress: true, kpiId: true,
          // The role-level gauge this KR pushes, when linked.
          kpi: { select: KR_KPI_SELECT },
          // Last 8 check-ins, oldest → newest, for sparkline rendering.
          checkIns: {
            orderBy: { createdAt: "desc" },
            take: 8,
            select: { id: true, value: true, note: true, createdAt: true },
          },
        },
      },
    },
    orderBy: [{ level: "asc" }, { createdAt: "desc" }],
  });

  // Owners and departments aren't Prisma relations on OKR — fetch separately
  const ownerIds = Array.from(new Set(okrs.map((o) => o.ownerId).filter((x): x is string => !!x)));
  const deptIds = Array.from(new Set(okrs.map((o) => o.departmentId).filter((x): x is string => !!x)));
  const [owners, depts] = await Promise.all([
    ownerIds.length > 0
      ? prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, firstName: true, lastName: true, avatar: true } })
      : Promise.resolve([]),
    deptIds.length > 0
      ? prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true, color: true } })
      : Promise.resolve([]),
  ]);
  const ownerMap = new Map(owners.map((u) => [u.id, u]));
  const deptMap = new Map(depts.map((d) => [d.id, d]));

  const STALE_AFTER_DAYS = 7;
  const now = Date.now();

  // KRs linked to a role KPI report that gauge's latest reading for their
  // owner (read-side derivation) instead of the hand-typed number.
  const derivedGroups = await enrichKeyResultGroups(
    okrs.map((o) => ({ userId: o.ownerId, keyResults: o.keyResults })),
  );

  // Compute progress per OKR + per-KR staleness
  const enriched = okrs.map((o, oi) => {
    const krs = derivedGroups[oi].map((kr) => {
      // Reverse so oldest → newest for nicer sparkline path math.
      const history = [...kr.checkIns].reverse();
      const lastAt = kr.checkIns[0]?.createdAt ?? null;
      const daysSinceCheckIn = lastAt
        ? Math.floor((now - new Date(lastAt).getTime()) / 86_400_000)
        : null;
      return {
        ...kr,
        checkIns: history,
        lastCheckInAt: lastAt,
        daysSinceCheckIn,
        isStale: daysSinceCheckIn === null || daysSinceCheckIn > STALE_AFTER_DAYS,
      };
    });

    const progress = rollUpOkrProgress(krs) ?? 0;

    return {
      ...o,
      keyResults: krs,
      progress,
      owner: o.ownerId ? ownerMap.get(o.ownerId) || null : null,
      department: o.departmentId ? deptMap.get(o.departmentId) || null : null,
      // Whether *I* own this OKR (drives "your goal" framing in the UI).
      isOwnedByMe: o.ownerId === userId,
    };
  });

  return jsonSuccess({ okrs: enriched, quarter });
}
