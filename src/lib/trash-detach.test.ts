import { describe, expect, it, vi } from "vitest";

// Pen test 2026-11-28, V-40: a subtask moved to another List was deleted
// with its parent (and, in a List delete, left out of the Trash snapshot).

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { relinkDetached } = await import("./trash");

type Row = { id: string; parentItemId: string | null };

function fakeDb(rows: Row[]) {
  const byId = new Map(rows.map((r) => [r.id, { ...r }]));
  return {
    rows: byId,
    item: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const r = byId.get(where.id);
        return r ? { id: r.id, parentItemId: r.parentItemId } : null;
      },
      updateMany: async ({ where, data }: { where: { id: string; parentItemId: null }; data: { parentItemId: string } }) => {
        const r = byId.get(where.id);
        if (!r || r.parentItemId !== null) return { count: 0 };
        r.parentItemId = data.parentItemId;
        return { count: 1 };
      },
    },
  };
}

describe("relinkDetached", () => {
  it("puts a released subtask back under its restored parent", async () => {
    const db = fakeDb([{ id: "parent", parentItemId: null }, { id: "moved", parentItemId: null }]);
    await relinkDetached(db as never, [{ id: "moved", parentItemId: "parent" }]);
    expect(db.rows.get("moved")?.parentItemId).toBe("parent");
  });

  it("leaves a subtask someone gave another parent meanwhile, and skips a parent that is not back", async () => {
    const db = fakeDb([{ id: "parent", parentItemId: null }, { id: "moved", parentItemId: "other" }, { id: "lone", parentItemId: null }]);
    await relinkDetached(db as never, [{ id: "moved", parentItemId: "parent" }, { id: "lone", parentItemId: "gone" }]);
    expect(db.rows.get("moved")?.parentItemId).toBe("other");
    expect(db.rows.get("lone")?.parentItemId).toBeNull();
  });

  it("never makes a loop: a parent filed under the task meanwhile leaves the task where it is (the step 7 review)", async () => {
    // P was trashed and C let go; then P's old parent Q was filed under C.
    const db = fakeDb([{ id: "P", parentItemId: "Q" }, { id: "Q", parentItemId: "C" }, { id: "C", parentItemId: null }]);
    await relinkDetached(db as never, [{ id: "C", parentItemId: "P" }]);
    expect(db.rows.get("C")?.parentItemId).toBeNull();
  });
});
