import { NextRequest, NextResponse } from "next/server";
import { managersWithSeatHere, ownHere, placementsHere } from "@/lib/access/profile-here";
import { mergeOrdered } from "@/lib/access/seated-here";
import { joinedHere } from "@/lib/access/joined-here";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";
import { lockWorkspaceSeats, seatsFor } from "@/lib/seats";
import { logActivity } from "@/lib/activity";
import { parsePaginationParams, paginatedResult, skipTake, type PaginationParams } from "@/lib/pagination";
import { getTeamUserIds } from "@/lib/team";
import { ORG_WIDE_ALIGNMENT_LEVELS } from "@/lib/alignment-scope";
import { seedAlignmentForUser } from "@/lib/alignment-assign";
import { getUserTagsMap, resolveUserIdsByTags } from "@/lib/user-tags";
import { orgRoleOf } from "@/lib/access/org-role";
import { freshActorRefusal, freshWorkspaceActor } from "@/lib/access/workspace-admin";
import { legacyIsAdminLevel, legacyIsManagerLevel } from "@/lib/access/legacy-levels";
import { grantableAccessLevel } from "@/lib/people/grantable-level";
import type { Prisma, UserStatus, AccessLevel } from "@/generated/prisma";
import { directoryList, reportsHere } from "@/lib/people/directory-list.server";
import { isReservedStaffAddress, STAFF_ADDRESS_REFUSAL } from "@/lib/platform-admin";
import { policyFromOrgSettings, validatePassword } from "@/lib/password-policy";
import { managerCandidateIn } from "@/lib/access/manager-candidate";
import { lockOrgRoles } from "@/lib/access/membership";
import { rolesBusyOrThrow } from "@/lib/access/roles-busy";
import { LOCKED_TX } from "@/lib/access/org-roles-busy";
import { ENDED_SEAT_ADD_REFUSAL, alreadyInOrg, anchoredEndedRefusal } from "@/lib/auth/invite-facts.server";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  // The Directory and the Org chart (Phase 6, spec-teams-people /people and
  // /organization): every Member reads the whole org's directory cards, with
  // server filters, sort and pagination, and people data only for the people
  // the viewer may read. The other scopes below keep their callers' contract.
  if (searchParams.get("scope") === "directory" || searchParams.get("fields") === "chart") {
    return directoryList(req);
  }
  const departmentId = searchParams.get("departmentId");
  const status = searchParams.get("status");
  const accessLevel = searchParams.get("accessLevel");
  // scope:
  //   "team": only the caller's reports + themselves
  //   "all" : every active user in the org (org-wide levels only)
  // Default: org-wide levels get "all", everyone else gets "team".
  // The door is ORG_WIDE_ALIGNMENT_LEVELS: the same ladder the rest of
  // Teams uses: so a Director/VP/HR sees the same org here as elsewhere.
  const requestedScope = searchParams.get("scope");
  // ?tagIds=a,b: narrow to people carrying ANY of these person-tags. Resolved
  // live from TagAssignment, ANDed with the scope/other filters below.
  const tagIdsParam = searchParams.get("tagIds");
  const tagIds = tagIdsParam ? tagIdsParam.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const pagination = parsePaginationParams(req);

  const orgId = getOrgId(session);
  const callerId = getUserId(session);
  const callerLevel = (session.user as { accessLevel?: string }).accessLevel ?? "";
  const orgWide = ORG_WIDE_ALIGNMENT_LEVELS.has(callerLevel);

  const includeDeleted = searchParams.get("includeDeleted") === "true";
  // ?employed=1: everyone who can still be given work (on leave, on probation
  // and serving notice included), never someone deactivated.
  const employed = searchParams.get("employed") === "1" && !status;
  // The directory card carries no access level, so it cannot be filtered on
  // one either (a filter is a read).
  const levelFilter = accessLevel && !(searchParams.get("scope") === "directory" && !ORG_WIDE_ALIGNMENT_LEVELS.has((session.user as { accessLevel?: string }).accessLevel ?? ""))
    ? (accessLevel as AccessLevel)
    : null;

  // scope=directory (Phase 6, spec-teams-people section 1 Access): the
  // Directory and the Org chart are open to every Member (person_card VIEW
  // org-wide, access 3.5 and 9 `people.view`), so any Member may list the
  // whole org, but a caller who is not org-wide gets the directory CARD only
  // (below): no phone, no access level, no KRA count, and never a removed
  // person. Guests never list the directory (access 11 invariant 3).
  const callerRole = orgRoleOf({ accessLevel: callerLevel || null });
  const directoryCard = requestedScope === "directory" && !orgWide;
  if (requestedScope === "directory" && callerRole === "GUEST") return jsonError("Not found", 404);
  const removedToo = includeDeleted && !directoryCard;

  // What is asked of the PERSON, the same for both halves below: the team
  // scope, the search words, the tags.
  const person: Prisma.UserWhereInput[] = [];
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
    person.push(teamIds.length > 0 ? { id: { in: teamIds } } : { id: callerId });
  }
  // Matched WORD BY WORD, as /api/people/pick does: a person types the name
  // they know, "Zoe Young", and it lives in two columns, so one `contains`
  // over the whole text matched no single column and a search found no one.
  // Each word must match the first name, the last name or the email; the
  // words are capped so a pasted paragraph cannot fan out.
  const words = (pagination.search ?? "").split(/\s+/).filter(Boolean).slice(0, 6);
  for (const word of words) {
    person.push({
      OR: [
        { firstName: { contains: word, mode: "insensitive" } },
        { lastName: { contains: word, mode: "insensitive" } },
        { email: { contains: word, mode: "insensitive" } },
      ],
    });
  }
  // Tag filter: ANDed with scope so it composes with the team scope instead
  // of clobbering it. An empty resolved set (a tag nobody has) correctly
  // yields no rows.
  if (tagIds.length > 0) person.push({ id: { in: await resolveUserIdsByTags(orgId, tagIds) } });

  // What is asked of the SEAT, read from the row that holds it
  // (docs/plans/workspace-status-2.md E12, step 6): the account for someone
  // anchored here, the membership for someone who works here through one
  // (its status, removal, level and department here), so a contractor who
  // last opened their agency is listed here with this workspace's values.
  // Before, only people anchored here were listed.
  const where: Prisma.UserWhereInput = { organizationId: orgId };
  if (!removedToo) where.deletedAt = null;
  if (departmentId) where.departmentId = departmentId;
  if (status) where.status = status as UserStatus;
  else if (employed) where.status = { not: "INACTIVE" };
  if (levelFilter) where.accessLevel = levelFilter;
  if (person.length > 0) where.AND = person;
  // A seat asked for as live also needs its account not ended (D12).
  const liveAsked = employed || (!!status && status !== "INACTIVE");
  const seatWhere: Prisma.OrganizationMembershipWhereInput = {
    organizationId: orgId,
    ...(removedToo ? {} : { removedAt: null }),
    ...(departmentId ? { departmentId } : {}),
    ...(status ? { status: status as UserStatus } : employed ? { status: { not: "INACTIVE" as const } } : {}),
    ...(levelFilter ? { role: levelFilter } : {}),
    user: {
      organizationId: { not: orgId },
      ...(removedToo ? {} : { deletedAt: null }),
      ...(liveAsked ? { status: { not: "INACTIVE" as const } } : {}),
      ...(person.length > 0 ? { AND: person } : {}),
    },
  };

  const select = {
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
    // With their workspace: only this workspace's own are answered (D18).
    department: { select: { id: true, name: true, organizationId: true } },
    role: { select: { id: true, title: true, organizationId: true } },
    // The reports are counted HERE below (reportsHere), never by the
    // cross-workspace directReports relation (workspace-status-2.md E1).
    // KRA assignments are counted where they were before: never for the
    // directory card (a scope=directory request is answered by
    // directoryList above, so this select is never left empty).
    _count: { select: { kraAssignments: !directoryCard } },
  } satisfies Prisma.UserSelect;

  const memberTotal = await prisma.organizationMembership.count({ where: seatWhere });
  let users: Prisma.UserGetPayload<{ select: typeof select }>[];
  let total: number;
  let seatOf = new Map<string, UsersSeatRow>();
  if (memberTotal === 0) {
    // Nobody here through a membership matches: the database sorts and
    // pages, as it always has. id breaks ties so page N and page N+1 never
    // overlap or skip a person (fetch-all-pages.ts walks every page for the
    // directory and org chart).
    const orderBy: Prisma.UserOrderByWithRelationInput[] = pagination.sortBy
      ? [{ [pagination.sortBy]: pagination.sortOrder } as Prisma.UserOrderByWithRelationInput, { id: "asc" }]
      : [{ firstName: "asc" }, { id: "asc" }];
    [users, total] = await Promise.all([
      prisma.user.findMany({ where, select, orderBy, ...skipTake(pagination) }),
      prisma.user.count({ where }),
    ]);
  } else {
    const page = await pageOfBothHalves(where, seatWhere, pagination);
    total = (await prisma.user.count({ where })) + memberTotal;
    seatOf = page.seats;
    const rows = page.ids.length ? await prisma.user.findMany({ where: { id: { in: page.ids } }, select }) : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    users = page.ids.map((id) => byId.get(id)).filter((u): u is NonNullable<typeof u> => !!u);
  }

  // Attach each person's tags (one batched query) so the directory can show
  // and filter by them without an N+1.
  const tagsByUser = await getUserTagsMap(orgId, users.map((u) => u.id));
  // THE LINE HERE (docs/plans/workspace-status-2.md E1, step 3): the
  // manager each row's seat here holds, the account's line for someone
  // anchored here and the membership's own for someone here through one,
  // never the account's line of another workspace. A department or job
  // title of another workspace, and a manager who holds no seat here, are
  // never answered (D18, profile-here.ts).
  const lineOf = (u: (typeof users)[number]) => (seatOf.has(u.id) ? seatOf.get(u.id)!.managerId ?? null : u.managerId);
  const managersHere = await managersWithSeatHere(orgId, users.map(lineOf));
  // What this workspace holds of the people here through a membership: the
  // placement on their membership, and their KRAs here (never their
  // account's in another workspace); and everyone's reports here.
  const memberIds = users.filter((u) => seatOf.has(u.id)).map((u) => u.id);
  const [placed, reports, kras, managerRows] = await Promise.all([
    placementsHere(orgId, memberIds.map((id) => seatOf.get(id)!)),
    reportsHere(orgId, users.map((u) => u.id)),
    memberIds.length && !directoryCard
      ? prisma.kRAAssignment.groupBy({ by: ["userId"], where: { userId: { in: memberIds }, kra: { organizationId: orgId } }, _count: { _all: true } })
      : Promise.resolve([] as Array<{ userId: string; _count: { _all: number } }>),
    managersHere.size ? prisma.user.findMany({ where: { id: { in: [...managersHere] } }, select: { id: true, firstName: true, lastName: true } }) : Promise.resolve([] as Array<{ id: string; firstName: string; lastName: string }>),
  ]);
  const krasHere = new Map(kras.map((k) => [k.userId, k._count._all]));
  const managerOf = new Map(managerRows.map((m) => [m.id, m]));
  const usersWithTags = users.map((u) => {
    const line = lineOf(u);
    const shown = line && managersHere.has(line) ? line : null;
    const base = {
      ...u,
      department: ownHere(u.department, orgId),
      role: ownHere(u.role, orgId),
      managerId: shown,
      manager: shown ? managerOf.get(shown) ?? null : null,
      tags: tagsByUser.get(u.id) ?? [],
      _count: { directReports: reports.get(u.id) ?? 0, ...(directoryCard ? {} : { kraAssignments: u._count.kraAssignments }) },
    };
    const m = seatOf.get(u.id);
    if (!m) return base;
    const dept = m.departmentId ? placed.department.get(m.departmentId) : undefined;
    const title = m.roleId ? placed.role.get(m.roleId) : undefined;
    return {
      ...base,
      status: m.status,
      ...(directoryCard ? {} : { accessLevel: m.role }),
      joinDate: m.joinDate ?? joinedHere(m, m.user),
      deletedAt: m.removedAt,
      department: dept ? { id: dept.id, name: dept.name } : null,
      role: title ? { id: title.id, title: title.title } : null,
      _count: { directReports: reports.get(u.id) ?? 0, ...(directoryCard ? {} : { kraAssignments: krasHere.get(u.id) ?? 0 }) },
    };
  });

  return jsonSuccess(paginatedResult(usersWithTags, total, pagination));
}

