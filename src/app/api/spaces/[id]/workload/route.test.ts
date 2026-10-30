// GET /api/spaces/[id]/workload, the Space's Workload tab: the Space gate
// answers before any read, only the Space's readable Lists add tasks or
// people, a departed or deactivated person is never a row, done tasks and
// meetings never count, a colleague's own hours reach only a viewer who may
// read their people data, and each of the three reads (this window, no
// dates, overdue) has its own cap and says when it was cut.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORK_SCHEDULE_DEFAULTS } from "@/lib/work-schedule";

type Row = { id: string; title: string; status: string | null; boardId: string; ownerId: string | null; assigneeIds: string[]; startAt: Date | null; dueAt: Date | null; priority: string | null };
type Bucket = "window" | "undated" | "overdue";
type Where = Record<string, unknown> & { AND: [Record<string, unknown>, Record<string, unknown>] };

const st = vi.hoisted(() => ({
  signedIn: true,
  space: { id: "sp1" } as null | { id: string },
  lists: [] as Array<{ id: string; slug: string; name: string; statuses: unknown; canContribute: boolean }>,
  spaceMembers: [] as string[],
  /** What each of the three task reads answers. */
  rows: { window: [], undated: [], overdue: [] } as Record<"window" | "undated" | "overdue", Row[]>,
  /** Who holds a level in this workspace. */
  here: new Set<string>(),
  inactive: new Set<string>(),
  removed: new Set<string>(),
  /** Whose people data the viewer may read. */
  readable: new Set<string>(),
  weekly: new Map<string, number>(),
  estimates: new Map<string, number>(),
  itemReads: [] as Array<{ where: Where; take: number; orderBy: unknown }>,
  reads: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/item-gate", () => ({
  itemCtx: async () => (st.signedIn
    ? { userId: "me", organizationId: "org1", userName: null }
    : { error: Response.json({ error: "Unauthorized" }, { status: 401 }) }),
}));
vi.mock("@/lib/list-links-server", () => ({ spaceForViewer: async () => st.space }));
vi.mock("@/lib/space", () => ({
  listSpaceMembers: async () => { st.reads.push("spaceMember"); return st.spaceMembers.map((userId) => ({ userId })); },
  readableListsInSpace: async () => {
    st.reads.push("lists");
    return { lists: st.lists, folderCount: 0 };
  },
}));
vi.mock("@/lib/people/person-access.server", () => ({
  peopleCtx: async () => ({ userId: "me" }),
  readsPeopleDataOf: (_ctx: unknown, id: string) => st.readable.has(id),
}));
vi.mock("@/lib/access/manager-lines", () => ({
  liveHereAmong: async (_org: string, ids: string[]) => new Set(ids.filter((x) => st.here.has(x))),
}));
vi.mock("@/lib/work-schedule-server", () => ({ readOrgWorkSchedule: async () => WORK_SCHEDULE_DEFAULTS }));

/** Which of the three reads a where clause is. */
function bucketOf(where: Where): Bucket {
  const b = where.AND[0] as Record<string, unknown>;
  if ("OR" in b) return "window";
  if (b.startAt === null && b.dueAt === null) return "undated";
  return "overdue";
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    item: {
      findMany: async (a: { where: Where; take: number; orderBy: unknown }) => {
        st.itemReads.push(a);
        return st.rows[bucketOf(a.where)].slice(0, a.take);
      },
    },
    user: {
      findMany: async (a: { where: { id: { in: string[] }; deletedAt?: null; status?: { not: string } }; select: Record<string, boolean> }) => {
        const ids = a.where.id.in;
        if (a.select.weeklyCapacityHours) {
          return ids.map((id) => ({ id, weeklyCapacityHours: st.weekly.get(id) ?? null, workSchedule: null }));
        }
        // Honour the filters the route asks for, so dropping one fails a test.
        return ids
          .filter((id) => !(a.where.status?.not === "INACTIVE" && st.inactive.has(id)))
          .filter((id) => !(a.where.deletedAt === null && st.removed.has(id)))
          .map((id) => ({ id, firstName: id, lastName: "", avatar: null }));
      },
    },
    $queryRaw: async () => [...st.estimates].map(([id, est]) => ({ id, est })),
  },
}));

