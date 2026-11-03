// Workspace settings > Members, the list (settings-architecture 5.5, spec
// `/settings/members`): server filters, server sort and a page cursor, so the
// old 500-row cap and the in-memory search are gone.
//
// Scope, decided by the smallest worst case (nobody sees more people data
// than they did yesterday):
//   Owner, Admin, the People team   the whole organisation
//   the rest of the manager tier    their own reporting chain and themself,
//                                   read only (what /api/users gave them)
//
// Every row carries the four-role word and, for a Member, the tier, so no
// raw level reaches the page. Server-only (prisma).
//
// EVERYONE WHO BELONGS HERE (docs/plans/workspace-status.md D11): people
// anchored here, and people who work here through a membership, each with
// THIS workspace's role (membership.role) and status (the membership's own
// Active, Deactivated, HR label), under the same filters, search and scope.
// A removed membership is left out, as a removed anchored person is. For a
// membership person the row carries `profileHere: false`, and the job title,
// department, office and weekly hours are the ones THIS workspace holds on
// their membership (D18; the final review, product H1), never the
// account's, which are the workspace it is anchored to; the drawer shows
// them read-only. The department, office and job title filters match a
// membership person by those same ids (security L1). For every row,
// anchored here or not, a job title, department or office is shown only
// when it is one of this workspace's own, and a manager only when they hold
// a seat here (profile-here.ts, D18). The
// Owners, the Admins and the People team are counted over the same people
// (liveAdminsOf, peopleTeamIdsFor). With membership people among the matches,
// a sort by role, status, department, title or join date reads each one's
// key at their seat here, in memory over the matching ids, so nobody sorts by
// another workspace's answer; a sort by name stays in the database.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { ownerIdsOf } from "@/lib/admin/companies-list";
import { liveAdminsOf, memberRoleOf, tierLabel, type MemberRole } from "./membership";
import { parseAccessSettings } from "./settings";
import { agentsWithStoredReports } from "./manager-lines";
import { MEMBERSHIP_PROFILE_SELECT, managersWithSeatHere, ownHere, placementsHere, type MembershipProfileHere } from "./profile-here";
import { keptSeatWhere } from "./workspace-seat";
import { JOIN_ROW_SELECT, joinedHere, joinRowsHere } from "./joined-here";

export const MEMBER_SORTS = ["name_asc", "name_desc", "role", "department", "title", "status", "joined"] as const;
export type MemberSort = (typeof MEMBER_SORTS)[number];

export interface MemberQuery {
  q?: string;
  sort?: MemberSort;
  role?: MemberRole | "guest" | null;
  departmentId?: string | null;
  officeId?: string | null;
  roleId?: string | null;
  status?: string | null;
  noManager?: boolean;
  peopleTeam?: boolean;
  inactive30?: boolean;
  page?: number;
  limit?: number;
}

export interface MemberRow {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  role: MemberRole;
  tier: string | null;
  tierLabel: string | null;
  isAgent: boolean;
  jobTitle: { id: string; title: string } | null;
  department: { id: string; name: string } | null;
  office: { id: string; name: string } | null;
  manager: { id: string; name: string } | null;
  peopleTeam: boolean;
  status: string;
  lastSignInAt: string | null;
  joinedAt: string;
  weeklyCapacityHours: number | null;
  /**
   * Two step verification is on: an Owner or Admin may reset it (POST
   * /api/users/[id]/mfa-reset). The members route sends it to them only.
   */
  mfaEnabled?: boolean;
  /** Admin scopes an Owner gave (billing, security); empty for everyone else. */
  adminScopes: string[];
  /**
   * For an Agent who still has people listed under them (stored before rule
   * 6): how many, by kind. The lines give the Agent nothing (manager-lines.ts);
   * the drawer says so and offers to move them. Null for everyone else.
   */
  agentReports: { solid: number; dotted: number } | null;
  /**
   * False for someone who works here through a membership (D11): their job
   * title, department, office and capacity are the ones their membership
   * here holds (D18, the final review, product H1), shown read-only while
   * they work in another workspace. True for someone anchored here.
   */
  profileHere: boolean;
}

