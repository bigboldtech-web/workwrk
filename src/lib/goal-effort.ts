// computeGoalEffort — the automated "how much real work is moving this goal"
// signal, unified across BOTH kinds of work a goal can link to:
//   • KRAs → their Tasks (Task.hoursSpent, clean COMPLETED enum), and
//   • Boards / Spaces → their board Items (time via TimeEntry.itemId; done via
//     the cross-surface isDoneStatusName rule).
// A goal linked to a busy board used to show zero effort; this fixes that.
//
// Never self-reported — every number derives from real Tasks / Items / time
// entries. Shared by /api/okrs/[id]/effort and /api/okrs/[id]/assess.

import { prisma } from "@/lib/prisma";
import { isDoneStatusName } from "@/lib/board-items-shared";

export interface GoalEffort {
  hasLinkedWork: boolean;
  linkedKras: number;
  linkedBoards: number;
  totalHours: number;
  tasksDone: number;
  tasksOpen: number;
  lastActivityAt: Date | null;
  contributors: { id: string; name: string; hours: number; tasks: number }[];
}

type Person = { id: string; firstName: string | null; lastName: string | null; email: string };
const personName = (u: Person) => `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email;

export async function computeGoalEffort(orgId: string, okrId: string): Promise<GoalEffort> {
  // Every work link the goal has (KRA / Board / Space).
  const links = await prisma.entityLink.findMany({
    where: { organizationId: orgId, sourceType: "OKR", sourceId: okrId, targetType: { in: ["KRA", "BOARD", "SPACE"] } },
    select: { targetType: true, targetId: true },
  });
  const kraIds = [...new Set(links.filter((l) => l.targetType === "KRA").map((l) => l.targetId))];
  const boardIdSet = new Set(links.filter((l) => l.targetType === "BOARD").map((l) => l.targetId));
  const spaceIds = [...new Set(links.filter((l) => l.targetType === "SPACE").map((l) => l.targetId))];

  // Boards inside any linked Space count too.
  if (spaceIds.length) {
    const spaceBoards = await prisma.board.findMany({ where: { organizationId: orgId, spaceId: { in: spaceIds } }, select: { id: true } });
    for (const b of spaceBoards) boardIdSet.add(b.id);
  }
  const boardIds = [...boardIdSet];

  const empty = kraIds.length === 0 && boardIds.length === 0;
  if (empty) {
    return { hasLinkedWork: false, linkedKras: 0, linkedBoards: 0, totalHours: 0, tasksDone: 0, tasksOpen: 0, lastActivityAt: null, contributors: [] };
  }

  let totalHours = 0, tasksDone = 0, tasksOpen = 0;
  let lastActivityAt: Date | null = null;
  const byUser = new Map<string, { id: string; name: string; hours: number; workIds: Set<string> }>();
  const bump = (u: Person | null | undefined, hours: number, workId: string | null) => {
    if (!u) return;
    const cur = byUser.get(u.id) ?? { id: u.id, name: personName(u), hours: 0, workIds: new Set<string>() };
    cur.hours += hours;
    if (workId) cur.workIds.add(workId);
    byUser.set(u.id, cur);
  };
  const touch = (d: Date | null | undefined) => { if (d && (!lastActivityAt || d > lastActivityAt)) lastActivityAt = d; };

  // 1) KRA → Tasks (denormalized hoursSpent; COMPLETED = done).
  if (kraIds.length) {
    const tasks = await prisma.task.findMany({
      where: { organizationId: orgId, kraId: { in: kraIds } },
      select: { id: true, hoursSpent: true, status: true, completedAt: true, updatedAt: true, assignee: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
    for (const t of tasks) {
      const h = t.hoursSpent ?? 0;
      totalHours += h;
      if (t.status === "COMPLETED") tasksDone += 1; else tasksOpen += 1;
      touch(t.completedAt ?? t.updatedAt);
      bump(t.assignee, h, t.id);
    }
  }

  // 2) Boards / Spaces → Items (done via shared status rule; time via TimeEntry).
  if (boardIds.length) {
    const items = await prisma.item.findMany({
      where: { organizationId: orgId, boardId: { in: boardIds }, archivedAt: null },
      select: { id: true, status: true, updatedAt: true },
    });
    for (const it of items) {
      if (isDoneStatusName(it.status)) tasksDone += 1; else tasksOpen += 1;
      touch(it.updatedAt);
    }
    const itemIds = items.map((i) => i.id);
    if (itemIds.length) {
      const entries = await prisma.timeEntry.findMany({
        where: { organizationId: orgId, itemId: { in: itemIds }, hours: { not: null } },
        select: { hours: true, day: true, itemId: true, user: { select: { id: true, firstName: true, lastName: true, email: true } } },
      });
      for (const e of entries) {
        const h = e.hours == null ? 0 : Number(e.hours);
        totalHours += h;
        touch(e.day);
        bump(e.user, h, e.itemId);
      }
    }
  }

  const contributors = [...byUser.values()]
    .map((c) => ({ id: c.id, name: c.name, hours: Math.round(c.hours * 10) / 10, tasks: c.workIds.size }))
    .sort((a, b) => b.hours - a.hours || b.tasks - a.tasks);

  return {
    hasLinkedWork: true,
    linkedKras: kraIds.length,
    linkedBoards: boardIds.length,
    totalHours: Math.round(totalHours * 10) / 10,
    tasksDone,
    tasksOpen,
    lastActivityAt,
    contributors,
  };
}