import { GET } from "./route";

const get = (qs = "from=2026-11-02&to=2026-11-15&today=2026-10-31", id = "sp1") =>
  GET(new Request(`http://x/api/spaces/${id}/workload?${qs}`), { params: Promise.resolve({ id }) });

const task = (id: string, over: Partial<Row> = {}): Row => ({
  id, title: id, status: "TO_DO", boardId: "l1", ownerId: null, assigneeIds: [], startAt: null, dueAt: null, priority: null, ...over,
});

beforeEach(() => {
  st.signedIn = true;
  st.space = { id: "sp1" };
  st.lists = [{ id: "l1", slug: "l1", name: "Launch", statuses: null, canContribute: true }];
  st.spaceMembers = [];
  st.rows = { window: [], undated: [], overdue: [] };
  st.here = new Set();
  st.inactive = new Set();
  st.removed = new Set();
  st.readable = new Set();
  st.weekly = new Map();
  st.estimates = new Map();
  st.itemReads = [];
  st.reads = [];
});

describe("the gate", () => {
  it("answers 401 signed out and 404 without Can view on the Space, before any read", async () => {
    st.signedIn = false;
    expect((await get()).status).toBe(401);
    st.signedIn = true;
    st.space = null;
    const res = await get();
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(st.reads).toEqual([]);
  });

  it("refuses a window that is not two dates, runs backwards or is over 92 days", async () => {
    expect((await get("from=2026-11-02")).status).toBe(400);
    expect((await get("from=2026-11-15&to=2026-11-02")).status).toBe(400);
    expect((await get("from=2026-01-01&to=2026-06-01")).status).toBe(400);
  });
});

describe("people", () => {
  it("are the Space's members and everyone on an open task, who still work here", async () => {
    st.spaceMembers = ["ana", "gone"];
    st.rows.window = [task("t1", { ownerId: "cy", assigneeIds: ["left", "ben"], dueAt: new Date("2026-11-04") })];
    st.here = new Set(["ana", "ben", "cy", "dee"]);
    st.inactive = new Set(["dee"]);
    const body = await (await get()).json();
    expect(body.people.map((p: { id: string }) => p.id).sort()).toEqual(["ana", "ben", "cy"]);
    expect(body.people.find((p: { id: string }) => p.id === "ana").spaceMember).toBe(true);
    expect(body.people.find((p: { id: string }) => p.id === "ben").spaceMember).toBe(false);
  });

  it("drop a deactivated holder, so a task only they hold is Unassigned and names them for the re-check", async () => {
    st.rows.undated = [task("t1", { ownerId: "dee" })];
    st.here = new Set(["dee"]);
    st.inactive = new Set(["dee"]);
    const body = await (await get()).json();
    expect(body.people).toEqual([]);
    expect(body.items[0]).toMatchObject({ ownerId: null, assigneeIds: [], unassigned: true, formerIds: ["dee"], assigneeCount: 0 });
  });

  it("drop a removed member even while their level row lingers", async () => {
    st.spaceMembers = ["rex"];
    st.here = new Set(["rex"]);
    st.removed = new Set(["rex"]);
    const body = await (await get()).json();
    expect(body.people).toEqual([]);
  });
});

describe("whose capacity", () => {
  it("sends a colleague's own hours only when the viewer may read their people data", async () => {
    st.spaceMembers = ["me", "ana", "ben"];
    st.here = new Set(["me", "ana", "ben"]);
    st.readable = new Set(["me", "ana"]);
    st.weekly = new Map([["me", 40], ["ana", 20], ["ben", 16]]);
    const body = await (await get()).json();
    const by = Object.fromEntries(body.people.map((p: { id: string }) => [p.id, p]));
    expect(by.ana).toMatchObject({ weeklyCapacityHours: 20, ownCapacity: true });
    expect(by.ben).toMatchObject({ weeklyCapacityHours: null, workSchedule: null, ownCapacity: false });
  });
});

