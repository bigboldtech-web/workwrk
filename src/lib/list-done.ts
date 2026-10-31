// Done, decided by each task's OWN List, on every read that spans Lists.
//
// isDoneStatusName knows five words (done, complete, completed, closed,
// resolved). A List's own status set knows the rest: a content List's
// PUBLISHED, a sales List's CLOSED_WON and CHURNED, a CANCELLED in a CLOSED
// group. Home, My work, Everything, the Clock and Timesheets pickers and goal
// Effort used to ask the five words alone, so ticking a task on Home wrote
// PUBLISHED (that List's done status) and the task stayed under Overdue for
// good.
//
// THE READ IS TWO STEPS. A groupBy over (List, status) for the rows a caller's
// filter matches says which pairs each List's own set calls done
// (isDoneStatus, which falls back to the five words for a value the set does
// not declare), and those exact pairs become the SQL predicate. So a page is
// cut from open work in Postgres, and a capped read is never eaten by
// finished work it then throws away, which is how Home lost every open task
// behind 200 finished ones and My work showed an empty first page.
//
// Server only: it reads the database.

import type { Prisma } from "@/generated/prisma";
import { getBoardStatuses, isDoneStatus, type StatusOption } from "./board-items-shared";
import { prisma } from "./prisma";

/** Is this row done, by the status set of the List it lives in? */
export type ListDoneTest = (boardId: string | null | undefined, status: string | null | undefined) => boolean;

/**
 * The done test for rows of many Lists. A List not given (or one with no set
 * of its own) is judged by the default set, exactly as getBoardStatuses
 * answers for it everywhere else.
 */
export function listDoneTest(boards: Iterable<{ id: string; statuses?: unknown }>): ListDoneTest {
  const sets = new Map<string, StatusOption[]>();
  for (const b of boards) sets.set(b.id, getBoardStatuses(b));
  const fallback = getBoardStatuses(null);
  return (boardId, status) => isDoneStatus((boardId ? sets.get(boardId) : undefined) ?? fallback, status);
}

export interface DoneClauses {
  /** Keeps the rows that are open in their own List (a row with no status is open). */
  open: Prisma.ItemWhereInput;
  /** Keeps the rows that are done in their own List. */
  done: Prisma.ItemWhereInput;
}

/**
 * The where clauses for open and done work, from the (List, status) pairs a
 * read can reach. Lists whose done values are the same share one branch
 * (most Lists use the default set), so the clause stays small however many
 * Lists the rows span.
 */
export function doneClauses(
  groups: ReadonlyArray<{ boardId: string; status: string | null }>,
  isDone: ListDoneTest,
): DoneClauses {
  const doneByList = new Map<string, Set<string>>();
  for (const g of groups) {
    if (!g.status || !isDone(g.boardId, g.status)) continue;
    const set = doneByList.get(g.boardId) ?? new Set<string>();
    set.add(g.status);
    doneByList.set(g.boardId, set);
  }
  const branches = new Map<string, { statuses: string[]; boardIds: string[] }>();
  for (const [boardId, set] of doneByList) {
    const statuses = [...set].sort();
    const key = statuses.join("\u0000");
    const entry = branches.get(key);
    if (entry) entry.boardIds.push(boardId);
    else branches.set(key, { statuses, boardIds: [boardId] });
  }
  // Nothing in reach is done: every row is open, and "only done" is nothing.
  if (branches.size === 0) return { open: {}, done: { id: { in: [] } } };
  const done: Prisma.ItemWhereInput = {
    OR: [...branches.values()].map((b) => ({ boardId: { in: b.boardIds }, status: { in: b.statuses } })),
  };
  return {
    // A task with no status needs its own branch: NOT over a NULL status is
    // NULL in SQL, which would drop the row (the openItemsWhere rule).
    open: { OR: [{ status: null }, { NOT: done }] },
    done,
  };
}

export interface DoneSplit extends DoneClauses {
  isDone: ListDoneTest;
  /** Exact counts over the caller's where: the open rows and the done ones. */
  counts: { open: number; done: number };
}

/**
 * Split the rows `where` matches into open and done by each row's own List:
 * one groupBy over (List, status), one read of those Lists' status sets.
 */
export async function splitDoneByList(where: Prisma.ItemWhereInput, organizationId: string): Promise<DoneSplit> {
  const groups = await prisma.item.groupBy({ by: ["boardId", "status"], where, _count: { _all: true } });
  const boardIds = [...new Set(groups.map((g) => g.boardId))];
  const boards = boardIds.length
    ? await prisma.board.findMany({ where: { id: { in: boardIds }, organizationId }, select: { id: true, statuses: true } })
    : [];
  const isDone = listDoneTest(boards);
  const counts = { open: 0, done: 0 };
  for (const g of groups) {
    if (isDone(g.boardId, g.status)) counts.done += g._count._all;
    else counts.open += g._count._all;
  }
  return { isDone, counts, ...doneClauses(groups, isDone) };
}

/** The clause for a `done` query parameter: 0 open work, 1 everything, only the finished. */
export function doneParamWhere(param: "0" | "1" | "only", clauses: DoneClauses): Prisma.ItemWhereInput | null {
  if (param === "1") return null;
  return param === "only" ? clauses.done : clauses.open;
}
