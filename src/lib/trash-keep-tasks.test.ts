// moveToTrash's keepTasks (docs-found fixes batch 2): for a List, Folder or
// Space, count the tasks under the same locks the delete takes, and refuse
// with TrashHoldsTasks before anything is written. The Agent tier deletes
// with it on (src/lib/access/container-trash.ts).

import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ tasks: 0, counted: [] as unknown[], trashRows: 0, deletes: 0, locks: [] as string[] }));

vi.mock("@/lib/prisma", () => {
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      st.locks.push(sql);
      if (sql.includes('FROM "Board"')) return [{ id: "b1" }, { id: "b2" }];
      return [];
    },
    item: { count: async (a: unknown) => { st.counted.push(a); return st.tasks; } },
    // The capture finds nothing, so a delete that passes the guard ends there.
    board: { findUnique: async () => null, delete: async () => { st.deletes += 1; return {}; } },
    folder: { findUnique: async () => null },
    space: { findUnique: async () => null },
    trashItem: { create: async () => { st.trashRows += 1; return {}; } },
  };
  return { prisma: { ...tx, $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } };
});
vi.mock("@/lib/list-links-server", () => ({ listLinksAvailable: async () => false, captureListLinks: async () => [], reconcileListLinks: async () => undefined }));
vi.mock("@/lib/access/node-placement", () => ({
  canvasesHaveFolders: async () => false,
  lockFolderBranch: async () => ["f1", "f2"],
  folderBranch: async () => ["f1", "f2"],
}));

import { moveToTrash, TrashHoldsTasks } from "./trash";

beforeEach(() => { st.tasks = 0; st.counted = []; st.trashRows = 0; st.deletes = 0; st.locks = []; });

describe("moveToTrash keepTasks", () => {
  it("refuses a List, Folder or Space that holds a task, after the locks and before any write", async () => {
    st.tasks = 4;
    for (const kind of ["board", "folder", "space"] as const) {
      const err = await moveToTrash(kind, "x", { organizationId: "org", keepTasks: true }).catch((e: unknown) => e);
      expect(err, kind).toBeInstanceOf(TrashHoldsTasks);
      expect((err as TrashHoldsTasks).tasks).toBe(4);
    }
    // Counted over exactly the Lists the delete locks (and would remove).
    expect(st.counted[0]).toEqual({ where: { boardId: { in: ["b1", "b2"] } } });
    expect(st.trashRows).toBe(0);
    expect(st.deletes).toBe(0);
  });

  it("goes on when nothing in it is a task, and never counts without keepTasks", async () => {
    expect(await moveToTrash("board", "b1", { organizationId: "org", keepTasks: true })).toBe(false);
    expect(st.counted).toHaveLength(1);
    st.tasks = 9;
    expect(await moveToTrash("board", "b1", { organizationId: "org" })).toBe(false);
    expect(st.counted).toHaveLength(1);
  });
});
