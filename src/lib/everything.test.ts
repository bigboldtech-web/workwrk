// listEverything: done is decided by each task's own List.
//
// Everything decided done by the five words isDoneStatusName knows, in JS
// after the read, so a task in a content List's PUBLISHED (its done status)
// or a CANCELLED in a CLOSED group sat in the default "open work" list, and
// "Total records" counted it. Reproduced against the in-memory store
// (src/lib/item-test-db.ts) with the access resolver mocked to "every List
// here reads".

import { beforeEach, describe, expect, it, vi } from "vitest";
import { itemTestDb, installItemTestDb, type ItemTestDb } from "./item-test-db";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./item-test-db")).itemTestPrisma }));
vi.mock("./access/node-access", () => ({
  nodeCtxFromViewer: () => ({}),
  nodeRole: async () => ({ role: "FULL", path: false }),
  nodeRoleMap: async (_ctx: unknown, _kind: string, ids: string[]) => new Map(ids.map((id) => [id, "FULL"])),
}));
vi.mock("./list-links-server", () => ({ linkedTreeRows: async () => [] }));
vi.mock("./delegated-items", () => ({ delegatedWhere: async () => ({ id: { in: [] } }) }));
vi.mock("./preferences", () => ({ getEffectivePreferences: async () => null }));

import { listEverything, type EverythingQuery } from "./everything";

const CONTENT = {
  id: "b-content", slug: "posts", name: "Posts", icon: null, color: null, spaceId: null, organizationId: "org-1", archivedAt: null,
  statuses: [
    { value: "DRAFT", label: "Draft", color: "#999999", group: "ACTIVE" },
    { value: "PUBLISHED", label: "Published", color: "#15803D", group: "DONE" },
    { value: "CANCELLED", label: "Cancelled", color: "#D92D20", group: "CLOSED" },
  ],
};
const PLAIN = { id: "b-plain", slug: "work", name: "Work", icon: null, color: null, spaceId: null, organizationId: "org-1", archivedAt: null, statuses: null };

let db: ItemTestDb;
let n = 0;
function task(boardId: string, status: string | null) {
  n += 1;
  const id = `t-${String(n).padStart(4, "0")}`;
  db.items.push({
    id, title: id, organizationId: "org-1", boardId, status, priority: null, dueAt: null, startAt: null,
    ownerId: "u-me", assigneeIds: [], parentItemId: null, archivedAt: null, itemType: "TASK",
    createdAt: new Date(Date.UTC(2026, 0, n)), updatedAt: new Date(Date.UTC(2026, 0, n)),
  });
  return id;
}

const viewer = { userId: "u-me", organizationId: "org-1", orgRole: "MEMBER", isAgent: false, adminScopes: [] } as never;
const query = (over: Partial<EverythingQuery> = {}): EverythingQuery => ({
  group: "none", sort: "created", dir: "asc", done: "0", q: null, statuses: [], priorities: [], listIds: [], spaceIds: [],
  assigneeIds: [], includeSubtasks: true, cursor: null, limit: 50, ...over,
});

beforeEach(() => {
  n = 0;
  db = installItemTestDb(itemTestDb({ boards: [{ ...CONTENT }, { ...PLAIN }] }));
  db.prisma.space = { findMany: async () => [] };
  db.prisma.user = { findMany: async () => [] };
  db.prisma.itemActivity = { findMany: async () => [] };
});

describe("Everything's done rule", () => {
  it("leaves a content List's Published and Cancelled out of open work, and out of the total", async () => {
    const draft = task("b-content", "DRAFT");
    task("b-content", "PUBLISHED");
    task("b-content", "CANCELLED");
    const todo = task("b-plain", "TO_DO");
    task("b-plain", "DONE");

    const open = await listEverything(viewer, query());
    expect(open.rows.map((r) => r.id)).toEqual([draft, todo]);
    expect(open.total).toBe(2);
    expect(open.rows.map((r) => r.done)).toEqual([false, false]);

    const finished = await listEverything(viewer, query({ done: "only" }));
    expect(finished.rows.map((r) => r.status)).toEqual(["PUBLISHED", "CANCELLED", "DONE"]);
    expect(finished.total).toBe(3);
  });

  it("a first page behind many finished tasks still fills, with a cursor", async () => {
    for (let i = 0; i < 200; i++) task("b-content", "PUBLISHED");
    const open = Array.from({ length: 60 }, () => task("b-content", "DRAFT"));
    const first = await listEverything(viewer, query());
    expect(first.rows.map((r) => r.id)).toEqual(open.slice(0, 50));
    expect(first.hasMore).toBe(true);
    const second = await listEverything(viewer, query({ cursor: first.nextCursor }));
    expect(second.rows.map((r) => r.id)).toEqual(open.slice(50));
    expect(second.total).toBe(60);
  });
});
