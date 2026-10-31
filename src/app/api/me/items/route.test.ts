// GET /api/me/items: the task picker behind Clock and Timesheets.
//
// It read the 500 oldest of the viewer's tasks by due date and then dropped
// the done ones by the five words isDoneStatusName knows. So a Published post
// (a content List's done status) stayed in the picker for good, and someone
// with 500 finished tasks behind them got an empty picker while open work
// waited to be logged. Reproduced against the in-memory store.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { itemTestDb, installItemTestDb, type ItemTestDb } from "@/lib/item-test-db";

vi.mock("next-auth", async () => {
  const { legacyTestSession } = await import("@/lib/access/test-fixtures");
  return { getServerSession: async () => legacyTestSession("u-me", "EMPLOYEE", "org-1") };
});
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/item-test-db")).itemTestPrisma }));

import { GET } from "./route";

const CONTENT = {
  id: "b-content", slug: "posts", name: "Posts", icon: null, color: null, spaceId: null, organizationId: "org-1",
  statuses: [
    { value: "DRAFT", label: "Draft", color: "#999999", group: "ACTIVE" },
    { value: "PUBLISHED", label: "Published", color: "#15803D", group: "DONE" },
  ],
};
const PLAIN = { id: "b-plain", slug: "work", name: "Work", icon: null, color: null, spaceId: null, organizationId: "org-1", statuses: null };

let db: ItemTestDb;
let n = 0;
function task(boardId: string, status: string | null, dueAt: Date | null) {
  n += 1;
  const id = `t-${String(n).padStart(4, "0")}`;
  db.items.push({
    id, title: id, organizationId: "org-1", boardId, status, dueAt, startAt: null, position: n,
    ownerId: "u-me", assigneeIds: [], parentItemId: null, archivedAt: null, itemType: "TASK",
  });
  return id;
}
const day = (d: number) => new Date(Date.UTC(2026, 8, d));
const ids = async (status?: string) => {
  const res = await GET(new Request(`http://x/api/me/items${status ? `?status=${status}` : ""}`));
  return ((await res.json()) as { items: Array<{ id: string }> }).items.map((i) => i.id);
};

beforeEach(() => {
  n = 0;
  db = installItemTestDb(itemTestDb({ boards: [{ ...CONTENT }, { ...PLAIN }] }));
});

describe("the Clock and Timesheets picker", () => {
  it("leaves out what each task's own List calls done", async () => {
    const draft = task("b-content", "DRAFT", day(2));
    const published = task("b-content", "PUBLISHED", day(1));
    const todo = task("b-plain", "TO_DO", day(3));
    const done = task("b-plain", "DONE", day(4));
    expect(await ids()).toEqual([draft, todo]);
    expect(await ids("done")).toEqual([published, done]);
    expect(await ids("all")).toEqual([published, draft, todo, done]);
  });

  it("still lists open work behind 600 finished tasks", async () => {
    for (let i = 0; i < 600; i++) task("b-plain", "DONE", day(1));
    const open = task("b-plain", "TO_DO", day(20));
    expect(await ids()).toEqual([open]);
  });
});
