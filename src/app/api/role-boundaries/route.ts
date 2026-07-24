import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";

const RELATIONS = new Set(["OWNS", "CAN_REQUEST", "CANNOT_TOUCH"]);

// RoleBoundary — a role's explicit relation (CAN_REQUEST / CANNOT_TOUCH) to an
// area it does not own. OWNS is derived from OwnershipArea.ownerRoleId.
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const roleId = req.nextUrl.searchParams.get("roleId");
  const rows = await prisma.roleBoundary.findMany({
    where: { organizationId: getOrgId(session), ...(roleId ? { roleId } : {}) },
    include: { area: { include: { ownerRole: { select: { id: true, title: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  return jsonSuccess(rows);
}

// Idempotent: setting a relation for (roleId, areaId) upserts.
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  const orgId = getOrgId(session);

  const body = await req.json().catch(() => ({}));
  const { roleId, areaId } = body;
  const relation = body.relation ?? "CAN_REQUEST";
  if (!roleId || !areaId) return jsonError("roleId and areaId are required");
  if (!RELATIONS.has(relation)) return jsonError("relation must be OWNS | CAN_REQUEST | CANNOT_TOUCH");

  // Both must belong to the caller's org.
  const [role, area] = await Promise.all([
    prisma.role.findFirst({ where: { id: roleId, organizationId: orgId }, select: { id: true } }),
    prisma.ownershipArea.findFirst({ where: { id: areaId, organizationId: orgId }, select: { id: true } }),
  ]);
  if (!role || !area) return jsonError("Role or area not found", 404);

  const row = await prisma.roleBoundary.upsert({
    where: { roleId_areaId: { roleId, areaId } },
    update: { relation },
    create: { roleId, areaId, relation, organizationId: orgId },
    include: { area: { include: { ownerRole: { select: { id: true, title: true } } } } },
  });
  return jsonSuccess(row, 201);
}
