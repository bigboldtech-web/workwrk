// A tag save and the task's ARCHIVED tags (MCP step 3 review, low 2, then
// the founder's data-loss rule for the app itself). An archived tag is shown
// nowhere, so the browser's tag pickers (task detail, Kanban, the table)
// send the tags they show, and every save deleted the task's archived-tag
// assignments. updateBoardItem now leaves them as they are for every
// caller; only removeArchivedTags, which nothing passes, drops them.
// Through the real updateBoardItem over a stand-in database. The first test
// fails on the code before: a browser-style save removed the archived tag.

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

describe("a tag save keeps the task's archived tags", () => {
  it("a browser-style save, sending the tags it shows, keeps the archived tag's assignment as it is", async () => {
    await updateBoardItem("t1", { tagIds: ["tag-urgent"] }, "u-max");
    expect(h.deleted).toEqual([]);
    expect(h.assignments.map((a) => a.id)).toEqual(["ta-old", "ta-urgent"]);
  });

  it("changes the tags that are shown to exactly the ones sent, the archived one untouched", async () => {
    await updateBoardItem("t1", { tagIds: ["tag-new"] }, "u-max");
    expect(h.deleted).toEqual(["ta-urgent"]);
    expect(h.created.map((c) => c.tagId)).toEqual(["tag-new"]);
    expect(h.assignments.map((a) => a.id)).toEqual(["ta-old"]);
  });

  it("removeArchivedTags, which no caller passes, is the only way it drops them", async () => {
    await updateBoardItem("t1", { tagIds: ["tag-urgent"] }, "u-max", { removeArchivedTags: true });
    expect(h.deleted).toEqual(["ta-old"]);
  });

  it("tagAssignmentsToRemove keeps what is kept, and the archived ones it is given", () => {
    const existing = [{ tagId: "a" }, { tagId: "b" }, { tagId: "z" }];
    expect(tagAssignmentsToRemove(existing, new Set(["a"]), null)).toEqual([{ tagId: "b" }, { tagId: "z" }]);
    expect(tagAssignmentsToRemove(existing, new Set(["a"]), new Set(["z"]))).toEqual([{ tagId: "b" }]);
  });
});
