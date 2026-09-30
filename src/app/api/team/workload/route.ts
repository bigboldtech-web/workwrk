// GET /api/team/workload?from=YYYY-MM-DD&to=YYYY-MM-DD&today=YYYY-MM-DD&userIds=&boardIds=&priority=&dept=&includeDeactivated=1
// The cross-List Workload grid's data (spec-teams-people /team/workload),
// Items-based, replacing the server-only query the page used to run, so
// moving the window is a client fetch and never a page reload.
//
// People: the same scope as My team (the chain, or the org for Owner, Admin,
// the People team and the legacy org-wide levels), minus removed and
// deactivated people unless asked. Each carries weeklyCapacityHours and
// their own work schedule override, both tolerated absent for one release.
//
// Items: every OPEN item (not archived, not in a done status of its own
// List) on a List the viewer can read, where a person in scope is the owner
// or an assignee, that touches the window or has no dates at all (the
// Unscheduled column), or is already OVERDUE (due before `today`, the
// viewer's local day, whatever the window: late work is load a manager must
// see). Plus the Unassigned bucket: open items with nobody on them, on Lists
// the team belongs to or already works on. No newest-N cap. The counting
// itself is src/lib/people/workload-count.ts, run by the grid.
//
// Each item carries `assigneeCount`, everyone it is split across, while
// `ownerId` and `assigneeIds` carry only the people in the viewer's scope:
// Hours mode divides by the real count, so a co-assignee the viewer cannot
// see never doubles a report's share.

import { NextResponse, type NextRequest } from "next/server";
import { accessV2Resolver } from "@/lib/access/flags";
import { prisma } from "@/lib/prisma";
import { peopleCtx, relationTo } from "@/lib/people/person-access.server";
import { teamScopeFor } from "@/lib/people/team-scope.server";
import { readableBoardsFor } from "@/lib/people/team-boards.server";
import { canWritePersonField } from "@/lib/people/person-fields";
import { readOrgWorkSchedule } from "@/lib/work-schedule-server";
import { readPersonScheduleOverride } from "@/lib/work-schedule";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const err = (status: number, error: string) => NextResponse.json({ error }, { status });