/** A membership here as the list reads it, with the account's keys. */
const USERS_SEAT_SELECT = {
  userId: true, role: true, status: true, removedAt: true, departmentId: true, roleId: true, officeId: true, managerId: true,
  joinDate: true, weeklyCapacityHours: true, orgRole: true, isAgent: true, createdAt: true, isPrimary: true,
} as const;
type UsersSeatRow = Prisma.OrganizationMembershipGetPayload<{ select: typeof USERS_SEAT_SELECT }> & { user: { id: string; createdAt: Date } & Record<string, unknown> };

/** The account's own columns a list sorts by in the database, half by half, then merged. */
const PERSON_SORTS = new Set(["firstName", "lastName", "email"]);
/** Postgres sorts an enum by its declaration order (prisma/schema.prisma), so the in-memory sort does too. */
const LEVEL_ORDER = ["SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR", "MANAGER", "TEAM_LEAD", "EMPLOYEE", "AGENT", "HR"];
const STATUS_ORDER = ["ACTIVE", "INACTIVE", "ON_LEAVE", "PROBATION", "PIP", "NOTICE_PERIOD"];
const TEXT = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** A membership seat's value for a sort column the seat holds here (D1, D18); the account's for any other. */
function seatKey(m: UsersSeatRow, key: string): unknown {
  switch (key) {
    case "status": return String(m.status);
    case "accessLevel": return String(m.role);
    case "deletedAt": return m.removedAt;
    case "joinDate": return m.joinDate ?? joinedHere(m, m.user);
    case "departmentId": return m.departmentId;
    case "roleId": return m.roleId;
    case "officeId": return m.officeId;
    // The line their membership holds here (workspace-status-2.md E1), never the account's.
    case "managerId": return m.managerId;
    case "weeklyCapacityHours": return m.weeklyCapacityHours;
    case "orgRole": return m.orgRole;
    case "isAgent": return m.isAgent;
    default: return m.user[key];
  }
}

