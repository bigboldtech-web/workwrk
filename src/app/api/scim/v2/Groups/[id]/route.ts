// SCIM 2.0 Groups — single resource. GET / PUT / PATCH / DELETE.
// Group = Department in WorkWrk's data model. Member ops update
// User.departmentId.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateScim, scimError, scimResponse } from "@/lib/scim-auth";
import { groupToScim } from "@/lib/scim-mappers";

async function loadGroup(orgId: string, deptId: string) {
  const dept = await prisma.department.findFirst({
    where: { id: deptId, organizationId: orgId },
    include: {
      members: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });
  if (!dept) return null;
  return {
    id: dept.id,
    name: dept.name,
    members: dept.members.map((m) => ({
      id: m.id,
      display: `${m.firstName} ${m.lastName}`.trim() || m.email,
    })),
    createdAt: dept.createdAt,
    updatedAt: dept.updatedAt,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateScim(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const g = await loadGroup(auth.organizationId, id);
  if (!g) return scimError(404, "Group not found");
  return scimResponse(groupToScim(g));
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateScim(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return scimError(400, "Invalid JSON body");

  const dept = await prisma.department.findFirst({
    where: { id, organizationId: auth.organizationId },
  });
  if (!dept) return scimError(404, "Group not found");

  // Rename the department if displayName changed.
  if (typeof body.displayName === "string" && body.displayName.trim() && body.displayName.trim() !== dept.name) {
    await prisma.department.update({
      where: { id },
      data: { name: body.displayName.trim() },
    });
  }

  // Full replace of members. Users not in the new list lose this
  // department and end up unassigned (departmentId = null) — we don't
  // know which other dept to fall back to.
  if (Array.isArray(body.members)) {
    const newMemberIds = body.members
      .map((m: { value?: string }) => m.value)
      .filter((v: unknown): v is string => typeof v === "string");

    // Remove anyone currently in this dept who isn't in the new list.
    await prisma.user.updateMany({
      where: {
        organizationId: auth.organizationId,
        departmentId: id,
        id: { notIn: newMemberIds },
      },
      data: { departmentId: null },
    });
    // Add the new members.
    if (newMemberIds.length > 0) {
      await prisma.user.updateMany({
        where: { id: { in: newMemberIds }, organizationId: auth.organizationId },
        data: { departmentId: id },
      });
    }
  }

  const reloaded = await loadGroup(auth.organizationId, id);
  if (!reloaded) return scimError(500, "Group update succeeded but reload failed");
  return scimResponse(groupToScim(reloaded));
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateScim(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.Operations)) {
    return scimError(400, "Operations array required", "invalidSyntax");
  }

  const dept = await prisma.department.findFirst({
    where: { id, organizationId: auth.organizationId },
  });
  if (!dept) return scimError(404, "Group not found");

  for (const op of body.Operations as Array<{ op?: string; path?: string; value?: unknown }>) {
    const verb = (op.op ?? "").toLowerCase();

    // Add members: { op: "add", path: "members", value: [{ value: userId }, ...] }
    if (verb === "add" && op.path === "members" && Array.isArray(op.value)) {
      const ids = (op.value as Array<{ value?: string }>).map((m) => m.value).filter((v): v is string => typeof v === "string");
      if (ids.length > 0) {
        await prisma.user.updateMany({
          where: { id: { in: ids }, organizationId: auth.organizationId },
          data: { departmentId: id },
        });
      }
      continue;
    }

    // Remove members: { op: "remove", path: 'members[value eq "..."]' }
    if (verb === "remove" && typeof op.path === "string" && op.path.startsWith("members")) {
      // Parse the value out of the filter — `members[value eq "abc"]`
      const m = op.path.match(/value\s+eq\s+"([^"]+)"/);
      const memberId = m?.[1];
      if (memberId) {
        await prisma.user.updateMany({
          where: {
            id: memberId,
            organizationId: auth.organizationId,
            departmentId: id,
          },
          data: { departmentId: null },
        });
      } else if (Array.isArray(op.value)) {
        // Some IdPs send remove with a value array instead of a filter
        const ids = (op.value as Array<{ value?: string }>).map((v) => v.value).filter((v): v is string => typeof v === "string");
        if (ids.length > 0) {
          await prisma.user.updateMany({
            where: { id: { in: ids }, organizationId: auth.organizationId, departmentId: id },
            data: { departmentId: null },
          });
        }
      }
      continue;
    }

    // Replace displayName: { op: "replace", value: { displayName: "..." } } or path "displayName"
    if (verb === "replace") {
      let next: string | null = null;
      if (op.path === "displayName" && typeof op.value === "string") next = op.value.trim();
      else if (!op.path) {
        const v = op.value as Record<string, unknown> | undefined;
        if (typeof v?.displayName === "string") next = v.displayName.trim();
      }
      if (next && next !== dept.name) {
        await prisma.department.update({
          where: { id },
          data: { name: next },
        });
      }
    }
  }

  const reloaded = await loadGroup(auth.organizationId, id);
  if (!reloaded) return scimError(500, "Group patch succeeded but reload failed");
  return scimResponse(groupToScim(reloaded));
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateScim(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const dept = await prisma.department.findFirst({
    where: { id, organizationId: auth.organizationId },
    include: { _count: { select: { members: true } } },
  });
  if (!dept) return scimError(404, "Group not found");
  if (dept._count.members > 0) {
    return scimError(409, "Group has members — remove them first", "mutability");
  }

  await prisma.department.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
