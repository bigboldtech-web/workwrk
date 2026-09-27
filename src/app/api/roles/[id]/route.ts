import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { mayWriteJobTitles } from "@/lib/people/job-title-access.server";
import { isAssignableSeniority } from "@/lib/people/seniority";
import type { AccessLevel } from "@/generated/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { KPI_ORDER } from "@/lib/alignment";

// GET: the full role-definition bundle: the Block-B view of a role.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const { id } = await params;
  const orgId = getOrgId(session);

  const role = await prisma.role.findFirst({
    where: { id, organizationId: orgId },
    include: {
      department: { select: { id: true, name: true } },
      kraTemplates: {
        include: {
          kpis: {
            select: {
              id: true, name: true, description: true, unit: true, frequency: true,
              type: true, ownership: true, formula: true, direction: true, isNorthStar: true,
              baselineValue: true, baselineLabel: true, targetValue: true, targetLabel: true, lowerIsBetter: true,
            },
            // North-star gauge first, then alphabetical.
            orderBy: KPI_ORDER,
          },
          sops: { select: { id: true, title: true, status: true } },
          _count: { select: { assignments: true } },
        },
        orderBy: { name: "asc" },
      },
      ownedAreas: { select: { id: true, name: true, description: true } },
      boundaries: {
        include: { area: { include: { ownerRole: { select: { id: true, title: true } } } } },
      },
      thresholds: { orderBy: { createdAt: "asc" } },
      instances: {
        include: {
          scope: { select: { id: true, name: true, dimension: true } },
          user: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      users: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } },
    },
  });
  if (!role) return jsonError("Role not found", 404);

  // All ownership areas in the org, so the boundary editor can pick any.
  const allAreas = await prisma.ownershipArea.findMany({
    where: { organizationId: orgId },
    include: { ownerRole: { select: { id: true, title: true } } },
    orderBy: { name: "asc" },
  });

  return jsonSuccess({ role, allAreas });
}

// PUT: Edit role
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!(await mayWriteJobTitles(session))) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);

  const role = await prisma.role.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!role) return jsonError("Role not found", 404);

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("Send a JSON object");
  const data: { title?: string; description?: string | null; level?: AccessLevel; departmentId?: string | null } = {};
  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return jsonError("A job title needs a name");
    if (title.length > 120) return jsonError("A job title is up to 120 characters");
    data.title = title;
  }
  if (body.description !== undefined) data.description = typeof body.description === "string" ? body.description.slice(0, 4000) || null : null;
  const seniority = body.seniority ?? body.level;
  if (seniority !== undefined) {
    // Display only: never an admin level unless the row already carries it.
    if (!isAssignableSeniority(seniority, role.level)) return jsonError("Pick one of the six seniority labels");
    data.level = seniority as AccessLevel;
  }
  if (body.departmentId !== undefined) {
    const departmentId = typeof body.departmentId === "string" && body.departmentId ? body.departmentId : null;
    if (departmentId && !(await prisma.department.count({ where: { id: departmentId, organizationId: orgId } }))) {
      return jsonError("That department isn't in this workspace");
    }
    data.departmentId = departmentId;
  }
  if (Object.keys(data).length === 0) return jsonError("Nothing to change");

  const updated = await prisma.role.update({ where: { id }, data });

  return jsonSuccess(updated);
}

// DELETE: Delete role (only if no users)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!(await mayWriteJobTitles(session))) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);

  const role = await prisma.role.findFirst({
    where: { id, organizationId: orgId },
    include: { _count: { select: { users: true, kraTemplates: true } } },
  });
  if (!role) return jsonError("Role not found", 404);

  // Holders include removed people (their history keeps the title), and
  // KRAs defined on the title would be orphaned, so both refuse with the
  // count and what to do first.
  if (role._count.users > 0) {
    const current = await prisma.user.count({ where: { roleId: id, deletedAt: null } });
    const removed = role._count.users - current;
    return jsonError(
      current > 0
        ? `${current} ${current === 1 ? "person holds" : "people hold"} this job title. Give them another title first.`
        : `${removed} removed ${removed === 1 ? "person still holds" : "people still hold"} this job title in their history, so it stays.`,
      409,
    );
  }
  if (role._count.kraTemplates > 0) {
    return jsonError(`This job title defines ${role._count.kraTemplates} KRA${role._count.kraTemplates === 1 ? "" : "s"}. Detach or delete them first.`, 409);
  }

  await prisma.role.delete({ where: { id } });

  return jsonSuccess({ message: "Role deleted" });
}

// PATCH: the same edit as PUT (the Details card autosaves one field at a time).
export const PATCH = PUT;
