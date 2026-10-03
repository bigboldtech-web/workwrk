// folderSubtree: one Folder of a viewer's Space tree as a tree of its own,
// the cut readableListsInFolder hands readableListsInSpace.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { folderSubtree } from "./space";
import type { FolderNode, ListNode, SpaceTreeResult } from "@/lib/access/node-tree";

function list(id: string): ListNode {
  return { id, slug: id, name: id, icon: null, color: null, visibility: "WORKSPACE", ownerId: null, settings: null, role: "view" };
}

function folder(id: string, boards: ListNode[], childFolders: FolderNode[] = []): FolderNode {
  return {
    id,
    name: id,
    icon: null,
    color: null,
    position: 0,
    visibility: "WORKSPACE",
    ownerId: null,
    role: "view",
    path: false,
    _count: { boards: boards.length, childFolders: childFolders.length },
    childFolders,
    boards,
  } as FolderNode;
}

const C = folder("C", [list("c1")]);
const B = folder("B", [list("b1"), list("b2")], [C]);
const A = folder("A", [list("a1")], [B]);
const D = folder("D", [list("d1")]);
const TREE = {
  spaceRole: "view",
  access: "member",
  privateRule: "legacy",
  folders: [A, D],
  boards: [list("root1")],
  tables: [],
  docs: [{ id: "doc1", title: "Doc", role: "view" }],
  whiteboards: [],
} as unknown as SpaceTreeResult;

describe("folderSubtree", () => {
  it("finds a Folder at any depth and keeps only it, with everything below it", () => {
    const sub = folderSubtree(TREE, "B")!;
    expect(sub.folders).toEqual([B]);
    expect(sub.folders[0].childFolders).toEqual([C]);
    // Nothing beside or above it: no root Lists, no sibling Folder, no docs.
    expect(sub.boards).toEqual([]);
    expect(sub.docs).toEqual([]);
    expect(sub.folders.map((f) => f.id)).not.toContain("D");
    // The viewer's standing in the Space is carried as it was.
    expect(sub.spaceRole).toBe("view");
    expect(folderSubtree(TREE, "C")!.folders).toEqual([C]);
    expect(folderSubtree(TREE, "D")!.folders).toEqual([D]);
  });

  it("is null for a Folder the viewer's tree does not carry", () => {
    expect(folderSubtree(TREE, "nope")).toBeNull();
    expect(folderSubtree({ ...TREE, folders: [] }, "A")).toBeNull();
  });
});