/** Two keys in Postgres's order for this column: enums by declaration, text by collation, nulls last ascending and first descending. */
function compareKey(key: string, order: "asc" | "desc", a: unknown, b: unknown): number {
  if (a == null || b == null) {
    if (a == null && b == null) return 0;
    return (a == null) === (order === "desc") ? -1 : 1;
  }
  const sign = order === "desc" ? -1 : 1;
  if (key === "accessLevel") return sign * (LEVEL_ORDER.indexOf(String(a)) - LEVEL_ORDER.indexOf(String(b)));
  if (key === "status") return sign * (STATUS_ORDER.indexOf(String(a)) - STATUS_ORDER.indexOf(String(b)));
  if (a instanceof Date && b instanceof Date) return sign * (a.getTime() - b.getTime());
  if (typeof a === "number" && typeof b === "number") return sign * (a - b);
  if (typeof a === "boolean" && typeof b === "boolean") return sign * (Number(a) - Number(b));
  return sign * TEXT.compare(String(a), String(b));
}

/**
 * One page of the list when people here through a membership are among the
 * matches (E12, step 6): the people anchored here and the memberships here,
 * each half read with the sort key. A sort by name or email (the account's
 * own) is read in the database per half up to the page's end, then merged
 * (seated-here.ts mergeOrdered); any other sort reads every match's key at
 * the seat that holds it, in memory over the matching ids (as Members does),
 * so nobody is sorted by another workspace's level, status or join date.
 * Ties by id, as the database path breaks them.
 */
