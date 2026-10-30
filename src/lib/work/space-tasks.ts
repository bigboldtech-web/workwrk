// The Space page's cross-List task reads (List, Board, Team, Calendar,
// Gantt), and the CSV export of the List tab. One module, so the page and
// the export apply the same filters, the same order and the same caps, and a
// file can never hold rows the page would not show, nor miss rows it would.
//
// TWO DEFECTS THIS FILE EXISTS FOR.
//
// 1. The List, Board and Team tabs read 200 tasks and the heading said
//    "200 items across this Space" for a Space of 2,000; the CSV export was
//    built in the browser from those same 200 rows. The cap stays (a page of
//    a whole Space is not a list view), but a cut read now says so, the
//    heading counts the real total, and the export reads every row.
// 2. The Calendar and Gantt took 600 rows with no order, and the same read
//    also pulled every UNDATED task created in an 18-month window (the
//    Date-field fallback), which are never drawn unless their List has a
//    Date field. A Space with many undated tasks lost the month's due tasks
//    silently. Now the dated read and the fallback are two reads, each
//    ordered and capped, the fallback reads only Lists that have a Date
//    field, and a cut read is said on the page.
//
// Server only: it reads the database.

import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";

/** The List, Board and Team tabs show at most this many tasks. */
export const SPACE_TASKS_CAP = 200;
/** Each of the Calendar's and the Gantt's two reads takes at most this many. */
export const SPACE_DATED_CAP = 600;

export type SpaceListSort = "updated" | "title" | "status" | "board";
export type SpaceListDue = "any" | "overdue" | "today" | "week" | "month";

export interface SpaceListFilters {
  statuses: ReadonlySet<string> | null;
  owners: ReadonlySet<string> | null;
  due: SpaceListDue;
}

export const NO_SPACE_LIST_FILTERS: SpaceListFilters = { statuses: null, owners: null, due: "any" };

function startOfWeek(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() - out.getDay());
  return out;
}

/**
 * The List tab's where clause over the readable Lists. The due windows are
 * the server's local days, as the page has always drawn them.
 */
export function spaceTasksWhere(boardIds: readonly string[], filters: SpaceListFilters, now: Date = new Date()): Prisma.ItemWhereInput {
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow0 = new Date(today0.getFullYear(), today0.getMonth(), today0.getDate() + 1);
  const weekStart0 = startOfWeek(today0);
  const weekEnd0 = new Date(weekStart0.getFullYear(), weekStart0.getMonth(), weekStart0.getDate() + 7);
  const monthStart0 = new Date(today0.getFullYear(), today0.getMonth(), 1);
  const monthEnd0 = new Date(today0.getFullYear(), today0.getMonth() + 1, 1);
  const due =
    filters.due === "overdue" ? { dueAt: { lt: today0 } }
      : filters.due === "today" ? { dueAt: { gte: today0, lt: tomorrow0 } }
        : filters.due === "week" ? { dueAt: { gte: weekStart0, lt: weekEnd0 } }
          : filters.due === "month" ? { dueAt: { gte: monthStart0, lt: monthEnd0 } }
            : {};
  return {
    boardId: { in: [...boardIds] },
    archivedAt: null,
    ...(filters.statuses && filters.statuses.size > 0 ? { status: { in: [...filters.statuses] } } : {}),
    ...(filters.owners && filters.owners.size > 0 ? { ownerId: { in: [...filters.owners] } } : {}),
    ...due,
  };
}

/** The List tab's order. `id` last, so the export's cursor walk is stable. */
export function spaceTasksOrder(sort: SpaceListSort): Prisma.ItemOrderByWithRelationInput[] {
  const lead: Prisma.ItemOrderByWithRelationInput[] =
    sort === "title" ? [{ title: "asc" }]
      : sort === "status" ? [{ status: "asc" }, { updatedAt: "desc" }]
        : sort === "board" ? [{ board: { name: "asc" } }, { updatedAt: "desc" }]
          : [{ updatedAt: "desc" }];
  return [...lead, { id: "asc" }];
}

const n = (x: number) => x.toLocaleString("en-US");
const tasks = (x: number) => `${n(x)} task${x === 1 ? "" : "s"}`;

/** "200 of 1,234 tasks" when a read was cut, "34 tasks" when it was not. */
export function spaceTasksCount(shown: number, total: number): string {
  return total > shown ? `${n(shown)} of ${tasks(total)}` : tasks(shown);
}

/**
 * The List and Board tabs' heading. A cut read says how many of how many,
 * so the number is never the cap passed off as the Space.
 */
export function spaceTasksHeading(shown: number, total: number, filtered: boolean): string {
  return `${spaceTasksCount(shown, total)}${filtered ? " · filtered" : " across this Space"}`;
}

/**
 * The one sentence under a cut List, Board or Team tab: which tasks are
 * shown, by the order the tab used, in the Folder page's words.
 */
export function spaceTasksCutNotice(sort: SpaceListSort): string {
  const which =
    sort === "title" ? `the first ${SPACE_TASKS_CAP} tasks by title`
      : sort === "status" ? `the first ${SPACE_TASKS_CAP} tasks by status`
        : sort === "board" ? `the first ${SPACE_TASKS_CAP} tasks by List`
          : `the ${SPACE_TASKS_CAP} most recently updated tasks`;
  return `Showing ${which}. Open a List for the full set.`;
}

