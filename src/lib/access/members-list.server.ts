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

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { ownerIdsOf } from "@/lib/admin/companies-list";
import { memberRoleOf, tierLabel, type MemberRole } from "./membership";
import { parseAccessSettings } from "./settings";

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
  /** Admin scopes an Owner gave (billing, security); empty for everyone else. */
  adminScopes: string[];
}

/** The People team: the configured list, else everyone at HR (access step 0). */
export async function peopleTeamIdsFor(organizationId: string): Promise<{ ids: Set<string>; configured: boolean }> {
  const [org, hr] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { settings: true } }),
    prisma.user.findMany({ where: { organizationId, deletedAt: null, accessLevel: "HR" }, select: { id: true } }),
  ]);
  const configured = parseAccessSettings((org?.settings as { access?: unknown } | null)?.access).peopleTeamUserIds;
  return configured.length > 0 ? { ids: new Set(configured), configured: true } : { ids: new Set(hr.map((h) => h.id)), configured: false };
}

export async function listMembers(
  organizationId: string,
  scope: { orgWide: boolean; ids: string[] },
  query: MemberQuery,
): Promise<{ rows: MemberRow[]; total: number; page: number; pageCount: number }> {
  const limit = Math.min(100, Math.max(10, query.limit ?? 50));
  const page = Math.max(0, query.page ?? 0);
  const and: Prisma.UserWhereInput[] = [{ organizationId, deletedAt: null }];
  if (!scope.orgWide) and.push({ id: { in: scope.ids } });

  const [admins, team] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId, deletedAt: null, status: { not: "INACTIVE" }, accessLevel: { in: ["SUPER_ADMIN", "COMPANY_ADMIN"] } },
      select: { id: true, accessLevel: true, createdAt: true },
    }),
    peopleTeamIdsFor(organizationId),
  ]);
  const owners = new Set(ownerIdsOf(admins.map((a) => ({ id: a.id, level: a.accessLevel, createdAt: a.createdAt }))));

  if (query.q) {
    for (const w of query.q.trim().split(/\s+/).slice(0, 5)) {
      and.push({ OR: [{ firstName: { contains: w, mode: "insensitive" } }, { lastName: { contains: w, mode: "insensitive" } }, { email: { contains: w, mode: "insensitive" } }] });
    }
  }
  if (query.role === "OWNER") and.push({ id: { in: [...owners] } });
  else if (query.role === "ADMIN") and.push({ accessLevel: { in: ["SUPER_ADMIN", "COMPANY_ADMIN"] }, id: { notIn: [...owners] } });
  else if (query.role === "MEMBER") and.push({ accessLevel: { notIn: ["SUPER_ADMIN", "COMPANY_ADMIN"] } });
  else if (query.role === "guest") and.push({ id: { in: [] } }); // no Guest tier yet
  if (query.departmentId) and.push({ departmentId: query.departmentId });
  if (query.officeId) and.push({ officeId: query.officeId });
  if (query.roleId) and.push({ roleId: query.roleId });
  if (query.status) and.push({ status: query.status as Prisma.UserWhereInput["status"] });
  if (query.noManager) and.push({ managerId: null, status: { not: "INACTIVE" } });
  if (query.peopleTeam) and.push({ id: { in: [...team.ids] } });
  if (query.inactive30) {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const active = await prisma.activityLog.findMany({
      where: { organizationId, type: "login", createdAt: { gte: since } },
      select: { actorId: true },
      distinct: ["actorId"],
    });
    and.push({ id: { notIn: active.map((a) => a.actorId).filter((x): x is string => !!x) } });
  }
  const where: Prisma.UserWhereInput = { AND: and };

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

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy,
      skip: page * limit,
      take: limit,
      select: {
        id: true, firstName: true, lastName: true, email: true, avatar: true, accessLevel: true, status: true, createdAt: true, weeklyCapacityHours: true, adminScopes: true,
        role: { select: { id: true, title: true } },
        department: { select: { id: true, name: true } },
        office: { select: { id: true, name: true } },
        manager: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
  ]);
  const ids = users.map((u) => u.id);
  const logins = ids.length
    ? await prisma.activityLog.groupBy({ by: ["actorId"], where: { organizationId, type: "login", actorId: { in: ids } }, _max: { createdAt: true } })
    : [];
  const lastLogin = new Map(logins.map((l) => [l.actorId, l._max.createdAt]));

  const rows: MemberRow[] = users.map((u) => {
    const role = memberRoleOf(u.accessLevel, owners.has(u.id));
    return {
      id: u.id,
      name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email,
      email: u.email,
      avatar: u.avatar,
      role,
      tier: role === "MEMBER" ? u.accessLevel : null,
      tierLabel: role === "MEMBER" ? tierLabel(u.accessLevel) : null,
      isAgent: u.accessLevel === "AGENT",
      jobTitle: u.role ? { id: u.role.id, title: u.role.title } : null,
      department: u.department,
      office: u.office,
      manager: u.manager ? { id: u.manager.id, name: `${u.manager.firstName ?? ""} ${u.manager.lastName ?? ""}`.trim() } : null,
      peopleTeam: team.ids.has(u.id),
      status: String(u.status),
      lastSignInAt: lastLogin.get(u.id)?.toISOString() ?? null,
      joinedAt: u.createdAt.toISOString(),
      weeklyCapacityHours: u.weeklyCapacityHours ?? null,
      adminScopes: role === "ADMIN" ? u.adminScopes ?? [] : [],
    };
  });
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / limit)) };
}
