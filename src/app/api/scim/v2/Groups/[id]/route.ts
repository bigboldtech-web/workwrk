// SCIM 2.0 Groups, a single resource: GET, PUT, PATCH, DELETE.
// Group = Department in WorkWrk's data model. Member ops set the
// department each member holds HERE (src/lib/scim-groups.ts,
// docs/plans/workspace-status-2.md E9 ii, step 5): the account's for
// someone anchored here, the membership's for someone here through one,
// never another workspace's. loadGroup lists both kinds, and DELETE counts
// both. Before, a member op wrote the accounts anchored here only
// (`organizationId` here), so the people here through a membership were
// skipped, and loadGroup and DELETE never saw them.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateScim, scimError, scimResponse } from "@/lib/scim-auth";
import { groupToScim } from "@/lib/scim-mappers";
import { addToGroupHere, groupMemberCountHere, groupMembersHere, groupWriteRetry, removeFromGroupHere, replaceGroupHere } from "@/lib/scim-groups";

async function loadGroup(orgId: string, deptId: string) {
  const dept = await prisma.department.findFirst({ where: { id: deptId, organizationId: orgId } });
  if (!dept) return null;
  const members = (await groupMembersHere(orgId, [dept.id])).get(dept.id) ?? [];
  return { id: dept.id, name: dept.name, members, createdAt: dept.createdAt, updatedAt: dept.updatedAt };
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

  // Full replace of members. People here not in the new list lose this
  // department and end up unassigned: which other department to fall back
  // to is not known.
  if (Array.isArray(body.members)) {
    const newMemberIds = body.members
      .map((m: { value?: string }) => m.value)
      .filter((v: unknown): v is string => typeof v === "string");
    const busy = await groupWriteRetry(() => replaceGroupHere(auth.organizationId, id, newMemberIds));
    if (busy) return scimError(503, busy);
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
        const busy = await groupWriteRetry(() => addToGroupHere(auth.organizationId, id, ids));
        if (busy) return scimError(503, busy);
      }
      continue;
    }

    // Remove members: { op: "remove", path: 'members[value eq "..."]' },
    // each only while they are still in this department here.
    if (verb === "remove" && typeof op.path === "string" && op.path.startsWith("members")) {
      // Parse the value out of the filter: `members[value eq "abc"]`
      const m = op.path.match(/value\s+eq\s+"([^"]+)"/);
      const memberId = m?.[1];
      // Some IdPs send remove with a value array instead of a filter.
      const ids = memberId
        ? [memberId]
        : Array.isArray(op.value)
          ? (op.value as Array<{ value?: string }>).map((v) => v.value).filter((v): v is string => typeof v === "string")
          : [];
      if (ids.length > 0) {
        const busy = await groupWriteRetry(() => removeFromGroupHere(auth.organizationId, id, ids));
        if (busy) return scimError(503, busy);
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

  const dept = await prisma.department.findFirst({ where: { id, organizationId: auth.organizationId } });
  if (!dept) return scimError(404, "Group not found");
  // Both kinds of member here (a removed seat never blocks it, as the
  // Settings delete rule: its account's key clears on the delete).
  if ((await groupMemberCountHere(auth.organizationId, id)) > 0) {
    return scimError(409, "Group has members. Remove them first.", "mutability");
  }

  await prisma.department.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
