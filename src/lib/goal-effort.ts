// computeGoalEffort: the automated "how much real work is moving this goal"
// signal (spec-goals /okrs/[id] Effort card, Team goals Effort column).
//
// A goal links work through EntityLink (sourceType OKR):
//   KRA    -> every task tagged with that KRA (Item.metadata.kraId, which the
//             task drawer's Alignment row writes and migrate-legacy-tasks
//             copied from the dead Task.kraId), plus any legacy Task row the
//             migration has not moved yet (Task.kraId), never both for the
//             same work (a migrated Item carries metadata.legacyTaskId)
//   BOARD  -> the List's tasks
//   SPACE  -> the tasks of every List in the Space
// Hours are TimeEntry.hours on those tasks, plus the legacy hoursSpent a
// migrated task carried (metadata.legacyTask.hoursSpent) or a legacy Task
// still holds. Done is the cross-surface isDoneStatusName rule.
//
// Before Phase 6 the KRA path read only the legacy Task table, so a goal
// linked to a KRA showed zero effort for every task made since Phase 2, and
// the list's batched effort ignored Lists and Spaces, so Team goals and the
// goal page disagreed. Both now read this one module.
//
// Never self-reported. Server only.

import { prisma } from "@/lib/prisma";
import { isDoneStatusName } from "@/lib/board-items-shared";

export interface GoalEffortContributor {
  id: string;
  name: string;
  avatar: string | null;
  hours: number;
  tasks: number;
}

export interface GoalEffort {
  hasLinkedWork: boolean;
  linkedKras: number;
  linkedBoards: number;
  totalHours: number;
  /** Hours logged since the start of the current month (UTC). */
  hoursThisMonth: number;
  tasksDone: number;
  tasksOpen: number;
  lastActivityAt: Date | null;
  contributors: GoalEffortContributor[];
}

const empty = (): GoalEffort => ({
  hasLinkedWork: false, linkedKras: 0, linkedBoards: 0, totalHours: 0, hoursThisMonth: 0,
  tasksDone: 0, tasksOpen: 0, lastActivityAt: null, contributors: [],
});

