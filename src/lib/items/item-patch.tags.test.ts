// A browser's tag save through PATCH /api/items/[id] and the task's
// ARCHIVED tags (the founder's data-loss rule; MCP step 3 review, low 2).
// The tag pickers (task detail, Kanban, the table) send tagIds built from
// the tags the task shows, which never include an archived one. Through the
// real patchItemAs and the real updateBoardItem over a stand-in database:
// the archived tag's assignment is still there after the save. Fails on the
// code before: the save deleted it.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  tags: [
    { id: "tag-old", name: "old", color: null, archived: true, organizationId: "org" },
    { id: "tag-urgent", name: "urgent", color: null, archived: false, organizationId: "org" },
    { id: "tag-new", name: "new", color: null, archived: false, organizationId: "org" },
  ],
  assignments: [] as Array<{ id: string; tagId: string; entityType: string; entityId: string; createdAt: Date }>,
}));

vi.mock("@/lib/prisma", () => {
  const row = {
    id: "t1", organizationId: "org", boardId: "b1", title: "Ship it", status: "TO_DO", ownerId: null, assigneeIds: [], priority: null, startAt: null, dueAt: null,
    itemTypeId: null, recurRule: null, metadata: {}, groupKey: null, position: 0, archivedAt: null, createdAt: new Date(0), updatedAt: new Date(0), parentItemId: null,
  };
  const tagOf = (id: string) => h.tags.find((t) => t.id === id)!;
  return {
    prisma: {
      item: { findUnique: async () => ({ ...row, board: { id: "b1", slug: "b1", name: "Launch", spaceId: null, schema: { fields: [] } } }), update: async () => ({ ...row, board: { spaceId: null } }) },
      board: { findUnique: async () => ({ schema: { fields: [] } }), findFirst: async () => null },
      organization: { findUnique: async () => ({ settings: {} }) },
      user: { findUnique: async () => null },
      tag: { findMany: async (a: { where: { id: { in: string[] }; archived: boolean } }) => h.tags.filter((t) => a.where.id.in.includes(t.id) && t.archived === a.where.archived) },
      tagAssignment: {
        findMany: async (a: { where: { entityId: string | { in: string[] } } }) => {
          const ids = typeof a.where.entityId === "string" ? [a.where.entityId] : a.where.entityId.in;
          return h.assignments.filter((e) => ids.includes(e.entityId)).map((e) => ({ ...e, tag: tagOf(e.tagId) }));
        },
        createMany: async (a: { data: Array<{ tagId: string; entityId: string; entityType: string }> }) => {
          for (const d of a.data) h.assignments.push({ id: `ta-${d.tagId}`, tagId: d.tagId, entityType: d.entityType, entityId: d.entityId, createdAt: new Date() });
        },
        deleteMany: async (a: { where: { id: { in: string[] } } }) => {
          h.assignments = h.assignments.filter((e) => !a.where.id.in.includes(e.id));
        },
      },
      itemActivity: { create: async () => ({}) },
    },
  };
});
vi.mock("@/lib/item-gate", () => ({
  gateItem: async () => ({
    item: {
      id: "t1", organizationId: "org", boardId: "b1", title: "Ship it", status: "TO_DO", ownerId: null, assigneeIds: [], priority: null, dueAt: null, startAt: null,
      recurRule: null, metadata: {}, board: { id: "b1", name: "Launch", statuses: null, schema: { fields: [] }, archivedAt: null },
    },
    decision: { role: "EDIT", roleBeforeArchive: "EDIT" },
    creatorId: null, isCreator: false, watcherIds: [], unwatcherIds: [], viaLinkedList: null, canAddToList: true, canManageList: false,
  }),
}));
vi.mock("@/lib/board", () => ({ canContributeBoard: async () => true, getBoardForReader: async () => null }));
vi.mock("@/lib/assignable", () => ({ unknownUserIds: async () => [] }));
vi.mock("@/lib/item-context", () => ({ linkedContextFor: async () => null }));
vi.mock("@/lib/list-links-server", () => ({ linkedListsOf: async () => ({ links: [] }) }));
vi.mock("@/lib/list-connect-server", () => ({ validateConnectWrites: async () => ({ ok: true, values: {}, keys: [] }) }));
vi.mock("@/services/webhookDispatcher", () => ({ dispatchEvent: async () => undefined }));
vi.mock("@/lib/notify-item", () => ({ notifyItemAssigned: async () => undefined, notifyItemStatusChanged: async () => undefined }));
vi.mock("@/lib/notify-realtime", () => ({ publishItemChanged: async () => undefined }));
vi.mock("@/lib/recurring-tasks", () => ({ advanceSeriesOnComplete: async () => ({ recurred: false }) }));

import { legacyLevelRow } from "@/lib/access/test-fixtures";
import { patchItemAs } from "./item-patch";

const C = { userId: "u-max", ...legacyLevelRow("EMPLOYEE"), organizationId: "org", userName: "Max" };

beforeEach(() => {
  h.assignments = [
    { id: "ta-old", tagId: "tag-old", entityType: "BOARD_ITEM", entityId: "t1", createdAt: new Date(0) },
    { id: "ta-urgent", tagId: "tag-urgent", entityType: "BOARD_ITEM", entityId: "t1", createdAt: new Date(0) },
  ];
});

describe("a browser's tag save", () => {
  it("removing the one tag it shows keeps the task's archived tag", async () => {
    await patchItemAs(C, "t1", { tagIds: [] });
    expect(h.assignments.map((a) => a.id)).toEqual(["ta-old"]);
  });

  it("adding a tag beside the one it shows keeps the archived tag too", async () => {
    await patchItemAs(C, "t1", { tagIds: ["tag-urgent", "tag-new"] });
    expect(h.assignments.map((a) => a.id).sort()).toEqual(["ta-old", "ta-tag-new", "ta-urgent"]);
  });
});
