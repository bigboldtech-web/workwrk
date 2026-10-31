// GET /api/spaces/[id]/workload?from=YYYY-MM-DD&to=YYYY-MM-DD&today=YYYY-MM-DD
// The Space's Workload tab: who in this Space has too much or too little
// work over the next weeks, on the same WorkloadGrid a List's WORKLOAD view
// and Teams > Workload render.
//
// ONE gate, the Space's (Can view, the Bird's eye gate: a path through the
// Space is not a role), then ONE predicate for the Lists:
// readableListsInSpace, the answer every other Space tab uses. A List the
// viewer cannot open never adds a task, a count or a person here.
//
// People: the Space's members and everyone on an open task in its readable
// Lists, who still work in this workspace and are not deactivated. A departed
// holder is never a row (src/lib/work/space-workload.ts).
//
// Items: every OPEN task (not archived, not a meeting, not in a done status
// of its own List) on those Lists that touches the window, has no dates at
// all (the Unscheduled column) or is already overdue (due before the
// viewer's `today`, whatever the window). At most SPACE_WORKLOAD_CAP of each
// of the three, and `truncated` says which had more.
//
// WHOSE CAPACITY. A person's own weekly hours and work schedule are people
// data: they are sent only for people the viewer may read people data for
// (self, their chain, the People team, Admin), the dashboard Workload card's
// rule. Everyone else is measured against the company working calendar and
// marked ownCapacity: false, so a Space reader never learns a colleague is
// part time from this tab.

