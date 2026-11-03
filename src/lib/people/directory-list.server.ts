import "server-only";

// GET /api/users?scope=directory and ?fields=chart (spec-teams-people
// /people and /organization).
//
//   scope=directory   the Directory: every Member, org-wide, server filters
//                     (parseDirectoryQuery), sort and page. Card fields for
//                     everyone; phone only for people the viewer may read.
//                     The Removed and No manager views and the Deactivated
//                     filter are for Owner, Admin and the People team; for
//                     anyone else the parser drops them (the default view).
//   fields=chart      the Org chart projection: id, name, avatar, managerId,
//                     job title, department, office, isAgent and dotted
//                     managers, for every Member, capped at 5,000 rows with
//                     `truncated` set beyond that (never a silent cut).
//
// A Guest gets the 404 (access 11 invariant 3: Guests never see the
// directory). Every read tolerates the Phase 6 presence columns being absent.
//
// A department, job role or office is shown only when it is this
// workspace's own, and a manager only while they hold a seat here
// (docs/plans/workspace-status.md D18, src/lib/access/profile-here.ts): a
// person whose account came from another company never carries its
// department, title or people here.
//
// EVERYONE WHO WORKS HERE (D11, step 4). The Directory, the chart and the
// export list the people anchored here AND the people who work here through
// a membership, each in THIS workspace's state: the membership's own status
// (Active, an HR label, Deactivated) and removal, so the Removed view lists
// a membership this workspace removed, with Restore (DELETE ?restore=true
// restores either kind). Their department, job title and office here are
// the ones their membership holds (D18; the final review, product H1),
// resolved to this workspace's own rows, never the account's (which are the
// workspace it is anchored to): the filters on those, on seniority and the
// groupings match them by the membership's ids; their join date is the
// membership's (its join date, else when it was made); a manager is shown on
// the same rule as anyone's; nobody edits their placement here yet (PATCH
// refuses it, D11). Their phone is never sent (security L2): the record
// withholds it from this workspace, and the Directory and the export say
// the same. A sort by join date or a grouping
// with membership people among the matches is made in memory over the
// matching people (directoryOrder), so nobody is placed by another
// workspace's date or department, and a sort by reports too, since a
// membership person's row counts their reports here only (reportsHere, the
// step 4 review L6); a sort by name stays in the database. Names compare by
// collation in memory (L9).

import { NextResponse, type NextRequest } from "next/server";
import { accessV2Resolver } from "@/lib/access/flags";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { getUserTagsMap, resolveUserIdsByTags } from "@/lib/user-tags";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { hasPermission } from "@/lib/api-helpers";
import { directoryWhere, parseDirectoryQuery, type DirectoryQuery } from "./directory-query";
import { isPeopleAdmin, peopleCtx, readsPeopleDataOf, relationTo, type PeopleCtx } from "./person-access.server";
import { canWritePersonGroup, visibleStatus } from "./person-fields";
import { managersWithSeatHere, ownHere, placementsHere } from "@/lib/access/profile-here";
import { liveHereAmong } from "@/lib/access/manager-lines";
import { keptSeatWhere } from "@/lib/access/workspace-seat";
import { JOIN_ROW_SELECT, joinedHere } from "@/lib/access/joined-here";

export const CHART_CAP = 5000;

/** A membership here of someone anchored in another workspace, as the Directory lists them (D11, D18). */
export interface DirectorySeat {
  userId: string;
  role: string;
  status: string;
  removedAt: Date | null;
  /** When they joined here: the membership's join date, else when it was made (D18). */
  joinedHere: Date;
  /** The department, job role and office their membership here names (D18, product H1); resolve with placementsHere. */
  departmentId: string | null;
  roleId: string | null;
  officeId: string | null;
}

/**
 * The membership seats here a Directory query matches (see the header): in
 * the Removed view the ones removed here, otherwise the ones not removed,
 * the deactivated ones only with the Deactivated filter, as for people
 * anchored here. A filter on a department, job title or office matches the
 * membership's own (this workspace's) ids, one on seniority its job role's
 * level here (product H1); No manager reads the manager their row shows;
 * New joiners their join date here. The filters on the person (search,
 * tags, Reports to) are prismaWhere's, for both kinds.
 */
