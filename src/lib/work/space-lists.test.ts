// decideSpaceLists answers, for dozens of Lists at once, what the per-List
// helpers answer one List at a time. These tests hold it to that.
//
// The per-List helpers cannot run here (they read Prisma), so the reference
// is the struct each one's loader builds (src/lib/access/legacy-facts.ts):
//   getBoardForReader     loadBoardInputs(folderDepth "shallow"): the List,
//                         its own folder row, the Space
//   the folder-grant door getBoardForReaderOrFolderGrantee: the above, or the
//                         List's folder in the descendant-aware grant set
//   canContributeBoard    loadBoardInputs(folderDepth "none"): no folder
// handed to the same transcriptions. The sweep walks every combination of
// the facts those branches read; the named cases below it pin the product
// rules in words, so a regression reads as the rule it broke.

import { describe, expect, it } from "vitest";
import { legacyAllows, type LegacyInputs, type LegacySpace, type SpaceRoleValue, type VisibilityValue } from "@/lib/access/parity";
import { decideSpaceLists, orderListsLikeSidebar, type SpaceTreeBoard, type SpaceTreeFolder } from "./space-lists";

const ME = "u-me";
const OTHER = "u-other";
const ORG = "org-1";

function space(visibility: VisibilityValue, memberRole: SpaceRoleValue | null): LegacySpace {
  return { id: "s-1", organizationId: ORG, visibility, ownerId: OTHER, memberRole };
}

function viewer(level: string) {
  return { userId: ME, organizationId: ORG, accessLevel: level };
}

type Board = SpaceTreeBoard & { name: string };

/** What the per-List helpers answer for one List, from their loaders' structs. */
function reference(
  level: string,
  sp: LegacySpace,
  board: Board,
  folder: SpaceTreeFolder | null,
  granted: ReadonlySet<string>,
): { read: boolean; write: boolean } {
  const base: LegacyInputs = { userId: ME, organizationId: ORG, accessLevel: level, space: sp };
  const legacyBoard = {
    id: board.id,
    organizationId: ORG,
    spaceId: sp.id,
    folderId: board.folderId,
    visibility: board.visibility as VisibilityValue,
    ownerId: board.ownerId,
    memberRole: board.memberRole,
  };
  const legacyFolder = folder
    ? {
        id: folder.id,
        organizationId: ORG,
        spaceId: sp.id,
        parentFolderId: folder.parentFolderId,
        visibility: folder.visibility as VisibilityValue,
        ownerId: folder.ownerId,
        memberRole: null,
      }
    : null;
  const reader = legacyAllows({ ...base, board: legacyBoard, folder: legacyFolder }, "getBoardForReader");
  const grantee = board.folderId !== null && granted.has(board.folderId);
  return {
    read: reader || grantee,
    write: legacyAllows({ ...base, board: legacyBoard }, "canContributeBoard"),
  };
}

const LEVELS = ["COMPANY_ADMIN", "EMPLOYEE", "MANAGER"];
const VIS: VisibilityValue[] = ["PRIVATE", "WORKSPACE", "ORG"];
const ROLES: Array<SpaceRoleValue | null> = [null, "OWNER", "ADMIN", "MEMBER", "GUEST"];