type Person = { id: string; firstName: string | null; lastName: string | null; email: string; avatar: string | null };
const personName = (u: Person) => `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email;
const round1 = (n: number) => Math.round(n * 10) / 10;

function legacyHours(metadata: unknown): number {
  const lt = (metadata as { legacyTask?: { hoursSpent?: unknown } } | null)?.legacyTask;
  const h = typeof lt?.hoursSpent === "number" ? lt.hoursSpent : Number(lt?.hoursSpent ?? 0);
  return Number.isFinite(h) && h > 0 ? h : 0;
}

/** Which goals have any linked work at all (the verdict's hasLinkedWork), batched. */
export async function goalsWithLinkedWork(orgId: string, okrIds: string[]): Promise<Set<string>> {
  if (okrIds.length === 0) return new Set();
  const links = await prisma.entityLink.findMany({
    where: { organizationId: orgId, sourceType: "OKR", sourceId: { in: okrIds }, targetType: { in: ["KRA", "BOARD", "SPACE"] } },
    select: { sourceId: true, targetType: true, targetId: true },
  });
  const spaceIds = [...new Set(links.filter((l) => l.targetType === "SPACE").map((l) => l.targetId))];
  const spacesWithLists = spaceIds.length
    ? new Set((await prisma.board.findMany({ where: { organizationId: orgId, spaceId: { in: spaceIds } }, select: { spaceId: true } })).map((b) => b.spaceId))
    : new Set<string | null>();
  const out = new Set<string>();
  for (const l of links) {
    if (l.targetType === "SPACE" && !spacesWithLists.has(l.targetId)) continue;
    out.add(l.sourceId);
  }
  return out;
}

/** Effort for many goals in a fixed number of queries. */
export async function computeGoalEffortBatch(orgId: string, okrIds: string[], now: Date = new Date()): Promise<Map<string, GoalEffort>> {
  const out = new Map<string, GoalEffort>();
  if (okrIds.length === 0) return out;
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const links = await prisma.entityLink.findMany({
    where: { organizationId: orgId, sourceType: "OKR", sourceId: { in: okrIds }, targetType: { in: ["KRA", "BOARD", "SPACE"] } },
    select: { sourceId: true, targetType: true, targetId: true },
  });
  if (links.length === 0) {
    for (const id of okrIds) out.set(id, empty());
    return out;
  }

  // Resolve every link to a set of work ids per goal.
  const spaceIds = [...new Set(links.filter((l) => l.targetType === "SPACE").map((l) => l.targetId))];
  const spaceBoards = spaceIds.length
    ? await prisma.board.findMany({ where: { organizationId: orgId, spaceId: { in: spaceIds } }, select: { id: true, spaceId: true } })
    : [];
  const boardsOfSpace = new Map<string, string[]>();
  for (const b of spaceBoards) if (b.spaceId) boardsOfSpace.set(b.spaceId, [...(boardsOfSpace.get(b.spaceId) ?? []), b.id]);

  const goalKras = new Map<string, Set<string>>();
  const goalBoards = new Map<string, Set<string>>();
  for (const l of links) {
    if (l.targetType === "KRA") {
      const s = goalKras.get(l.sourceId) ?? new Set<string>();
      s.add(l.targetId);
      goalKras.set(l.sourceId, s);
    } else {
      const s = goalBoards.get(l.sourceId) ?? new Set<string>();
      for (const b of l.targetType === "BOARD" ? [l.targetId] : boardsOfSpace.get(l.targetId) ?? []) s.add(b);
      goalBoards.set(l.sourceId, s);
    }
  }
  const allKras = [...new Set([...goalKras.values()].flatMap((s) => [...s]))];
  const allBoards = [...new Set([...goalBoards.values()].flatMap((s) => [...s]))];

  // Tasks behind those links, once.
  const itemSelect = { id: true, status: true, updatedAt: true, boardId: true, metadata: true, ownerId: true, assigneeIds: true } as const;
  const [boardItems, kraItems] = await Promise.all([
    allBoards.length
      ? prisma.item.findMany({ where: { organizationId: orgId, boardId: { in: allBoards }, archivedAt: null, parentItemId: null }, select: itemSelect })
      : Promise.resolve([]),
    allKras.length
      ? prisma.item.findMany({
          where: { organizationId: orgId, archivedAt: null, OR: allKras.map((k) => ({ metadata: { path: ["kraId"], equals: k } })) },
          select: itemSelect,
        })
      : Promise.resolve([]),
  ]);
  type ItemRow = (typeof boardItems)[number];
  const items = new Map<string, ItemRow>();
  for (const it of [...boardItems, ...kraItems]) items.set(it.id, it);
  const migratedLegacy = new Set<string>();
  for (const it of items.values()) {
    const lid = (it.metadata as { legacyTaskId?: unknown } | null)?.legacyTaskId;
    if (typeof lid === "string") migratedLegacy.add(lid);
  }
  // Legacy Task rows the migration has not moved (read tolerantly: the table
  // may be gone in a later release).
  let legacyTasks: Array<{ id: string; kraId: string | null; hoursSpent: number | null; status: string; completedAt: Date | null; updatedAt: Date; assignee: Person | null }> = [];
  if (allKras.length) {
    try {
      legacyTasks = (await prisma.task.findMany({
        where: { organizationId: orgId, kraId: { in: allKras } },
        select: { id: true, kraId: true, hoursSpent: true, status: true, completedAt: true, updatedAt: true, assignee: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } } },
      })).filter((t) => !migratedLegacy.has(t.id));
    } catch {
      legacyTasks = [];
    }
  }

  const itemIds = [...items.keys()];
  const entries = itemIds.length
    ? await prisma.timeEntry.findMany({
        where: { organizationId: orgId, itemId: { in: itemIds }, hours: { not: null } },
        select: { hours: true, day: true, itemId: true, userId: true },
      })
    : [];
  const peopleIds = new Set<string>();
  for (const e of entries) if (e.userId) peopleIds.add(e.userId);
  for (const it of items.values()) {
    if (it.ownerId) peopleIds.add(it.ownerId);
    for (const a of it.assigneeIds ?? []) peopleIds.add(a);
  }
  const people = peopleIds.size
    ? await prisma.user.findMany({ where: { id: { in: [...peopleIds] }, organizationId: orgId }, select: { id: true, firstName: true, lastName: true, email: true, avatar: true } })
    : [];
  const personById = new Map<string, Person>(people.map((p) => [p.id, p]));
  const entriesByItem = new Map<string, typeof entries>();
  for (const e of entries) if (e.itemId) entriesByItem.set(e.itemId, [...(entriesByItem.get(e.itemId) ?? []), e]);

  for (const okrId of okrIds) {
    const kras = goalKras.get(okrId) ?? new Set<string>();
    const boards = goalBoards.get(okrId) ?? new Set<string>();
    if (kras.size === 0 && boards.size === 0) { out.set(okrId, empty()); continue; }
    let totalHours = 0, hoursThisMonth = 0, tasksDone = 0, tasksOpen = 0;
    let lastActivityAt: Date | null = null;
    const touch = (d: Date | null | undefined) => { if (d && (!lastActivityAt || d > lastActivityAt)) lastActivityAt = d; };
    const byUser = new Map<string, { p: Person; hours: number; work: Set<string> }>();
    const credit = (p: Person | null | undefined, hours: number, workId: string) => {
      if (!p) return;
      const c = byUser.get(p.id) ?? { p, hours: 0, work: new Set<string>() };
      c.hours += hours;
      c.work.add(workId);
      byUser.set(p.id, c);
    };
    for (const it of items.values()) {
      const kraId = (it.metadata as { kraId?: unknown } | null)?.kraId;
      const inGoal = (it.boardId != null && boards.has(it.boardId)) || (typeof kraId === "string" && kras.has(kraId));
      if (!inGoal) continue;
      if (isDoneStatusName(it.status)) tasksDone += 1; else tasksOpen += 1;
      touch(it.updatedAt);
      const legacy = legacyHours(it.metadata);
      totalHours += legacy;
      for (const uid of new Set([it.ownerId, ...(it.assigneeIds ?? [])].filter((x): x is string => !!x))) credit(personById.get(uid), 0, it.id);
      if (legacy && it.ownerId) credit(personById.get(it.ownerId), legacy, it.id);
      for (const e of entriesByItem.get(it.id) ?? []) {
        const h = e.hours == null ? 0 : Number(e.hours);
        totalHours += h;
        if (e.day && e.day >= monthStart) hoursThisMonth += h;
        touch(e.day);
        if (e.userId) credit(personById.get(e.userId), h, it.id);
      }
    }
    for (const t of legacyTasks) {
      if (!t.kraId || !kras.has(t.kraId)) continue;
      const h = t.hoursSpent ?? 0;
      totalHours += h;
      if (t.status === "COMPLETED") tasksDone += 1; else tasksOpen += 1;
      touch(t.completedAt ?? t.updatedAt);
      credit(t.assignee, h, `legacy:${t.id}`);
    }
    const contributors = [...byUser.values()]
      .map((c) => ({ id: c.p.id, name: personName(c.p), avatar: c.p.avatar ?? null, hours: round1(c.hours), tasks: c.work.size }))
      .sort((a, b) => b.hours - a.hours || b.tasks - a.tasks || a.name.localeCompare(b.name));
    out.set(okrId, {
      hasLinkedWork: true,
      linkedKras: kras.size,
      linkedBoards: boards.size,
      totalHours: round1(totalHours),
      hoursThisMonth: round1(hoursThisMonth),
      tasksDone,
      tasksOpen,
      lastActivityAt,
      contributors,
    });
  }
  return out;
}

export async function computeGoalEffort(orgId: string, okrId: string): Promise<GoalEffort> {
  return (await computeGoalEffortBatch(orgId, [okrId])).get(okrId) ?? empty();
}
