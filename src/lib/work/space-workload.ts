// The Space Workload tab's pure rules, shared by its route
// (GET /api/spaces/[id]/workload) and its client
// (src/app/(dashboard)/spaces/[slug]/space-workload-view.tsx), so the
// two can never disagree about who holds a task.
//
// WHO HOLDS A TASK. A task's owner and assignees, once each, counting only
// people who still work in this workspace. A departed person is never a row:
// the task counts for the others on it, and as Unassigned when nobody live
// is left on it, which is the worst case a lead must see (work that nobody
// here is doing). Its departed holders travel as `formerIds` so the Assign
// action can hand it on without ever overwriting a live person's claim.

/** The most open tasks one answer carries; a busier Space says it was cut. */
export const SPACE_WORKLOAD_CAP = 5000;

export interface WorkloadHolders {
  ownerId: string | null;
  assigneeIds: readonly string[];
}

export interface SpaceWorkloadItemHolders {
  /** The owner, when they still work here. */
  ownerId: string | null;
  /** The assignees who still work here, owner excluded, once each. */
  assigneeIds: string[];
  /** Everyone live the item's hours split across. */
  assigneeCount: number;
  /** Nobody who works here is on it. */
  unassigned: boolean;
  /** The departed people still named on an unassigned item, for the Assign re-check. */
  formerIds: string[];
}

/** Everyone named on a task, owner first, once each. */
export function holdersOf(row: WorkloadHolders): string[] {
  return [...new Set([...(row.ownerId ? [row.ownerId] : []), ...row.assigneeIds])];
}

/** A task's holders as the Space Workload draws them. */
export function spaceWorkloadHolders(row: WorkloadHolders, live: ReadonlySet<string>): SpaceWorkloadItemHolders {
  const all = holdersOf(row);
  const here = all.filter((id) => live.has(id));
  const ownerId = row.ownerId && live.has(row.ownerId) ? row.ownerId : null;
  return {
    ownerId,
    assigneeIds: here.filter((id) => id !== ownerId),
    assigneeCount: here.length,
    unassigned: here.length === 0,
    formerIds: here.length === 0 ? all : [],
  };
}

/**
 * May an Assign from the Unassigned row go ahead, given the task as it is
 * NOW? Only when everyone on it now was already on it when the grid loaded
 * and none of them works here: a person who took it since must never be
 * overwritten without a word.
 */
export function mayAssignOver(current: WorkloadHolders, formerIds: readonly string[]): boolean {
  const former = new Set(formerIds);
  return holdersOf(current).every((id) => former.has(id));
}
