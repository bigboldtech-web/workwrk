// Ask AI's search_tasks reads in pages until it has enough tasks the person
// may open (the task page's own ladder), instead of filtering one batch of
// the newest rows: a narrow reader whose readable tasks sit far down a big
// workspace now gets them. The database and the access ladder are mocked:
// 1,000 tasks newest first, of which only a few far down are readable.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

type Row = { id: string; title: string; status: string; priority: string | null; dueAt: null; ownerId: null; boardId: string; assigneeIds: string[]; organizationId: string; parentItemId: null; updatedAt: Date };
// Newest first by (updatedAt desc, id desc): three tasks share each second,
// so the id breaks the ties.
const idOf = (i: number) => `t${String(9999 - i).padStart(4, "0")}`;
const all: Row[] = Array.from({ length: 1000 }, (_, i) => ({
  id: idOf(i), title: `Task ${i}`, status: i % 2 ? "Done" : "To Do", priority: null, dueAt: null,
  ownerId: null, boardId: i >= 900 ? "L-mine" : "L-private", assigneeIds: [], organizationId: "org-1", parentItemId: null,
  updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0) - Math.floor(i / 3) * 1000),
}));
let rows: Row[] = all;
let reads = 0;
let denied = false;
let level: string | null = "EMPLOYEE";
/** The workspace the caller is anchored in; "org-1" is this one. */
let home = "org-1";
/** Their membership's role here when anchored elsewhere. */
let membership: string | null = null;
let afterRead: ((page: Row[]) => void) | null = null;

type Keyset = { updatedAt: Date | { lt: Date }; id?: { lt: string } };
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findFirst: async () => (level ? legacyLevelRow(level) : null),
      // The caller, by id (tools.ts callerLevel): anchored here, or in another
      // workspace for a person here through a membership. A denied one is deactivated.
      findUnique: async () => (level ? { organizationId: home, ...legacyLevelRow(level), status: denied ? "INACTIVE" : "ACTIVE", deletedAt: null } : null),
      // A Talk answer's readers (review round 4): each read at the level held here.
      findMany: async (a: { where: { id: { in: string[] } } }) =>
        a.where.id.in.filter((id) => id !== "u-unknown").map((id) => ({ id, organizationId: id === "u-elsewhere" ? "org-2" : "org-1", ...legacyLevelRow("EMPLOYEE"), status: id === "u-gone" ? "INACTIVE" : "ACTIVE", deletedAt: null })),
    },
    // u-elsewhere works here through a second membership (anchored in org-2).
    organizationMembership: { findUnique: async (a?: { where?: { userId_organizationId?: { userId?: string } } }) => (a?.where?.userId_organizationId?.userId === "u-elsewhere" ? { role: "EMPLOYEE" } : membership ? { role: membership } : null) },
    item: {
      // Applies the keyset the tool sends (where.AND[0].OR), as the database would.
      findMany: async (args: { take: number; where: { AND?: Array<{ OR?: Keyset[] }> } }) => {
        reads += 1;
        const k = args.where.AND?.[0]?.OR;
        const older = (r: Row) => !k || k.some((c) => (c.updatedAt instanceof Date ? r.updatedAt.getTime() === c.updatedAt.getTime() && r.id < (c.id?.lt ?? "") : r.updatedAt < c.updatedAt.lt));
        const page = rows.filter(older).slice(0, args.take);
        afterRead?.(page);
        return page;
      },
    },
  },
}));
vi.mock("@/lib/access/node-access", () => ({
  nodeCtxFromLevel: (userId: string, organizationId: string) => ({ userId, organizationId, orgAdmin: false, orgGuest: false, isAgent: false, denied: false }),
  nodeRoles: async () => new Map(),
}));
vi.mock("@/lib/list-links-server", () => ({
  // A Talk answer's readers (review round 3): Eve opens no List here.
  listReader: (v?: { userId?: string }) => ({ canRead: async () => v?.userId !== "u-eve" && v?.userId !== "u-elsewhere" }),

  readableItemsVia: async (_v: unknown, items: Row[]) => new Map(items.map((it) => [it.id, { readable: it.boardId === "L-mine", via: null }])),
}));

const { TOOLS } = await import("./tools");
const ctx = { orgId: "org-1", userId: "u-1" };

beforeEach(() => { rows = all; reads = 0; denied = false; level = "EMPLOYEE"; home = "org-1"; membership = null; afterRead = null; });