/** A membership here of someone anchored in another workspace, not removed: their seat here. */
interface MemberSeat {
  userId: string;
  role: string;
  status: string;
  createdAt: Date;
  adminScopes: string[];
  /** The manager stored on their account (one line per account, D18). */
  managerId: string | null;
  /** What this workspace holds of them on the membership (D18, product H1). */
  profile: MembershipProfileHere;
}

/** The people who work here through a membership (anchored elsewhere), not removed here, with their seat (D11). */
async function membershipSeatsHere(organizationId: string): Promise<MemberSeat[]> {
  const rows = await prisma.organizationMembership.findMany({
    where: { organizationId, ...keptSeatWhere(), user: { organizationId: { not: organizationId } } },
    select: { userId: true, role: true, status: true, ...JOIN_ROW_SELECT, ...MEMBERSHIP_PROFILE_SELECT, adminScopes: true, user: { select: { managerId: true, createdAt: true } } },
  });
  // Joined here as liveAdminsOf reads it (joined-here.ts, the step 4 review H1).
  return rows.map((r) => ({
    userId: r.userId,
    role: String(r.role),
    status: String(r.status),
    createdAt: joinedHere(r, { createdAt: r.user?.createdAt ?? r.createdAt }),
    adminScopes: r.adminScopes ?? [],
    managerId: r.user?.managerId ?? null,
    profile: { departmentId: r.departmentId, roleId: r.roleId, officeId: r.officeId, weeklyCapacityHours: r.weeklyCapacityHours, joinDate: r.joinDate },
  }));
}

/**
 * Whether anyone anchored here holds a membership row here that is not the
 * home row (they joined through a membership, then switched in): then their
 * "joined" here is that row's date, not the account's (joined-here.ts), and
 * a sort by join date must be made in memory.
 */
async function anyoneSwitchedIn(organizationId: string): Promise<boolean> {
  return (await prisma.organizationMembership.count({ where: { organizationId, isPrimary: false, user: { organizationId } } })) > 0;
}

/** Postgres sorts an enum by its declaration order (prisma/schema.prisma), so the in-memory sort does too. */
const LEVEL_ORDER = ["SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR", "MANAGER", "TEAM_LEAD", "EMPLOYEE", "AGENT", "HR"];
const STATUS_ORDER = ["ACTIVE", "INACTIVE", "ON_LEAVE", "PROBATION", "PIP", "NOTICE_PERIOD"];
const ADMIN_LEVELS = ["SUPER_ADMIN", "COMPANY_ADMIN"];

/** The People team: the configured list, else everyone at HR (access step 0). */
export async function peopleTeamIdsFor(organizationId: string): Promise<{ ids: Set<string>; configured: boolean }> {
  const [org, hr, hrMembers] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { settings: true } }),
    prisma.user.findMany({ where: { organizationId, deletedAt: null, accessLevel: "HR" }, select: { id: true } }),
    // At the People team tier HERE through a membership (D11): the level the
    // People team powers read for them (viewer.ts isSeededPeopleTeam).
    prisma.organizationMembership.findMany({ where: { organizationId, role: "HR", ...keptSeatWhere(), user: { organizationId: { not: organizationId } } }, select: { userId: true } }),
  ]);
  const configured = parseAccessSettings((org?.settings as { access?: unknown } | null)?.access).peopleTeamUserIds;
  return configured.length > 0
    ? { ids: new Set(configured), configured: true }
    : { ids: new Set([...hr.map((h) => h.id), ...hrMembers.map((h) => h.userId)]), configured: false };
}

