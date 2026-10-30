// GET /api/me/work: what My work shows, and the cursor it hands back.
//
// Two launch defects, both reproduced against an in-memory store
// (src/lib/item-test-db.ts):
//
//   * The read took limit*3+1 rows by due date, dropped done ones in JS, and
//     used the last SHOWN row as the next cursor. A person whose oldest 151
//     tasks were finished got an empty first page, a null cursor and "Nothing
//     assigned to you yet", with every open task behind it, and a total that
//     counted the finished ones.
//   * Done was the five words isDoneStatusName knows, so a task in a content
//     List's PUBLISHED (its done status) stayed on the list of work to do.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { itemTestDb, installItemTestDb, type ItemTestDb } from "@/lib/item-test-db";

vi.mock("next-auth", async () => {
  const { legacyTestSession } = await import("@/lib/access/test-fixtures");
  return { getServerSession: async () => legacyTestSession("u-me", "EMPLOYEE", "org-1") };
});
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/item-test-db")).itemTestPrisma }));
vi.mock("@/lib/preferences", () => ({ getEffectivePreferences: async () => null }));
vi.mock("@/lib/board", () => ({ getOrCreatePersonalBoard: async () => ({ id: "b-personal", statuses: null }) }));
vi.mock("@/lib/board-items", () => ({ createBoardItem: async () => ({ id: "new", title: "new" }) }));
vi.mock("@/lib/delegated-items", () => ({ delegatedWhere: async () => ({ organizationId: "org-1", id: { in: [] } }) }));
vi.mock("@/lib/assignee-lift", () => ({ listSidesFor: async () => ({ withheld: new Set(), addable: new Set() }) }));

import { GET } from "./route";

const CONTENT = {
  id: "b-content", slug: "posts", name: "Posts", icon: null, color: null, spaceId: null, organizationId: "org-1",
  statuses: [
    { value: "DRAFT", label: "Draft", color: "#999999", group: "ACTIVE" },
    { value: "PUBLISHED", label: "Published", color: "#15803D", group: "DONE" },
    { value: "CANCELLED", label: "Cancelled", color: "#D92D20", group: "CLOSED" },
  ],
};
const PLAIN = { id: "b-plain", slug: "work", name: "Work", icon: null, color: null, spaceId: null, organizationId: "org-1", statuses: null };

let db: ItemTestDb;
let n = 0;
function task(boardId: string, status: string | null, dueAt: Date | null) {
  n += 1;
  const id = `t-${String(n).padStart(4, "0")}`;
  db.items.push({
    id, title: id, organizationId: "org-1", boardId, status, priority: null, dueAt, startAt: null,
    ownerId: "u-me", assigneeIds: ["u-me"], parentItemId: null, archivedAt: null, itemType: "TASK", itemTypeId: null,
    createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z"),
  });
  return id;
}
const day = (d: number) => new Date(Date.UTC(2026, 8, d));

beforeEach(() => {
  n = 0;
  db = installItemTestDb(itemTestDb({ boards: [{ ...CONTENT }, { ...PLAIN }] }));
  const boards = db.prisma.board.findMany;
  // readableListIds asks with relation filters this store does not model:
  // every List here is the viewer's to open.
  db.prisma.board.findMany = async (args = {}) => {
    const where = args.where as { OR?: unknown; id?: { in: string[] } } | undefined;
    if (where?.OR) return db.boards.filter((b) => where.id?.in.includes(String(b.id))).map((b) => ({ id: b.id }));
    return boards(args);
  };
  db.prisma.task = { findMany: async () => [] };
  db.prisma.legacyRedirect = { findMany: async () => [] };
  db.prisma.space = { findMany: async () => [] };
  db.prisma.user = { findMany: async () => [] };
  db.prisma.itemType = { findMany: async () => [] };
  db.prisma.tagAssignment = { findMany: async () => [] };
  db.prisma.itemActivity = { findMany: async () => [] };
});

interface Body { rows: Array<{ id: string; status: string | null; done?: boolean }>; total: number; nextCursor: string | null; hasMore: boolean }
async function get(query: string): Promise<Body> {
  const res = await GET(new Request(`http://x/api/me/work?${query}`));
  return (await res.json()) as Body;
}

describe("My work's first page when the oldest tasks are finished", () => {
  it("shows the open tasks behind 160 finished ones, with a total that counts only open work", async () => {
    for (let i = 0; i < 160; i++) task("b-plain", "DONE", day(1));
    const late = [task("b-plain", "TO_DO", day(20)), task("b-plain", "IN_PROGRESS", day(21))];
    const body = await get("limit=50");
    expect(body.rows.map((r) => r.id)).toEqual(late);
    expect(body.total).toBe(2);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
  });

  it("pages through open work with a cursor that always moves", async () => {
    const open = Array.from({ length: 120 }, (_, i) => task("b-plain", "TO_DO", day(1 + (i % 28))));
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let pageNo = 0; pageNo < 5; pageNo++) {
      const body = await get(`limit=50${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...body.rows.map((r) => r.id));
      expect(body.total).toBe(120);
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    expect(seen.sort()).toEqual([...open].sort());
  });

  it("reads on past a window a status change emptied, and the cursor is the last row it read", async () => {
    // Done in no List's set when the groupBy ran, so the SQL let them through;
    // they turned done (COMPLETED, by the name rule) before the rows were read.
    const turning = Array.from({ length: 70 }, () => task("b-plain", "TO_DO", day(1)));
    const open = [task("b-plain", "TO_DO", day(25)), task("b-plain", "TO_DO", day(26))];
    db.afterGroupBy = () => {
      for (const r of db.items) if (turning.includes(String(r.id))) r.status = "COMPLETED";
      db.afterGroupBy = undefined;
    };
    const body = await get("limit=50");
    expect(body.rows.map((r) => r.id)).toEqual(open);
    expect(body.nextCursor).toBeNull();
  });
});

describe("done is decided by each task's own List", () => {
  it("a content List's Published and Cancelled are done, its Draft is open", async () => {
    const draft = task("b-content", "DRAFT", day(2));
    const published = task("b-content", "PUBLISHED", day(1));
    const cancelled = task("b-content", "CANCELLED", day(3));
    const plain = task("b-plain", "TO_DO", day(4));

    const open = await get("limit=50");
    expect(open.rows.map((r) => r.id)).toEqual([draft, plain]);
    expect(open.total).toBe(2);
    expect(open.rows.every((r) => r.done === false)).toBe(true);

    const only = await get("limit=50&done=only");
    expect(only.rows.map((r) => r.id)).toEqual([published, cancelled]);
    expect(only.total).toBe(2);
    expect(only.rows.every((r) => r.done === true)).toBe(true);

    const all = await get("limit=50&done=1");
    expect(all.rows).toHaveLength(4);
    expect(all.total).toBe(4);
  });
});
