// The two-set golden suite (invariant 2).
//
// "Full-read sets never widen by lower grants. accessibleIds(viewer, "space",
// VIEW).readable contains only Spaces with a Space-level source; container
// labels come from containerOnly, which content endpoints cannot consume. The
// visibleSpaceIds leak trap (space.ts:165-171) is enforced by the return type."
//
// Every assertion here is one a broken implementation would fail. That matters
// because this is the half accessibleIds had no coverage of at all: the whole
// two-set implementation was untested, and four of its six branches ignored
// minRole, so a FULL-level call handed back a VIEW-level set.

import { describe, expect, it } from "vitest";

import {
  cascade,
  channelMembershipClears,
  folderSets,
  listSets,
  orgWideAnchorlessClears,
  roleFromSopRole,
  roleFromSpaceRole,
  sopFolderSets,
  spaceSets,
} from "./id-sets";
import type { ObjectRole } from "./types";

const ALL_ROLES: ObjectRole[] = ["VIEW", "COMMENT", "EDIT", "FULL"];

function ids(set: Set<string>): string[] {
  return [...set].sort();
}

// ─────────────────────────────────────────────────────────────────
// The enum mapping (spec 3.1)
// ─────────────────────────────────────────────────────────────────

describe("the spec 3.1 enum mapping", () => {
  it("maps SpaceRole to the one ladder", () => {
    expect(roleFromSpaceRole("OWNER")).toBe("FULL");
    expect(roleFromSpaceRole("ADMIN")).toBe("FULL");
    expect(roleFromSpaceRole("MEMBER")).toBe("EDIT");
    expect(roleFromSpaceRole("GUEST")).toBe("VIEW");
  });

  it("maps SOPFolderRole to the one ladder", () => {
    expect(roleFromSopRole("OWNER")).toBe("FULL");
    expect(roleFromSopRole("EDITOR")).toBe("EDIT");
    expect(roleFromSopRole("VIEWER")).toBe("VIEW");
  });

  it("reads an unknown value as the narrowest rung, never as the widest", () => {
    expect(roleFromSpaceRole("WHATEVER")).toBe("VIEW");
    expect(roleFromSopRole("WHATEVER")).toBe("VIEW");
  });
});

// ─────────────────────────────────────────────────────────────────
// Invariant 2: the leak trap
// ─────────────────────────────────────────────────────────────────

