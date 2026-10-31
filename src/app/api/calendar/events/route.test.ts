// GET /api/calendar/events?calendar=team: a manager's view of their reports'
// tasks.
//
// The team read sent every task a report owned or was assigned, with its
// title and its /item link, whatever List it sat in: a PRIVATE List, another
// team's Space. Teams > Workload only ever showed Lists the viewer can read.
// Now a task in a List the manager cannot open is not sent at all. Tried
// against the in-memory store with the access resolver mocked.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { itemTestDb, installItemTestDb, type ItemTestDb } from "@/lib/item-test-db";

vi.mock("next-auth", async () => {
  const { legacyTestSession } = await import("@/lib/access/test-fixtures");
  return { getServerSession: async () => legacyTestSession("u-mgr", "MANAGER", "org-1") };
});
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/item-test-db")).itemTestPrisma }));
vi.mock("@/lib/reporting-line", () => ({ getEffectiveReportTree: async () => ["u-mgr", "u-rep"] }));
vi.mock("@/lib/access/manager-lines", () => ({ managesNobody: async () => false }));
vi.mock("@/lib/access/acting-workspace", () => ({ inWorkspaceWhere: () => ({}) }));
vi.mock("@/lib/assignee-lift", () => ({ liftWithheldListIds: async () => new Set() }));
const readable = new Set<string>();
vi.mock("@/lib/access/node-access", () => ({
  nodeCtxFromSession: async () => ({}),
  nodeRoleMap: async (_ctx: unknown, _kind: string, ids: string[]) => new Map(ids.map((id) => [id, readable.has(id) ? "VIEW" : "none"])),
}));

import { GET } from "./route";

let db: ItemTestDb;
function task(id: string, boardId: string, ownerId: string, metadata: unknown = null) {
  db.items.push({
    id, title: `Title of ${id}`, organizationId: "org-1", boardId, status: "TO_DO", archivedAt: null, itemType: "TASK",
    ownerId, assigneeIds: [], startAt: null, dueAt: new Date("2026-09-16T00:00:00Z"), metadata,
  });
}

beforeEach(() => {
  readable.clear();
  db = installItemTestDb(itemTestDb());
  db.prisma.user = { findFirst: async () => ({ id: "u-rep" }), findMany: async () => [] };
  db.prisma.userDottedLine = { findFirst: async () => null };
  db.prisma.timeEntry = { findMany: async () => [] };
});

async function events(calendar: "team" | "my") {
  const res = await GET(new Request(`http://x/api/calendar/events?calendar=${calendar}&kinds=task,external&from=2026-09-14T00:00:00Z&to=2026-09-21T00:00:00Z`));
  const body = (await res.json()) as { events: Array<{ id: string; title: string; url: string | null; busyOnly?: boolean }>; calendar: string };
  expect(body.calendar).toBe(calendar);
  return body.events;
}

describe("the team calendar's tasks", () => {
  it("sends a report's task only from a List the manager can open", async () => {
    readable.add("b-shared");
    task("t-shared", "b-shared", "u-rep");
    task("t-private", "b-private", "u-rep");
    const got = await events("team");
    expect(got.map((e) => e.id)).toEqual(["item:t-shared"]);
    expect(JSON.stringify(got)).not.toContain("t-private");
  });

  it("keeps the manager's own task wherever it sits", async () => {
    task("t-mine", "b-private", "u-mgr");
    expect((await events("team")).map((e) => e.id)).toEqual(["item:t-mine"]);
  });

  it("shows a report's synced Google block in an unreadable List as Busy, with no title or link", async () => {
    task("t-gcal", "b-private", "u-rep", { legacyTask: { externalSource: "GCAL", externalId: "g-1" } });
    const [e] = await events("team");
    expect(e).toMatchObject({ id: "item:t-gcal", title: "Busy", url: null, busyOnly: true });
  });

  it("does not narrow My calendar", async () => {
    task("t-mine", "b-private", "u-mgr");
    expect((await events("my")).map((e) => e.id)).toEqual(["item:t-mine"]);
  });
});
