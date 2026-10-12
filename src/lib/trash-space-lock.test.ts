// moveToTrash for a Space and a Folder (docs-found fixes batch 3). The Space
// branch locked only the Lists already in the Space and never the Space row,
// then deleted Lists and Folders by spaceId. A List created, moved, restored
// or copied into the Space mid-delete needs only a key-share lock on the
// Space row, so it committed meanwhile: deleted with no copy in the Trash
// snapshot (its tasks cascading), and missed by an Agent's keepTasks count.
// Now the Space row is locked, its Folders with it, then its Lists, and
// every row goes by the ids the capture took. The Folder branch was already
// safe for Lists (its Folders are locked and Board.folderId is a key), but it
// also deleted Lists by folderId; it now goes by the captured ids too.
//
// Docs-found fixes batch 4: the Space was locked before its Folders, the
// reverse of every writer into one of its Folders (lockParentFolder, then the
// Space's key), so the two could deadlock. The Folders now come first, then
// the Space and any Folder that joined late, without waiting
// (lockSpaceForDelete), and a busy attempt starts again.

import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  steps: [] as string[],
  boardDeletes: [] as unknown[],
  folderDeletes: [] as unknown[],
  counted: [] as unknown[],
  tasks: 0,
  sql: [] as string[],
  /** Busy answers to give the Space lock, one per attempt, before it is free. */
  spaceBusy: 0,
  transactions: 0,
}));

vi.mock("@/lib/prisma", () => {
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      st.sql.push(sql);
      const table = /FROM "(\w+)"/.exec(sql)?.[1] ?? "?";
      st.steps.push(`lock ${table}${sql.includes('"spaceId"') ? " by space" : sql.includes('"folderId"') ? " by folder" : ""}`);
      if (table === "Space" && st.spaceBusy > 0) {
        st.spaceBusy -= 1;
        // What the adapter raises for a NOWAIT lock another transaction holds.
        throw Object.assign(new Error('Raw query failed. Code: `55P03`. Message: `could not obtain lock on row in relation "Space"`'), { code: "P2010", meta: { code: "55P03" } });
      }
      if (table === "Board") return [{ id: "b1" }];
      if (table === "Folder" && sql.includes("ORDER BY id FOR UPDATE") && !sql.includes("NOWAIT")) return [{ id: "f1" }];
      return [];
    },
    space: {
      findUnique: async () => ({ id: "s1", organizationId: "org", name: "Ops" }),
      findMany: async () => [],
      delete: async () => { st.steps.push("delete Space"); return {}; },
    },
    folder: {
      findUnique: async () => ({ id: "f1", organizationId: "org", spaceId: "s1", name: "Team" }),
      // The capture's read, after the locks: one Folder in the Space.
      findMany: async () => [{ id: "f1", spaceId: "s1" }],
      deleteMany: async (a: unknown) => { st.folderDeletes.push(a); return { count: 1 }; },
    },
    // The capture's read, after the locks: the one List the lock found. A
    // List moved in after it would match a spaceId or folderId delete.
    board: {
      findMany: async () => [{ id: "b1", spaceId: "s1", folderId: "f1" }],
      deleteMany: async (a: unknown) => { st.boardDeletes.push(a); return { count: 1 }; },
    },
    whiteboard: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
    dataTable: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
    dataTableRow: { findMany: async () => [] },
    fileEntry: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
    spaceMember: { findMany: async () => [] },
    folderMember: { findMany: async () => [] },
    item: { findMany: async () => [], count: async (a: unknown) => { st.counted.push(a); return st.tasks; } },
    view: { findMany: async () => [] },
    boardMember: { findMany: async () => [] },
    trashItem: { create: async () => { st.steps.push("snapshot"); return {}; } },
  };
  return { prisma: { ...tx, $transaction: async (fn: (t: typeof tx) => unknown) => { st.transactions += 1; return fn(tx); } } };
});
vi.mock("@/lib/list-links-server", () => ({ listLinksAvailable: async () => false, captureListLinks: async () => [], reconcileListLinks: async () => undefined }));
vi.mock("@/lib/access/node-placement", () => ({
  canvasesHaveFolders: async () => false,
  lockFolderBranch: async () => { st.steps.push("lock Folder branch"); return ["f1"]; },
  folderBranch: async () => [],
}));

import { moveToTrash, TrashHoldsTasks } from "./trash";

beforeEach(() => {
  st.steps = [];
  st.boardDeletes = [];
  st.folderDeletes = [];
  st.counted = [];
  st.tasks = 0;
  st.sql = [];
  st.spaceBusy = 0;
  st.transactions = 0;
});

