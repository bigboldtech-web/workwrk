// Ask AI's search_tasks reads in pages until it has enough tasks the person
// may open (the task page's own ladder), instead of filtering one batch of
// the newest rows: a narrow reader whose readable tasks sit far down a big
// workspace now gets them. The database and the access ladder are mocked:
// 1,000 tasks newest first, of which only a few far down are readable.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

type Row = { id: string; title: string; status: string; priority: string | null; dueAt: null; ownerId: null; boardId: string; assigneeIds: string[]; organizationId: string; parentItemId: null };
const rows: Row[] = Array.from({ length: 1000 }, (_, i) => ({
  id: `t${String(i).padStart(4, "0")}`, title: `Task ${i}`, status: i % 2 ? "Done" : "To Do", priority: null, dueAt: null,
  ownerId: null, boardId: i >= 900 ? "L-mine" : "L-private", assigneeIds: [], organizationId: "org-1", parentItemId: null,
}));
let reads = 0;
let denied = false;
let level: string | null = "EMPLOYEE";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findFirst: async () => (level ? legacyLevelRow(level) : null) },
    item: {
      findMany: async (args: { take: number; cursor?: { id: string }; skip?: number }) => {
        reads += 1;
        const start = args.cursor ? rows.findIndex((r) => r.id === args.cursor!.id) + (args.skip ?? 0) : 0;
        return rows.slice(start, start + args.take);
      },
    },
  },
}));
vi.mock("@/lib/access/node-access", () => ({ nodeCtxForUser: async () => ({ denied }), nodeRoles: async () => new Map() }));
vi.mock("@/lib/list-links-server", () => ({
  listReader: () => ({}),
  readableItemsVia: async (_v: unknown, items: Row[]) => new Map(items.map((it) => [it.id, { readable: it.boardId === "L-mine", via: null }])),
}));

const { TOOLS } = await import("./tools");
const ctx = { orgId: "org-1", userId: "u-1" };

beforeEach(() => { reads = 0; denied = false; level = "EMPLOYEE"; });

describe("search_tasks", () => {
  it("finds the readable tasks far down the workspace, one batch would have found none", async () => {
    const out = await TOOLS.search_tasks.handler(ctx, { limit: 20 }) as { count: number; tasks: Array<{ id: string }>; partial?: boolean };
    expect(out.count).toBe(20);
    expect(out.tasks[0].id).toBe("t0900");
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

  it("a denied or departed person reads nothing, and nothing is queried", async () => {
    denied = true;
    expect(await TOOLS.search_tasks.handler(ctx, {})).toEqual({ count: 0, tasks: [] });
    denied = false;
    level = null;
    expect(await TOOLS.search_tasks.handler(ctx, {})).toEqual({ count: 0, tasks: [] });
    expect(reads).toBe(0);
  });

  it("a bad limit from the model is clamped, never a crash", async () => {
    const out = await TOOLS.search_tasks.handler(ctx, { limit: "lots" }) as { count: number };
    expect(out.count).toBe(20);
  });
});
