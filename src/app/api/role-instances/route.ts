import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";

// RoleInstance — Role × Scope held by a person (the cloneable instance).
const INSTANCE_INCLUDE = {
  scope: { select: { id: true, name: true, dimension: true } },
  user: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } },
  role: { select: { id: true, title: true } },
} as const;

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const roleId = req.nextUrl.searchParams.get("roleId");
  const rows = await prisma.roleInstance.findMany({
    where: { organizationId: getOrgId(session), ...(roleId ? { roleId } : {}) },
    include: INSTANCE_INCLUDE,
    orderBy: { createdAt: "asc" },
  });
  return jsonSuccess(rows);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const orgId = getOrgId(session);

  const body = await req.json().catch(() => ({}));
  const { roleId } = body;
  if (!roleId) return jsonError("roleId is required");
  const role = await prisma.role.findFirst({ where: { id: roleId, organizationId: orgId }, select: { id: true } });
  if (!role) return jsonError("Role not found", 404);

  try {
    const row = await prisma.roleInstance.create({
      data: {
        roleId,
        scopeId: body.scopeId ?? null,
        userId: body.userId ?? null,
        name: body.name ?? null,
        organizationId: orgId,
      },
      include: INSTANCE_INCLUDE,
    });
    return jsonSuccess(row, 201);
  } catch (e) {
    // Unique (roleId, scopeId) — an instance for this role+scope already exists.
    return jsonError(e instanceof Error && e.message.includes("Unique") ? "An instance already exists for this role and scope" : "Couldn't create instance");
  }
}
