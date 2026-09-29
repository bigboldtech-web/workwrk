import "server-only";

// Whose work My team (/team) and Workload (/team/workload) show, on the
// server: one answer for the two pages and their three APIs
// (GET /api/team/members-work, /api/team/attention, /api/team/workload).
//
//   org-wide viewers (Owner, Admin, the People team, and the legacy
//   org-wide levels that saw the org here before Phase 6): everyone in the
//   organization who is not removed.
//   everyone else: their chain, solid lines at any depth plus dotted
//   reports (peopleCtx().chain), never themselves.
//
// `direct` is the Direct reports view: people whose manager is the viewer,
// plus the viewer's dotted reports.

import { prisma } from "@/lib/prisma";
import type { PeopleCtx } from "./person-access.server";

export interface TeamScope {
  /** True when the scope is the whole organization. */
  orgWide: boolean;
  /** The people in scope (removed people excluded), in no particular order. */
  ids: string[];
  /** The viewer's direct solid and dotted reports inside `ids`. */
  direct: Set<string>;
  /** True when the viewer also has reports below their direct ones. */
  hasIndirect: boolean;
}

export async function teamScopeFor(ctx: PeopleCtx, opts: { includeDeactivated?: boolean } = {}): Promise<TeamScope> {
  const orgWide = ctx.isAdmin || ctx.peopleTeam || ctx.orgWide;
  const statusWhere = opts.includeDeactivated ? {} : { status: { not: "INACTIVE" as const } };
  const [people, dotted] = await Promise.all([
    prisma.user.findMany({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        ...statusWhere,
        ...(orgWide ? {} : { id: { in: [...ctx.chain] } }),
      },
      select: { id: true, managerId: true },
    }),
    prisma.userDottedLine.findMany({ where: { managerId: ctx.userId }, select: { userId: true } }),
  ]);
  const ids = people.map((p) => p.id);
  const inScope = new Set(ids);
  const direct = new Set<string>();
  for (const p of people) if (p.managerId === ctx.userId) direct.add(p.id);
  for (const d of dotted) if (inScope.has(d.userId)) direct.add(d.userId);
  const chainOnly = orgWide ? ids.filter((id) => ctx.chain.has(id)) : ids;
  const hasIndirect = chainOnly.some((id) => !direct.has(id) && id !== ctx.userId);
  return { orgWide, ids, direct, hasIndirect };
}