export async function directorySeats(ctx: PeopleCtx, q: DirectoryQuery): Promise<Map<string, DirectorySeat>> {
  const w = directoryWhere(q);
  const rows = await prisma.organizationMembership.findMany({
    where: {
      organizationId: ctx.organizationId,
      user: { organizationId: { not: ctx.organizationId } },
      ...(w.deleted === "only" ? { removedAt: { not: null } } : keptSeatWhere()),
      ...(w.status === "inactive" ? { status: "INACTIVE" as const } : w.status === "not-inactive" ? { status: { not: "INACTIVE" as const } } : {}),
    },
    select: { userId: true, role: true, status: true, removedAt: true, joinDate: true, departmentId: true, roleId: true, officeId: true, ...JOIN_ROW_SELECT, user: { select: { managerId: true, createdAt: true } } },
  });
  // Their join date here: the one stored on the membership (D18), else when
  // they joined here (access/joined-here.ts, the step 4 review H1).
  let seats = rows.map((r) => ({
    seat: {
      userId: r.userId,
      role: String(r.role),
      status: String(r.status),
      removedAt: r.removedAt,
      joinedHere: r.joinDate ?? joinedHere(r, { createdAt: r.user?.createdAt ?? r.createdAt }),
      departmentId: r.departmentId,
      roleId: r.roleId,
      officeId: r.officeId,
    },
    managerId: r.user?.managerId ?? null,
  }));
  // The placement filters, by what the membership holds here (product H1).
  if (w.departmentId) seats = seats.filter((m) => m.seat.departmentId === w.departmentId);
  if (w.roleId) seats = seats.filter((m) => m.seat.roleId === w.roleId);
  if (w.officeId) seats = seats.filter((m) => m.seat.officeId === w.officeId);
  if (w.seniority) {
    const levels = new Set<string>(w.seniority);
    const roles = (await placementsHere(ctx.organizationId, seats.map((m) => m.seat))).role;
    seats = seats.filter((m) => !!m.seat.roleId && levels.has(roles.get(m.seat.roleId)?.level ?? ""));
  }
  if (w.joinedAfter) seats = seats.filter((m) => m.seat.joinedHere.getTime() >= w.joinedAfter!.getTime());
  if (w.noManager) {
    const shown = await managersWithSeatHere(ctx.organizationId, seats.map((m) => m.managerId));
    seats = seats.filter((m) => !(m.managerId && shown.has(m.managerId)));
  }
  return new Map(seats.map((m) => [m.seat.userId, m.seat]));
}

/**
 * The Directory's where (both kinds, see the header): the people anchored
 * here that the query matches, and the membership seats directorySeats
 * matched, each then held to the filters on the person.
 */
export function prismaWhere(ctx: PeopleCtx, q: DirectoryQuery, extraIds: string[] | null, seats?: ReadonlyMap<string, DirectorySeat>): Prisma.UserWhereInput {
  const w = directoryWhere(q);
  const where: Prisma.UserWhereInput = { organizationId: ctx.organizationId };
  where.deletedAt = w.deleted === "only" ? { not: null } : null;
  if (w.status === "inactive") where.status = "INACTIVE";
  else if (w.status === "not-inactive") where.status = { not: "INACTIVE" };
  if (w.departmentId) where.departmentId = w.departmentId;
  if (w.roleId) where.roleId = w.roleId;
  if (w.officeId) where.officeId = w.officeId;
  if (w.noManager) where.managerId = null;
  if (w.joinedAfter) where.joinDate = { gte: w.joinedAfter };
  if (w.seniority) where.role = { level: { in: w.seniority as Prisma.EnumAccessLevelFilter["in"] } };
  const and: Prisma.UserWhereInput[] = [];
  // Reports to: the line stored on the account, for both kinds.
  if (w.managerId) and.push({ managerId: w.managerId });
  if (w.q) {
    const words = w.q.split(/\s+/).filter(Boolean).slice(0, 4);
    for (const word of words) {
      and.push({
        OR: [
          { firstName: { contains: word, mode: "insensitive" } },
          { lastName: { contains: word, mode: "insensitive" } },
          { email: { contains: word, mode: "insensitive" } },
          // This workspace's job roles only (D18).
          { role: { title: { contains: word, mode: "insensitive" }, organizationId: ctx.organizationId } },
        ],
      });
    }
  }
  if (extraIds) and.push({ id: { in: extraIds } });
  if (seats && seats.size > 0) return { AND: [{ OR: [where, { id: { in: [...seats.keys()] } }] }, ...and] };
  if (and.length) where.AND = and;
  return where;
}

