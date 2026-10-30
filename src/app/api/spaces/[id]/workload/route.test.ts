// GET /api/spaces/[id]/workload, the Space's Workload tab: the Space gate
// answers before any read, only the Space's readable Lists add tasks or
// people, a departed or deactivated person is never a row, done tasks and
// meetings never count, a colleague's own hours reach only a viewer who may
// read their people data, and a cut answer says it was cut.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORK_SCHEDULE_DEFAULTS } from "@/lib/work-schedule";

type Row = { id: string; title: string; status: string | null; boardId: string; ownerId: string | null; assigneeIds: string[]; startAt: Date | null; dueAt: Date | null; priority: string | null; metadata: unknown };

const st = vi.hoisted(() => ({
  signedIn: true,
  space: { id: "sp1" } as null | { id: string },
  lists: [] as Array<{ id: string; slug: string; name: string; statuses: unknown; canContribute: boolean }>,
  spaceMembers: [] as string[],
  items: [] as Row[],
  /** Who holds a level in this workspace. */
  here: new Set<string>(),
  inactive: new Set<string>(),
  /** Whose people data the viewer may read. */
  readable: new Set<string>(),
  weekly: new Map<string, number>(),
  itemWhere: null as null | Record<string, unknown>,
  itemTake: 0,
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
vi.mock("@/lib/prisma", () => ({
  prisma: {
    item: {
      findMany: async (a: { where: Record<string, unknown>; take: number }) => {
        st.itemWhere = a.where;
        st.itemTake = a.take;
        return st.items.slice(0, a.take);
      },
    },
    user: {
      findMany: async (a: { where: { id: { in: string[] } }; select: Record<string, boolean> }) => {
        const ids = a.where.id.in;
        if (a.select.weeklyCapacityHours) {
          return ids.map((id) => ({ id, weeklyCapacityHours: st.weekly.get(id) ?? null, workSchedule: null }));
        }
        return ids.filter((id) => !st.inactive.has(id)).map((id) => ({ id, firstName: id, lastName: "", avatar: null }));
      },
    },
  },
}));

import { GET } from "./route";

const get = (qs = "from=2026-11-02&to=2026-11-15&today=2026-10-31", id = "sp1") =>
  GET(new Request(`http://x/api/spaces/${id}/workload?${qs}`), { params: Promise.resolve({ id }) });

const task = (id: string, over: Partial<Row> = {}): Row => ({
  id, title: id, status: "TO_DO", boardId: "l1", ownerId: null, assigneeIds: [], startAt: null, dueAt: null, priority: null, metadata: {}, ...over,
});

beforeEach(() => {
  st.signedIn = true;
  st.space = { id: "sp1" };
  st.lists = [{ id: "l1", slug: "l1", name: "Launch", statuses: null, canContribute: true }];
  st.spaceMembers = [];
  st.items = [];
  st.here = new Set();
  st.inactive = new Set();
  st.readable = new Set();
  st.weekly = new Map();
  st.itemWhere = null;
  st.itemTake = 0;
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
    st.items = [task("t1", { ownerId: "cy", assigneeIds: ["left", "ben"] })];
    st.here = new Set(["ana", "ben", "cy", "dee"]);
    st.inactive = new Set(["dee"]);
    const body = await (await get()).json();
    expect(body.people.map((p: { id: string }) => p.id).sort()).toEqual(["ana", "ben", "cy"]);
    expect(body.people.find((p: { id: string }) => p.id === "ana").spaceMember).toBe(true);
    expect(body.people.find((p: { id: string }) => p.id === "ben").spaceMember).toBe(false);
  });

  it("drop a deactivated holder, so a task only they hold is Unassigned and names them for the re-check", async () => {
    st.items = [task("t1", { ownerId: "dee" })];
    st.here = new Set(["dee"]);
    st.inactive = new Set(["dee"]);
    const body = await (await get()).json();
    expect(body.people).toEqual([]);
    expect(body.items[0]).toMatchObject({ ownerId: null, assigneeIds: [], unassigned: true, formerIds: ["dee"], assigneeCount: 0 });
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
  it("are read from the Space's readable Lists only, open, live and never a meeting", async () => {
    st.items = [task("t1")];
    await get();
    const w = JSON.stringify(st.itemWhere);
    expect(st.itemWhere).toMatchObject({ organizationId: "org1", archivedAt: null, boardId: { in: ["l1"] } });
    expect(w).toContain('"itemType":{"notIn"');
    // The default status set's done statuses are left out in SQL.
    expect(w).toContain('"NOT"');
  });

  it("drop a task in a done status of its own List", async () => {
    st.items = [task("t1", { status: "DONE" }), task("t2", { status: "TO_DO" })];
    const body = await (await get()).json();
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(["t2"]);
  });

  it("read nothing when the viewer can open no List here", async () => {
    st.lists = [];
    const body = await (await get()).json();
    expect(st.itemWhere).toBeNull();
    expect(body).toMatchObject({ items: [], boards: [], truncated: false });
  });

  it("say so when there were more than the cap", async () => {
    st.items = Array.from({ length: 5001 }, (_, i) => task(`t${i}`));
    const body = await (await get()).json();
    expect(st.itemTake).toBe(5001);
    expect(body.items).toHaveLength(5000);
    expect(body.truncated).toBe(true);
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