describe("invariant 2: full-read sets never widen by lower grants", () => {
  it("puts a Space reached only through a folder grant in containerOnly, never in readable", () => {
    // Worked example J: accessibleIds(Tom, "space", VIEW) is
    // readable = {}, containerOnly = { Agency }.
    const sets = spaceSets({
      minRole: "VIEW",
      orgVisible: [],
      memberships: [],
      descendantSpaceIds: ["space_agency"],
    });
    expect(ids(sets.readable)).toEqual([]);
    expect(ids(sets.containerOnly)).toEqual(["space_agency"]);
  });

  it("never puts the same id in both sets", () => {
    const sets = spaceSets({
      minRole: "VIEW",
      orgVisible: [],
      memberships: [{ spaceId: "space_1", role: "MEMBER" }],
      // The viewer ALSO holds a folder inside the Space they are a member of.
      descendantSpaceIds: ["space_1"],
    });
    expect(ids(sets.readable)).toEqual(["space_1"]);
    expect(ids(sets.containerOnly)).toEqual([]);
  });

  it("keeps the sets independent between calls", () => {
    const a = spaceSets({ minRole: "VIEW", orgVisible: [], memberships: [], descendantSpaceIds: [] });
    a.readable.add("leaked");
    const b = spaceSets({ minRole: "VIEW", orgVisible: [], memberships: [], descendantSpaceIds: [] });
    expect(ids(b.readable)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────
// minRole, on every branch
// ─────────────────────────────────────────────────────────────────

describe("spaceSets honours minRole", () => {
  it("reads Space.settings.defaultPermission for the EVERYONE grant, not a hard-coded EDIT", () => {
    // Spec 3.1: "Visibility.ORG on Space -> an EVERYONE grant at the role
    // Space.settings.defaultPermission maps to ... The dead Default permission
    // select (audit Broken #9) becomes this row and is therefore enforced."
    const orgVisible = [
      { id: "space_view", settings: { defaultPermission: "view" } },
      { id: "space_comment", settings: { defaultPermission: "comment" } },
      { id: "space_edit", settings: { defaultPermission: "edit" } },
      { id: "space_default", settings: {} },
    ];
    const base = { orgVisible, memberships: [], descendantSpaceIds: [] };

    expect(ids(spaceSets({ ...base, minRole: "VIEW" }).readable)).toEqual([
      "space_comment",
      "space_default",
      "space_edit",
      "space_view",
    ]);
    expect(ids(spaceSets({ ...base, minRole: "COMMENT" }).readable)).toEqual([
      "space_comment",
      "space_default",
      "space_edit",
    ]);
    expect(ids(spaceSets({ ...base, minRole: "EDIT" }).readable)).toEqual([
      "space_default",
      "space_edit",
    ]);
    // No EVERYONE grant is ever FULL, so a FULL-level call sees none of them.
    expect(ids(spaceSets({ ...base, minRole: "FULL" }).readable)).toEqual([]);
  });

  it("filters SpaceMember rows by their mapped role", () => {
    const memberships = [
      { spaceId: "s_owner", role: "OWNER" },
      { spaceId: "s_admin", role: "ADMIN" },
      { spaceId: "s_member", role: "MEMBER" },
      { spaceId: "s_guest", role: "GUEST" },
    ];
    const base = { orgVisible: [], memberships, descendantSpaceIds: [] };
    expect(ids(spaceSets({ ...base, minRole: "VIEW" }).readable)).toEqual([
      "s_admin",
      "s_guest",
      "s_member",
      "s_owner",
    ]);
    expect(ids(spaceSets({ ...base, minRole: "EDIT" }).readable)).toEqual([
      "s_admin",
      "s_member",
      "s_owner",
    ]);
    expect(ids(spaceSets({ ...base, minRole: "FULL" }).readable)).toEqual(["s_admin", "s_owner"]);
  });

  it("gives an org admin every Space at every minRole", () => {
    for (const minRole of ALL_ROLES) {
      const sets = spaceSets({
        minRole,
        allIds: ["a", "b"],
        orgVisible: [],
        memberships: [],
        descendantSpaceIds: [],
      });
      expect(ids(sets.readable)).toEqual(["a", "b"]);
    }
  });
});

describe("folderSets honours minRole", () => {
  const base = {
    ownedIds: [] as string[],
    inheritedIds: [] as string[],
    parents: [] as Array<{ id: string; parentFolderId: string | null }>,
    containerOnlyIds: [] as string[],
  };

  it("filters FolderMember rows by their mapped role", () => {
    const grants = [
      { folderId: "f_owner", role: "OWNER" },
      { folderId: "f_member", role: "MEMBER" },
      { folderId: "f_guest", role: "GUEST" },
    ];
    expect(ids(folderSets({ ...base, grants, minRole: "VIEW" }).readable)).toEqual([
      "f_guest",
      "f_member",
      "f_owner",
    ]);
    expect(ids(folderSets({ ...base, grants, minRole: "FULL" }).readable)).toEqual(["f_owner"]);
  });

  it("cascades a folder grant downward, and only from grants that clear minRole", () => {
    const parents = [
      { id: "f_parent", parentFolderId: null },
      { id: "f_child", parentFolderId: "f_parent" },
      { id: "f_grandchild", parentFolderId: "f_child" },
      { id: "f_elsewhere", parentFolderId: null },
    ];
    const granted = folderSets({
      ...base,
      parents,
      grants: [{ folderId: "f_parent", role: "MEMBER" }],
      minRole: "VIEW",
    });
    expect(ids(granted.readable)).toEqual(["f_child", "f_grandchild", "f_parent"]);

    // The same grant is EDIT, so a FULL-level call sees neither the folder nor
    // anything under it. A cascade that ran off the raw grant list rather than
    // the cleared seeds would leak the descendants here.
    const full = folderSets({
      ...base,
      parents,
      grants: [{ folderId: "f_parent", role: "MEMBER" }],
      minRole: "FULL",
    });
    expect(ids(full.readable)).toEqual([]);
  });

  it("gives the folder's owner the folder at every minRole (rule 5 is FULL)", () => {
    for (const minRole of ALL_ROLES) {
      const sets = folderSets({ ...base, grants: [], ownedIds: ["f_mine"], minRole });
      expect(ids(sets.readable)).toEqual(["f_mine"]);
    }
  });

  it("drops a container label the viewer turns out to read properly", () => {
    const sets = folderSets({
      ...base,
      grants: [{ folderId: "f_1", role: "MEMBER" }],
      containerOnlyIds: ["f_1", "f_2"],
      minRole: "VIEW",
    });
    expect(ids(sets.readable)).toEqual(["f_1"]);
    expect(ids(sets.containerOnly)).toEqual(["f_2"]);
  });
});

describe("listSets honours minRole", () => {
  const base = {
    ownedIds: [] as string[],
    inheritedIds: [] as string[],
    orgVisibleIds: [] as string[],
    containerOnlyIds: [] as string[],
  };

  it("filters BoardMember rows by their mapped role", () => {
    const grants = [
      { boardId: "b_admin", role: "ADMIN" },
      { boardId: "b_member", role: "MEMBER" },
      { boardId: "b_guest", role: "GUEST" },
    ];
    expect(ids(listSets({ ...base, grants, minRole: "COMMENT" }).readable)).toEqual([
      "b_admin",
      "b_member",
    ]);
    expect(ids(listSets({ ...base, grants, minRole: "FULL" }).readable)).toEqual(["b_admin"]);
  });

  it("gives an ORG-visibility board VIEW and nothing above it", () => {
    // Spec 3.1: "Visibility.ORG on Board -> an EVERYONE grant on the List at
    // VIEW."
    expect(
      ids(listSets({ ...base, grants: [], orgVisibleIds: ["b_org"], minRole: "VIEW" }).readable),
    ).toEqual(["b_org"]);
    for (const minRole of ["COMMENT", "EDIT", "FULL"] as ObjectRole[]) {
      expect(
        ids(listSets({ ...base, grants: [], orgVisibleIds: ["b_org"], minRole }).readable),
      ).toEqual([]);
    }
  });

  it("trusts the caller to have resolved the inherited containers at minRole", () => {
    // This is the contract the loader keeps by calling folderIds(viewer,
    // minRole) rather than folderIds(viewer, "VIEW"): `inheritedIds` is
    // already filtered, so listSets adds it as-is. The comment matters because
    // an implementation that re-filtered here would silently double-narrow.
    const sets = listSets({ ...base, grants: [], inheritedIds: ["b_inherited"], minRole: "FULL" });
    expect(ids(sets.readable)).toEqual(["b_inherited"]);
  });
});

describe("sopFolderSets honours minRole and cascades", () => {
  it("cascades an EDITOR grant to children but not to a FULL-level caller", () => {
    const parents = [
      { id: "sf_root", parentId: null },
      { id: "sf_child", parentId: "sf_root" },
    ];
    const editor = sopFolderSets({
      minRole: "EDIT",
      grants: [{ folderId: "sf_root", role: "EDITOR" }],
      parents,
    });
    expect(ids(editor.readable)).toEqual(["sf_child", "sf_root"]);

    const full = sopFolderSets({
      minRole: "FULL",
      grants: [{ folderId: "sf_root", role: "EDITOR" }],
      parents,
    });
    expect(ids(full.readable)).toEqual([]);
  });
});

describe("the EDIT-level EVERYONE branches", () => {
  it("clears every minRole up to EDIT and never FULL", () => {
    expect(channelMembershipClears("VIEW")).toBe(true);
    expect(channelMembershipClears("EDIT")).toBe(true);
    expect(channelMembershipClears("FULL")).toBe(false);
  });

  it("gives a Guest no unanchored Table or Whiteboard at all (rule 8)", () => {
    expect(orgWideAnchorlessClears("VIEW", false)).toBe(true);
    expect(orgWideAnchorlessClears("EDIT", false)).toBe(true);
    expect(orgWideAnchorlessClears("FULL", false)).toBe(false);
    for (const minRole of ALL_ROLES) {
      expect(orgWideAnchorlessClears(minRole, true)).toBe(false);
    }
  });
});

describe("cascade", () => {
  it("terminates on a cycle rather than spinning", () => {
    const rows = [
      { id: "a", parentFolderId: "b" },
      { id: "b", parentFolderId: "a" },
    ];
    expect(ids(cascade(["a"], rows))).toEqual(["b"]);
  });

  it("excludes the seeds themselves and anything unreachable", () => {
    const rows = [
      { id: "child", parentFolderId: "seed" },
      { id: "orphan", parentFolderId: null },
      { id: "other", parentFolderId: "elsewhere" },
    ];
    expect(ids(cascade(["seed"], rows))).toEqual(["child"]);
  });
});