/** Whether a query with membership people among its matches is ordered in memory (see the header). */
export function orderedInMemory(q: DirectoryQuery, seats: ReadonlyMap<string, DirectorySeat>): boolean {
  return seats.size > 0 && (q.group !== "none" || q.sort === "recent" || q.sort === "tenure" || q.sort === "reports");
}

/**
 * How many of each of these people's direct reports hold a seat here, not
 * removed (manager-lines.ts liveHereAmong): the count a membership person's
 * row shows, never their account's reports in another workspace (the step 4
 * review L6). Two reads.
 */
export async function reportsHere(organizationId: string, managerIds: readonly string[]): Promise<Map<string, number>> {
  const ids = [...new Set(managerIds)].filter(Boolean);
  if (ids.length === 0) return new Map();
  const reports = await prisma.user.findMany({ where: { managerId: { in: ids }, deletedAt: null }, select: { id: true, managerId: true } });
  const here = await liveHereAmong(organizationId, reports.map((r) => r.id));
  const out = new Map<string, number>();
  for (const r of reports) if (r.managerId && here.has(r.id)) out.set(r.managerId, (out.get(r.managerId) ?? 0) + 1);
  return out;
}

/** Names in the order Postgres's collation gives them, near enough (the step 4 review L9): case and accents set aside, numbers by value. */
const NAMES = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/**
 * Every matching person's id in the Directory's order, read in memory, for a
 * query orderedInMemory: grouped by this workspace's own department, office
 * or job title (none for a membership person, D18), then by join date here
 * or name, as orderFor orders the database. With the groups' totals.
 */
export async function directoryOrder(ctx: PeopleCtx, q: DirectoryQuery, where: Prisma.UserWhereInput, seats: ReadonlyMap<string, DirectorySeat>): Promise<{ ids: string[]; groups: Array<{ key: string; count: number }> }> {
  const org = ctx.organizationId;
  const keys = await prisma.user.findMany({
    where,
    select: {
      id: true, organizationId: true, firstName: true, lastName: true, joinDate: true, departmentId: true, officeId: true, roleId: true,
      department: { select: { name: true, organizationId: true } },
      office: { select: { name: true, organizationId: true } },
      role: { select: { title: true, organizationId: true } },
      _count: { select: { directReports: { where: { deletedAt: null } } } },
    },
  });
  // A membership person's reports here only (L6).
  const memberReports = q.sort === "reports" ? await reportsHere(org, keys.filter((k) => k.organizationId !== org && seats.has(k.id)).map((k) => k.id)) : new Map<string, number>();
  // What the memberships among them hold here, for the groups (product H1).
  const memberSeats = keys.map((k) => (k.organizationId === org ? undefined : seats.get(k.id))).filter((m): m is DirectorySeat => !!m);
  const placed = q.group !== "none" ? await placementsHere(org, memberSeats) : null;
  const keyed = keys.map((k) => {
    const m = k.organizationId === org ? undefined : seats.get(k.id);
    const dept = m ? (m.departmentId ? placed?.department.get(m.departmentId) ?? null : null) : ownHere(k.department, org);
    const office = m ? (m.officeId ? placed?.office.get(m.officeId) ?? null : null) : ownHere(k.office, org);
    const title = m ? (m.roleId ? placed?.role.get(m.roleId) ?? null : null) : ownHere(k.role, org);
    const group =
      q.group === "department" ? { id: dept ? (m ? m.departmentId : k.departmentId) : null, name: dept?.name ?? null }
      : q.group === "office" ? { id: office ? (m ? m.officeId : k.officeId) : null, name: office?.name ?? null }
      : q.group === "title" ? { id: title ? (m ? m.roleId : k.roleId) : null, name: title?.title ?? null }
      : { id: null, name: null };
    return { id: k.id, first: k.firstName ?? "", last: k.lastName ?? "", joined: (m ? m.joinedHere : k.joinDate).getTime(), reports: m ? memberReports.get(k.id) ?? 0 : k._count?.directReports ?? 0, group };
  });
  // As Postgres orders text ascending: nulls last, by the collation (L9).
  const text = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : NAMES.compare(a, b));
  const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const byName = (a: (typeof keyed)[number], b: (typeof keyed)[number]) => text(a.first, b.first) || text(a.last, b.last) || byId(a.id, b.id);
  const then: Record<string, (a: (typeof keyed)[number], b: (typeof keyed)[number]) => number> = {
    recent: (a, b) => b.joined - a.joined || byId(a.id, b.id),
    tenure: (a, b) => a.joined - b.joined || byId(a.id, b.id),
    reports: (a, b) => b.reports - a.reports || byName(a, b),
    name: byName,
  };
  keyed.sort((a, b) => text(a.group.name, b.group.name) || (then[q.sort] ?? byName)(a, b));
  const counts = new Map<string, number>();
  for (const k of keyed) counts.set(k.group.id ?? "none", (counts.get(k.group.id ?? "none") ?? 0) + 1);
  return { ids: keyed.map((k) => k.id), groups: q.group === "none" ? [] : [...counts].map(([key, count]) => ({ key, count })) };
}

