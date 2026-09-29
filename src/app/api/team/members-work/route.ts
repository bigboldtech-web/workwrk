// GET /api/team/members-work: My team's table (spec-teams-people /team).
//
// Scope (src/lib/people/team-scope.server.ts): the viewer's chain, solid
// lines at any depth plus dotted reports, never themselves; the whole
// organization for Owner, Admin, the People team and the legacy org-wide
// levels. Anyone else gets 403: the page shows them the LockedPage, and the
// API never answers with an empty list that reads as "your team has no
// work".
//
// Query: view=all|direct|needs-attention, q, dept, title, manager (org-wide
// viewers), noKras=1, overdue=1, includeDeactivated=1 (a deactivated
// report's open work is still work someone must pick up),
// sort=name|open|overdue|active, page (or cursor) and limit (default 40,
// at most 100).
//
// Counting (src/lib/people/team-work.ts): EXACT over every live item on a
// List the viewer can read, one aggregated SQL row per person, List and
// status, so the totals are never the newest-N window they used to be. An
// item counts for its owner and for every assignee. Done follows each List's
// own status set. "Working on" is a sample for the current page only.
//
// Read-only. Item visibility comes from the one node-access resolver, over
// ONE world for every List (never a gate call per List), so a title on a
// List the viewer cannot open never leaks.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { peopleCtx } from "@/lib/people/person-access.server";
import { teamScopeFor } from "@/lib/people/team-scope.server";
import { openItemsWhere, readableBoardsFor } from "@/lib/people/team-boards.server";
import { aggregateWork, parseTeamSort, sortTeam, weekStartLocal, NO_WORK, type WorkGroupRow } from "@/lib/people/team-work";
import { ACCESS_ACTIVITY_TYPES } from "@/lib/access/access-activity";
import { toCsv } from "@/lib/people/people-csv";

const err = (status: number, error: string) => NextResponse.json({ error }, { status });

interface WorkingOn {
  id: string;
  title: string;
  status: string | null;
  dueAt: string | null;
  board: { id: string; name: string };
}

type SampleRow = { id: string; title: string; status: string | null; dueAt: Date | null; updatedAt: Date; boardId: string; ownerId: string | null; assigneeIds: string[] };

type Detail = {
  id: string;
  role: { id: string; title: string } | null;
  department: { id: string; name: string } | null;
  presenceStatus?: string | null;
  presenceUntil?: Date | null;
};

