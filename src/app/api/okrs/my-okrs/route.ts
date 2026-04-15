import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonSuccess } from "@/lib/api-helpers";

/**
 * GET /api/okrs/my-okrs
 * Returns OKRs relevant to the current user:
 * - Company OKRs (level=COMPANY)
 * - Team OKRs where user's department matches
 * - Individual OKRs where user is the owner
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

  const where: any = {
    organizationId: orgId,
    quarter,
    OR: [
      { level: "COMPANY" },
      { ownerId: userId },
    ],
  };
  if (me?.departmentId) {
    where.OR.push({ level: "TEAM", departmentId: me.departmentId });
  }

  const okrs = await prisma.oKR.findMany({
    where,
    include: {
      keyResults: { select: { id: true, title: true, startValue: true, currentValue: true, targetValue: true, unit: true } },
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

  // Compute progress per OKR
  const enriched = okrs.map((o) => {
    const krs = o.keyResults;
    let progress = 0;
    if (krs.length > 0) {
      const total = krs.reduce((sum, kr) => {
        const range = (kr.targetValue || 0) - (kr.startValue || 0);
        if (range <= 0) return sum + 0;
        const current = kr.currentValue || 0;
        const pct = Math.max(0, Math.min(100, ((current - (kr.startValue || 0)) / range) * 100));
        return sum + pct;
      }, 0);
      progress = Math.round(total / krs.length);
    }
    return {
      ...o,
      progress,
      owner: o.ownerId ? ownerMap.get(o.ownerId) || null : null,
      department: o.departmentId ? deptMap.get(o.departmentId) || null : null,
    };
  });

  return jsonSuccess({ okrs: enriched, quarter });
}