describe("tasks", () => {
  it("are read from the Space's readable Lists only, open, live and never a meeting, in three reads", async () => {
    await get();
    expect(st.itemReads.map((r) => bucketOf(r.where)).sort()).toEqual(["overdue", "undated", "window"]);
    for (const r of st.itemReads) {
      expect(r.where).toMatchObject({ organizationId: "org1", archivedAt: null, boardId: { in: ["l1"] } });
      expect(JSON.stringify(r.where)).toContain('"itemType":{"notIn"');
      // The default status set's done statuses are left out in SQL, and a
      // task with no status is kept (NOT over NULL would drop it).
      expect(r.where.AND[1]).toMatchObject({ OR: [{ status: null }, { NOT: expect.anything() }] });
      expect(r.take).toBe(5001);
    }
  });

  it("match the window the way the grid counts: an overlapping span, or the one date inside it", async () => {
    await get();
    const w = st.itemReads.find((r) => bucketOf(r.where) === "window")!.where.AND[0] as { OR: Array<Record<string, unknown>> };
    const lo = new Date("2026-11-01T00:00:00.000Z");
    const hi = new Date("2026-11-16T23:59:59.999Z");
    expect(w.OR).toEqual([
      { startAt: { not: null, lte: hi }, dueAt: { not: null, gte: lo } },
      { startAt: null, dueAt: { gte: lo, lte: hi } },
      { dueAt: null, startAt: { gte: lo, lte: hi } },
    ]);
  });

  it("keep the most recently due overdue work when there is too much of it", async () => {
    await get();
    const o = st.itemReads.find((r) => bucketOf(r.where) === "overdue")!;
    expect(o.where.AND[0]).toEqual({ dueAt: { lt: new Date("2026-11-01T00:00:00.000Z") } });
    expect(o.orderBy).toEqual([{ dueAt: "desc" }, { id: "asc" }]);
  });

  it("drop a task in a done status of its own List, and count a task once when two reads find it", async () => {
    const late = task("t3", { dueAt: new Date("2026-10-20") });
    st.rows.window = [task("t1", { status: "DONE", dueAt: new Date("2026-11-04") }), task("t2", { dueAt: new Date("2026-11-05") })];
    st.rows.overdue = [late, task("t3b", { status: "DONE", dueAt: new Date("2026-10-21") })];
    st.rows.undated = [task("t4"), late];
    const body = await (await get()).json();
    expect(body.items.map((i: { id: string }) => i.id).sort()).toEqual(["t2", "t3", "t4"]);
  });

  it("carry each task's estimate from its own read, and none for a task without one", async () => {
    st.rows.undated = [task("t1"), task("t2")];
    st.estimates = new Map([["t1", 90]]);
    const body = await (await get()).json();
    expect(body.items.find((i: { id: string }) => i.id === "t1").estimateMinutes).toBe(90);
    expect(body.items.find((i: { id: string }) => i.id === "t2").estimateMinutes).toBeNull();
  });

  it("read nothing when the viewer can open no List here", async () => {
    st.lists = [];
    const body = await (await get()).json();
    expect(st.itemReads).toEqual([]);
    expect(body).toMatchObject({ items: [], boards: [], truncated: { window: false, unscheduled: false, overdue: false } });
  });

  it("say which read was cut, and a cut read never crowds out the others", async () => {
    st.rows.overdue = Array.from({ length: 5001 }, (_, i) => task(`o${i}`, { dueAt: new Date("2024-01-01") }));
    st.rows.window = [task("w1", { dueAt: new Date("2026-11-04") })];
    st.rows.undated = [task("u1")];
    const body = await (await get()).json();
    expect(body.truncated).toEqual({ window: false, unscheduled: false, overdue: true });
    const ids = new Set(body.items.map((i: { id: string }) => i.id));
    expect(ids.has("w1") && ids.has("u1")).toBe(true);
    expect(body.items).toHaveLength(5002);
  });

  it("carry each List's own statuses and whether the viewer may assign on it", async () => {
    st.lists = [
      { id: "l1", slug: "l1", name: "Launch", statuses: null, canContribute: true },
      { id: "l2", slug: "l2", name: "Ops", statuses: null, canContribute: false },
    ];
    const body = await (await get()).json();
    expect(body.boards.map((b: { id: string; canEdit: boolean }) => [b.id, b.canEdit])).toEqual([["l1", true], ["l2", false]]);
    expect(body.boards[0].statuses.length).toBeGreaterThan(0);
  });
});