describe("search_tasks", () => {
  it("finds the readable tasks far down the workspace, one batch would have found none", async () => {
    const out = await TOOLS.search_tasks.handler(ctx, { limit: 20 }) as { count: number; tasks: Array<{ id: string }>; partial?: boolean };
    expect(out.count).toBe(20);
    expect(out.tasks[0].id).toBe(idOf(900));
    expect(out.partial).toBeUndefined();
    expect(reads).toBeGreaterThan(1);
  });

  it("applies done after the access rule and still fills the page", async () => {
    const out = await TOOLS.search_tasks.handler(ctx, { limit: 10, done: false }) as { count: number; tasks: Array<{ status: string }> };
    expect(out.count).toBe(10);
    expect(out.tasks.every((t) => t.status === "To Do")).toBe(true);
  });

  it("says the search was cut short rather than answering none", async () => {
    const out = await TOOLS.search_tasks.handler(ctx, { limit: 50, titleContains: "x" }) as { count: number; partial?: boolean };
    // every candidate is read (the mock ignores the title filter), 100 readable: 50 found, not capped
    expect(out.count).toBe(50);
    expect(out.partial).toBeUndefined();
  });

  it("a task archived or moved away mid-scan neither skips a task nor ends the search", async () => {
    // After each page, its last row leaves the candidates (archived, trashed):
    // a cursor on that row's id would have skipped a row or read nothing more.
    afterRead = (page) => { const last = page[page.length - 1]; if (last) rows = rows.filter((r) => r.id !== last.id); };
    const out = await TOOLS.search_tasks.handler(ctx, { limit: 20 }) as { count: number; tasks: Array<{ id: string }>; partial?: boolean };
    expect(out.count).toBe(20);
    expect(out.tasks.map((t) => t.id)).toEqual(Array.from({ length: 21 }, (_, i) => idOf(900 + i)).filter((id) => all.some((r) => r.id === id)).slice(0, 20));
    expect(out.partial).toBeUndefined();
  });

  it("says partial, with how many were read, only when tasks were left unread", async () => {
    const hidden = all.map((r) => ({ ...r, boardId: "L-private" }));
    // exactly 1,000 candidates and the cap is 1,000: nothing was left unread
    rows = hidden;
    const exact = await TOOLS.search_tasks.handler(ctx, { limit: 20 }) as { count: number; partial?: boolean };
    expect(exact.count).toBe(0);
    expect(exact.partial).toBeUndefined();
    // one more, older task past the cap: the search was cut short and says so
    rows = [...hidden, { ...hidden[0], id: "t-older", updatedAt: new Date(Date.UTC(2025, 0, 1)) }];
    const cut = await TOOLS.search_tasks.handler(ctx, { limit: 20 }) as { count: number; partial?: boolean; searched?: number };
    expect(cut).toMatchObject({ count: 0, partial: true, searched: 1000 });
  });

  it("a denied or departed person reads nothing, and nothing is queried", async () => {
    denied = true;
    expect(await TOOLS.search_tasks.handler(ctx, {})).toEqual({ count: 0, tasks: [] });
    denied = false;
    level = null;
    expect(await TOOLS.search_tasks.handler(ctx, {})).toEqual({ count: 0, tasks: [] });
    expect(reads).toBe(0);
  });

  it("a person here through a second membership reads at that membership's level, never as nobody", async () => {
    // Anchored in another workspace, a Member here: they read their tasks here.
    home = "org-home";
    membership = "EMPLOYEE";
    const out = (await TOOLS.search_tasks.handler(ctx, {})) as { count: number };
    expect(out.count).toBeGreaterThan(0);
    // Without a membership here they read nothing, and nothing is queried.
    membership = null;
    reads = 0;
    expect(await TOOLS.search_tasks.handler(ctx, {})).toEqual({ count: 0, tasks: [] });
    expect(reads).toBe(0);
  });

  it("a bad limit from the model is clamped, never a crash", async () => {
    const out = await TOOLS.search_tasks.handler(ctx, { limit: "lots" }) as { count: number };
    expect(out.count).toBe(20);
  });
});

describe("search_tasks in a Talk turn (review round 3)", () => {
  const talk = (audience: string[]) => ({ ...ctx, teammate: { agentId: "a1", agentName: "CoS", sessionId: "s1", routineId: null, trigger: "TALK" as const, timezone: "UTC", audience } });

  it("finds only tasks in Lists every reader of the answer can open", async () => {
    const out = await TOOLS.search_tasks.handler(talk(["u-1", "u-eve"]), { limit: 20 }) as { count: number };
    expect(out.count).toBe(0);
  });

  it("counts a reader anchored in another workspace, never skips them (review round 4)", async () => {
    // Reads nothing here, and is anchored in another workspace: the old lookup dropped them and passed every List.
    const out = await TOOLS.search_tasks.handler(talk(["u-1", "u-elsewhere"]), { limit: 20 }) as { count: number };
    expect(out.count).toBe(0);
  });

  it("fails closed for a reader who cannot be read, and leaves out one who can no longer sign in", async () => {
    expect(((await TOOLS.search_tasks.handler(talk(["u-1", "u-unknown"]), { limit: 20 })) as { count: number }).count).toBe(0);
    expect(((await TOOLS.search_tasks.handler(talk(["u-1", "u-gone"]), { limit: 20 })) as { count: number }).count).toBe(20);
  });

  it("finds what the asker can when everyone there can open it too", async () => {
    const out = await TOOLS.search_tasks.handler(talk(["u-1", "u-olivia"]), { limit: 20 }) as { count: number };
    expect(out.count).toBe(20);
  });
});
