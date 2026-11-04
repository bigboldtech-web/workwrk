// SCIM 2.0 Groups, list and create. Groups are mapped onto existing
// Department rows: an IdP push of "this user joined the Engineering
// group" reassigns the person's department in WorkWrk. Cleaner than
// modeling a parallel SCIM group store.
//
// Members, read and written, are this workspace's (src/lib/scim-groups.ts,
// docs/plans/workspace-status-2.md E9 ii, step 5): everyone who holds a seat
// here in that department, the people here through a membership included,
// each placed on the row that holds their seat (their membership's
// department for them, never their account's). Before, only the people
// anchored here were read or written.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateScim, scimError, scimResponse } from "@/lib/scim-auth";
import { groupToScim, parseScimFilter, scimList } from "@/lib/scim-mappers";
import { addToGroupHere, groupMembersHere, groupWriteRetry } from "@/lib/scim-groups";

async function loadGroupWithMembers(orgId: string, deptId: string) {
  const dept = await prisma.department.findFirst({ where: { id: deptId, organizationId: orgId } });
  if (!dept) return null;
  const members = (await groupMembersHere(orgId, [dept.id])).get(dept.id) ?? [];
  return { id: dept.id, name: dept.name, members, createdAt: dept.createdAt, updatedAt: dept.updatedAt };
}

export async function GET(req: NextRequest) {
  const auth = await authenticateScim(req);
  if (!auth.ok) return auth.response;

  const sp = new URL(req.url).searchParams;
  const startIndex = Math.max(1, Number(sp.get("startIndex") ?? 1));
  const count = Math.min(Math.max(1, Number(sp.get("count") ?? 100)), 200);
  const filter = parseScimFilter(sp.get("filter"));

  const where: Record<string, unknown> = { organizationId: auth.organizationId };
  if (filter && filter.field === "displayName") where.name = filter.value;

  const [total, depts] = await Promise.all([
    prisma.department.count({ where }),
    prisma.department.findMany({
      where,
      orderBy: { name: "asc" },
      skip: startIndex - 1,
      take: count,
    }),
  ]);
  const membersOf = await groupMembersHere(auth.organizationId, depts.map((d) => d.id));

  const groups = depts.map((d) =>
    groupToScim({
      id: d.id,
      name: d.name,
      members: membersOf.get(d.id) ?? [],
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }),
  );

  return scimResponse(scimList(groups, total, startIndex));
}

export async function POST(req: NextRequest) {
  const auth = await authenticateScim(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  if (!body) return scimError(400, "Invalid JSON body");

  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  if (!displayName) return scimError(400, "displayName required", "invalidValue");

  const existing = await prisma.department.findFirst({
    where: { organizationId: auth.organizationId, name: displayName },
    select: { id: true },
  });
  if (existing) {
    return scimError(409, "Group already exists", "uniqueness");
  }

  const dept = await prisma.department.create({
    data: { name: displayName, organizationId: auth.organizationId },
  });

  // If members were supplied, place each in the new department here, at
  // the seat they hold here (src/lib/scim-groups.ts).
  if (Array.isArray(body.members) && body.members.length > 0) {
    const memberIds = body.members
      .map((m: { value?: string }) => m.value)
      .filter((v: unknown): v is string => typeof v === "string");
    if (memberIds.length > 0) {
      const busy = await groupWriteRetry(() => addToGroupHere(auth.organizationId, dept.id, memberIds));
      if (busy) return scimError(503, busy);
    }
  }

  const reloaded = await loadGroupWithMembers(auth.organizationId, dept.id);
  if (!reloaded) return scimError(500, "Group create succeeded but reload failed");
  return scimResponse(groupToScim(reloaded), 201);
}