export async function listMembers(
  organizationId: string,
  scope: { orgWide: boolean; ids: string[] },
  query: MemberQuery,
): Promise<{ rows: MemberRow[]; total: number; page: number; pageCount: number }> {
  const limit = Math.min(100, Math.max(10, query.limit ?? 50));
  const page = Math.max(0, query.page ?? 0);
  // Who belongs here, in two halves (D11): anchored here and not removed, and
  // a membership here not removed. A filter on what the seat holds (the
  // role, the status) is applied to each half from its own row; one on the
  // person (name, email, scope, the People team, sign-ins) or on this
  // workspace's own job titles, departments and offices, to both.
  const anchored: Prisma.UserWhereInput[] = [{ organizationId, deletedAt: null }];
  const common: Prisma.UserWhereInput[] = [];
  if (!scope.orgWide) common.push({ id: { in: scope.ids } });

  const [admins, team, memberSeats] = await Promise.all([liveAdminsOf(prisma, organizationId), peopleTeamIdsFor(organizationId), membershipSeatsHere(organizationId)]);
  // The Owners: one answer for both halves (membership.ts liveAdminsOf, the last-Owner guard's own set).
  const owners = new Set(ownerIdsOf(admins.map((a) => ({ id: a.id, level: a.accessLevel, createdAt: a.createdAt }))));
  let seats = memberSeats;

  if (query.q) {
    for (const w of query.q.trim().split(/\s+/).slice(0, 5)) {
      common.push({ OR: [{ firstName: { contains: w, mode: "insensitive" } }, { lastName: { contains: w, mode: "insensitive" } }, { email: { contains: w, mode: "insensitive" } }] });
    }
  }
  if (query.role === "OWNER") common.push({ id: { in: [...owners] } });
  else if (query.role === "ADMIN") {
    anchored.push({ accessLevel: { in: ["SUPER_ADMIN", "COMPANY_ADMIN"] } });
    common.push({ id: { notIn: [...owners] } });
    seats = seats.filter((m) => ADMIN_LEVELS.includes(m.role));
  } else if (query.role === "MEMBER") {
    anchored.push({ accessLevel: { notIn: ["SUPER_ADMIN", "COMPANY_ADMIN"] } });
    seats = seats.filter((m) => !ADMIN_LEVELS.includes(m.role));
  } else if (query.role === "guest") common.push({ id: { in: [] } }); // no Guest tier yet
  // This workspace's own placement filters (security L1): the account's ids
  // for someone anchored here, the membership's for a membership person.
  // Before, both halves matched the account's ids, so an id of another
  // workspace listed which of this workspace's contractors sat in it there.
  if (query.departmentId) {
    anchored.push({ departmentId: query.departmentId });
    seats = seats.filter((m) => m.profile.departmentId === query.departmentId);
  }
  if (query.officeId) {
    anchored.push({ officeId: query.officeId });
    seats = seats.filter((m) => m.profile.officeId === query.officeId);
  }
  if (query.roleId) {
    anchored.push({ roleId: query.roleId });
    seats = seats.filter((m) => m.profile.roleId === query.roleId);
  }
  if (query.status) {
    anchored.push({ status: query.status as Prisma.UserWhereInput["status"] });
    seats = seats.filter((m) => m.status === query.status);
  }
  if (query.noManager) {
    anchored.push({ managerId: null, status: { not: "INACTIVE" } });
    // A membership person's row names their manager only while that manager
    // holds a seat here, so No manager reads the same view (the step 3
    // review L3): the account's line to someone of another workspace is no
    // manager here, and the filter tells nothing about it.
    const shown = await managersWithSeatHere(organizationId, seats.map((m) => m.managerId));
    seats = seats.filter((m) => m.status !== "INACTIVE" && !(m.managerId && shown.has(m.managerId)));
  }
  if (query.peopleTeam) common.push({ id: { in: [...team.ids] } });
  if (query.inactive30) {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const active = await prisma.activityLog.findMany({
      where: { organizationId, type: "login", createdAt: { gte: since } },
      select: { actorId: true },
      distinct: ["actorId"],
    });
    common.push({ id: { notIn: active.map((a) => a.actorId).filter((x): x is string => !!x) } });
    // A membership person signs in where their account is anchored, so this
    // workspace has no sign-in of theirs to judge by (the step 3 review L3):
    // left out, never listed as inactive.
    seats = [];
  }
  const seatOf = new Map(seats.map((m) => [m.userId, m]));
  const halves: Prisma.UserWhereInput = seatOf.size > 0 ? { OR: [{ AND: anchored }, { id: { in: [...seatOf.keys()] } }] } : { AND: anchored };
  const where: Prisma.UserWhereInput = { AND: [halves, ...common] };

  const select = {
    id: true, organizationId: true, firstName: true, lastName: true, email: true, avatar: true, accessLevel: true, status: true, createdAt: true, weeklyCapacityHours: true, mfaEnabled: true, adminScopes: true,
    role: { select: { id: true, title: true, organizationId: true } },
    department: { select: { id: true, name: true, organizationId: true } },
    office: { select: { id: true, name: true, organizationId: true } },
    manager: { select: { id: true, firstName: true, lastName: true } },
  } as const;

  let total: number;
  let users: Prisma.UserGetPayload<{ select: typeof select }>[];
  const joinedInMemory = query.sort === "joined" && (await anyoneSwitchedIn(organizationId));
  if ((seatOf.size === 0 && !joinedInMemory) || query.sort === undefined || query.sort === "name_asc" || query.sort === "name_desc") {
    // Name, or nobody here through a membership: the database sorts and pages.
    const orderBy: Prisma.UserOrderByWithRelationInput[] = (() => {
      switch (query.sort) {
        case "name_desc": return [{ firstName: "desc" }, { lastName: "desc" }, { id: "asc" }];
        case "role": return [{ accessLevel: "asc" }, { firstName: "asc" }, { id: "asc" }];
        case "department": return [{ department: { name: "asc" } }, { firstName: "asc" }, { id: "asc" }];
        case "title": return [{ role: { title: "asc" } }, { firstName: "asc" }, { id: "asc" }];
        case "status": return [{ status: "asc" }, { firstName: "asc" }, { id: "asc" }];
        case "joined": return [{ createdAt: "desc" }, { id: "asc" }];
        default: return [{ firstName: "asc" }, { lastName: "asc" }, { id: "asc" }];
      }
    })();
    [total, users] = await Promise.all([prisma.user.count({ where }), prisma.user.findMany({ where, orderBy, skip: page * limit, take: limit, select })]);
  } else {
    // A seat's key for a membership person (their level, status, join date,
    // job title and department here, from the membership; never another
    // workspace's), read over the matching people's ids and sorted here,
    // then the page read in full.
    const keys = await prisma.user.findMany({
      where,
      select: { id: true, organizationId: true, firstName: true, accessLevel: true, status: true, createdAt: true, role: { select: { title: true, organizationId: true } }, department: { select: { name: true, organizationId: true } } },
    });
    // The anchored people's own rows here, for when they joined here (joined-here.ts).
    const ownRows = query.sort === "joined" ? await joinRowsHere(prisma, organizationId, keys.filter((k) => k.organizationId === organizationId).map((k) => k.id)) : new Map();
    const keyedSeats = keys.map((k) => (k.organizationId === organizationId ? undefined : seatOf.get(k.id))).filter((m): m is MemberSeat => !!m);
    const placedKeys = query.sort === "title" || query.sort === "department" ? await placementsHere(organizationId, keyedSeats.map((m) => m.profile)) : null;
    const keyed = keys.map((k) => {
      const m = k.organizationId === organizationId ? undefined : seatOf.get(k.id);
      return {
        id: k.id,
        first: k.firstName ?? "",
        level: m ? m.role : String(k.accessLevel),
        status: m ? m.status : String(k.status),
        joined: (m ? m.createdAt : joinedHere(ownRows.get(k.id), k)).getTime(),
        title: m ? (m.profile.roleId ? placedKeys?.role.get(m.profile.roleId)?.title ?? null : null) : ownHere(k.role, organizationId)?.title ?? null,
        dept: m ? (m.profile.departmentId ? placedKeys?.department.get(m.profile.departmentId)?.name ?? null : null) : ownHere(k.department, organizationId)?.name ?? null,
      };
    });
    const text = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : a > b ? 1 : 0);
    const tie = (a: (typeof keyed)[number], b: (typeof keyed)[number]) => text(a.first, b.first) || text(a.id, b.id);
    const by: Record<string, (a: (typeof keyed)[number], b: (typeof keyed)[number]) => number> = {
      role: (a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level) || tie(a, b),
      status: (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || tie(a, b),
      department: (a, b) => text(a.dept, b.dept) || tie(a, b),
      title: (a, b) => text(a.title, b.title) || tie(a, b),
      joined: (a, b) => b.joined - a.joined || text(a.id, b.id),
    };
    keyed.sort(by[query.sort] ?? tie);
    total = keyed.length;
    const pageIds = keyed.slice(page * limit, page * limit + limit).map((k) => k.id);
    const full = pageIds.length ? await prisma.user.findMany({ where: { id: { in: pageIds } }, select }) : [];
    const byId = new Map(full.map((u) => [u.id, u]));
    users = pageIds.map((uid) => byId.get(uid)).filter((u): u is NonNullable<typeof u> => !!u);
  }

  const ids = users.map((u) => u.id);
  const seatHere = (u: (typeof users)[number]) => (u.organizationId === organizationId ? undefined : seatOf.get(u.id));
  const levelOf = (u: (typeof users)[number]) => seatHere(u)?.role ?? String(u.accessLevel);
  const pageSeats = users.map((u) => seatHere(u)).filter((m): m is MemberSeat => !!m);
  const [logins, agentLines, managersHere, anchoredRows, placed] = await Promise.all([
    ids.length ? prisma.activityLog.groupBy({ by: ["actorId"], where: { organizationId, type: "login", actorId: { in: ids } }, _max: { createdAt: true } }) : Promise.resolve([]),
    agentsWithStoredReports(organizationId, users.filter((u) => levelOf(u) === "AGENT").map((u) => u.id)),
    // A manager is named only while they hold a seat here (deactivated or
    // not, as a record names them): never someone of another workspace,
    // whoever the row is (D18, the step 3 review H2).
    managersWithSeatHere(organizationId, users.map((u) => u.manager?.id)),
    // When the people anchored here joined here (joined-here.ts).
    joinRowsHere(prisma, organizationId, users.filter((u) => u.organizationId === organizationId).map((u) => u.id)),
    // What this workspace holds of the membership people on the page (D18, product H1).
    placementsHere(organizationId, pageSeats.map((m) => m.profile)),
  ]);
  const lastLogin = new Map(logins.map((l) => [l.actorId, l._max.createdAt]));

  const rows: MemberRow[] = users.map((u) => {
    const m = seatHere(u);
    const level = levelOf(u);
    const role = memberRoleOf(level, owners.has(u.id));
    // This workspace's own only, for everyone (D18): for a membership
    // person, what their membership here holds (product H1).
    const title = m ? (m.profile.roleId ? placed.role.get(m.profile.roleId) ?? null : null) : ownHere(u.role, organizationId);
    const dept = m ? (m.profile.departmentId ? placed.department.get(m.profile.departmentId) ?? null : null) : ownHere(u.department, organizationId);
    const office = m ? (m.profile.officeId ? placed.office.get(m.profile.officeId) ?? null : null) : ownHere(u.office, organizationId);
    const manager = u.manager && managersHere.has(u.manager.id) ? u.manager : null;
    return {
      id: u.id,
      name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email,
      email: u.email,
      avatar: u.avatar,
      role,
      tier: role === "MEMBER" ? level : null,
      tierLabel: role === "MEMBER" ? tierLabel(level) : null,
      isAgent: level === "AGENT",
      jobTitle: title ? { id: title.id, title: title.title } : null,
      department: dept ? { id: dept.id, name: dept.name } : null,
      office: office ? { id: office.id, name: office.name } : null,
      manager: manager ? { id: manager.id, name: `${manager.firstName ?? ""} ${manager.lastName ?? ""}`.trim() } : null,
      peopleTeam: team.ids.has(u.id),
      status: m ? m.status : String(u.status),
      // Their sign-ins are logged where their account is anchored (L3).
      lastSignInAt: m ? null : lastLogin.get(u.id)?.toISOString() ?? null,
      joinedAt: (m ? m.createdAt : joinedHere(anchoredRows.get(u.id), u)).toISOString(),
      // Their working week here is the membership's (product H1); their
      // sign-in factor is the account's.
      weeklyCapacityHours: m ? m.profile.weeklyCapacityHours ?? null : u.weeklyCapacityHours ?? null,
      ...(m ? {} : { mfaEnabled: u.mfaEnabled === true }),
      adminScopes: role === "ADMIN" ? (m ? m.adminScopes : u.adminScopes ?? []) : [],
      agentReports: agentLines.get(u.id) ?? null,
      profileHere: !m,
    };
  });
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / limit)) };
}