function list(v: string | null): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export async function GET(req: NextRequest) {
  const ctx = await peopleCtx();
  if (!ctx) return err(401, "Unauthorized");
  if (ctx.orgRole === "GUEST") return err(404, "Not found");
  const sp = req.nextUrl.searchParams;
  const fromRaw = sp.get("from") ?? "";
  const toRaw = sp.get("to") ?? "";
  if (!DATE_RE.test(fromRaw) || !DATE_RE.test(toRaw)) return err(400, "from and to are dates, YYYY-MM-DD");
  // One day of padding each side: the grid counts in the viewer's own zone.
  const from = new Date(`${fromRaw}T00:00:00.000Z`);
  const to = new Date(`${toRaw}T23:59:59.999Z`);
  if (to.getTime() < from.getTime()) return err(400, "to is before from");
  if (to.getTime() - from.getTime() > 92 * 86_400_000) return err(400, "A window is at most 92 days");
  const lo = new Date(from.getTime() - 86_400_000);
  const hi = new Date(to.getTime() + 86_400_000);
  // Overdue is due before the viewer's today; a day of padding, the grid
  // decides in the viewer's own zone. A bad or missing value is the server's.
  const todayRaw = sp.get("today") ?? "";
  const todayAt = DATE_RE.test(todayRaw) ? new Date(`${todayRaw}T00:00:00.000Z`) : new Date();
  const overdueBefore = new Date((Number.isNaN(todayAt.getTime()) ? Date.now() : todayAt.getTime()) + 86_400_000);

  const scope = await teamScopeFor(ctx, { includeDeactivated: sp.get("includeDeactivated") === "1" });
  if (!scope.orgWide && ctx.chain.size === 0) return err(403, "Workload shows the work of people who report to you. Nobody reports to you yet.");

  const onlyUsers = new Set(list(sp.get("userIds")));
  const onlyBoards = new Set(list(sp.get("boardIds")));
  const priorities = list(sp.get("priority"));
  const dept = sp.get("dept") || null;
  const orgId = ctx.organizationId;

  const peopleRows = scope.ids.length
    ? await prisma.user.findMany({
        where: {
          organizationId: orgId,
          id: { in: onlyUsers.size ? scope.ids.filter((id) => onlyUsers.has(id)) : scope.ids },
          ...(dept ? { departmentId: dept } : {}),
        },
        select: { id: true, firstName: true, lastName: true, email: true, avatar: true, departmentId: true },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      })
    : [];
  const ids = peopleRows.map((p) => p.id);
  const extra = await capacityFields(ids);

  const boards = await readableBoardsFor(ctx.viewer);
  const boardIds = onlyBoards.size ? boards.ids.filter((id) => onlyBoards.has(id)) : boards.ids;

  const touches = {
    OR: [
      { startAt: null, dueAt: null },
      { AND: [{ OR: [{ startAt: null }, { startAt: { lte: hi } }] }, { OR: [{ dueAt: null }, { dueAt: { gte: lo } }] }] },
      { dueAt: { lt: overdueBefore } },
    ],
  };
  const common = {
    organizationId: orgId,
    archivedAt: null,
    ...(priorities.length ? { priority: { in: priorities } } : {}),
  };

  // The Lists the team belongs to or already works on: where Unassigned
  // work is theirs to pick up (every unassigned row in the org is not).
  const [memberBoards, ownedBoards] = ids.length && boardIds.length
    ? await Promise.all([
        prisma.boardMember.findMany({ where: { userId: { in: ids }, boardId: { in: boardIds } }, select: { boardId: true }, distinct: ["boardId"] }),
        prisma.item.findMany({
          where: { organizationId: orgId, archivedAt: null, boardId: { in: boardIds }, OR: [{ ownerId: { in: ids } }, { assigneeIds: { hasSome: ids } }] },
          select: { boardId: true },
          distinct: ["boardId"],
        }),
      ])
    : [[], []];
  const teamBoardIds = [...new Set([...memberBoards.map((m) => m.boardId), ...ownedBoards.map((o) => o.boardId)])];

  const rows = ids.length && boardIds.length
    ? await prisma.item.findMany({
        where: {
          ...common,
          AND: [
            touches,
            {
              OR: [
                { boardId: { in: boardIds }, ownerId: { in: ids } },
                { boardId: { in: boardIds }, assigneeIds: { hasSome: ids } },
                ...(teamBoardIds.length ? [{ boardId: { in: teamBoardIds }, ownerId: null, assigneeIds: { isEmpty: true } }] : []),
              ],
            },
          ],
        },
        select: { id: true, title: true, status: true, boardId: true, ownerId: true, assigneeIds: true, startAt: true, dueAt: true, priority: true, metadata: true },
        orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { position: "asc" }],
      })
    : [];

  const inScope = new Set(ids);
  const items = rows
    .filter((r) => !boards.isDone(r.boardId, r.status))
    .map((r) => {
      const md = (r.metadata ?? {}) as Record<string, unknown>;
      const est = typeof md.timeEstimate === "number" && Number.isFinite(md.timeEstimate) && md.timeEstimate > 0 ? md.timeEstimate : null;
      return {
        id: r.id,
        title: r.title,
        status: r.status,
        boardId: r.boardId,
        // Only people in view: an assignee outside the viewer's scope is not
        // drawn (their row is not the viewer's to see).
        ownerId: r.ownerId && inScope.has(r.ownerId) ? r.ownerId : null,
        assigneeIds: r.assigneeIds.filter((a) => inScope.has(a)),
        // Everyone the estimate is split across, seen or not (a count, no
        // identity): the owner plus each assignee, once each.
        assigneeCount: new Set([...(r.ownerId ? [r.ownerId] : []), ...r.assigneeIds]).size,
        unassigned: !r.ownerId && r.assigneeIds.length === 0,
        startAt: r.startAt ? r.startAt.toISOString() : null,
        dueAt: r.dueAt ? r.dueAt.toISOString() : null,
        priority: r.priority,
        estimateMinutes: est,
      };
    });

  const usedBoards = new Set(items.map((i) => i.boardId));
  const orgSchedule = await readOrgWorkSchedule(orgId);
  return NextResponse.json(
    {
      window: { from: fromRaw, to: toRaw },
      orgSchedule,
      people: peopleRows.map((p) => ({
        id: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        email: p.email,
        avatar: p.avatar,
        departmentId: p.departmentId,
        weeklyCapacityHours: extra.get(p.id)?.weeklyCapacityHours ?? null,
        workSchedule: extra.get(p.id)?.workSchedule ?? null,
        canEditCapacity: canWritePersonField("weeklyCapacityHours", relationTo(ctx, p.id), { managerTierSelf: ctx.managerTier, chainWritesMembership: !accessV2Resolver() }),
      })),
      items,
      boards: boards.ids
        .filter((id) => usedBoards.has(id) || teamBoardIds.includes(id))
        .map((id) => {
          const b = boards.byId.get(id)!;
          return { id: b.id, name: b.name, canEdit: b.canEdit, statuses: b.statuses };
        }),
      viewer: { orgWide: scope.orgWide, canExport: ctx.isAdmin && !ctx.isAgent, isAdmin: ctx.isAdmin },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** weeklyCapacityHours and workSchedule, tolerating the columns being absent. */
async function capacityFields(ids: string[]): Promise<Map<string, { weeklyCapacityHours: number | null; workSchedule: unknown }>> {
  const out = new Map<string, { weeklyCapacityHours: number | null; workSchedule: unknown }>();
  if (!ids.length) return out;
  try {
    const rows = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, weeklyCapacityHours: true, workSchedule: true } });
    for (const r of rows) out.set(r.id, { weeklyCapacityHours: r.weeklyCapacityHours ?? null, workSchedule: readPersonScheduleOverride(r.workSchedule) });
  } catch {
    // prisma/sql/2026-09-26-phase6-people.sql not applied yet: everyone
    // falls back to the org schedule.
  }
  return out;
}