export function orderFor(q: DirectoryQuery): Prisma.UserOrderByWithRelationInput[] {
  const group: Prisma.UserOrderByWithRelationInput[] =
    q.group === "department"
      ? [{ department: { name: "asc" } }]
      : q.group === "office"
        ? [{ office: { name: "asc" } }]
        : q.group === "title"
          ? [{ role: { title: "asc" } }]
          : [];
  // id breaks ties so page N and page N+1 never overlap or skip a person.
  const tail: Prisma.UserOrderByWithRelationInput[] = [{ firstName: "asc" }, { lastName: "asc" }, { id: "asc" }];
  switch (q.sort) {
    case "recent":
      return [...group, { joinDate: "desc" }, { id: "asc" }];
    case "tenure":
      return [...group, { joinDate: "asc" }, { id: "asc" }];
    case "reports":
      return [...group, { directReports: { _count: "desc" } }, ...tail];
    default:
      return [...group, ...tail];
  }
}

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/** An office as a Directory card names it (id, name, city), from placementsHere's row. */
function officeCard(o: { id: string; name: string; city: string | null } | undefined): { id: string; name: string; city: string | null } | null {
  return o ? { id: o.id, name: o.name, city: o.city } : null;
}

export async function directoryList(req: NextRequest): Promise<Response> {
  const ctx = await peopleCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.orgRole === "GUEST") return notFound();

  const sp = new URL(req.url).searchParams;
  const privileged = isPeopleAdmin(ctx);

  if (sp.get("fields") === "chart") return chartList(ctx);

  const q = parseDirectoryQuery(sp, { privileged });
  let tagIds: string[] | null = null;
  if (q.tagIds.length) tagIds = await resolveUserIdsByTags(ctx.organizationId, q.tagIds);
  const seats = await directorySeats(ctx, q);
  const where = prismaWhere(ctx, q, tagIds, seats);

  const select = {
    id: true,
    organizationId: true,
    firstName: true,
    lastName: true,
    email: true,
    avatar: true,
    phone: true,
    status: true,
    managerId: true,
    joinDate: true,
    deletedAt: true,
    accessLevel: true,
    department: { select: { id: true, name: true, color: true, organizationId: true } },
    role: { select: { id: true, title: true, level: true, organizationId: true } },
    office: { select: { id: true, name: true, city: true, organizationId: true } },
    manager: { select: { id: true, firstName: true, lastName: true, avatar: true } },
    _count: { select: { directReports: { where: { deletedAt: null } } } },
  } as const;
  let users: Prisma.UserGetPayload<{ select: typeof select }>[];
  let total: number;
  // Group totals over the WHOLE filtered set (never the page's run), so a
  // group that crosses a page boundary still shows its real count.
  let groups: Array<{ key: string; count: number }> | undefined;
  if (orderedInMemory(q, seats)) {
    // Membership people among the matches, ordered by a date or a group here (see the header).
    const order = await directoryOrder(ctx, q, where, seats);
    total = order.ids.length;
    const pageIds = order.ids.slice((q.page - 1) * q.size, q.page * q.size);
    const full = pageIds.length ? await prisma.user.findMany({ where: { id: { in: pageIds } }, select }) : [];
    const byId = new Map(full.map((u) => [u.id, u]));
    users = pageIds.map((id) => byId.get(id)).filter((u): u is NonNullable<typeof u> => !!u);
    if (q.group !== "none") groups = order.groups;
  } else {
    [users, total] = await Promise.all([
      prisma.user.findMany({ where, select, orderBy: orderFor(q), skip: (q.page - 1) * q.size, take: q.size }),
      prisma.user.count({ where }),
    ]);
    if (q.group !== "none") {
      const by = q.group === "department" ? "departmentId" : q.group === "office" ? "officeId" : "roleId";
      const counted = await prisma.user.groupBy({ by: [by], where, _count: { _all: true } });
      groups = counted.map((g) => ({ key: (g as Record<string, unknown>)[by] as string | null ?? "none", count: g._count._all }));
    }
  }

  const presence = await presenceFor(users.map((u) => u.id));
  // Invite follows the invitations route's own gate (people.create), so the
  // button never renders for someone POST /api/invitations would refuse.
  const session = await getServerSession(authOptions);
  const canInvite = session?.user && !ctx.isAgent ? await hasPermission(session, "people", "create") : false;
  const tagsByUser = await getUserTagsMap(ctx.organizationId, users.map((u) => u.id));
  const managersHere = await managersWithSeatHere(ctx.organizationId, users.map((u) => u.managerId));
  // A membership person's reports here only (L6).
  const memberReports = await reportsHere(ctx.organizationId, users.filter((u) => u.organizationId !== ctx.organizationId && seats.has(u.id)).map((u) => u.id));
  // What the memberships on the page hold here (product H1).
  const placed = await placementsHere(ctx.organizationId, users.map((u) => (u.organizationId === ctx.organizationId ? undefined : seats.get(u.id))).filter((m): m is DirectorySeat => !!m));
  const rows = users.map((u) => {
    const peopleData = readsPeopleDataOf(ctx, u.id);
    const p = presence.get(u.id);
    // Their seat here when they work here through a membership (see the header).
    const m = u.organizationId === ctx.organizationId ? undefined : seats.get(u.id);
    const status = m ? m.status : String(u.status);
    const role = m ? (m.roleId ? placed.role.get(m.roleId) ?? null : null) : ownHere(u.role, ctx.organizationId);
    const managerHere = !!u.managerId && managersHere.has(u.managerId);
    return {
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      avatar: u.avatar,
      // Raw employment status (PIP, notice period, probation, leave) is
      // people data; everyone else learns only whether it is deactivated.
      status: visibleStatus(status, peopleData),
      isDeactivated: status === "INACTIVE",
      managerId: managerHere ? u.managerId : null,
      joinDate: m ? m.joinedHere : u.joinDate,
      deletedAt: privileged ? (m ? m.removedAt : u.deletedAt) : null,
      isAgent: (m ? m.role : u.accessLevel) === "AGENT",
      department: m ? (m.departmentId ? placed.department.get(m.departmentId) ?? null : null) : ownHere(u.department, ctx.organizationId),
      role: role ? { id: role.id, title: role.title, seniority: role.level } : null,
      office: m ? (m.officeId ? officeCard(placed.office.get(m.officeId)) : null) : ownHere(u.office, ctx.organizationId),
      manager: managerHere ? u.manager : null,
      directReports: m ? memberReports.get(u.id) ?? 0 : u._count.directReports,
      tags: tagsByUser.get(u.id) ?? [],
      presenceStatus: p?.presenceStatus ?? null,
      presenceUntil: p?.presenceUntil ?? null,
      // People data (access 3.5): only for self, the chain, the People team
      // and Admins. Absent, not blank, for anyone else, and for someone here
      // through a membership, whose record here holds no people data
      // (security L2).
      ...(peopleData && !m ? { phone: u.phone } : {}),
      // A row is selectable (and editable) only where the viewer holds the
      // placement write: a dotted-line manager reads, never edits. Nobody
      // edits the placement of someone here through a membership (D11).
      canEdit: !m && u.id !== ctx.userId && canWritePersonGroup("placement", relationTo(ctx, u.id), { chainWritesMembership: !accessV2Resolver() }),
      // False for someone here through a membership: their placement here is shown read-only (D18, product H1).
      profileHere: !m,
    };
  });

  const totalPages = Math.max(1, Math.ceil(total / q.size));
  return NextResponse.json(
    {
      data: rows,
      pagination: { page: q.page, limit: q.size, total, totalPages, hasMore: q.page < totalPages },
      ...(groups ? { groups } : {}),
      viewer: { privileged, canInvite, canImport: ctx.isAdmin, canExport: ctx.isAdmin && !ctx.isAgent, canRemove: ctx.isAdmin && !ctx.isAgent },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function chartList(ctx: PeopleCtx): Promise<Response> {
  // Everyone who works here and is not removed (see the header): anchored
  // here, and through a membership seat here not removed, each in this
  // workspace's state.
  const memberSeats = await prisma.organizationMembership.findMany({
    where: { organizationId: ctx.organizationId, ...keptSeatWhere(), user: { organizationId: { not: ctx.organizationId } } },
    select: { userId: true, role: true, status: true, departmentId: true, roleId: true, officeId: true },
  });
  const seatOf = new Map(memberSeats.map((m) => [m.userId, { role: String(m.role), status: String(m.status), departmentId: m.departmentId, roleId: m.roleId, officeId: m.officeId }]));
  // What the memberships hold here (product H1).
  const placed = await placementsHere(ctx.organizationId, memberSeats);
  const anchored: Prisma.UserWhereInput = { organizationId: ctx.organizationId, deletedAt: null };
  const where: Prisma.UserWhereInput = seatOf.size > 0 ? { OR: [anchored, { id: { in: [...seatOf.keys()] } }] } : anchored;
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        organizationId: true,
        firstName: true,
        lastName: true,
        avatar: true,
        managerId: true,
        accessLevel: true,
        status: true,
        roleId: true,
        departmentId: true,
        officeId: true,
        role: { select: { title: true, organizationId: true } },
        department: { select: { name: true, organizationId: true } },
        office: { select: { organizationId: true } },
        dottedLineToManagers: { select: { managerId: true } },
      },
      orderBy: [{ firstName: "asc" }, { id: "asc" }],
      take: CHART_CAP,
    }),
    prisma.user.count({ where }),
  ]);
  const presence = await presenceFor(users.map((u) => u.id));
  // A manager, solid or dotted, only while they hold a seat here (D18; the
  // step 4 review L6: a dotted line to someone of another workspace is no id here).
  const managersHere = await managersWithSeatHere(ctx.organizationId, users.flatMap((u) => [u.managerId, ...u.dottedLineToManagers.map((d) => d.managerId)]));
  return NextResponse.json(
    {
      data: users.map((u) => {
        // Their seat here when they work here through a membership: its
        // level and status, and the placement it holds here (D18, product H1).
        const m = u.organizationId === ctx.organizationId ? undefined : seatOf.get(u.id);
        const status = m ? m.status : String(u.status);
        const role = m ? (m.roleId ? placed.role.get(m.roleId) ?? null : null) : ownHere(u.role, ctx.organizationId);
        const dept = m ? (m.departmentId ? placed.department.get(m.departmentId) ?? null : null) : ownHere(u.department, ctx.organizationId);
        const office = m ? (m.officeId ? placed.office.get(m.officeId) ?? null : null) : ownHere(u.office, ctx.organizationId);
        return {
          id: u.id,
          firstName: u.firstName,
          lastName: u.lastName,
          avatar: u.avatar,
          managerId: u.managerId && managersHere.has(u.managerId) ? u.managerId : null,
          isAgent: (m ? m.role : u.accessLevel) === "AGENT",
          status: visibleStatus(status, readsPeopleDataOf(ctx, u.id)),
          isDeactivated: status === "INACTIVE",
          // This workspace's own only (D18).
          roleId: role ? (m ? m.roleId : u.roleId) : null,
          departmentId: dept ? (m ? m.departmentId : u.departmentId) : null,
          officeId: office ? (m ? m.officeId : u.officeId) : null,
          jobTitle: role?.title ?? null,
          department: dept?.name ?? null,
          dottedManagerIds: u.dottedLineToManagers.map((d) => d.managerId).filter((id) => managersHere.has(id)),
          presenceStatus: presence.get(u.id)?.presenceStatus ?? null,
          presenceUntil: presence.get(u.id)?.presenceUntil ?? null,
        };
      }),
      total,
      truncated: total > users.length,
      viewer: { canEditLines: isPeopleAdmin(ctx) || ctx.orgWide, canExport: ctx.isAdmin && !ctx.isAgent, isAdmin: ctx.isAdmin },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** The presence columns, read on their own so a database without them still answers. */
export async function presenceFor(ids: string[]): Promise<Map<string, { presenceStatus: string | null; presenceUntil: string | null }>> {
  const out = new Map<string, { presenceStatus: string | null; presenceUntil: string | null }>();
  if (ids.length === 0) return out;
  try {
    const rows = await prisma.user.findMany({
      where: { id: { in: ids }, presenceStatus: { not: null } },
      select: { id: true, presenceStatus: true, presenceUntil: true },
    });
    for (const r of rows) {
      out.set(r.id, { presenceStatus: r.presenceStatus, presenceUntil: r.presenceUntil?.toISOString() ?? null });
    }
  } catch {
    // Column absent for one release: no dots.
  }
  return out;
}
