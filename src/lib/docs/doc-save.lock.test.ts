// A doc save (src/lib/docs/doc-save.ts) decides its conflict check, its
// version number and what a partial save keeps from the row read under its
// lock, in the transaction that writes: never from the copy read before it.

import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  // What the save read first, and what the row holds once it has the lock
  // (another save, by the person or their AI teammate, landed in between).
  early: { title: "Plan", content: { blocks: ["old"] }, updatedAt: new Date("2026-10-06T08:00:00Z") },
  live: { title: "Plan", content: { blocks: ["theirs"] }, updatedAt: new Date("2026-10-06T08:00:05Z") },
  lastVersion: 7,
  steps: [] as string[],
  versions: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/doc-access", () => ({ docAccess: async () => ({ unlockedRole: "EDIT", locked: false, canManage: false }) }));
vi.mock("@/lib/access/node-access", () => ({ nodeCtxFromLevel: () => ({}), canReadDocPlace: async () => true }));
vi.mock("@/lib/access/node-placement", () => ({
  checkMove: async () => ({ ok: true }),
  docAnchorPlaceOf: async () => null,
  docHomeOf: async () => null,
  docPlaceLive: async () => true,
  writeDocTreeMove: async () => ({ ok: true }),
}));
vi.mock("@/lib/doc-link-extract", () => ({ syncLinksFromBlocks: async () => {} }));
vi.mock("@/lib/prisma", () => {
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      db.steps.push(strings.join("?").includes("FOR UPDATE") ? "lock" : "raw");
      return [{ "?column?": 1 }];
    },
    doc: {
      findUnique: async () => { db.steps.push("read live"); return db.live; },
      update: async (a: { data: Record<string, unknown> }) => {
        db.steps.push("update");
        db.updates.push(a.data);
        return { id: "d1", title: a.data.title, content: a.data.content, excerpt: null, updatedAt: new Date("2026-10-06T08:00:09Z") };
      },
    },
    docVersion: {
      findFirst: async () => { db.steps.push("last version"); return { version: db.lastVersion }; },
      create: async (a: { data: Record<string, unknown> }) => { db.steps.push("version"); db.versions.push(a.data); return {}; },
    },
  };
  return {
    prisma: {
      doc: { findFirst: async () => ({ id: "d1", archivedAt: null, entityType: "SPACE", entityId: "s1", createdById: "u0", parentId: null, ...db.early }), update: tx.doc.update },
      docVersion: tx.docVersion,
      // An interactive transaction, or (as the save did before) a batch.
      $transaction: async (fn: ((t: typeof tx) => unknown) | Promise<unknown>[]) => (Array.isArray(fn) ? Promise.all(fn) : fn(tx)),
    },
  };
});

import { saveDocAs } from "./doc-save";

// The access checks are mocked, so the person's level is never read here.
const ctx = { userId: "me", orgId: "org" } as never;

beforeEach(() => {
  db.lastVersion = 7;
  db.steps = [];
  db.versions = [];
  db.updates = [];
});

describe("saveDocAs under the doc's lock", () => {
  it("refuses a save another save beat, by the row it reads under the lock", async () => {
    // Before: the early read passed the check and this save overwrote theirs.
    const res = await saveDocAs(ctx, "d1", { content: { blocks: ["mine"] }, knownUpdatedAt: "2026-10-06T08:00:00.000Z" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "conflict", liveUpdatedAt: "2026-10-06T08:00:05.000Z" });
    expect(db.versions).toEqual([]);
    expect(db.updates).toEqual([]);
  });

  it("keeps the content saved in between when only the title changes", async () => {
    // Before: the early read's content went back, wiping the other save.
    const res = await saveDocAs(ctx, "d1", { title: "Plan B" });
    expect(res.status).toBe(200);
    expect(db.updates[0]).toMatchObject({ title: "Plan B", content: { blocks: ["theirs"] } });
  });

  it("takes the next version number after the lock, in the same transaction as the writes", async () => {
    const res = await saveDocAs(ctx, "d1", { content: { blocks: ["mine"] }, knownUpdatedAt: "2026-10-06T08:00:05.000Z" });
    expect(res.status).toBe(200);
    expect(db.steps).toEqual(["lock", "read live", "last version", "version", "update"]);
    expect(db.versions[0]).toMatchObject({ version: 8, content: { blocks: ["mine"] }, authorId: "me" });
    expect(await res.json()).toMatchObject({ version: 8, doc: { id: "d1" } });
  });
});
