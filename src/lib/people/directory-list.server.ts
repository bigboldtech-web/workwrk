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

export const CHART_CAP = 5000;

export function prismaWhere(ctx: PeopleCtx, q: DirectoryQuery, extraIds: string[] | null): Prisma.UserWhereInput {
  const w = directoryWhere(q);
  const where: Prisma.UserWhereInput = { organizationId: ctx.organizationId };
  where.deletedAt = w.deleted === "only" ? { not: null } : null;
  if (w.status === "inactive") where.status = "INACTIVE";
  else if (w.status === "not-inactive") where.status = { not: "INACTIVE" };
  if (w.departmentId) where.departmentId = w.departmentId;
  if (w.roleId) where.roleId = w.roleId;
  if (w.officeId) where.officeId = w.officeId;
  if (w.managerId) where.managerId = w.managerId;
  if (w.noManager) where.managerId = null;
  if (w.joinedAfter) where.joinDate = { gte: w.joinedAfter };
  if (w.seniority) where.role = { level: { in: w.seniority as Prisma.EnumAccessLevelFilter["in"] } };
  const and: Prisma.UserWhereInput[] = [];
  if (w.q) {
    const words = w.q.split(/\s+/).filter(Boolean).slice(0, 4);
    for (const word of words) {
      and.push({
        OR: [
          { firstName: { contains: word, mode: "insensitive" } },
          { lastName: { contains: word, mode: "insensitive" } },
          { email: { contains: word, mode: "insensitive" } },
          { role: { title: { contains: word, mode: "insensitive" } } },
        ],
      });
    }
  }
  if (extraIds) and.push({ id: { in: extraIds } });
  if (and.length) where.AND = and;
  return where;
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
  const where = prismaWhere(ctx, q, tagIds);

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
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
        department: { select: { id: true, name: true, color: true } },
        role: { select: { id: true, title: true, level: true } },
        office: { select: { id: true, name: true, city: true } },
        manager: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        _count: { select: { directReports: { where: { deletedAt: null } } } },
      },
      orderBy: orderFor(q),
      skip: (q.page - 1) * q.size,
      take: q.size,
    }),
    prisma.user.count({ where }),
  ]);

  // Group totals over the WHOLE filtered set (never the page's run), so a
  // group that crosses a page boundary still shows its real count.
  let groups: Array<{ key: string; count: number }> | undefined;
  if (q.group !== "none") {
    const by = q.group === "department" ? "departmentId" : q.group === "office" ? "officeId" : "roleId";
    const counted = await prisma.user.groupBy({ by: [by], where, _count: { _all: true } });
    groups = counted.map((g) => ({ key: (g as Record<string, unknown>)[by] as string | null ?? "none", count: g._count._all }));
  }

  const presence = await presenceFor(users.map((u) => u.id));
  // Invite follows the invitations route's own gate (people.create), so the
  // button never renders for someone POST /api/invitations would refuse.
  const session = await getServerSession(authOptions);
  const canInvite = session?.user && !ctx.isAgent ? await hasPermission(session, "people", "create") : false;
  const tagsByUser = await getUserTagsMap(ctx.organizationId, users.map((u) => u.id));
  const rows = users.map((u) => {
    const peopleData = readsPeopleDataOf(ctx, u.id);
    const p = presence.get(u.id);
    return {
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      avatar: u.avatar,
      // Raw employment status (PIP, notice period, probation, leave) is
      // people data; everyone else learns only whether it is deactivated.
      status: visibleStatus(u.status, peopleData),
      isDeactivated: u.status === "INACTIVE",
      managerId: u.managerId,
      joinDate: u.joinDate,
      deletedAt: privileged ? u.deletedAt : null,
      isAgent: u.accessLevel === "AGENT",
      department: u.department,
      role: u.role ? { id: u.role.id, title: u.role.title, seniority: u.role.level } : null,
      office: u.office,
      manager: u.manager,
      directReports: u._count.directReports,
      tags: tagsByUser.get(u.id) ?? [],
      presenceStatus: p?.presenceStatus ?? null,
      presenceUntil: p?.presenceUntil ?? null,
      // People data (access 3.5): only for self, the chain, the People team
      // and Admins. Absent, not blank, for anyone else.
      ...(peopleData ? { phone: u.phone } : {}),
      // A row is selectable (and editable) only where the viewer holds the
      // placement write: a dotted-line manager reads, never edits.
      canEdit: u.id !== ctx.userId && canWritePersonGroup("placement", relationTo(ctx, u.id), { chainWritesMembership: !accessV2Resolver() }),
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
  const where: Prisma.UserWhereInput = { organizationId: ctx.organizationId, deletedAt: null };
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        avatar: true,
        managerId: true,
        accessLevel: true,
        status: true,
        roleId: true,
        departmentId: true,
        officeId: true,
        role: { select: { title: true } },
        department: { select: { name: true } },
        dottedLineToManagers: { select: { managerId: true } },
      },
      orderBy: [{ firstName: "asc" }, { id: "asc" }],
      take: CHART_CAP,
    }),
    prisma.user.count({ where }),
  ]);
  const presence = await presenceFor(users.map((u) => u.id));
  return NextResponse.json(
    {
      data: users.map((u) => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        avatar: u.avatar,
        managerId: u.managerId,
        isAgent: u.accessLevel === "AGENT",
        status: visibleStatus(u.status, readsPeopleDataOf(ctx, u.id)),
        isDeactivated: u.status === "INACTIVE",
        roleId: u.roleId,
        departmentId: u.departmentId,
        officeId: u.officeId,
        jobTitle: u.role?.title ?? null,
        department: u.department?.name ?? null,
        dottedManagerIds: u.dottedLineToManagers.map((d) => d.managerId),
        presenceStatus: presence.get(u.id)?.presenceStatus ?? null,
        presenceUntil: presence.get(u.id)?.presenceUntil ?? null,
      })),
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
