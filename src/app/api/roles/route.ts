import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess, isManager, LOOKUP_CACHE_HEADERS } from "@/lib/api-helpers";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);

  // Additive alignment counts for the job-title-first workspace: every
  // role row carries how many KRAs it contains and how many KPI gauges
  // sit under those KRAs. Existing consumers read id/title/level/dept
  // and are unaffected by the extra fields.
  const [roles, kraKpiCounts] = await Promise.all([
    prisma.role.findMany({
      where: { organizationId: orgId },
      include: {
        department: { select: { id: true, name: true } },
        _count: { select: { users: true, kraTemplates: true } },
      },
      orderBy: { title: "asc" },
    }),
    prisma.kRA.findMany({
      where: { organizationId: orgId, roleId: { not: null } },
      select: { roleId: true, _count: { select: { kpis: true } } },
    }),
  ]);

  const kpiCountByRole = new Map<string, number>();
  for (const kra of kraKpiCounts) {
    if (!kra.roleId) continue;
    kpiCountByRole.set(kra.roleId, (kpiCountByRole.get(kra.roleId) ?? 0) + kra._count.kpis);
  }

  return jsonSuccess(
    roles.map((r) => ({ ...r, kpiCount: kpiCountByRole.get(r.id) ?? 0 })),
    200,
    LOOKUP_CACHE_HEADERS,
  );
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const { title, description, level, departmentId } = body;

  if (!title) return jsonError("Role title is required");

  const role = await prisma.role.create({
    data: {
      title,
      description,
      level: level || "EMPLOYEE",
      departmentId,
      organizationId: getOrgId(session),
    },
  });

  return jsonSuccess(role, 201);
}
