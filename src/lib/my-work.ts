// my-work.ts: the row shape and the grouping vocabulary /my-work is built on,
// shared by `GET /api/me/work` and the page that reads it.
//
// It lives here rather than in the route file because a Next route module may
// only export the handlers and a small set of route config keys; anything else
// fails the build's route-type check. It is also the file the test imports, so
// the grouping rules can be pinned without standing a server up.

import { DUE_BUCKET_LABEL, DUE_BUCKET_ORDER, type DueBucket } from "./work-buckets";

// "assignee" is here because /everything accepts `?view=team`, which the
// spec resolves to a list grouped by the person on the task: that is what the
// Space "team" view showed, and the 308 has to land on something real.
export type WorkGroupKey = "due" | "status" | "list" | "priority" | "assignee" | "none";
export type WorkSortKey = "due" | "priority" | "title" | "list" | "created" | "updated";
export type WorkViewKey = "list" | "board" | "calendar";
export type DoneFilter = "0" | "1" | "only";

export const WORK_GROUPS: ReadonlyArray<{ key: WorkGroupKey; label: string }> = [
  { key: "due", label: "Due date" },
  { key: "status", label: "Status" },
  { key: "list", label: "List" },
  { key: "priority", label: "Priority" },
  { key: "assignee", label: "Assignee" },
  { key: "none", label: "None" },
];

export const WORK_SORTS: ReadonlyArray<{ key: WorkSortKey; label: string }> = [
  { key: "due", label: "Due date" },
  { key: "priority", label: "Priority" },
  { key: "title", label: "Title" },
  { key: "list", label: "List" },
  { key: "created", label: "Created" },
  { key: "updated", label: "Updated" },
];

export const WORK_VIEWS: ReadonlyArray<{ key: WorkViewKey; label: string }> = [
  { key: "list", label: "List" },
  { key: "board", label: "Board" },
  { key: "calendar", label: "Calendar" },
];

/** Urgent / High / Normal / Low. The legacy Critical / Medium words are gone. */
export const PRIORITY_ORDER: readonly string[] = ["URGENT", "HIGH", "NORMAL", "LOW"];
export const PRIORITY_LABEL: Readonly<Record<string, string>> = {
  URGENT: "Urgent",
  HIGH: "High",
  NORMAL: "Normal",
  LOW: "Low",
};

export interface MyWorkBoardRef {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  color: string | null;
  spaceId: string | null;
}

export interface MyWorkRow {
  id: string;
  title: string;
  status: string | null;
  priority: string | null;
  startAt: string | null;
  dueAt: string | null;
  ownerId: string | null;
  assigneeIds: string[];
  parentItemId: string | null;
  createdAt: string;
  updatedAt: string;
  /** The bucket the row falls in, computed in the VIEWER's zone by the server. */
  dueBucket: DueBucket;
  /** The WORD this List calls the status, resolved server-side. */
  statusLabel: string | null;
  /** The hex the List's owner chose for it, or null when the List declares none. */
  statusColor: string | null;
  /** This List's own first done status: what the checkbox writes. */
  doneStatus: string | null;
  board: MyWorkBoardRef | null;
  space: { id: string; slug: string; name: string } | null;
  /** True when the viewer can open the List page the chip points at. */
  listReadable: boolean;
  /**
   * The people on the task, owner (the DRI) first, hydrated server-side.
   *
   * Multi-assignee shipped but /my-work had no Assignees column and no field
   * to switch one on, so "assigned to you" and "assigned to you and two other
   * people" rendered identically. Ids that no longer resolve to a person in
   * the org are dropped here rather than drawn as a blank circle.
   */
  assignees: Array<{ id: string; firstName: string | null; lastName: string | null; avatar: string | null }>;
}

/** The values the viewer's own tasks carry, for the Filter panel's rows. */
export interface MyWorkFacets {
  statuses: Array<{ value: string; label: string; count: number }>;
  lists: Array<{ id: string; name: string; count: number }>;
  spaces: Array<{ id: string; name: string; count: number }>;
  types: Array<{ id: string; name: string; count: number }>;
  tags: Array<{ id: string; name: string; color: string | null; count: number }>;
}

export interface MyWorkResponse {
  rows: MyWorkRow[];
  group: WorkGroupKey;
  sort: WorkSortKey;
  dir: "asc" | "desc";
  total: number;
  nextCursor: string | null;
  hasMore: boolean;
  locale: { timeZone: string | null; weekStart: number | null };
  facets: MyWorkFacets;
  /**
   * How many rows the viewer still has in the LEGACY `Task` table.
   *
   * The `/tasks/*` pages are the only UI over that table, and /my-work reads
   * Items, so until the W4 migration moves those rows across there is work a
   * person owns that this page cannot show. The "…" menu therefore carries a
   * "Legacy tasks" row, and this count is what decides whether to draw it: the
   * door exists exactly while there is something behind it, and disappears by
   * itself the day the migration empties the table.
   */
  legacyTaskCount: number;
}

export interface WorkGroup {
  key: string;
  label: string;
  rows: MyWorkRow[];
  /** Overdue is the one group that carries a semantic colour, paired with the word. */
  tone?: "danger";
}

