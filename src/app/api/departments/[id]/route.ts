// PUT    /api/departments/[id]: one field or several; the same writers as
//        POST. A parent that would put the department under itself (at any
//        depth) is a 409 `department_cycle`; head and parent must be the
//        org's own; a rename onto another department's name is a 409.
// PATCH  an alias of PUT (the drawer autosaves one field at a time).
// DELETE only when nobody (current or removed) is in it and it has no
//        sub-departments; otherwise a 409 that says what to move first.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId } from "@/lib/api-helpers";
import { mayWriteDepartments } from "@/lib/people/department-access.server";
import { wouldCreateCycle } from "@/lib/people/reporting-lines";

const err = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!(await mayWriteDepartments(session))) return err(403, "Only an Admin can edit departments.");
  const { id } = await params;
  const orgId = getOrgId(session);
  const dept = await prisma.department.findFirst({ where: { id, organizationId: orgId }, select: { id: true } });
  if (!dept) return err(404, "Department not found");

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return err(400, "Send a JSON object");
  const data: { name?: string; description?: string | null; color?: string | null; parentId?: string | null; headId?: string | null } = {};

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return err(400, "A department needs a name", { field: "name" });
    if (name.length > 80) return err(400, "A department name is up to 80 characters", { field: "name" });
    const dup = await prisma.department.findFirst({ where: { organizationId: orgId, id: { not: id }, name: { equals: name, mode: "insensitive" } }, select: { id: true } });
    if (dup) return err(409, "A department with that name already exists", { field: "name", code: "duplicate" });
    data.name = name;
  }
  if (body.description !== undefined) data.description = typeof body.description === "string" ? body.description.trim().slice(0, 2000) || null : null;
  if (body.color !== undefined) {
    // The eight-hue index (design-system 1.7), or null for none. Legacy hex
    // and CSS-var values are only ever read, never written again.
    if (body.color !== null && !(typeof body.color === "string" && /^[1-8]$/.test(body.color))) return err(400, "A colour is one of the eight hues", { field: "color" });
    data.color = body.color as string | null;
  }
  if (body.headId !== undefined) {
    const headId = typeof body.headId === "string" && body.headId ? body.headId : null;
    if (headId && !(await prisma.user.count({ where: { id: headId, organizationId: orgId, deletedAt: null } }))) {
      return err(400, "That head isn't in this workspace", { field: "headId" });
    }
    data.headId = headId;
  }
  if (body.parentId !== undefined) {
    const parentId = typeof body.parentId === "string" && body.parentId ? body.parentId : null;
    if (parentId) {
      const all = await prisma.department.findMany({ where: { organizationId: orgId }, select: { id: true, parentId: true } });
      if (!all.some((d) => d.id === parentId)) return err(400, "That parent department isn't in this workspace", { field: "parentId" });
      if (wouldCreateCycle(id, parentId, new Map(all.map((d) => [d.id, d.parentId])))) {
        return err(409, "A department can't sit under itself or one of its own sub-departments.", { field: "parentId", code: "department_cycle" });
      }
    }
    data.parentId = parentId;
  }
  if (Object.keys(data).length === 0) return err(400, "Nothing to change");
  const updated = await prisma.department.update({ where: { id }, data });
  return NextResponse.json(updated);
}

export const PATCH = PUT;

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!(await mayWriteDepartments(session))) return err(403, "Only an Admin can delete departments.");
  const { id } = await params;
  const orgId = getOrgId(session);
  const dept = await prisma.department.findFirst({
    where: { id, organizationId: orgId },
    include: { _count: { select: { members: true, subDepartments: true } } },
  });
  if (!dept) return err(404, "Department not found");
  const current = await prisma.user.count({ where: { departmentId: id, deletedAt: null } });
  if (dept._count.members > 0 || dept._count.subDepartments > 0) {
    const removed = dept._count.members - current;
    const parts = [
      current > 0 ? `${current} ${current === 1 ? "person" : "people"}` : null,
      removed > 0 ? `${removed} removed ${removed === 1 ? "person" : "people"}` : null,
      dept._count.subDepartments > 0 ? `${dept._count.subDepartments} sub-department${dept._count.subDepartments === 1 ? "" : "s"}` : null,
    ].filter(Boolean);
    return err(409, `Move ${parts.join(" and ")} out of this department first.`, { code: "not_empty" });
  }
  await prisma.department.delete({ where: { id } });
  return NextResponse.json({ message: "Department deleted" });
}
