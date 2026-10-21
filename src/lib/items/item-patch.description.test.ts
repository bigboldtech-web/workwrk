// PATCH /api/items/[id]'s description check (docs/plans/mcp-server.md 4.3
// update_task, step 3 test "item-patch: an expectDescription mismatch
// answers 409 and writes nothing"). A writer that adds to a description
// sends the text it read as expectDescription; the save is made only while
// the stored row still holds exactly that text, compared on the value the
// save is computed from (updateBoardItem's metadataFn, run on the locked,
// compare-and-swapped row). Through the real patchItemAs; the gate, the
// writer and the event and notice side effects are stand-ins. Fails on the
// code before step 3: expectDescription was dropped by the body's schema and
// the save went through.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** The task row as stored. */
  stored: { description: "Old" } as Record<string, unknown>,
  /** What the gate read (a moment before the write). */
  gateRead: { description: "Old" } as Record<string, unknown>,
  writes: [] as Array<Record<string, unknown>>,
  options: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    board: { findUnique: async () => ({ schema: { fields: [] } }), findFirst: async () => null },
    organization: { findUnique: async () => ({ settings: {} }) },
  },
}));
vi.mock("@/lib/item-gate", () => ({
  gateItem: async () => ({
    item: {
      id: "t1", organizationId: "org", boardId: "b1", title: "Ship it", status: "TO_DO", ownerId: null, assigneeIds: [], priority: null, dueAt: null, startAt: null,
      recurRule: null, metadata: h.gateRead, board: { id: "b1", name: "Launch", statuses: null, schema: { fields: [] }, archivedAt: null },
    },
    decision: { role: "EDIT", roleBeforeArchive: "EDIT" },
    creatorId: null, isCreator: false, watcherIds: [], unwatcherIds: [], viaLinkedList: null, canAddToList: true, canManageList: false,
  }),
}));
vi.mock("@/lib/board-items", async () => ({
  PRIORITY_OPTIONS: (await import("@/lib/board-items-shared")).PRIORITY_OPTIONS,
  // As the real one: the metadata computed from the STORED value, and written only once it is computed.
  updateBoardItem: async (_id: string, patch: Record<string, unknown>, _actor: string, opts: { metadataFn?: (s: Record<string, unknown>) => Promise<unknown>; keepArchivedTags?: boolean }) => {
    h.options.push({ keepArchivedTags: opts.keepArchivedTags ?? false });
    const metadata = opts.metadataFn ? await opts.metadataFn({ ...h.stored }) : undefined;
    h.writes.push({ ...patch, ...(metadata ? { metadata } : {}) });
    if (metadata) h.stored = metadata as Record<string, unknown>;
    return { id: "t1", title: patch.title ?? "Ship it", status: "TO_DO", ownerId: null, assigneeIds: [], priority: null, dueAt: null, startAt: null, metadata: h.stored, updatedAt: new Date() };
  },
  getBoardItemRow: async () => ({ id: "t1", metadata: h.stored }),
  moveBoardItem: async () => undefined,
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
const send = async (body: Record<string, unknown>) => {
  const res = await patchItemAs(C, "t1", body);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

beforeEach(() => {
  h.stored = { description: "Old" };
  h.gateRead = { description: "Old" };
  h.writes = [];
  h.options = [];
});

describe("expectDescription", () => {
  it("answers 409 description_changed and writes nothing when the task holds other text", async () => {
    const r = await send({ title: "Ship it now", metadataPatch: { description: "Older\n\nNew" }, expectDescription: "Older" });
    expect(r).toEqual({ status: 409, body: { error: "description_changed" } });
    expect(h.writes).toEqual([]);
    expect(h.stored).toEqual({ description: "Old" });
  });

  it("compares on the stored value the save is made from: text saved after the gate read answers 409 and writes nothing", async () => {
    h.stored = { description: "Old\n\nOlivia's line" };
    const r = await send({ metadataPatch: { description: "Old\n\nNew" }, expectDescription: "Old" });
    expect(r).toEqual({ status: 409, body: { error: "description_changed" } });
    expect(h.writes).toEqual([]);
  });

  it("reads an absent description as empty, so an empty one is set", async () => {
    h.stored = {};
    h.gateRead = {};
    expect((await send({ metadataPatch: { description: "First" }, expectDescription: "" })).status).toBe(200);
    expect(h.stored).toMatchObject({ description: "First" });
    expect((await send({ metadataPatch: { description: "x" }, expectDescription: "First " })).status).toBe(409);
  });

  it("guard: writes the addition when the task still holds the text it was made from", async () => {
    const r = await send({ metadataPatch: { description: "Old\n\nNew" }, expectDescription: "Old" });
    expect(r.status).toBe(200);
    expect(h.writes).toHaveLength(1);
    expect(h.stored).toMatchObject({ description: "Old\n\nNew" });
    expect(h.writes[0]).not.toHaveProperty("expectDescription");
  });

  it("guard: without it, a description save is made as before", async () => {
    h.stored = { description: "Changed by someone" };
    expect((await send({ metadataPatch: { description: "Mine" } })).status).toBe(200);
    expect(h.stored).toMatchObject({ description: "Mine" });
  });
});

// The step 3 review (2026-10-22), lows 4 and 2.
describe("the review's fixes", () => {
  it("never matches a description saved as anything but text, so an addition never replaces it", async () => {
    h.stored = { description: { type: "doc", content: [] } };
    h.gateRead = { description: { type: "doc", content: [] } };
    expect(await send({ metadataPatch: { description: "New" }, expectDescription: "" })).toEqual({ status: 409, body: { error: "description_changed" } });
    expect(h.writes).toEqual([]);
  });

  it("hands keepArchivedTags to the write only when a caller passes it, never from the request body", async () => {
    await send({ tagIds: [], keepArchivedTags: true });
    await patchItemAs(C, "t1", { tagIds: [] }, { keepArchivedTags: true });
    expect(h.options).toEqual([{ keepArchivedTags: false }, { keepArchivedTags: true }]);
  });
});