describe("moving a Space to Trash", () => {
  it("locks its Folders, then the Space row, then any Folder that joined late, then its Lists and their tasks, before the snapshot", async () => {
    expect(await moveToTrash("space", "s1", { organizationId: "org" })).toBe(true);
    expect(st.steps.slice(0, 5)).toEqual(["lock Folder by space", "lock Space", "lock Folder by space", "lock Board by space", "lock Item"]);
    expect(st.steps.indexOf("snapshot")).toBeGreaterThan(4);
  });

  // Docs-found fixes batch 4: the writers' order is a Folder, then the Space.
  it("takes the Folders in id order and waits for them, then never waits for the Space or a late Folder while it holds them", async () => {
    await moveToTrash("space", "s1", { organizationId: "org" });
    const [folders, space, late] = st.sql;
    expect(folders).toMatch(/FROM "Folder" WHERE "spaceId" = \? ORDER BY id FOR UPDATE$/);
    expect(space).toMatch(/FROM "Space" WHERE id = \? FOR UPDATE NOWAIT$/);
    expect(late).toMatch(/FROM "Folder" WHERE "spaceId" = \? AND NOT \(id = ANY\(\?::text\[\]\)\) ORDER BY id FOR UPDATE NOWAIT$/);
  });

  // Docs-found fixes batch 6, from the batch 5 review: the handover's WORK
  // locks the leaver's tasks in id order, and a delete locked them in no
  // order, so the two could deadlock on shared tasks.
  it("locks its Lists and their tasks in id order", async () => {
    await moveToTrash("space", "s1", { organizationId: "org" });
    const board = st.sql.find((q) => q.includes('FROM "Board"'));
    const items = st.sql.find((q) => q.includes('FROM "Item"'));
    expect(board).toMatch(/ORDER BY id FOR UPDATE$/);
    expect(items).toMatch(/FROM "Item" WHERE "boardId" = ANY\(\?::text\[\]\) ORDER BY id FOR UPDATE$/);
  });

  it("starts again, from its Folders, when the Space is busy, and writes nothing on the busy try", async () => {
    st.spaceBusy = 2;
    expect(await moveToTrash("space", "s1", { organizationId: "org" })).toBe(true);
    expect(st.transactions).toBe(3);
    expect(st.steps.filter((x) => x === "snapshot")).toHaveLength(1);
    expect(st.steps.slice(0, 4)).toEqual(["lock Folder by space", "lock Space", "lock Folder by space", "lock Space"]);
  });

  it("gives up after its tries, with the busy error, and writes nothing", async () => {
    st.spaceBusy = 99;
    const err = await moveToTrash("space", "s1", { organizationId: "org" }).catch((e: unknown) => e);
    expect(String((err as Error).message)).toMatch(/could not obtain lock/);
    expect(st.transactions).toBe(4);
    expect(st.steps).not.toContain("snapshot");
  });

  it("deletes the Lists and Folders the capture took, by id, never every row that names the Space", async () => {
    await moveToTrash("space", "s1", { organizationId: "org" });
    expect(st.boardDeletes).toEqual([{ where: { id: { in: ["b1"] } } }]);
    expect(st.folderDeletes).toEqual([{ where: { id: { in: ["f1"] } } }]);
    expect(st.steps.at(-1)).toBe("delete Space");
  });

  it("an Agent's count runs after the Space lock, over exactly the Lists it removes", async () => {
    st.tasks = 50;
    const err = await moveToTrash("space", "s1", { organizationId: "org", keepTasks: true }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TrashHoldsTasks);
    expect(st.steps.slice(0, 2)).toEqual(["lock Folder by space", "lock Space"]);
    // A refusal is no busy row: it is never tried again.
    expect(st.transactions).toBe(1);
    expect(st.counted).toEqual([{ where: { boardId: { in: ["b1"] } } }]);
    expect(st.steps).not.toContain("snapshot");
  });
});

describe("moving a Folder to Trash", () => {
  it("deletes the Lists the capture took, by id, never every List that names one of its Folders", async () => {
    expect(await moveToTrash("folder", "f1", { organizationId: "org" })).toBe(true);
    expect(st.steps[0]).toBe("lock Folder branch");
    expect(st.boardDeletes).toEqual([{ where: { id: { in: ["b1"] } } }]);
    expect(st.folderDeletes).toEqual([{ where: { id: { in: ["f1"] } } }]);
  });
});