/**
 * Cut a page of rows into headed groups.
 *
 * The server orders so that every group is a contiguous run, so this is a
 * single pass and never re-sorts: re-sorting here would make the last group on
 * a page disagree with the first group on the next one.
 */
export function groupRows(rows: readonly MyWorkRow[], group: WorkGroupKey): WorkGroup[] {
  if (group === "none") return rows.length ? [{ key: "all", label: "", rows: [...rows] }] : [];

  // ONE GROUP PER KEY, not one group per RUN.
  //
  // This walked the rows and opened a new group whenever the key differed
  // from the PREVIOUS row, which is only correct when the rows arrive sorted
  // by the very thing they are being grouped by. They do not: the sort is the
  // reader's own choice, and grouping is a second, independent choice. Group
  // by List while sorted by due date and a List's rows are scattered, so the
  // same List opened three groups: three headers with the same name, three
  // partial counts of one list, and three React children with the same key
  // (which is how this surfaced, as a duplicate-key warning on /everything).
  //
  // Insertion order is kept, so the first row of a group still decides where
  // that group sits, and a caller that DOES sort by the group key sees
  // exactly what it saw before.
  const byKey = new Map<string, WorkGroup>();
  for (const row of rows) {
    const { key, label, tone } = groupOf(row, group);
    let current = byKey.get(key);
    if (!current) {
      current = { key, label, rows: [], ...(tone ? { tone } : {}) };
      byKey.set(key, current);
    }
    current.rows.push(row);
  }
  return [...byKey.values()];
}

function groupOf(row: MyWorkRow, group: WorkGroupKey): { key: string; label: string; tone?: "danger" } {
  switch (group) {
    case "due": {
      const bucket = row.dueBucket;
      return { key: bucket, label: DUE_BUCKET_LABEL[bucket], ...(bucket === "overdue" ? { tone: "danger" as const } : {}) };
    }
    case "status": {
      const status = row.status ?? "";
      return { key: status || "__none", label: row.statusLabel || "No status" };
    }
    case "list": {
      const board = row.board;
      return { key: board?.id ?? "__none", label: board ? board.name : "No list" };
    }
    case "priority": {
      const p = row.priority ?? "";
      return { key: p || "__none", label: p ? PRIORITY_LABEL[p] ?? p : "No priority" };
    }
    case "assignee": {
      // The owner is the DRI and is first in the hydrated list, so the group
      // is "whose task is this", not "who is on it somewhere".
      const person = row.assignees[0] ?? null;
      const name = person ? `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim() : "";
      return { key: row.ownerId ?? "__none", label: name || "Unassigned" };
    }
    default:
      return { key: "all", label: "" };
  }
}

/**
 * The columns a Board view shows for a grouping, INCLUDING the empty ones.
 *
 * A kanban with only the columns that happen to have cards is a kanban you
 * cannot drop into: "Overdue" has to exist as a column before you can drag
 * something out of it, and "Today" has to exist before you can drag into it.
 * Grouped by anything unbounded (status names across every List, List names)
 * the columns are whatever the page holds, which is the honest answer there.
 */
/**
 * The groups the LIST view shows.
 *
 * Grouped by due date it is the same six columns the Board view draws,
 * INCLUDING the empty ones, which design-system 5.1 collapses to one line.
 * List and board showed different group sets before this: the board said
 * "Tomorrow 0 / Nothing here" while the list silently omitted the bucket, so
 * the same page disagreed with itself about how many buckets exist.
 */
export function listGroups(rows: readonly MyWorkRow[], group: WorkGroupKey): WorkGroup[] {
  return group === "due" ? boardColumns(rows, "due") : groupRows(rows, group);
}

export function boardColumns(rows: readonly MyWorkRow[], group: WorkGroupKey): WorkGroup[] {
  if (group === "due") {
    const byKey = new Map<string, MyWorkRow[]>();
    for (const row of rows) {
      const list = byKey.get(row.dueBucket) ?? [];
      list.push(row);
      byKey.set(row.dueBucket, list);
    }
    return DUE_BUCKET_ORDER.map((bucket) => ({
      key: bucket,
      label: DUE_BUCKET_LABEL[bucket],
      rows: byKey.get(bucket) ?? [],
      ...(bucket === "overdue" ? { tone: "danger" as const } : {}),
    }));
  }
  if (group === "priority") {
    const byKey = new Map<string, MyWorkRow[]>();
    for (const row of rows) {
      const key = row.priority || "__none";
      const list = byKey.get(key) ?? [];
      list.push(row);
      byKey.set(key, list);
    }
    return [...PRIORITY_ORDER, "__none"].map((key) => ({
      key,
      label: key === "__none" ? "No priority" : PRIORITY_LABEL[key] ?? key,
      rows: byKey.get(key) ?? [],
    }));
  }
  // Status and List: the set is whatever the rows carry. `none` has one column.
  return groupRows(rows, group === "none" ? "status" : group);
}

/** The counts the sidebar badge and the Home widget footer print. */
export function overdueAndTodayCount(rows: readonly MyWorkRow[]): number {
  return rows.filter((r) => r.dueBucket === "overdue" || r.dueBucket === "today").length;
}