export async function GET(req: NextRequest) {
  const ctx = await peopleCtx();
  if (!ctx) return err(401, "Unauthorized");
  if (ctx.orgRole === "GUEST") return err(404, "Not found");
  const sp = req.nextUrl.searchParams;
  const scope = await teamScopeFor(ctx, { includeDeactivated: sp.get("includeDeactivated") === "1" });
  if (!scope.orgWide && ctx.chain.size === 0) return err(403, "My team shows the people who report to you. Nobody reports to you yet.");

  const view = sp.get("view") === "direct" ? "direct" : sp.get("view") === "needs-attention" ? "needs-attention" : "all";
  const q = (sp.get("q") ?? "").trim();
  const dept = sp.get("dept") || null;
  const title = sp.get("title") || null;
  const manager = scope.orgWide ? sp.get("manager") || null : null;
  const noKras = sp.get("noKras") === "1";
  const overdueOnly = sp.get("overdue") === "1";
  const sort = parseTeamSort(sp.get("sort"));
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit")) || 40));
  const cursor = sp.get("cursor");
  const page = Math.max(1, cursor && Number.isFinite(Number(cursor)) ? Math.floor(Number(cursor) / limit) + 1 : Number(sp.get("page")) || 1);

  // The people, narrowed by the cheap filters in SQL.
  const baseIds = view === "direct" ? scope.ids.filter((id) => scope.direct.has(id)) : scope.ids;
  const orgId = ctx.organizationId;
  const people = baseIds.length
    ? await prisma.user.findMany({
        where: {
          organizationId: orgId,
          id: { in: baseIds },
          ...(dept ? { departmentId: dept } : {}),
          ...(title ? { roleId: title } : {}),
          ...(manager ? { managerId: manager } : {}),
          ...(noKras ? { kraAssignments: { none: { status: "ACTIVE" } } } : {}),
          ...(q
            ? { OR: [
                { firstName: { contains: q, mode: "insensitive" as const } },
                { lastName: { contains: q, mode: "insensitive" as const } },
                { email: { contains: q, mode: "insensitive" as const } },
              ] }
            : {}),
        },
        select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
      })
    : [];
  const ids = people.map((p) => p.id);

  const boards = await readableBoardsFor(ctx.viewer);
  const now = new Date();
  const weekStart = weekStartLocal(now);

  const [groups, lastActiveRows, attentionIds] = await Promise.all([
    ids.length && boards.ids.length
      ? prisma.$queryRaw<WorkGroupRow[]>`
          SELECT p.person AS "personId", i."boardId" AS "boardId", i."status" AS "status",
                 count(*)::int AS "n",
                 (count(*) FILTER (WHERE i."dueAt" IS NOT NULL AND i."dueAt" < ${now}))::int AS "overdue",
                 (count(*) FILTER (WHERE i."updatedAt" >= ${weekStart}))::int AS "recent"
            FROM "Item" i
            CROSS JOIN LATERAL (
              SELECT DISTINCT x AS person FROM unnest(array_append(i."assigneeIds", i."ownerId")) AS x
            ) p
           WHERE i."organizationId" = ${orgId}
             AND i."archivedAt" IS NULL
             AND i."boardId" IN (${Prisma.join(boards.ids)})
             AND p.person IN (${Prisma.join(ids)})
           GROUP BY 1, 2, 3`
      : Promise.resolve([] as WorkGroupRow[]),
    // Work, not access: a record of who was given access to what never
    // counts as somebody being active.
    ids.length
      ? prisma.activityLog.groupBy({
          by: ["actorId"],
          where: { organizationId: orgId, actorId: { in: ids }, type: { notIn: [...ACCESS_ACTIVITY_TYPES] } },
          _max: { createdAt: true },
        })
      : Promise.resolve([] as Array<{ actorId: string; _max: { createdAt: Date | null } }>),
    view === "needs-attention" && ids.length ? attentionPeople(ids) : Promise.resolve(null),
  ]);

  const work = aggregateWork(groups, boards.isDone);
  const lastActive = new Map(lastActiveRows.map((r) => [r.actorId, r._max.createdAt?.getTime() ?? null] as const));
  const named = people
    .filter((p) => (attentionIds ? attentionIds.has(p.id) : true))
    .map((p) => ({
      ...p,
      name: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email,
      work: work.get(p.id) ?? { ...NO_WORK },
      lastActive: lastActive.get(p.id) ?? null,
    }))
    .filter((p) => (overdueOnly ? p.work.overdue > 0 : true));

  const sorted = sortTeam(named, sort);
  const total = sorted.length;

  // Export CSV (Owner and Admin, never an Agent): every row the filters
  // hold, not the page.
  if (sp.get("format") === "csv") {
    if (!ctx.isAdmin || ctx.isAgent) return err(403, "Only an Admin can export My team.");
    const csv = toCsv(
      ["Name", "Email", "Open", "Done this week", "Overdue", "Last active"],
      sorted.map((p) => [p.name, p.email, p.work.open, p.work.doneThisWeek, p.work.overdue, p.lastActive ? new Date(p.lastActive).toISOString() : ""]),
    );
    return new NextResponse(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="my-team.csv"', "Cache-Control": "no-store" },
    });
  }
  const slice = sorted.slice((page - 1) * limit, page * limit);
  const pageIds = slice.map((p) => p.id);

  // The page's own detail: job titles, departments, presence, and a
  // "Working on" sample (the soonest-due open item, else the most recently
  // touched), all for at most `limit` people. The sample is taken PER
  // PERSON over OPEN items only (done filtered in SQL by each List's own
  // status set), so a person whose open work is older than a pile of
  // recently finished items still shows it, never "Nothing open" beside
  // an Open count above zero.
  const open = openItemsWhere(boards);
  const [details, sampleLists] = await Promise.all([
    pageIds.length ? pageDetails(pageIds) : Promise.resolve([] as Detail[]),
    pageIds.length && boards.ids.length
      ? Promise.all(pageIds.map((pid) => prisma.item.findMany({
          where: {
            AND: [
              { organizationId: orgId, archivedAt: null, boardId: { in: boards.ids }, OR: [{ ownerId: pid }, { assigneeIds: { has: pid } }] },
              open,
            ],
          },
          select: { id: true, title: true, status: true, dueAt: true, updatedAt: true, boardId: true, ownerId: true, assigneeIds: true },
          orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
          take: 5,
        })))
      : Promise.resolve([] as SampleRow[][]),
  ]);
  const sample: SampleRow[] = sampleLists.flat();
  const detailById = new Map(details.map((d) => [d.id, d] as const));
  const openByPerson = new Map<string, typeof sample>();
  const pageSet = new Set(pageIds);
  for (const it of sample) {
    if (boards.isDone(it.boardId, it.status)) continue;
    const who = new Set([...(it.ownerId ? [it.ownerId] : []), ...it.assigneeIds]);
    for (const pid of who) {
      if (!pageSet.has(pid)) continue;
      const list = openByPerson.get(pid);
      if (list) list.push(it);
      else openByPerson.set(pid, [it]);
    }
  }
  const pick = (list: typeof sample): WorkingOn | null => {
    if (!list.length) return null;
    const dated = list.filter((i) => i.dueAt).sort((a, b) => a.dueAt!.getTime() - b.dueAt!.getTime());
    const it = dated[0] ?? list[0];
    return { id: it.id, title: it.title, status: it.status, dueAt: it.dueAt ? it.dueAt.toISOString() : null, board: { id: it.boardId, name: boards.byId.get(it.boardId)?.name ?? "" } };
  };

  const rows = slice.map((p) => {
    const d = detailById.get(p.id);
    return {
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      email: p.email,
      avatar: p.avatar,
      role: d?.role ?? null,
      department: d?.department ?? null,
      presenceStatus: d?.presenceStatus ?? null,
      presenceUntil: d?.presenceUntil ? d.presenceUntil.toISOString() : null,
      open: p.work.open,
      doneThisWeek: p.work.doneThisWeek,
      overdue: p.work.overdue,
      workingOn: pick(openByPerson.get(p.id) ?? []),
      lastActive: p.lastActive ? new Date(p.lastActive).toISOString() : null,
      direct: scope.direct.has(p.id),
      // Record numbers: the same door POST /api/kpi-records opens.
      canRecord: ctx.isAdmin || ctx.peopleTeam || ctx.orgWide || ctx.writeChain.has(p.id),
    };
  });

  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } });
  const hasMore = page * limit < total;
  return NextResponse.json(
    {
      rows,
      total,
      page,
      limit,
      hasMore,
      nextCursor: hasMore ? String(page * limit) : null,
      viewer: {
        orgWide: scope.orgWide,
        orgName: org?.name ?? "",
        hasIndirect: scope.hasIndirect,
        canExport: ctx.isAdmin && !ctx.isAgent,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function pageDetails(ids: string[]): Promise<Detail[]> {
  try {
    return await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, role: { select: { id: true, title: true } }, department: { select: { id: true, name: true } }, presenceStatus: true, presenceUntil: true },
    });
  } catch {
    // presenceStatus is additive (prisma/sql 2026-09-26-phase6-people.sql);
    // a database without it still answers, with no dot.
    return prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, role: { select: { id: true, title: true } }, department: { select: { id: true, name: true } } },
    });
  }
}

/** People with a submitted weekly review or KPI record waiting, or no KRAs. */
async function attentionPeople(ids: string[]): Promise<Set<string>> {
  const [weekly, kpis, noKras] = await Promise.all([
    prisma.weeklyReview.findMany({ where: { userId: { in: ids }, status: "SUBMITTED" }, select: { userId: true }, distinct: ["userId"] }),
    prisma.kPIRecord.findMany({ where: { userId: { in: ids }, status: "SUBMITTED" }, select: { userId: true }, distinct: ["userId"] }),
    prisma.user.findMany({ where: { id: { in: ids }, kraAssignments: { none: { status: "ACTIVE" } } }, select: { id: true } }),
  ]);
  return new Set([...weekly.map((w) => w.userId), ...kpis.map((k) => k.userId), ...noKras.map((u) => u.id)]);
}