/** The URL of the complete CSV export of the List tab, with its filters and order. */
export function spaceTasksExportHref(spaceId: string, sort: SpaceListSort, filters: SpaceListFilters): string {
  const qs = new URLSearchParams();
  if (sort !== "updated") qs.set("sort", sort);
  if (filters.statuses && filters.statuses.size > 0) qs.set("status", [...filters.statuses].join(","));
  if (filters.owners && filters.owners.size > 0) qs.set("owner", [...filters.owners].join(","));
  if (filters.due !== "any") qs.set("due", filters.due);
  const q = qs.toString();
  return `/api/spaces/${encodeURIComponent(spaceId)}/tasks/export.csv${q ? `?${q}` : ""}`;
}

/** Read the List tab's `?sort=`, `?status=`, `?owner=` and `?due=` the way the page does. */
export function parseSpaceListQuery(sp: { get(key: string): string | null }): { sort: SpaceListSort; filters: SpaceListFilters } {
  const sorts: SpaceListSort[] = ["updated", "title", "status", "board"];
  const dues: SpaceListDue[] = ["any", "overdue", "today", "week", "month"];
  const set = (raw: string | null) => {
    const values = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    return values.length ? new Set(values) : null;
  };
  const sortRaw = sp.get("sort") as SpaceListSort | null;
  const dueRaw = sp.get("due") as SpaceListDue | null;
  return {
    sort: sortRaw && sorts.includes(sortRaw) ? sortRaw : "updated",
    filters: { statuses: set(sp.get("status")), owners: set(sp.get("owner")), due: dueRaw && dues.includes(dueRaw) ? dueRaw : "any" },
  };
}

// ── Calendar and Gantt ──────────────────────────────────────────────

export interface DatedTaskRow {
  id: string;
  title: string;
  status: string | null;
  createdAt: Date;
  startAt: Date | null;
  dueAt: Date | null;
  metadata: Prisma.JsonValue;
  boardId: string;
  board: { slug: string; name: string };
}

export interface DatedTaskRead {
  rows: DatedTaskRow[];
  /** The due-date read had more than the cap: the earliest due were kept. */
  datedCut: boolean;
  /** The Date-field read had more than the cap: the newest were kept. */
  fallbackCut: boolean;
}

/**
 * The tasks a Calendar month or a Gantt window can draw, in two reads.
 *
 *   1. Due inside [from, to): ordered by due date, so a cut keeps the
 *      earliest and the page says it was cut.
 *   2. No due date, in a List that HAS a Date field (dateKeyByBoard), created
 *      inside [createdFrom, createdTo): the rows whose date lives in that
 *      field. A List with no Date field has nothing to project, so its
 *      undated tasks are never read; they used to fill the same capped read
 *      as the dated ones and push them out. Newest first.
 *
 * The caller projects the dates and drops what falls outside its window.
 */
export async function readSpaceDatedTasks(args: {
  boardIds: readonly string[];
  dateKeyByBoard: ReadonlyMap<string, string>;
  from: Date;
  to: Date;
  createdFrom: Date;
  createdTo: Date;
}): Promise<DatedTaskRead> {
  const select = {
    id: true, title: true, status: true, createdAt: true, startAt: true, dueAt: true, metadata: true,
    boardId: true,
    board: { select: { slug: true, name: true } },
  } as const;
  const fieldLists = args.boardIds.filter((id) => args.dateKeyByBoard.has(id));
  const [dated, fallback] = await Promise.all([
    args.boardIds.length
      ? prisma.item.findMany({
          where: { boardId: { in: [...args.boardIds] }, archivedAt: null, dueAt: { gte: args.from, lt: args.to } },
          orderBy: [{ dueAt: "asc" }, { id: "asc" }],
          take: SPACE_DATED_CAP + 1,
          select,
        })
      : Promise.resolve([]),
    fieldLists.length
      ? prisma.item.findMany({
          where: { boardId: { in: fieldLists }, archivedAt: null, dueAt: null, createdAt: { gte: args.createdFrom, lt: args.createdTo } },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take: SPACE_DATED_CAP + 1,
          select,
        })
      : Promise.resolve([]),
  ]);
  return {
    rows: [...dated.slice(0, SPACE_DATED_CAP), ...fallback.slice(0, SPACE_DATED_CAP)] as DatedTaskRow[],
    datedCut: dated.length > SPACE_DATED_CAP,
    fallbackCut: fallback.length > SPACE_DATED_CAP,
  };
}

/** The one sentence under a cut Calendar or Gantt, or null when nothing was cut. */
export function datedCutNotice(read: Pick<DatedTaskRead, "datedCut" | "fallbackCut">, span: "month" | "window"): string | null {
  const where = span === "month" ? "this month" : "these weeks";
  if (read.datedCut) return `Showing the first ${SPACE_DATED_CAP} tasks due ${where}, by due date. Open a List for the full set.`;
  if (read.fallbackCut) return `Some tasks dated by a List's Date field are not shown. Open a List for the full set.`;
  return null;
}
