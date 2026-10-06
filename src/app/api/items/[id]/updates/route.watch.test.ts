// A comment's auto-watch (POST /api/items/[id]/updates) changes only the
// watcher lists, on the task's metadata as it is NOW: read again under the
// row's lock, never the copy the gate read before the comment was written.

import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  // What the gate read, and what the row holds by the time the comment lands
  // (a field saved in between, by the person or their AI teammate).
  gateMetadata: { watchers: [] as string[] } as Record<string, unknown>,
  liveMetadata: { watchers: [] as string[], budget: 42 } as Record<string, unknown>,
  locked: [] as string[],
  writes: [] as Array<Record<string, unknown>>,
  notified: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/item-gate", () => ({
  // The gate is mocked, so the person's level is never read here.
  itemCtx: async () => ({ userId: "me", organizationId: "org", userName: "Max" }),
  gateItem: async () => ({ item: { id: "i1", title: "Call Acme", dueAt: null, metadata: db.gateMetadata, assigneeIds: [], boardId: "b1" } }),
}));
vi.mock("@/lib/item-thread", () => ({ createUpdate: async () => ({ id: "u1" }), listUpdates: async () => [], listUpdatesAround: async () => [], logActivity: async () => {} }));
vi.mock("@/lib/notify-prefs", () => ({ filterNotifyUsers: async (ids: string[]) => ids }));
vi.mock("@/lib/notify-item", () => ({
  notifyItemCommented: async (a: Record<string, unknown>) => { db.notified.push(a); },
  taskReaders: async () => [],
}));
vi.mock("@/lib/notify-realtime", () => ({ publishItemChanged: async () => {} }));
vi.mock("@/lib/entity-link", () => ({ createEntityLink: async () => {} }));
vi.mock("@/lib/file-access", () => ({ readableFileIds: async () => [] }));
vi.mock("@/lib/prisma", () => {
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      db.locked.push(strings.join("?"));
      return [{ metadata: db.liveMetadata }];
    },
    item: { update: async (a: { data: { metadata: Record<string, unknown> } }) => { db.writes.push(a.data.metadata); return {}; } },
  };
  return { prisma: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx), item: tx.item, user: { findMany: async () => [] } } };
});

import { POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/items/i1/updates", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "i1" }) });

beforeEach(() => {
  db.gateMetadata = { watchers: [] };
  db.liveMetadata = { watchers: [], budget: 42 };
  db.locked = [];
  db.writes = [];
  db.notified = [];
});

describe("POST /api/items/[id]/updates auto-watch", () => {
  it("adds the commenter to the watchers of the task as it is now, under the row lock, keeping a field saved since the gate", async () => {
    const res = await post({ body: "On it" });
    expect(res.status).toBe(201);
    expect(db.locked[0]).toMatch(/FOR UPDATE/);
    // Before: the gate's copy went back whole, and budget 42 was lost.
    expect(db.writes).toEqual([{ watchers: ["me"], unwatchers: [], budget: 42 }]);
    expect((db.notified[0].metadata as Record<string, unknown>).watchers).toEqual(["me"]);
  });

  it("writes nothing when the commenter already watches the task now", async () => {
    db.liveMetadata = { watchers: ["me"], budget: 42 };
    await post({ body: "Again" });
    expect(db.writes).toEqual([]);
  });

  it("never subscribes someone who unwatched since the gate read the task", async () => {
    db.liveMetadata = { watchers: [], unwatchers: ["me"] };
    await post({ body: "Quiet" });
    expect(db.writes).toEqual([]);
  });
});
