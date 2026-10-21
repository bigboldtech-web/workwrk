// The description check UNDER THE LOCK (docs/plans/mcp-server.md 4.3
// update_task; step 3 review, low 15). Through the real patchItemAs and the
// real updateBoardItem (board-items.ts), over a stand-in database that
// plays the row lock: the save is computed from the row read before, then
// written in a transaction that locks the row (SELECT ... FOR UPDATE) and
// writes only while it still holds what the save was computed from. Here
// somebody else's edit lands between the two: the lock sees it, the save is
// computed again from their text, the text no longer matches
// expectDescription, and nothing is written. Fails on the code before step
// 3: expectDescription was dropped and the save went through on the retry.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** The row's metadata as each read finds it, in order; the last one repeats. */
  reads: [] as Array<Record<string, unknown>>,
  /** What the lock finds. */
  locked: {} as Record<string, unknown>,
  updates: [] as Array<Record<string, unknown>>,
  lockedReads: 0,
}));

vi.mock("@/lib/prisma", () => {
  const row = (metadata: Record<string, unknown>) => ({
    id: "t1", organizationId: "org", boardId: "b1", title: "Ship it", status: "TO_DO", ownerId: null, assigneeIds: [], priority: null, startAt: null, dueAt: null,
    itemTypeId: null, recurRule: null, metadata, groupKey: null, position: 0, archivedAt: null, createdAt: new Date(0), updatedAt: new Date(0), parentItemId: null,
  });
  const next = () => (h.reads.length > 1 ? h.reads.shift()! : h.reads[0]);
  const tx = {
    $queryRaw: async () => {
      h.lockedReads += 1;
      return [{ metadata: h.locked }];
    },
    item: {
      update: async (a: { data: Record<string, unknown> }) => {
        h.updates.push(a.data);
        return { ...row(a.data.metadata as Record<string, unknown>), board: { spaceId: null } };
      },
    },
  };
  return {
    prisma: {
      item: { findUnique: async () => row(next()) },
      board: { findUnique: async () => ({ schema: { fields: [] } }), findFirst: async () => null },
      organization: { findUnique: async () => ({ settings: {} }) },
      user: { findUnique: async () => null },
      tagAssignment: { findMany: async () => [] },
      itemActivity: { create: async () => ({}) },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});
vi.mock("@/lib/item-gate", () => ({
  gateItem: async () => ({
    item: {
      id: "t1", organizationId: "org", boardId: "b1", title: "Ship it", status: "TO_DO", ownerId: null, assigneeIds: [], priority: null, dueAt: null, startAt: null,
      recurRule: null, metadata: { description: "Old" }, board: { id: "b1", name: "Launch", statuses: null, schema: { fields: [] }, archivedAt: null },
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
  h.updates = [];
  h.lockedReads = 0;
});

describe("expectDescription under the row lock", () => {
  it("an edit that lands between the read and the lock: the lock sees it, the save is made again from it, and nothing is written", async () => {
    h.reads = [{ description: "Old" }, { description: "Old\n\nOlivia's line" }];
    h.locked = { description: "Old\n\nOlivia's line" };
    const res = await patchItemAs(C, "t1", { metadataPatch: { description: "Old\n\nNew" }, expectDescription: "Old" });
    expect([res.status, await res.json()]).toEqual([409, { error: "description_changed" }]);
    expect(h.lockedReads).toBe(1);
    expect(h.updates).toEqual([]);
  });

  it("guard: with the row still as read, the addition is written once, in the locked transaction", async () => {
    h.reads = [{ description: "Old" }];
    h.locked = { description: "Old" };
    const res = await patchItemAs(C, "t1", { metadataPatch: { description: "Old\n\nNew" }, expectDescription: "Old" });
    expect(res.status).not.toBe(409);
    expect(h.updates).toHaveLength(1);
    expect((h.updates[0].metadata as Record<string, unknown>).description).toBe("Old\n\nNew");
  });
});