import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma";
import { itemCtx } from "@/lib/item-gate";
import { prisma } from "@/lib/prisma";
import { listSpaceMembers, readableListsInSpace } from "@/lib/space";
import { spaceForViewer } from "@/lib/list-links-server";
import { getBoardStatuses, isDoneStatus, type StatusOption } from "@/lib/board-items-shared";
import { openItemsWhere, type ReadableBoard, type ReadableBoards } from "@/lib/people/team-boards.server";
import { peopleCtx, readsPeopleDataOf } from "@/lib/people/person-access.server";
import { liveHereAmong } from "@/lib/access/manager-lines";
import { readOrgWorkSchedule } from "@/lib/work-schedule-server";
import { readPersonScheduleOverride } from "@/lib/work-schedule";
import { NOT_SYSTEM_ITEMS } from "@/lib/system-items";
import { SPACE_WORKLOAD_CAP, spaceWorkloadHolders } from "@/lib/work/space-workload";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const answer = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const c = await itemCtx();
  if ("error" in c) {
    c.error.headers.set("Cache-Control", "no-store");
    return c.error;
  }
  const { id } = await params;
  try {
    const space = await spaceForViewer(c, id);
    if (!space) return answer({ error: "Not found" }, 404);

    const sp = new URL(req.url).searchParams;
    const fromRaw = sp.get("from") ?? "";
    const toRaw = sp.get("to") ?? "";
    if (!DATE_RE.test(fromRaw) || !DATE_RE.test(toRaw)) return answer({ error: "from and to are dates, YYYY-MM-DD" }, 400);
    // One day of padding each side: the grid counts in the viewer's own zone.
    const from = new Date(`${fromRaw}T00:00:00.000Z`);
    const to = new Date(`${toRaw}T23:59:59.999Z`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return answer({ error: "from and to are dates, YYYY-MM-DD" }, 400);
    if (to.getTime() < from.getTime()) return answer({ error: "to is before from" }, 400);
    if (to.getTime() - from.getTime() > 92 * 86_400_000) return answer({ error: "A window is at most 92 days" }, 400);
    const lo = new Date(from.getTime() - 86_400_000);
    const hi = new Date(to.getTime() + 86_400_000);
    const todayRaw = sp.get("today") ?? "";
    const todayAt = DATE_RE.test(todayRaw) ? new Date(`${todayRaw}T00:00:00.000Z`) : new Date();
    const overdueBefore = new Date((Number.isNaN(todayAt.getTime()) ? Date.now() : todayAt.getTime()) + 86_400_000);

    const orgId = c.organizationId;
    const { lists } = await readableListsInSpace(space.id, c);
    const byId = new Map<string, ReadableBoard>(
      lists.map((l) => [l.id, { id: l.id, slug: l.slug, name: l.name, statuses: getBoardStatuses(l), canEdit: l.canContribute }] as const),
    );
    const boards: ReadableBoards = {
      ids: [...byId.keys()],
      byId,
      isDone: (boardId, status) => isDoneStatus(byId.get(boardId)?.statuses ?? [], status),
    };
    const boardIds = boards.ids;

    // THREE READS, EACH WITH ITS OWN CAP, so no one kind of task can crowd out
    // another: a Space with years of stale overdue work still shows this
    // window and its undated work (the worst case is a lead reading a buried
    // person as having room). The window read matches the counting exactly
    // (src/lib/people/workload-count.ts): a span that overlaps the window, or
    // the one date a task has inside it. Overdue keeps the most recently due.
    const windowed = {
      OR: [
        { startAt: { not: null, lte: hi }, dueAt: { not: null, gte: lo } },
        { startAt: null, dueAt: { gte: lo, lte: hi } },
        { dueAt: null, startAt: { gte: lo, lte: hi } },
        // A start after its due date: the counting swaps the two, so it still overlaps.
        { startAt: { not: null, gte: lo }, dueAt: { not: null, lte: hi } },
      ],
    };
    // Tasks only, never a meeting's Item on the hidden Meetings List
    // (src/lib/system-items.ts): it would count as a person's load.
    const base = { organizationId: orgId, archivedAt: null, ...NOT_SYSTEM_ITEMS, boardId: { in: boardIds } };
    const open = openItemsWhere(boards);
    const select = { id: true, title: true, status: true, boardId: true, ownerId: true, assigneeIds: true, startAt: true, dueAt: true, priority: true } as const;
    const read = (bucket: Prisma.ItemWhereInput, orderBy: Prisma.ItemOrderByWithRelationInput[]) =>
      boardIds.length
        ? prisma.item.findMany({ where: { ...base, AND: [bucket, open] }, select, orderBy, take: SPACE_WORKLOAD_CAP + 1 })
        : Promise.resolve([]);
    const [spaceMembers, inWindow, undated, overdue] = await Promise.all([
      listSpaceMembers(space.id),
      read(windowed, [{ dueAt: { sort: "asc", nulls: "last" } }, { startAt: "asc" }, { id: "asc" }]),
      read({ startAt: null, dueAt: null }, [{ updatedAt: "desc" }, { id: "asc" }]),
      read({ dueAt: { lt: overdueBefore } }, [{ dueAt: "desc" }, { id: "asc" }]),
    ]);
    const truncated = {
      window: inWindow.length > SPACE_WORKLOAD_CAP,
      unscheduled: undated.length > SPACE_WORKLOAD_CAP,
      overdue: overdue.length > SPACE_WORKLOAD_CAP,
    };
    // One row per task (an overdue task can also be in the window). openItemsWhere
    // leaves a status a List does not define to isDone, which applies the
    // shared done-name fallback.
    const byTask = new Map<string, (typeof inWindow)[number]>();
    for (const r of [...inWindow.slice(0, SPACE_WORKLOAD_CAP), ...undated.slice(0, SPACE_WORKLOAD_CAP), ...overdue.slice(0, SPACE_WORKLOAD_CAP)]) {
      if (!byTask.has(r.id) && !boards.isDone(r.boardId, r.status)) byTask.set(r.id, r);
    }
    const rows = [...byTask.values()];
    const estimates = await estimatesOf(orgId, rows.map((r) => r.id));

    const memberIds = new Set(spaceMembers.map((m) => m.userId));
    const candidates = new Set<string>(memberIds);
    for (const r of rows) {
      if (r.ownerId) candidates.add(r.ownerId);
      for (const a of r.assigneeIds) candidates.add(a);
    }
    // Who still works here: holds a level in this workspace (anchored or
    // through a membership), is not removed and is not deactivated.
    const here = await liveHereAmong(orgId, [...candidates]);
    const peopleRows = here.size
      ? await prisma.user.findMany({
          where: { id: { in: [...here] }, deletedAt: null, status: { not: "INACTIVE" } },
          select: { id: true, firstName: true, lastName: true, avatar: true },
          orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        })
      : [];
    const live = new Set(peopleRows.map((p) => p.id));

    const pctx = await peopleCtx();
    const readable = new Set(pctx ? peopleRows.map((p) => p.id).filter((pid) => readsPeopleDataOf(pctx, pid)) : []);
    const extra = await capacityFields([...readable]);

    const items = rows.map((r) => {
      return {
        id: r.id,
        title: r.title,
        status: r.status,
        boardId: r.boardId,
        ...spaceWorkloadHolders(r, live),
        startAt: r.startAt ? r.startAt.toISOString() : null,
        dueAt: r.dueAt ? r.dueAt.toISOString() : null,
        priority: r.priority,
        estimateMinutes: estimates.get(r.id) ?? null,
      };
    });

    const orgSchedule = await readOrgWorkSchedule(orgId);
    return answer({
      window: { from: fromRaw, to: toRaw },
      orgSchedule,
      people: peopleRows.map((p) => {
        const own = readable.has(p.id);
        return {
          id: p.id,
          firstName: p.firstName,
          lastName: p.lastName,
          avatar: p.avatar,
          weeklyCapacityHours: own ? extra.get(p.id)?.weeklyCapacityHours ?? null : null,
          workSchedule: own ? extra.get(p.id)?.workSchedule ?? null : null,
          ownCapacity: own,
        };
      }),
      items,
      boards: lists.map((l) => {
        const b = byId.get(l.id)!;
        return { id: b.id, name: b.name, canEdit: b.canEdit, statuses: b.statuses as StatusOption[] };
      }),
      truncated,
    });
  } catch (err) {
    console.error(`[space-workload] GET /api/spaces/${id}/workload failed:`, err);
    return answer({ error: "Couldn't load the workload." }, 500);
  }
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

/**
 * Each task's estimate in minutes (Item.metadata.timeEstimate, the field the
 * task drawer's Estimate writes), read on its own: the rest of metadata
 * (custom field values, linked-List keys) is never pulled for a count.
 */
async function estimatesOf(orgId: string, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 5000) {
    const chunk = ids.slice(i, i + 5000);
    const rows = await prisma.$queryRaw<Array<{ id: string; est: number }>>`
      SELECT i."id" AS "id", (i."metadata"->>'timeEstimate')::float8 AS "est"
        FROM "Item" i
       WHERE i."organizationId" = ${orgId}
         AND i."id" IN (${Prisma.join(chunk)})
         AND jsonb_typeof(i."metadata"->'timeEstimate') = 'number'`;
    for (const r of rows) if (Number.isFinite(r.est) && r.est > 0) out.set(r.id, r.est);
  }
  return out;
}
