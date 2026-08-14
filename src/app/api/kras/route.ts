import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { seedKraToRoleHolders } from "@/lib/alignment-assign";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess, isManager, requirePermission } from "@/lib/api-helpers";
import { parsePaginationParams, paginatedResult, skipTake } from "@/lib/pagination";
import { getTeamUserIds } from "@/lib/team";
import { logActivity } from "@/lib/activity";
import { KPI_ORDER } from "@/lib/alignment";
import type { Prisma } from "@/generated/prisma";

// Soft over-100 signal for a job title's KRA weights. Sums the role-level
// KRA.weight across every KRA on the role and flags a breach WITHOUT
// rejecting — an existing >100 role must stay editable so someone can
// rebalance it. `roleWeightTotal` is the running sum; `weightWarning` is
// advisory copy the UI can surface. Best-effort: never fails the write.
async function roleWeightSignal(
  roleId: string | null | undefined,
  organizationId: string,
): Promise<{ roleWeightTotal: number | null; weightWarning: string | null }> {
  if (!roleId) return { roleWeightTotal: null, weightWarning: null };
  try {
    const kras = await prisma.kRA.findMany({
      where: { roleId, organizationId },
      select: { weight: true },
    });
    const roleWeightTotal = Math.round(kras.reduce((s, k) => s + (k.weight || 0), 0) * 100) / 100;
    return {
      roleWeightTotal,
      weightWarning:
        roleWeightTotal > 100
          ? `This job title's KRA weights now total ${roleWeightTotal}% — over the 100% budget. Saved; trim a KRA weight to rebalance.`
          : null,
    };
  } catch {
    return { roleWeightTotal: null, weightWarning: null };
  }
}

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  // Job-title-first workspace: one role's KRAs only.
  const roleId = searchParams.get("roleId");
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
  const callerLevel = (session.user as { accessLevel?: string }).accessLevel ?? "";
  const orgWideRoles = new Set(["COMPANY_ADMIN", "SUPER_ADMIN", "C_LEVEL", "VP", "DIRECTOR", "HR"]);
  const isOrgWide = orgWideRoles.has(callerLevel);
  const isManagerLevel = isManager(session);

  const where: Prisma.KRAWhereInput = { organizationId: orgId };
  if (category) where.category = category;
  if (roleId) where.roleId = roleId;

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
        kpis: {
          select: {
            id: true, name: true, unit: true, type: true, frequency: true, targetValue: true,
            lowerIsBetter: true, direction: true, isNorthStar: true, ownership: true,
            description: true, kraId: true,
          },
          // North-star gauge first, then alphabetical.
          orderBy: KPI_ORDER,
        },
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
  const { name, description, category, roleId, weight } = body;

  if (!name) return jsonError("KRA name is required");
  // Role-level default weight: the share of the job title this area
  // carries. Holders inherit it as their starting weightage.
  if (weight != null && (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0 || weight > 100)) {
    return jsonError("Weight must be a number between 0 and 100");
  }

  // Role-first spine: a KRA exists ONLY inside a job title. Legacy
  // orphans (roleId null) stay readable and fixable via PATCH, but no
  // new orphan can ever be born.
  if (!roleId || typeof roleId !== "string") {
    return jsonError("KRA must belong to a job title — pick a role (roleId) first.");
  }
  const role = await prisma.role.findFirst({
    where: { id: roleId, organizationId: getOrgId(session) },
    select: { id: true },
  });
  if (!role) return jsonError("Job title not found in this organization", 404);

  const kra = await prisma.kRA.create({
    data: {
      name,
      description,
      category,
      roleId,
      ...(weight != null && { weight }),
      organizationId: getOrgId(session),
    },
  });

  // Everyone already holding this job title inherits the new KRA at
  // once — a role and its holders must never drift apart. Best-effort:
  // a seeding hiccup must not fail the KRA creation.
  try {
    await seedKraToRoleHolders({ kraId: kra.id, roleId, organizationId: getOrgId(session) });
  } catch (e) {
    console.error("seedKraToRoleHolders failed", e);
  }

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

  // Surface the job title's running weight budget so the UI can nudge a
  // rebalance when the new KRA pushes the role over 100%.
  const signal = await roleWeightSignal(roleId, getOrgId(session));
  return jsonSuccess({ ...kra, ...signal }, 201);
}

export async function PATCH(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePermission(session, "kras", "edit");
  if (denied) return denied;

  const body = await req.json();
  const { id, name, description, category, roleId, weight } = body;

  if (!id) return jsonError("KRA id is required");
  if (weight !== undefined && (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0 || weight > 100)) {
    return jsonError("Weight must be a number between 0 and 100");
  }

  const existing = await prisma.kRA.findFirst({
    where: { id, organizationId: getOrgId(session) },
  });
  if (!existing) return jsonError("KRA not found", 404);

  // Attaching to a job title must point at a real role of THIS org.
  // (Clearing to null stays possible so admins can re-home a KRA.)
  if (roleId) {
    const role = await prisma.role.findFirst({
      where: { id: roleId, organizationId: getOrgId(session) },
      select: { id: true },
    });
    if (!role) return jsonError("Job title not found in this organization", 404);
  }

  // Changing the role-level weight never rewrites existing holders'
  // weightage — per-person overrides stay put; only NEW seeds (and the
  // zero-value backfill script) pick the new default up.
  const kra = await prisma.kRA.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(category !== undefined && { category }),
      ...(roleId !== undefined && { roleId: roleId || null }),
      ...(weight !== undefined && { weight }),
    },
  });

  // Re-homing a KRA onto a job title (incl. fixing a legacy orphan) hands
  // it to everyone already holding that title. Same idempotent seed as
  // creation; never fails the update.
  if (roleId && roleId !== existing.roleId) {
    try {
      await seedKraToRoleHolders({ kraId: kra.id, roleId, organizationId: getOrgId(session) });
    } catch (e) {
      console.error("seedKraToRoleHolders failed", e);
    }
  }

  // Editing a weight (or re-homing the KRA) can tip the job title over its
  // 100% budget — surface the running total; never block the save.
  const signal = await roleWeightSignal(kra.roleId, getOrgId(session));
  return jsonSuccess({ ...kra, ...signal });
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