async function pageOfBothHalves(
  where: Prisma.UserWhereInput,
  seatWhere: Prisma.OrganizationMembershipWhereInput,
  pagination: PaginationParams,
): Promise<{ ids: string[]; seats: Map<string, UsersSeatRow> }> {
  const key = pagination.sortBy ?? "firstName";
  const order = pagination.sortBy ? pagination.sortOrder : "asc";
  const { skip, take } = skipTake(pagination);
  const byDb = PERSON_SORTS.has(key);
  const [anchored, members] = await Promise.all([
    prisma.user.findMany({
      where,
      select: { id: true, [key]: true } as Prisma.UserSelect,
      ...(byDb ? { orderBy: [{ [key]: order } as Prisma.UserOrderByWithRelationInput, { id: "asc" as const }], take: skip + take } : {}),
    }) as unknown as Promise<Array<{ id: string } & Record<string, unknown>>>,
    prisma.organizationMembership.findMany({
      where: seatWhere,
      select: { ...USERS_SEAT_SELECT, user: { select: { id: true, createdAt: true, [key]: true } as Prisma.UserSelect } },
      ...(byDb ? { orderBy: [{ user: { [key]: order } } as Prisma.OrganizationMembershipOrderByWithRelationInput, { userId: "asc" as const }], take: skip + take } : {}),
    }) as unknown as Promise<UsersSeatRow[]>,
  ]);
  type Keyed = { id: string; key: unknown };
  const cmp = (a: Keyed, b: Keyed) => compareKey(key, order, a.key, b.key) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const a: Keyed[] = anchored.map((u) => ({ id: u.id, key: u[key] }));
  const b: Keyed[] = members.map((m) => ({ id: m.userId, key: seatKey(m, key) }));
  const all = byDb ? mergeOrdered(a, b, cmp) : [...a, ...b].sort(cmp);
  return { ids: all.slice(skip, skip + take).map((k) => k.id), seats: new Map(members.map((m) => [m.userId, m])) };
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);
  // The level as the database holds it now: a person demoted a moment ago
  // must not create an account on the level their token still claims.
  const fresh = await freshWorkspaceActor(session);
  if (!fresh.ok) return freshActorRefusal(fresh);
  if (!legacyIsManagerLevel(fresh.level)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const { firstName, lastName, email, password, departmentId, roleId, accessLevel, managerId } = body;

  if (!firstName || !lastName || !email) {
    return jsonError("First name, last name, and email are required");
  }

  // Never take the level from the body on trust (grantable-level.ts).
  const level = grantableAccessLevel(fresh.level, accessLevel);
  if (!level) return jsonError("You can't give that access level. An admin sets it in Members.", 403);

  // Reports to: a live person of this workspace, never an Agent (access 2.4,
  // AGENT_TIER_BLURB), the rule every other door that writes a manager holds.
  // It was written as sent.
  const reportsTo = managerId === undefined || managerId === null || managerId === "" ? null : managerId;
  if (reportsTo !== null) {
    if (typeof reportsTo !== "string") return jsonError("managerId is a person's id");
    const candidate = await managerCandidateIn(getOrgId(session), reportsTo);
    if (candidate === "not_found") return jsonError("That manager isn't in this workspace");
    if (candidate === "agent_cannot_manage") return NextResponse.json({ error: "An Agent can't be anyone's manager", code: "agent_cannot_manage" }, { status: 400 });
  }

  // Job title and department: the workspace's own, or none (docs-found
  // fixes batch 5). They were written as sent, so an id from another
  // workspace put its job title and department on this person's record.
  const placement = await placementIn(getOrgId(session), { departmentId, roleId });
  if (!placement.ok) return NextResponse.json({ error: placement.error, field: placement.field }, { status: 400 });

  // Already here, as their own account or through a membership (someone who
  // last switched to another workspace is still in this one): one address,
  // one person (invite-facts.server.ts alreadyInOrg, the check /join makes).
  if (typeof email !== "string") return jsonError("Enter an email address");
  const inOrg = await alreadyInOrg(email, getOrgId(session));
  // Ended where they are anchored here (D4): refused as before, saying the
  // way back (the final review, product M5).
  const ended = anchoredEndedRefusal(inOrg, legacyIsAdminLevel(fresh.level));
  if (ended) return jsonError(ended);
  if (inOrg.member) return jsonError("A user with this email already exists");
  // Someone whose membership here was ended (docs/plans/workspace-status.md
  // D13) comes back through an invitation, never as a second account, and
  // only an Admin brings them back (the final review, product L3: one rule,
  // and no Manager sent to an invite that refuses them).
  if (inOrg.inactive) return jsonError(ENDED_SEAT_ADD_REFUSAL);
  // The creator chooses this account's password, so it may never carry a
  // WorkwrK staff address (platform-admin.ts).
  if (typeof email === "string" && (await isReservedStaffAddress(email))) return jsonError(STAFF_ADDRESS_REFUSAL);

  // No default password, ever: an account made here used to get the shared
  // "Welcome@123", so anyone who knew it could sign in as a new member (the
  // People import dropped it for the same reason). The creator must set one
  // that meets the workspace's own password policy; the product's screens
  // invite people instead, and the invitee chooses.
  if (typeof password !== "string" || !password) {
    return jsonError("Set a password for this account, or invite the person from Members so they choose their own.");
  }
  const org = await prisma.organization.findUnique({ where: { id: getOrgId(session) }, select: { settings: true } });
  const pwError = validatePassword(password, policyFromOrgSettings(org?.settings));
  if (pwError) return jsonError(pwError);
  const passwordHash = await bcrypt.hash(password, 12);

  // The person takes a seat (src/lib/seats.ts), checked and taken under the
  // workspace's lock so two adds at once cannot both take the last one.
  const placed = await prisma.$transaction(async (tx) => {
    // Reports to is checked again under the workspace's role lock, so a role
    // change making that manager an Agent waits for this add or is seen by
    // it (rule 6's race). The role lock first, then the seats.
    if (reportsTo !== null) {
      await lockOrgRoles(tx, getOrgId(session));
      // Live too: a deactivated person holds no reports (invariant 13), as
      // an accepted invitation's manager must be (managerOnAccept).
      const again = await managerCandidateIn(getOrgId(session), reportsTo, { db: tx, live: true });
      if (again === "agent_cannot_manage") return { agent: true } as const;
      if (again === "inactive") return { inactive: true } as const;
      if (again !== "ok") return { gone: true } as const;
    }
    // Bounded (batch 5): a busy seat lock answers 503, never a 500 while
    // the role lock is held.
    await lockWorkspaceSeats(tx, getOrgId(session), { bounded: true });
    const seats = await seatsFor(getOrgId(session), 1, tx);
    if (!seats.ok) return { refused: seats.message } as const;
    const row = await tx.user.create({
      data: {
        firstName,
        lastName,
        email,
        passwordHash,
        departmentId: placement.departmentId,
        roleId: placement.roleId,
        accessLevel: level,
        // The org-role mirror, written with the level (spec 10 step 0).
        orgRole: orgRoleOf({ accessLevel: level }),
        managerId: reportsTo,
        organizationId: getOrgId(session),
      },
      // Never the password hash, MFA secrets or token version: the answer is
      // what the person who added them may see.
      select: { id: true, firstName: true, lastName: true, email: true, accessLevel: true, status: true, departmentId: true, roleId: true, managerId: true, organizationId: true, createdAt: true },
    });
    return { user: row } as const;
  }, LOCKED_TX).catch(rolesBusyOrThrow);
  if (placed instanceof NextResponse) return placed;
  if ("inactive" in placed) return NextResponse.json({ error: "That manager is deactivated, and a deactivated person can't have reports. Pick someone active.", code: "manager_inactive" }, { status: 400 });
  if ("agent" in placed) return NextResponse.json({ error: "An Agent can't be anyone's manager", code: "agent_cannot_manage" }, { status: 400 });
  if ("gone" in placed) return jsonError("That manager isn't in this workspace");
  if (placed.refused !== undefined) return NextResponse.json({ error: placed.refused, code: "seat_limit" }, { status: 403 });
  const user = placed.user;

  logActivity({
    type: "user_added",
    actorId: getUserId(session),
    organizationId: getOrgId(session),
    description: `Added new team member ${firstName} ${lastName}`,
    targetId: user.id,
    targetType: "user",
  });

  // Hybrid assignment: seed KRA/SOP defaults from the hire's role template.
  if (placement.roleId) {
    try {
      await seedAlignmentForUser({
        userId: user.id,
        roleId: placement.roleId,
        organizationId: getOrgId(session),
        assignedBy: getUserId(session),
      });
    } catch (e) {
      console.error("seedAlignmentForUser failed", e);
    }
  }

  return jsonSuccess(user, 201);
}

/**
 * A job title and department sent for a new account: blank, or an id of this
 * workspace's own. Anything else is a 400 naming the field, never a write.
 */
async function placementIn(
  organizationId: string,
  sent: { departmentId: unknown; roleId: unknown },
): Promise<{ ok: true; departmentId: string | null; roleId: string | null } | { ok: false; error: string; field: "departmentId" | "roleId" }> {
  const id = (v: unknown) => (v === undefined || v === null || v === "" ? null : v);
  const departmentId = id(sent.departmentId);
  const roleId = id(sent.roleId);
  if (departmentId !== null && (typeof departmentId !== "string" || !(await prisma.department.count({ where: { id: departmentId, organizationId } })))) {
    return { ok: false, error: "That department isn't in this workspace", field: "departmentId" };
  }
  if (roleId !== null && (typeof roleId !== "string" || !(await prisma.role.count({ where: { id: roleId, organizationId } })))) {
    return { ok: false, error: "That job title isn't in this workspace", field: "roleId" };
  }
  return { ok: true, departmentId: departmentId as string | null, roleId: roleId as string | null };
}
