import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess, isManager, requirePermission } from "@/lib/api-helpers";
import { parsePaginationParams, paginatedResult, skipTake } from "@/lib/pagination";
import { getTeamUserIds } from "@/lib/team";
import { logActivity } from "@/lib/activity";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  // scope:
  //   "all"  — every KRA in the org (admins / execs / HR)
  //   "team" — KRAs assigned to anyone in my recursive team
  //   "own"  — KRAs assigned to me
  // Default: admins+execs → "all", managers/team-leads → "team",
  // everyone else → "own". Non-admins can never escape their scope.
  const requestedScope = searchParams.get("scope");
  const pagination = parsePaginationParams(req);

  const orgId = getOrgId(session);
  const callerId = getUserId(session);
  const callerLevel = (session.user as any).accessLevel as string;
  const orgWideRoles = new Set(["COMPANY_ADMIN", "SUPER_ADMIN", "C_LEVEL", "VP", "DIRECTOR", "HR"]);
  const isOrgWide = orgWideRoles.has(callerLevel);
  const isManagerLevel = isManager(session);

  const where: any = { organizationId: orgId };
  if (category) where.category = category;

  const effectiveScope = isOrgWide
    ? (requestedScope || "all")
    : isManagerLevel
      ? "team"
      : "own";

  if (effectiveScope !== "all") {
    const userIds =
      effectiveScope === "team"
        ? await getTeamUserIds(orgId, callerId)
        : [callerId];
    where.assignments = { some: { userId: { in: userIds }, status: "ACTIVE" } };
  }
  if (pagination.search) {
    where.OR = [
      { name: { contains: pagination.search, mode: "insensitive" } },
      { description: { contains: pagination.search, mode: "insensitive" } },
    ];
  }

  const [kras, total] = await Promise.all([
    prisma.kRA.findMany({
      where,
      include: {
        role: { select: { id: true, title: true } },
        kpis: { select: { id: true, name: true, unit: true, type: true, frequency: true, targetValue: true, lowerIsBetter: true, description: true, kraId: true } },
        _count: { select: { assignments: true } },
      },
      orderBy: { name: "asc" },
      ...skipTake(pagination),
    }),
    prisma.kRA.count({ where }),
  ]);

  return jsonSuccess(paginatedResult(kras, total, pagination));
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePermission(session, "kras", "create");
  if (denied) return denied;

  const body = await req.json();
  const { name, description, category, roleId } = body;

  if (!name) return jsonError("KRA name is required");

  const kra = await prisma.kRA.create({
    data: {
      name,
      description,
      category,
      roleId,
      organizationId: getOrgId(session),
    },
  });

  // KRAs anchor performance / KPI tracking — every creation should
  // show up in the org's history of "how did we measure people."
  logActivity({
    type: "kra.create",
    actorId: getUserId(session),
    organizationId: getOrgId(session),
    description: `Created KRA: ${kra.name}`,
    targetId: kra.id,
    targetType: "KRA",
    metadata: { name, category, roleId },
  });

  return jsonSuccess(kra, 201);
}

export async function PATCH(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePermission(session, "kras", "edit");
  if (denied) return denied;

  const body = await req.json();
  const { id, name, description, category, roleId } = body;

  if (!id) return jsonError("KRA id is required");

  const existing = await prisma.kRA.findFirst({
    where: { id, organizationId: getOrgId(session) },
  });
  if (!existing) return jsonError("KRA not found", 404);

  const kra = await prisma.kRA.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(category !== undefined && { category }),
      ...(roleId !== undefined && { roleId: roleId || null }),
    },
  });

  return jsonSuccess(kra);
}

export async function DELETE(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePermission(session, "kras", "delete");
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return jsonError("KRA id is required");

  const existing = await prisma.kRA.findFirst({
    where: { id, organizationId: getOrgId(session) },
  });
  if (!existing) return jsonError("KRA not found", 404);

  await prisma.kRA.delete({ where: { id } });

  return jsonSuccess({ message: "KRA deleted" });
}
