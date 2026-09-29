// PUT    /api/departments/[id]: one field or several; the same writers as
//        POST. A parent that would put the department under itself (at any
//        depth) is a 409 `department_cycle`; head and parent must be the
//        org's own; a rename onto another department's name is a 409.
// PATCH  an alias of PUT (the drawer autosaves one field at a time).
// GET    the Delete section's preview, for whoever may write departments:
//        the goals that name this department (as their audience or as the
//        department of a Department goal). Titles only of goals the caller
//        can open; the rest are a count.
// DELETE only when no CURRENT person is in it and it has no sub-departments;
//        otherwise a 409 that says what to move first. Removed people never
//        block it: the product gives no way to edit a removed record, so a
//        department that held one could never be deleted without signing
//        them back in. They leave the department in the same transaction.
//        When goals name the department the caller must say how many it
//        agreed to detach (?detachGoals=N, the count the drawer showed), or
//        it is a 409 `has_goals`: the delete takes the department off those
//        goals' audiences (GoalAssignee cascades) and off Department goals
//        (OKR.departmentId goes to null), and nobody should learn that after
//        the fact. A count that no longer matches (a goal was added since the
//        drawer loaded) is the same 409 with the fresh count.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId } from "@/lib/api-helpers";
import { mayWriteDepartments } from "@/lib/people/department-access.server";
import { wouldCreateCycle } from "@/lib/people/reporting-lines";
import { canSeeGoal } from "@/lib/goal-audience";

const err = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

/** Every goal the delete would change: an audience row for the department,
 *  or a Department goal filed under it. One goal counts once. The list route
 *  counts the same way for its `goalCount` (route files can't share code). */
async function goalsNaming(orgId: string, id: string) {
  return prisma.oKR.findMany({
    where: { organizationId: orgId, OR: [{ departmentId: id }, { assignees: { some: { departmentId: id } } }] },
    select: { id: true, title: true, level: true, ownerId: true, departmentId: true },
    orderBy: { title: "asc" },
  });
}

const goalsWord = (n: number) => `${n} ${n === 1 ? "goal" : "goals"}`;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!(await mayWriteDepartments(session))) return err(403, "Only an Admin can delete departments.");
  const { id } = await params;
  const orgId = getOrgId(session);
  if (!(await prisma.department.count({ where: { id, organizationId: orgId } }))) return err(404, "Department not found");
  const all = await goalsNaming(orgId, id);
  // A People-team writer may not be able to open every goal: those stay a
  // count, so the preview never shows a title its viewer couldn't see.
  const seen = await Promise.all(all.map((g) => canSeeGoal(session, g)));
  const goals = all.filter((_, i) => seen[i]).map((g) => ({ id: g.id, title: g.title, level: g.level }));
  return NextResponse.json({ goals, hiddenGoals: all.length - goals.length, totalGoals: all.length }, { headers: { "Cache-Control": "no-store" } });
}

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

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!(await mayWriteDepartments(session))) return err(403, "Only an Admin can delete departments.");
  const { id } = await params;
  const orgId = getOrgId(session);
  const dept = await prisma.department.findFirst({
    where: { id, organizationId: orgId },
    include: { _count: { select: { members: { where: { deletedAt: null } }, subDepartments: true } } },
  });
  if (!dept) return err(404, "Department not found");
  const current = dept._count.members;
  if (current > 0 || dept._count.subDepartments > 0) {
    const parts = [
      current > 0 ? `${current} ${current === 1 ? "person" : "people"}` : null,
      dept._count.subDepartments > 0 ? `${dept._count.subDepartments} sub-department${dept._count.subDepartments === 1 ? "" : "s"}` : null,
    ].filter(Boolean);
    return err(409, `Move ${parts.join(" and ")} out of this department first.`, { code: "not_empty" });
  }
  const goals = (await goalsNaming(orgId, id)).length;
  const agreed = new URL(req.url).searchParams.get("detachGoals");
  if (goals > 0 && agreed !== String(goals)) {
    return err(409, `${goalsWord(goals)} ${goals === 1 ? "names" : "name"} this department. Deleting it takes the department off ${goals === 1 ? "that goal" : "those goals"}.`, { code: "has_goals", goals });
  }
  await prisma.$transaction([
    prisma.user.updateMany({ where: { organizationId: orgId, departmentId: id, deletedAt: { not: null } }, data: { departmentId: null } }),
    prisma.department.delete({ where: { id } }),
  ]);
  return NextResponse.json({ message: "Department deleted", detachedGoals: goals });
}
