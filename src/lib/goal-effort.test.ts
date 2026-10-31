// computeGoalEffortBatch: a goal's tasks done and open, by each task's own
// List.
//
// Effort counted done by the five words isDoneStatusName knows, so a goal
// linked to a content List whose done status is Published, or a sales List
// whose CLOSED group holds Closed won, read every finished task as open.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { itemTestDb, installItemTestDb, type ItemTestDb } from "./item-test-db";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./item-test-db")).itemTestPrisma }));
vi.mock("@/lib/access/node-access", () => ({
  nodeCtxFromViewer: () => ({}),
  nodeRoleMap: async (_ctx: unknown, _kind: string, ids: string[]) => new Map(ids.map((id) => [id, "VIEW"])),
}));

import { computeGoalEffortBatch } from "./goal-effort";

const SALES = {
  id: "b-sales", organizationId: "org-1",
  statuses: [
    { value: "LEAD", label: "Lead", color: "#999999", group: "ACTIVE" },
    { value: "CLOSED_WON", label: "Closed won", color: "#15803D", group: "DONE" },
    { value: "CLOSED_LOST", label: "Closed lost", color: "#D92D20", group: "CLOSED" },
  ],
};

let db: ItemTestDb;
const viewer = { userId: "u-me", organizationId: "org-1", orgRole: "MEMBER", isAgent: false, adminScopes: [] } as never;

beforeEach(() => {
  db = installItemTestDb(itemTestDb({ boards: [{ ...SALES }] }));
  db.prisma.organization = { findUnique: async () => ({ settings: {} }) };
  db.prisma.entityLink = { findMany: async () => [{ sourceId: "g-1", targetType: "BOARD", targetId: "b-sales" }] };
  db.prisma.task = { findMany: async () => [] };
  db.prisma.timeEntry = { findMany: async () => [] };
  db.prisma.user = { findMany: async () => [] };
  for (const [id, status] of [["t-1", "LEAD"], ["t-2", "CLOSED_WON"], ["t-3", "CLOSED_LOST"], ["t-4", "CLOSED_WON"]]) {
    db.items.push({
      id, organizationId: "org-1", boardId: "b-sales", status, archivedAt: null, parentItemId: null,
      updatedAt: new Date("2026-10-01T00:00:00Z"), metadata: {}, ownerId: null, assigneeIds: [],
    });
  }
});

describe("goal Effort's done and open tasks", () => {
  it("reads done from the linked List's own status set", async () => {
    const effort = (await computeGoalEffortBatch("org-1", ["g-1"], new Date("2026-10-15T00:00:00Z"), viewer)).get("g-1")!;
    expect(effort).toMatchObject({ tasksDone: 3, tasksOpen: 1 });
  });
});
