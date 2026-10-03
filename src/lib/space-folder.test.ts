// folderShelfOrder: a Folder and the live Folders below it in the sidebar's
// walk, the order readableFolderLists puts a Folder's Lists in.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { folderShelfOrder } from "./space";

const f = (id: string, parentFolderId: string | null, position: number, name = id) => ({ id, parentFolderId, position, name });

describe("folderShelfOrder", () => {
  // Space: A { C { G }, B }, D. B sits before C by position.
  const FOLDERS = [f("A", null, 0), f("C", "A", 2), f("G", "C", 0), f("B", "A", 1), f("D", null, 1)];

  it("walks each Folder's sub-folders first, depth first by position, then the Folder itself", () => {
    expect(folderShelfOrder(FOLDERS, "A")).toEqual(["B", "G", "C", "A"]);
    expect(folderShelfOrder(FOLDERS, "C")).toEqual(["G", "C"]);
    expect(folderShelfOrder(FOLDERS, "D")).toEqual(["D"]);
  });

  it("breaks a position tie by name, as the sidebar does", () => {
    const tied = [f("A", null, 0), f("z", "A", 0, "Zeta"), f("y", "A", 0, "Alpha")];
    expect(folderShelfOrder(tied, "A")).toEqual(["y", "z", "A"]);
  });

  it("leaves out the Space's other Folders, and an archived sub-folder with everything below it", () => {
    // C archived: absent from the live Folders, so G (whose parent is C) is
    // unreachable from A, exactly as the page's own walk skips it.
    const live = FOLDERS.filter((x) => x.id !== "C");
    expect(folderShelfOrder(live, "A")).toEqual(["B", "A"]);
  });

  it("still answers for a Folder whose own parent is archived: the walk starts at it", () => {
    const live = FOLDERS.filter((x) => x.id !== "A");
    expect(folderShelfOrder(live, "C")).toEqual(["G", "C"]);
  });

  it("never loops on a cycle in bad data", () => {
    const cyclic = [f("A", "B", 0), f("B", "A", 0)];
    expect(folderShelfOrder(cyclic, "A")).toEqual(["B", "A"]);
  });
});
