// my-work.ts: the row shape and the grouping vocabulary /my-work is built on,
// shared by `GET /api/me/work` and the page that reads it.
//
// It lives here rather than in the route file because a Next route module may
// only export the handlers and a small set of route config keys; anything else
// fails the build's route-type check. It is also the file the test imports, so
// the grouping rules can be pinned without standing a server up.

import { DUE_BUCKET_LABEL, DUE_BUCKET_ORDER, type DueBucket } from "./work-buckets";
import { isDoneStatusName, type BoardItemRow, type StatusOption } from "./board-items-shared";

// "assignee" is here because /everything accepts `?view=team`, which the
// spec resolves to a list grouped by the person on the task: that is what the
// Space "team" view showed, and the 308 has to land on something real.
export type WorkGroupKey = "due" | "status" | "list" | "priority" | "assignee" | "none";
export type WorkSortKey = "due" | "priority" | "title" | "list" | "created" | "updated";
// Six views. List, Board and Calendar are the page's own renderers; Gantt and
// Timeline are the List page's renderers (board-gantt-view, board-timeline-view)
// fed the same Item rows through `toBoardRows` below, so there is ONE Gantt in
// the product and My work borrows it rather than owning a second. Sprint is
// the personal sprint room the retired /tasks/sprint page was: KPI tiles, a
// burndown, a verdict and the at-risk list, over the same rows.
export type WorkViewKey = "list" | "board" | "calendar" | "gantt" | "timeline" | "sprint";
export type DoneFilter = "0" | "1" | "only";
/** `?scope=`: whose tasks the page shows. "mine" is assigned to me; "delegated" is assigned BY me to somebody else. */
export type WorkScopeKey = "mine" | "delegated";

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
  { key: "gantt", label: "Gantt" },
  { key: "timeline", label: "Timeline" },
  { key: "sprint", label: "Sprint" },
];

/** A view key from the URL, or `list` for anything the switcher does not offer. */
export function parseWorkView(raw: string | null | undefined): WorkViewKey {
  const key = (raw ?? "").trim().toLowerCase();
  return (WORK_VIEWS.find((v) => v.key === key)?.key ?? "list") as WorkViewKey;
}

export function parseWorkScope(raw: string | null | undefined): WorkScopeKey {
  return (raw ?? "").trim().toLowerCase() === "delegated" ? "delegated" : "mine";
}

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

/* ───────────── the bridge to the List page's renderers ───────────── */

/**
 * The status vocabulary a cross-List page can honestly offer a List renderer.
 *
 * A List renderer takes ONE status set (the List's own). My work spans every
 * List, so the set is built from what the rows carry: each distinct status
 * value with the word and colour its List resolved server-side. A value that
 * is its own List's done status lands in the DONE group, so the Gantt's
 * "overdue" backlog and the Timeline's done styling follow each List's own
 * rule rather than a name heuristic. Two Lists that spell the same value with
 * different colours draw the first one seen; that is the honest limit of a
 * cross-List view, and the row's own List page keeps its own colour.
 */
export function statusOptionsFrom(rows: readonly MyWorkRow[]): StatusOption[] {
  const seen = new Map<string, StatusOption>();
  for (const row of rows) {
    if (!row.status || seen.has(row.status)) continue;
    const done = row.doneStatus ? row.status === row.doneStatus : isDoneStatusName(row.status);
    seen.set(row.status, {
      value: row.status,
      label: row.statusLabel ?? row.status,
      color: row.statusColor ?? "#98A2B3",
      group: done ? "DONE" : "ACTIVE",
    });
  }
  return [...seen.values()];
}

/**
 * My work rows as the List renderers' row shape.
 *
 * Both are projections of the same Item table, so nothing is invented: the
 * fields the Gantt and Timeline read (dates, status, priority, title,
 * assignees) are copied across and the List-only fields (position, groupKey,
 * metadata) get the neutral values a row with no List context has. `position`
 * follows the page order so the lanes read top to bottom as the list does.
 */
export function toBoardRows(rows: readonly MyWorkRow[]): BoardItemRow[] {
  return rows.map((r, i) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    ownerId: r.ownerId,
    assigneeIds: r.assigneeIds,
    groupKey: null,
    position: i,
    metadata: {},
    startAt: r.startAt,
    dueAt: r.dueAt,
    priority: r.priority,
    parentItemId: r.parentItemId,
    boardId: r.board?.id ?? null,
    archivedAt: null,
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
    assignees: r.assignees.map((a) => ({
      id: a.id,
      firstName: a.firstName ?? "",
      lastName: a.lastName ?? "",
      avatar: a.avatar,
    })),
  }));
}
