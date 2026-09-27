import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";
import { checkPlanLimit } from "@/lib/plan-limits";
import { logActivity } from "@/lib/activity";
import { parsePaginationParams, paginatedResult, skipTake } from "@/lib/pagination";
import { getTeamUserIds } from "@/lib/team";
import { ORG_WIDE_ALIGNMENT_LEVELS } from "@/lib/alignment-scope";
import { seedAlignmentForUser } from "@/lib/alignment-assign";
import { getUserTagsMap, resolveUserIdsByTags } from "@/lib/user-tags";
import { orgRoleOf } from "@/lib/access/org-role";
import { grantableAccessLevel } from "@/lib/people/grantable-level";
import type { Prisma, UserStatus, AccessLevel } from "@/generated/prisma";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const departmentId = searchParams.get("departmentId");
  const status = searchParams.get("status");
  const accessLevel = searchParams.get("accessLevel");
  // scope:
  //   "team" — only the caller's reports + themselves
  //   "all"  — every active user in the org (org-wide levels only)
  // Default: org-wide levels get "all", everyone else gets "team".
  // The door is ORG_WIDE_ALIGNMENT_LEVELS — the same ladder the rest of
  // Teams uses — so a Director/VP/HR sees the same org here as elsewhere.
  const requestedScope = searchParams.get("scope");
  // ?tagIds=a,b — narrow to people carrying ANY of these person-tags. Resolved
  // live from TagAssignment, ANDed with the scope/other filters below.
  const tagIdsParam = searchParams.get("tagIds");
  const tagIds = tagIdsParam ? tagIdsParam.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const pagination = parsePaginationParams(req);

  const orgId = getOrgId(session);
  const callerId = getUserId(session);
  const callerLevel = (session.user as { accessLevel?: string }).accessLevel ?? "";
  const orgWide = ORG_WIDE_ALIGNMENT_LEVELS.has(callerLevel);

  const includeDeleted = searchParams.get("includeDeleted") === "true";
  const where: Prisma.UserWhereInput = { organizationId: orgId };
  if (!includeDeleted) where.deletedAt = null;
  if (departmentId) where.departmentId = departmentId;
  if (status) where.status = status as UserStatus;
  // The directory card carries no access level, so it cannot be filtered on
  // one either (a filter is a read).
  if (accessLevel && !(searchParams.get("scope") === "directory" && !ORG_WIDE_ALIGNMENT_LEVELS.has((session.user as { accessLevel?: string }).accessLevel ?? ""))) {
    where.accessLevel = accessLevel as AccessLevel;
  }

  // scope=directory (Phase 6, spec-teams-people section 1 Access): the
  // Directory and the Org chart are open to every Member (person_card VIEW
  // org-wide, access 3.5 and 9 `people.view`), so any Member may list the
  // whole org, but a caller who is not org-wide gets the directory CARD only
  // (below): no phone, no access level, no KRA count, and never a removed
  // person. Guests never list the directory (access 11 invariant 3).
  const callerRole = orgRoleOf({ accessLevel: callerLevel || null });
  const directoryCard = requestedScope === "directory" && !orgWide;
  if (requestedScope === "directory" && callerRole === "GUEST") return jsonError("Not found", 404);
  if (directoryCard) where.deletedAt = null;

  // Enforce scope. Non-org-wide callers can never escape team scope,
  // regardless of what they pass, except into the directory card above.
  // Stops a line manager from seeing org-wide people data.
  const effectiveScope = orgWide
    ? (requestedScope === "directory" ? "all" : requestedScope || "all")
    : directoryCard
      ? "directory"
      : "team";
  if (effectiveScope === "team") {
    const teamIds = await getTeamUserIds(orgId, callerId);
    where.id = teamIds.length > 0 ? { in: teamIds } : callerId;
  }
  if (pagination.search) {
    where.OR = [
      { firstName: { contains: pagination.search, mode: "insensitive" } },
      { lastName: { contains: pagination.search, mode: "insensitive" } },
      { email: { contains: pagination.search, mode: "insensitive" } },
    ];
  }

  // Tag filter — ANDed with scope via `AND` so it composes with the existing
  // `where.id` (team scope) instead of clobbering it. An empty resolved set
  // (a tag nobody has) correctly yields no rows.
  if (tagIds.length > 0) {
    const taggedIds = await resolveUserIdsByTags(orgId, tagIds);
    const andClause = (where.AND as Prisma.UserWhereInput[] | undefined) ?? [];
    andClause.push({ id: { in: taggedIds } });
    where.AND = andClause;
  }

  // id breaks ties so page N and page N+1 never overlap or skip a person
  // (fetch-all-pages.ts walks every page for the directory and org chart).
  const orderBy: Prisma.UserOrderByWithRelationInput[] = pagination.sortBy
    ? [{ [pagination.sortBy]: pagination.sortOrder } as Prisma.UserOrderByWithRelationInput, { id: "asc" }]
    : [{ firstName: "asc" }, { id: "asc" }];

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        avatar: true,
        phone: !directoryCard,
        status: true,
        accessLevel: !directoryCard,
        managerId: true,
        joinDate: true,
        deletedAt: true,
        department: { select: { id: true, name: true } },
        role: { select: { id: true, title: true } },
        manager: { select: { id: true, firstName: true, lastName: true } },
        // Filtered count — soft-deleted reports don't inflate "N reports".
        _count: { select: { directReports: { where: { deletedAt: null } }, kraAssignments: !directoryCard } },
      },
      orderBy,
      ...skipTake(pagination),
    }),
    prisma.user.count({ where }),
  ]);

  // Attach each person's tags (one batched query) so the directory can show
  // and filter by them without an N+1.
  const tagsByUser = await getUserTagsMap(orgId, users.map((u) => u.id));
  const usersWithTags = users.map((u) => ({ ...u, tags: tagsByUser.get(u.id) ?? [] }));

  return jsonSuccess(paginatedResult(usersWithTags, total, pagination));
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  // Plan limit enforcement
  const planCheck = await checkPlanLimit(getOrgId(session), "users");
  if (!planCheck.allowed) return jsonError(planCheck.message, 403);

  const body = await req.json();
  const { firstName, lastName, email, password, departmentId, roleId, accessLevel, managerId } = body;

  if (!firstName || !lastName || !email) {
    return jsonError("First name, last name, and email are required");
  }

  // Never take the level from the body on trust (grantable-level.ts).
  const level = grantableAccessLevel((session.user as { accessLevel?: string }).accessLevel, accessLevel);
  if (!level) return jsonError("You can't give that access level. An admin sets it in Members.", 403);

  const existing = await prisma.user.findFirst({
    where: { email, organizationId: getOrgId(session) },
  });
  if (existing) return jsonError("A user with this email already exists");

  const passwordHash = await bcrypt.hash(password || "Welcome@123", 12);

  const user = await prisma.user.create({
    data: {
      firstName,
      lastName,
      email,
      passwordHash,
      departmentId,
      roleId,
      accessLevel: level,
      managerId,
      organizationId: getOrgId(session),
    },
  });

  logActivity({
    type: "user_added",
    actorId: getUserId(session),
    organizationId: getOrgId(session),
    description: `Added new team member ${firstName} ${lastName}`,
    targetId: user.id,
    targetType: "user",
  });

  // Hybrid assignment: seed KRA/SOP defaults from the hire's role template.
  if (roleId) {
    try {
      await seedAlignmentForUser({
        userId: user.id,
        roleId,
        organizationId: getOrgId(session),
        assignedBy: getUserId(session),
      });
    } catch (e) {
      console.error("seedAlignmentForUser failed", e);
    }
  }

  return jsonSuccess(user, 201);
}