describe("decideSpaceLists matches the per-List helpers", () => {
  it("for every combination of the facts their branches read", () => {
    let checked = 0;
    for (const level of LEVELS) {
      for (const spaceVis of VIS) {
        for (const spaceRole of ROLES) {
          for (const boardVis of VIS) {
            for (const boardRole of ROLES) {
              for (const boardOwner of [ME, OTHER, null]) {
                for (const folderCase of ["root", "public", "private-mine", "private-theirs"] as const) {
                  for (const grantedHere of [false, true]) {
                    if (folderCase === "root" && grantedHere) continue;
                    const sp = space(spaceVis, spaceRole);
                    const folder: SpaceTreeFolder | null =
                      folderCase === "root"
                        ? null
                        : {
                            id: "f-1",
                            parentFolderId: null,
                            visibility: folderCase === "public" ? "WORKSPACE" : "PRIVATE",
                            ownerId: folderCase === "private-mine" ? ME : OTHER,
                          };
                    const board: Board = {
                      id: "b-1",
                      name: "List",
                      folderId: folder ? folder.id : null,
                      visibility: boardVis,
                      ownerId: boardOwner,
                      memberRole: boardRole,
                    };
                    const granted = new Set(grantedHere ? ["f-1"] : []);
                    const got = decideSpaceLists(viewer(level), {
                      space: sp,
                      folders: folder ? [folder] : [],
                      boards: [board],
                      granted,
                    });
                    const want = reference(level, sp, board, folder, granted);
                    // A List directly in a folder is shown whenever it is
                    // readable: its only ancestor is its own folder, which the
                    // reader transcription has already weighed.
                    expect({ level, spaceVis, spaceRole, boardVis, boardRole, boardOwner, folderCase, grantedHere, read: got.lists.length === 1 }).toEqual({
                      level, spaceVis, spaceRole, boardVis, boardRole, boardOwner, folderCase, grantedHere, read: want.read,
                    });
                    if (got.lists.length === 1) expect(got.lists[0].canContribute).toBe(want.write);
                    checked += 1;
                  }
                }
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(5000);
  });
});

describe("the product rules, in words", () => {
  const publicFolder: SpaceTreeFolder = { id: "f-pub", parentFolderId: null, visibility: "WORKSPACE", ownerId: OTHER };
  const theirPrivate: SpaceTreeFolder = { id: "f-priv", parentFolderId: null, visibility: "PRIVATE", ownerId: OTHER };
  const under: SpaceTreeFolder = { id: "f-under", parentFolderId: "f-priv", visibility: "WORKSPACE", ownerId: OTHER };
  const list = (id: string, folderId: string | null, extra: Partial<Board> = {}): Board => ({
    id, name: id, folderId, visibility: "WORKSPACE", ownerId: OTHER, memberRole: null, ...extra,
  });

  it("a Space GUEST reads every open List and writes none", () => {
    const r = decideSpaceLists(viewer("EMPLOYEE"), {
      space: space("ORG", "GUEST"),
      folders: [publicFolder],
      boards: [list("a", null), list("b", "f-pub")],
      granted: new Set(),
    });
    expect(r.lists.map((l) => [l.id, l.canContribute])).toEqual([["b", false], ["a", false]]);
  });

  it("a Space MEMBER writes open Lists but never someone's PRIVATE one", () => {
    const r = decideSpaceLists(viewer("EMPLOYEE"), {
      space: space("WORKSPACE", "MEMBER"),
      folders: [],
      boards: [list("open", null), list("theirs", null, { visibility: "PRIVATE" })],
      granted: new Set(),
    });
    expect(r.lists.map((l) => [l.id, l.canContribute])).toEqual([["open", true]]);
  });

  it("a PRIVATE List shared through BoardMember appears for its member", () => {
    const r = decideSpaceLists(viewer("EMPLOYEE"), {
      space: space("WORKSPACE", "MEMBER"),
      folders: [],
      boards: [list("shared", null, { visibility: "PRIVATE", memberRole: "MEMBER" })],
      granted: new Set(),
    });
    expect(r.lists.map((l) => [l.id, l.canContribute])).toEqual([["shared", true]]);
  });

  it("a Space OWNER reads someone's PRIVATE List without writing to it", () => {
    const r = decideSpaceLists(viewer("EMPLOYEE"), {
      space: space("WORKSPACE", "OWNER"),
      folders: [],
      boards: [list("theirs", null, { visibility: "PRIVATE" })],
      granted: new Set(),
    });
    expect(r.lists.map((l) => [l.id, l.canContribute])).toEqual([["theirs", false]]);
  });

  it("a folder grantee with no Space role reads the granted folder, writes nothing, sees nothing else", () => {
    const r = decideSpaceLists(viewer("EMPLOYEE"), {
      space: space("WORKSPACE", null),
      folders: [publicFolder, theirPrivate, under],
      boards: [list("root", null), list("in-pub", "f-pub"), list("in-priv", "f-priv"), list("deep", "f-under")],
      // Descendant-aware, as accessibleFolderIds returns it.
      granted: new Set(["f-priv", "f-under"]),
    });
    expect(r.lists.map((l) => [l.id, l.canContribute])).toEqual([["deep", false], ["in-priv", false]]);
    // The count is the tree's: both granted folders, plus the open folder the
    // coarse folderVisibleTo view passes. A grantee with no Space role never
    // reaches the Space page that prints it (the page sends them to their
    // folder), so only Space readers ever read this number.
    expect(r.visibleFolderCount).toBe(3);
  });

  it("hides a List under a PRIVATE folder that is not the viewer's, unless it is shared to them", () => {
    // Shown through the BoardMember row; writable because canContributeBoard
    // has no folder branch and the viewer is a non-guest Space member.
    const r = decideSpaceLists(viewer("EMPLOYEE"), {
      space: space("ORG", "MEMBER"),
      folders: [theirPrivate, under],
      boards: [list("deep", "f-under"), list("deep-shared", "f-under", { memberRole: "GUEST" })],
      granted: new Set(),
    });
    expect(r.lists.map((l) => [l.id, l.canContribute])).toEqual([["deep-shared", true]]);
    expect(r.visibleFolderCount).toBe(0);
  });

  it("an org admin reads and writes everything and sees every folder", () => {
    const r = decideSpaceLists(viewer("COMPANY_ADMIN"), {
      space: space("PRIVATE", null),
      folders: [theirPrivate, under],
      boards: [list("deep", "f-under", { visibility: "PRIVATE" }), list("root", null)],
      granted: new Set(),
    });
    expect(r.lists.map((l) => [l.id, l.canContribute])).toEqual([["deep", true], ["root", true]]);
    expect(r.visibleFolderCount).toBe(2);
  });

  it("never names a List the viewer cannot read", () => {
    const r = decideSpaceLists(viewer("EMPLOYEE"), {
      space: space("WORKSPACE", null),
      folders: [],
      boards: [list("a", null), list("b", null, { visibility: "PRIVATE" })],
      granted: new Set(),
    });
    expect(r.lists).toEqual([]);
  });
});

describe("orderListsLikeSidebar", () => {
  const f = (id: string, parentFolderId: string | null): SpaceTreeFolder => ({ id, parentFolderId, visibility: "WORKSPACE", ownerId: null });
  const l = (id: string, folderId: string | null) => ({ id, folderId });

  it("walks folders depth first, child folders before a folder's Lists, root Lists last", () => {
    const folders = [f("A", null), f("B", null), f("A1", "A"), f("A1x", "A1")];
    const lists = [l("rootList", null), l("inB", "B"), l("inA", "A"), l("inA1", "A1"), l("inA1x", "A1x")];
    const out = orderListsLikeSidebar(folders, lists);
    expect(out.map((o) => o.list.id)).toEqual(["inA1x", "inA1", "inA", "inB", "rootList"]);
    expect(out[0].chain.map((c) => c.id)).toEqual(["A", "A1", "A1x"]);
    expect(out[4].chain).toEqual([]);
  });

  it("keeps the input order of siblings", () => {
    const out = orderListsLikeSidebar([f("Z", null), f("A", null)], [l("z2", "Z"), l("z1", "Z"), l("a1", "A")]);
    expect(out.map((o) => o.list.id)).toEqual(["z2", "z1", "a1"]);
  });

  it("leaves out Lists whose folder cannot be reached, and survives a cycle", () => {
    const folders = [f("A", null), f("orphan", "gone"), f("C1", "C2"), f("C2", "C1")];
    const lists = [l("inA", "A"), l("inOrphan", "orphan"), l("inCycle", "C1"), l("nowhere", "missing")];
    expect(orderListsLikeSidebar(folders, lists).map((o) => o.list.id)).toEqual(["inA"]);
  });
});
