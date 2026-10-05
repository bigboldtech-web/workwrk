// Trashing a Files folder (src/lib/trash.ts moveToTrash "file_folder")
// removes exactly what its snapshot holds: a file uploaded or moved into the
// folder after the capture is in no snapshot, so it must stay (its folder's
// SetNull keeps it at the Files root) rather than be deleted for good.

import { beforeEach, describe, expect, it, vi } from "vitest";

type File = { id: string; folderId: string | null };
const db = vi.hoisted(() => ({
  folders: [] as Array<{ id: string; parentId: string | null; name: string }>,
  files: [] as File[],
  trash: [] as Array<Record<string, unknown>>,
  // Runs after the capture and before the delete: the race.
  between: null as null | (() => void),
}));

vi.mock("@/lib/prisma", () => {
  const matches = (f: File, where: { id?: { in: string[] }; folderId?: { in: string[] } }) =>
    (!where.id || where.id.in.includes(f.id)) && (!where.folderId || (f.folderId !== null && where.folderId.in.includes(f.folderId)));
  const tx = {
    fileEntry: {
      deleteMany: async (a: { where: { id?: { in: string[] }; folderId?: { in: string[] } } }) => {
        const gone = db.files.filter((f) => matches(f, a.where));
        db.files = db.files.filter((f) => !gone.includes(f));
        return { count: gone.length };
      },
    },
    fileFolder: {
      deleteMany: async (a: { where: { id: { in: string[] } } }) => {
        db.folders = db.folders.filter((f) => !a.where.id.in.includes(f.id));
        // onDelete SetNull: what still names a removed folder drops to the root.
        for (const f of db.files) if (f.folderId && !db.folders.some((d) => d.id === f.folderId)) f.folderId = null;
        return { count: 1 };
      },
    },
  };
  return {
    prisma: {
      fileFolder: {
        findUnique: async (a: { where: { id: string } }) => db.folders.find((f) => f.id === a.where.id) ?? null,
        findMany: async (a: { where: { parentId: { in: string[] } } }) => db.folders.filter((f) => f.parentId && a.where.parentId.in.includes(f.parentId)),
      },
      fileEntry: {
        findMany: async (a: { where: { folderId: { in: string[] } } }) => db.files.filter((f) => f.folderId && a.where.folderId.in.includes(f.folderId)).map((f) => ({ ...f })),
      },
      trashItem: {
        create: async (a: { data: Record<string, unknown> }) => {
          db.trash.push(a.data);
          db.between?.();
          return {};
        },
      },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

import { moveToTrash } from "./trash";

beforeEach(() => {
  db.folders = [
    { id: "root", parentId: null, name: "Contracts" },
    { id: "sub", parentId: "root", name: "2026" },
  ];
  db.files = [
    { id: "a", folderId: "root" },
    { id: "b", folderId: "sub" },
    { id: "elsewhere", folderId: null },
  ];
  db.trash = [];
  db.between = null;
});

describe("moveToTrash file_folder", () => {
  it("removes the folder, its sub-folders and the files the snapshot holds", async () => {
    expect(await moveToTrash("file_folder", "root", { organizationId: "org" })).toBe(true);
    expect(db.folders).toEqual([]);
    expect(db.files.map((f) => f.id)).toEqual(["elsewhere"]);
    const snap = db.trash[0].snapshot as { children: { files: File[] } };
    expect(snap.children.files.map((f) => f.id).sort()).toEqual(["a", "b"]);
  });

  it("keeps a file that lands in the folder after the capture, at the Files root", async () => {
    // Before: the delete went by folder and took this file with no snapshot of it.
    db.between = () => db.files.push({ id: "late", folderId: "sub" });
    await moveToTrash("file_folder", "root", { organizationId: "org" });
    expect(db.files).toEqual([{ id: "elsewhere", folderId: null }, { id: "late", folderId: null }]);
  });

  it("leaves a captured file where it was moved meanwhile", async () => {
    db.between = () => {
      const a = db.files.find((f) => f.id === "a");
      if (a) a.folderId = null;
    };
    await moveToTrash("file_folder", "root", { organizationId: "org" });
    expect(db.files.map((f) => f.id).sort()).toEqual(["a", "elsewhere"]);
  });
});
