// moveToTrash for a Space and a Folder (docs-found fixes batch 3). The Space
// branch locked only the Lists already in the Space and never the Space row,
// then deleted Lists and Folders by spaceId. A List created, moved, restored
// or copied into the Space mid-delete needs only a key-share lock on the
// Space row, so it committed meanwhile: deleted with no copy in the Trash
// snapshot (its tasks cascading), and missed by an Agent's keepTasks count.
// Now the Space row is locked first, then its Folders, then its Lists, and
// every row goes by the ids the capture took. The Folder branch was already
// safe for Lists (its Folders are locked and Board.folderId is a key), but it
// also deleted Lists by folderId; it now goes by the captured ids too.

import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  steps: [] as string[],
  boardDeletes: [] as unknown[],
  folderDeletes: [] as unknown[],
  counted: [] as unknown[],
  tasks: 0,
}));

vi.mock("@/lib/prisma", () => {
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      const table = /FROM "(\w+)"/.exec(sql)?.[1] ?? "?";
      st.steps.push(`lock ${table}${sql.includes('"spaceId"') ? " by space" : sql.includes('"folderId"') ? " by folder" : ""}`);
      if (table === "Board") return [{ id: "b1" }];
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
  return { prisma: { ...tx, $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } };
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
});

describe("moving a Space to Trash", () => {
  it("locks the Space row first, then its Folders, then its Lists and their tasks, before the snapshot", async () => {
    expect(await moveToTrash("space", "s1", { organizationId: "org" })).toBe(true);
    expect(st.steps.slice(0, 4)).toEqual(["lock Space", "lock Folder by space", "lock Board by space", "lock Item"]);
    expect(st.steps.indexOf("snapshot")).toBeGreaterThan(3);
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
    expect(st.steps[0]).toBe("lock Space");
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
