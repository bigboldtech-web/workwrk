// GET  /api/departments: every Member (never a Guest). Each row carries the
//      head, the parent, the colour, `_count.members` over CURRENT people
//      only, `_count.roles` and `removedMembers` (removed people never block
//      a delete; the drawer says they will be taken out of the department).
//      A bare array, as every caller reads it.
//      With ?withAccess=1 a caller who may write departments also gets
//      `goalCount` per row: the goals a delete would take the department off
//      (as audience or as a Department goal's department), so the drawer can
//      name them before it asks. Nobody else sees how many goals a
//      department carries.
// POST /api/departments: Owner, Admin and whoever the permission matrix
//      grants organization.manageDepartments. Head and parent must be the
//      org's own; a duplicate name is a 409, not a 500.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { viewerFromSession } from "@/lib/access/viewer";
import { getSessionOrFail, getOrgId, LOOKUP_CACHE_HEADERS } from "@/lib/api-helpers";
import { mayWriteDepartments } from "@/lib/people/department-access.server";
import { departmentHue } from "@/lib/people/department-hue";

const err = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  // A Guest is an org role (orgRoleOf), not an AccessLevel value, so the
  // guard asks the viewer rather than comparing the level to "GUEST".
  if ((await viewerFromSession())?.orgRole === "GUEST") return err(404, "Not found");
  const orgId = getOrgId(session);

  const departments = await prisma.department.findMany({
    where: { organizationId: orgId },
    include: {
      head: { select: { id: true, firstName: true, lastName: true, avatar: true } },
      _count: { select: { members: { where: { deletedAt: null } }, roles: true } },
      subDepartments: { select: { id: true, name: true } },
    },
    orderBy: { name: "asc" },
  });
  const removed = await prisma.user.groupBy({
    by: ["departmentId"],
    where: { organizationId: orgId, deletedAt: { not: null }, departmentId: { not: null } },
    _count: { _all: true },
  });
  const removedBy = new Map(removed.map((r) => [r.departmentId, r._count._all]));
  const rows = departments.map((d) => ({
    ...d,
    hue: departmentHue(d.color).index,
    removedMembers: removedBy.get(d.id) ?? 0,
  }));
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  const canWrite = new URL(req.url).searchParams.get("withAccess") === "1" ? await mayWriteDepartments(session) : undefined;
  if (canWrite !== undefined) {
    if (!canWrite) return NextResponse.json({ data: rows, canWrite }, { headers: { "Cache-Control": "no-store" } });
    // The same "goals naming a department" rule DELETE /api/departments/[id]
    // enforces: one goal counts once per department, whether it names the
    // department as an audience row, as its own department, or both.
    const [audience, filed] = await Promise.all([
      prisma.goalAssignee.findMany({ where: { departmentId: { not: null }, okr: { organizationId: orgId } }, select: { departmentId: true, okrId: true } }),
      prisma.oKR.findMany({ where: { organizationId: orgId, departmentId: { not: null } }, select: { id: true, departmentId: true } }),
    ]);
    const goalsBy = new Map<string, Set<string>>();
    for (const [deptId, okrId] of [...audience.map((a) => [a.departmentId, a.okrId]), ...filed.map((o) => [o.departmentId, o.id])]) {
      if (!deptId) continue;
      goalsBy.set(deptId, (goalsBy.get(deptId) ?? new Set<string>()).add(okrId as string));
    }
    const withGoals = rows.map((d) => ({ ...d, goalCount: goalsBy.get(d.id)?.size ?? 0 }));
    return NextResponse.json({ data: withGoals, canWrite }, { headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(rows, fresh ? { headers: { "Cache-Control": "no-store" } } : { headers: LOOKUP_CACHE_HEADERS });
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!(await mayWriteDepartments(session))) return err(403, "Only an Admin can create departments.");
  const orgId = getOrgId(session);

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return err(400, "Department name is required", { field: "name" });
  if (name.length > 80) return err(400, "A department name is up to 80 characters", { field: "name" });
  const description = typeof body?.description === "string" ? body.description.trim().slice(0, 2000) || null : null;
  const color = typeof body?.color === "string" && /^[1-8]$/.test(body.color) ? body.color : null;
  const parentId = typeof body?.parentId === "string" && body.parentId ? body.parentId : null;
  const headId = typeof body?.headId === "string" && body.headId ? body.headId : null;

  if (parentId && !(await prisma.department.count({ where: { id: parentId, organizationId: orgId } }))) {
    return err(400, "That parent department isn't in this workspace", { field: "parentId" });
  }
  if (headId && !(await prisma.user.count({ where: { id: headId, organizationId: orgId, deletedAt: null } }))) {
    return err(400, "That head isn't in this workspace", { field: "headId" });
  }
  const dup = await prisma.department.findFirst({ where: { organizationId: orgId, name: { equals: name, mode: "insensitive" } }, select: { id: true } });
  if (dup) return err(409, "A department with that name already exists", { field: "name", code: "duplicate" });

  const department = await prisma.department.create({
    data: { name, description, color, parentId, headId, organizationId: orgId },
  });
  return NextResponse.json(department, { status: 201 });
}
