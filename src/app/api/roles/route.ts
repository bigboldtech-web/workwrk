import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { mayWriteJobTitles } from "@/lib/people/job-title-access.server";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess, LOOKUP_CACHE_HEADERS } from "@/lib/api-helpers";
import { isAssignableSeniority } from "@/lib/people/seniority";
import type { AccessLevel } from "@/generated/prisma";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  if ((session.user as { accessLevel?: string }).accessLevel === "GUEST") return jsonError("Not found", 404);

  // Additive alignment counts for the job-title-first workspace: every
  // role row carries how many KRAs it contains and how many KPI gauges
  // sit under those KRAs. Existing consumers read id/title/level/dept
  // and are unaffected by the extra fields.
  const [roles, kraKpiCounts] = await Promise.all([
    prisma.role.findMany({
      where: { organizationId: orgId },
      include: {
        department: { select: { id: true, name: true } },
        _count: {
          select: {
            // Headcount uses the ONE person predicate (not soft-deleted;
            // UserStatus has no TERMINATED value, offboarding IS the soft
            // delete) so role cards agree with the Directory.
            users: { where: { deletedAt: null } },
            kraTemplates: true,
          },
        },
      },
      orderBy: { title: "asc" },
    }),
    prisma.kRA.findMany({
      where: { organizationId: orgId, roleId: { not: null } },
      select: { roleId: true, _count: { select: { kpis: true } } },
    }),
  ]);

  // Removed people still hold their title (history), so the list can say
  // why a title with no current holders cannot be deleted yet.
  const removed = await prisma.user.groupBy({
    by: ["roleId"],
    where: { organizationId: orgId, deletedAt: { not: null }, roleId: { not: null } },
    _count: { _all: true },
  });
  const removedByRole = new Map(removed.map((r) => [r.roleId, r._count._all]));

  const kpiCountByRole = new Map<string, number>();
  for (const kra of kraKpiCounts) {
    if (!kra.roleId) continue;
    kpiCountByRole.set(kra.roleId, (kpiCountByRole.get(kra.roleId) ?? 0) + kra._count.kpis);
  }

  const rows = roles.map((r) => ({
    ...r,
    // Role.level is SENIORITY (display only, access 2.1); the alias is the
    // name every new reader uses until the column is renamed at step 8.
    seniority: r.level,
    kpiCount: kpiCountByRole.get(r.id) ?? 0,
    removedHolders: removedByRole.get(r.id) ?? 0,
  }));
  if (new URL(req.url).searchParams.get("withAccess") === "1") {
    return jsonSuccess({ data: rows, canWrite: await mayWriteJobTitles(session) }, 200, { "Cache-Control": "no-store" });
  }
  return jsonSuccess(rows, 200, LOOKUP_CACHE_HEADERS);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!(await mayWriteJobTitles(session))) return jsonError("Forbidden", 403);

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) return jsonError("A job title needs a name");
  if (title.length > 120) return jsonError("A job title is up to 120 characters");
  // `seniority` is the field; `level` is accepted as its alias for one release.
  const seniority = body?.seniority ?? body?.level ?? "EMPLOYEE";
  if (!isAssignableSeniority(seniority)) return jsonError("Pick one of the six seniority labels");
  const departmentId = typeof body?.departmentId === "string" && body.departmentId ? body.departmentId : null;
  if (departmentId && !(await prisma.department.count({ where: { id: departmentId, organizationId: getOrgId(session) } }))) {
    return jsonError("That department isn't in this workspace");
  }
  const description = typeof body?.description === "string" ? body.description.trim().slice(0, 4000) || null : null;

  const role = await prisma.role.create({
    data: {
      title,
      description,
      level: seniority as AccessLevel,
      departmentId,
      organizationId: getOrgId(session),
    },
  });

  return jsonSuccess(role, 201);
}
