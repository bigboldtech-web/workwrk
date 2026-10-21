// A tag write and the task's ARCHIVED tags (docs/plans/mcp-server.md step 3
// review, low 2: data loss). An archived tag is shown nowhere, so a writer
// that sends the tags it sees cannot send it, and the diff removed its
// assignment. With keepArchivedTags (the MCP server's update_task) the
// archived assignment stays exactly as it is. Through the real
// updateBoardItem over a stand-in database. Fails on the code before the
// review: there was no keepArchivedTags and no tagAssignmentsToRemove.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Assignment = { id: string; tagId: string; entityType: string; entityId: string };

const h = vi.hoisted(() => ({
  tags: [
    { id: "tag-old", name: "old", color: null, archived: true, organizationId: "org" },
    { id: "tag-urgent", name: "urgent", color: null, archived: false, organizationId: "org" },
    { id: "tag-new", name: "new", color: null, archived: false, organizationId: "org" },
  ],
  assignments: [] as Assignment[],
  deleted: [] as string[],
  created: [] as Array<{ tagId: string }>,
}));

vi.mock("@/lib/prisma", () => {
  const tagOf = (id: string) => h.tags.find((t) => t.id === id)!;
  const row = { id: "t1", organizationId: "org", boardId: "b1", title: "Ship it", status: "TO_DO", ownerId: null, assigneeIds: [], priority: null, startAt: null, dueAt: null, itemTypeId: null, recurRule: null, metadata: {}, groupKey: null, position: 0, archivedAt: null, createdAt: new Date(0), updatedAt: new Date(0), parentItemId: null };
  return {
    prisma: {
      item: { findUnique: async () => ({ ...row }), update: async () => ({ ...row, board: { spaceId: null } }) },
      user: { findUnique: async () => null },
      tag: { findMany: async (a: { where: { id: { in: string[] }; archived: boolean } }) => h.tags.filter((t) => a.where.id.in.includes(t.id) && t.archived === a.where.archived) },
      tagAssignment: {
        findMany: async (a: { where: { entityId: string | { in: string[] } } }) => {
          const ids = typeof a.where.entityId === "string" ? [a.where.entityId] : a.where.entityId.in;
          return h.assignments.filter((e) => ids.includes(e.entityId)).map((e) => ({ ...e, tag: tagOf(e.tagId) }));
        },
        createMany: async (a: { data: Array<{ tagId: string }> }) => void h.created.push(...a.data),
        deleteMany: async (a: { where: { id: { in: string[] } } }) => {
          h.deleted.push(...a.where.id.in);
          h.assignments = h.assignments.filter((e) => !a.where.id.in.includes(e.id));
        },
      },
      itemActivity: { create: async () => ({}) },
    },
  };
});

import { tagAssignmentsToRemove, updateBoardItem } from "./board-items";

beforeEach(() => {
  h.assignments = [
    { id: "ta-old", tagId: "tag-old", entityType: "BOARD_ITEM", entityId: "t1" },
    { id: "ta-urgent", tagId: "tag-urgent", entityType: "BOARD_ITEM", entityId: "t1" },
  ];
  h.deleted = [];
  h.created = [];
});

describe("keepArchivedTags", () => {
  it("leaves an archived tag's assignment as it is, and changes the rest to the tags sent", async () => {
    await updateBoardItem("t1", { tagIds: ["tag-new"] }, "u-max", { keepArchivedTags: true });
    expect(h.deleted).toEqual(["ta-urgent"]);
    expect(h.created.map((c) => c.tagId)).toEqual(["tag-new"]);
    expect(h.assignments.map((a) => a.id)).toEqual(["ta-old"]);
  });

  it("guard: without it a tag write is exactly as before (the browser pickers' path, which still drops an archived tag)", async () => {
    await updateBoardItem("t1", { tagIds: ["tag-urgent"] }, "u-max");
    expect(h.deleted).toEqual(["ta-old"]);
  });

  it("tagAssignmentsToRemove keeps what is kept, and archived tags only when asked", () => {
    const existing = [{ tagId: "a" }, { tagId: "b" }, { tagId: "z" }];
    expect(tagAssignmentsToRemove(existing, new Set(["a"]), null)).toEqual([{ tagId: "b" }, { tagId: "z" }]);
    expect(tagAssignmentsToRemove(existing, new Set(["a"]), new Set(["z"]))).toEqual([{ tagId: "b" }]);
  });
});
