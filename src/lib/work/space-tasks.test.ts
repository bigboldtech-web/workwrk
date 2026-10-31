// The Space page's cross-List reads (src/lib/work/space-tasks.ts).
//
//   * Calendar and Gantt took 600 rows with no order in ONE read that also
//     pulled every undated task created in an 18-month window, which are
//     never drawn unless their List has a Date field. A Space with many
//     undated tasks lost the month's due tasks with no word on the page.
//   * The List, Board and Team tabs read 200 and the heading said "200 items
//     across this Space" whatever the Space held.
//
// The reads run against the in-memory store (src/lib/item-test-db.ts).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { itemTestDb, installItemTestDb, type ItemTestDb } from "@/lib/item-test-db";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/item-test-db")).itemTestPrisma }));

import {
  SPACE_DATED_CAP, datedCutNotice, parseSpaceListQuery, readSpaceDatedTasks, spaceTasksCutNotice,
  spaceTasksExportHref, spaceTasksHeading, spaceTasksWhere,
} from "./space-tasks";

let db: ItemTestDb;
let n = 0;
function task(boardId: string, over: Record<string, unknown> = {}) {
  n += 1;
  const id = `t-${String(n).padStart(4, "0")}`;
  db.items.push({
    id, title: id, status: "TO_DO", boardId, archivedAt: null, startAt: null, dueAt: null, metadata: {},
    createdAt: new Date("2026-09-10T00:00:00Z"), ...over,
  });
  return id;
}

const SEPT = { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-10-01T00:00:00Z") };
const WINDOW = { createdFrom: new Date("2026-03-01T00:00:00Z"), createdTo: new Date("2027-09-01T00:00:00Z") };

beforeEach(() => {
  n = 0;
  db = installItemTestDb(itemTestDb({ boards: [{ id: "b-plain", slug: "plain", name: "Plain" }, { id: "b-dated", slug: "dated", name: "Dated" }] }));
});

describe("the Calendar and Gantt read", () => {
  it("keeps every task due this month behind 700 undated tasks in a List with no Date field", async () => {
    for (let i = 0; i < 700; i++) task("b-plain");
    const due = Array.from({ length: 5 }, (_, i) => task("b-plain", { dueAt: new Date(Date.UTC(2026, 8, 3 + i)) }));
    const read = await readSpaceDatedTasks({ boardIds: ["b-plain"], dateKeyByBoard: new Map(), ...SEPT, ...WINDOW });
    expect(read.rows.map((r) => r.id)).toEqual(due);
    expect(read).toMatchObject({ datedCut: false, fallbackCut: false });
    expect(datedCutNotice(read, "month")).toBeNull();
  });

  it("reads a Date-field List's undated tasks on their own read, and says when that read is cut", async () => {
    for (let i = 0; i < SPACE_DATED_CAP + 50; i++) task("b-dated", { metadata: { when: "2026-09-12" } });
    const due = task("b-dated", { dueAt: new Date("2026-09-20T00:00:00Z") });
    const read = await readSpaceDatedTasks({ boardIds: ["b-dated"], dateKeyByBoard: new Map([["b-dated", "when"]]), ...SEPT, ...WINDOW });
    expect(read.rows[0].id).toBe(due);
    expect(read.rows).toHaveLength(SPACE_DATED_CAP + 1);
    expect(read).toMatchObject({ datedCut: false, fallbackCut: true });
    expect(datedCutNotice(read, "month")).toBe("Some tasks dated by a List's Date field are not shown. Open a List for the full set.");
  });

  it("a month with more due tasks than the cap keeps the earliest and says so", async () => {
    const due = Array.from({ length: SPACE_DATED_CAP + 1 }, (_, i) => task("b-plain", { dueAt: new Date(Date.UTC(2026, 8, 29) - i * 60_000) }));
    const read = await readSpaceDatedTasks({ boardIds: ["b-plain"], dateKeyByBoard: new Map(), ...SEPT, ...WINDOW });
    expect(read.rows).toHaveLength(SPACE_DATED_CAP);
    // The latest-due one is the one left out.
    expect(read.rows.map((r) => r.id)).not.toContain(due[0]);
    expect(read.datedCut).toBe(true);
    expect(datedCutNotice(read, "month")).toBe(`Showing the first ${SPACE_DATED_CAP} tasks due this month, by due date. Open a List for the full set.`);
    expect(datedCutNotice(read, "window")).toContain("due these weeks");
  });
});

describe("the List, Board and Team tabs' words", () => {
  it("the heading counts the real total when the read was cut", () => {
    expect(spaceTasksHeading(200, 1234, false)).toBe("200 of 1,234 tasks across this Space");
    expect(spaceTasksHeading(34, 34, false)).toBe("34 tasks across this Space");
    expect(spaceTasksHeading(1, 1, true)).toBe("1 task · filtered");
  });

  it("the cut line names which tasks are shown, in the Folder page's words", () => {
    expect(spaceTasksCutNotice("updated")).toBe("Showing the 200 most recently updated tasks. Open a List for the full set.");
    expect(spaceTasksCutNotice("title")).toBe("Showing the first 200 tasks by title. Open a List for the full set.");
    expect(spaceTasksCutNotice("board")).toBe("Showing the first 200 tasks by List. Open a List for the full set.");
  });

  it("the export link carries the tab's filters and order, and reads back the same", () => {
    const filters = { statuses: new Set(["TO_DO", "DONE"]), owners: new Set(["u-1"]), due: "week" as const };
    const href = spaceTasksExportHref("sp-1", "title", filters);
    expect(href).toBe("/api/spaces/sp-1/tasks/export.csv?sort=title&status=TO_DO%2CDONE&owner=u-1&due=week");
    const back = parseSpaceListQuery(new URL(`http://x${href}`).searchParams);
    expect(back.sort).toBe("title");
    expect([...back.filters.statuses!]).toEqual(["TO_DO", "DONE"]);
    expect([...back.filters.owners!]).toEqual(["u-1"]);
    expect(back.filters.due).toBe("week");
    expect(spaceTasksExportHref("sp-1", "updated", { statuses: null, owners: null, due: "any" })).toBe("/api/spaces/sp-1/tasks/export.csv");
  });

  it("the where clause applies the List tab's filters to the readable Lists only", () => {
    const where = spaceTasksWhere(["b-1"], { statuses: new Set(["DONE"]), owners: null, due: "any" });
    expect(where).toEqual({ boardId: { in: ["b-1"] }, archivedAt: null, status: { in: ["DONE"] } });
  });
});
