// The legacy floor (legacy-floor.ts) is today's answer, asked of parity.ts.
//
// Each grid world is described once by its parameters. The test builds the
// NodeRows the floor reads AND, separately, the LegacyInputs struct today's
// helpers read, and checks the floor equals the transcription's answer for
// every helper the floor names. The last blocks pin the pieces the floor adds
// on top: the folder-grantee union of board.ts:700-716, the cutoff that
// keeps the floor to rows (and sub-pages) from before this release, and the
// copy of resolveDocRole.

import { describe, expect, it } from "vitest";
import {
  floorFor, legacyEntryFor, legacyGrantsOf, legacyIsDocFull, legacyResolveDocRole, legacySpaceManages, writtenBeforeCutoff, type FloorRole,
} from "./legacy-floor";
import { emptyGrants, emptyRows, type DocSharingFact, type NodeRows, type NodeVisibility, type ViewerGrants } from "./node-rules";
import { legacyAllows, type LegacyInputs, type SpaceRoleValue } from "./parity";

const ORG = "org-1";
const ME = "u-me";
const OTHER = "u-other";

interface W {
  admin: boolean;
  sVis: "WORKSPACE" | "ORG";
  sRole: SpaceRoleValue | null;
  p: { vis: NodeVisibility; role: SpaceRoleValue | null } | null;
  f: { vis: NodeVisibility; role: SpaceRoleValue | null; owner: boolean };
  l: { vis: NodeVisibility; role: SpaceRoleValue | null; owner: boolean };
}

function* worlds(): Generator<W> {
  const parents: W["p"][] = [null, { vis: "PRIVATE", role: null }, { vis: "PRIVATE", role: "ADMIN" }, { vis: "WORKSPACE", role: "GUEST" }];
  for (const admin of [false, true])
    for (const sVis of ["WORKSPACE", "ORG"] as const)
      for (const sRole of [null, "OWNER", "ADMIN", "MEMBER", "GUEST"] as Array<SpaceRoleValue | null>)
        for (const p of parents)
          for (const fVis of ["WORKSPACE", "PRIVATE"] as NodeVisibility[])
            for (const fRole of [null, "ADMIN", "MEMBER", "GUEST"] as Array<SpaceRoleValue | null>)
              for (const fOwner of [false, true])
                for (const lVis of ["WORKSPACE", "PRIVATE", "ORG"] as NodeVisibility[])
                  for (const lRole of [null, "ADMIN", "MEMBER", "GUEST"] as Array<SpaceRoleValue | null>)
                    for (const lOwner of [false, true])
                      yield { admin, sVis, sRole, p, f: { vis: fVis, role: fRole, owner: fOwner }, l: { vis: lVis, role: lRole, owner: lOwner } };
}

function build(w: W): { rows: NodeRows; g: ViewerGrants } {
  const rows = emptyRows(ORG, "legacy");
  const g = emptyGrants({ userId: ME, orgAdmin: w.admin, orgGuest: false, isAgent: false, denied: false });
  rows.spaces.set("S", { id: "S", organizationId: ORG, name: "S", slug: "s", icon: null, color: null, visibility: w.sVis, ownerId: OTHER });
  if (w.sRole) g.space.set("S", w.sRole);
  if (w.p) {
    rows.folders.set("P", { id: "P", organizationId: ORG, spaceId: "S", parentFolderId: null, name: "P", icon: null, color: null, visibility: w.p.vis, ownerId: OTHER, position: 0 });
    if (w.p.role) g.folder.set("P", w.p.role);
  }
  rows.folders.set("F", {
    id: "F", organizationId: ORG, spaceId: "S", parentFolderId: w.p ? "P" : null, name: "F", icon: null, color: null,
    visibility: w.f.vis, ownerId: w.f.owner ? ME : OTHER, position: 0,
  });
  if (w.f.role) g.folder.set("F", w.f.role);
  rows.lists.set("L", {
    id: "L", organizationId: ORG, spaceId: "S", folderId: "F", name: "L", slug: "l", icon: null, color: null,
    visibility: w.l.vis, ownerId: w.l.owner ? ME : OTHER,
  });
  if (w.l.role) g.list.set("L", w.l.role);
  return { rows, g };
}

// Today's struct, from the parameters alone.
function inputs(w: W): LegacyInputs {
  return {
    userId: ME,
    organizationId: ORG,
    accessLevel: w.admin ? "COMPANY_ADMIN" : "EMPLOYEE",
    space: { id: "S", organizationId: ORG, visibility: w.sVis, ownerId: OTHER, memberRole: w.sRole },
    folder: {
      id: "F", organizationId: ORG, spaceId: "S", parentFolderId: w.p ? "P" : null, visibility: w.f.vis,
      ownerId: w.f.owner ? ME : OTHER, memberRole: w.f.role, ancestorMemberRole: w.p?.role ?? null,
    },
    board: { id: "L", organizationId: ORG, spaceId: "S", folderId: "F", visibility: w.l.vis, ownerId: w.l.owner ? ME : OTHER, memberRole: w.l.role },
  };
}

function expectedFolder(w: W): FloorRole {
  const i = inputs(w);
  if (!legacyAllows(i, "folderReadable")) return "none";
  return legacyAllows(i, "canEditSpace") ? "FULL" : "VIEW";
}

function expectedList(w: W): FloorRole {
  const i = inputs(w);
  // board.ts:700-716: a FolderMember on the List's Folder or an ancestor.
  const union = !!w.f.role || !!w.p?.role;
  if (!legacyAllows(i, "getBoardForReader") && !union) return "none";
  if (legacyAllows(i, "canEditBoard")) return "FULL";
  if (legacyAllows(i, "canContributeBoard")) return "EDIT";
  return "VIEW";
}

const GRID_TIMEOUT = 30_000;

describe("the floor is today's answer over the grid", () => {
  // The grids collect mismatches and assert once: a message string built for
  // every one of tens of thousands of expects is most of a grid's run time,
  // and a loaded machine then trips the default 5 second timeout.
  it("Folders: folderReadable, and Full access with canEditSpace", () => {
    let n = 0;
    const failures: string[] = [];
    for (const w of worlds()) {
      const { rows, g } = build(w);
      const got = floorFor(rows, g, { kind: "folder", id: "F" });
      const want = expectedFolder(w);
      if (got !== want) failures.push(`${got} != ${want} ${JSON.stringify(w)}`);
      n += 1;
    }
    expect(n).toBeGreaterThan(20000);
    expect(failures.slice(0, 5)).toEqual([]);
  }, GRID_TIMEOUT);

  it("Lists: getBoardForReader or the folder-grantee union, then canContributeBoard and canEditBoard", () => {
    const failures: string[] = [];
    for (const w of worlds()) {
      const { rows, g } = build(w);
      const got = floorFor(rows, g, { kind: "list", id: "L" });
      const want = expectedList(w);
      if (got !== want) failures.push(`${got} != ${want} ${JSON.stringify(w)}`);
    }
    expect(failures.slice(0, 5)).toEqual([]);
  }, GRID_TIMEOUT);

  it("docs: docAccessible with the copied resolveDocRole, Full access for isDocFull", () => {
    const entries: Array<DocSharingFact | undefined> = [
      undefined, { restricted: true }, { restricted: true, members: { [ME]: "view" } }, { members: { [ME]: "view" } }, { members: { [ME]: "edit" } },
    ];
    const failures: string[] = [];
    for (const w of worlds()) {
      if (w.l.owner || w.l.role === "MEMBER") continue; // keeps the doc grid quick; the List grid covers these
      for (const anchor of ["FOLDER", "BOARD", "SPACE"] as const) {
        for (const entry of entries) {
          for (const creator of [false, true]) {
            const { rows, g } = build(w);
            const entityId = anchor === "FOLDER" ? "F" : anchor === "BOARD" ? "L" : "S";
            rows.docs.set("D", { id: "D", organizationId: ORG, title: "D", entityType: anchor, entityId, parentId: null, createdById: creator ? ME : OTHER });
            if (entry) rows.docSharing.set("D", entry);
            const i = inputs(w);
            i.doc = { id: "D", organizationId: ORG, createdById: creator ? ME : OTHER, anchor: { entityType: anchor, entityId } };
            let expected: FloorRole = "none";
            if (legacyAllows(i, "docAccessible")) {
              const role = legacyResolveDocRole(entry as never, { userId: ME, accessLevel: i.accessLevel, createdById: creator ? ME : OTHER });
              if (role) expected = legacyIsDocFull({ userId: ME, accessLevel: i.accessLevel }, { createdById: creator ? ME : OTHER }) ? "FULL" : role === "edit" ? "EDIT" : "COMMENT";
            }
            const got = floorFor(rows, g, { kind: "doc", id: "D" });
            if (got !== expected) failures.push(`${got} != ${expected} ${anchor} ${JSON.stringify(entry)} ${creator} ${JSON.stringify(w)}`);
          }
        }
      }
    }
    expect(failures.slice(0, 5)).toEqual([]);
  }, GRID_TIMEOUT);
});

describe("the List folder-grantee union (board.ts:700-716)", () => {
  it("admits a List through a grant on its Folder or on any ancestor, however deep", () => {
    const rows = emptyRows(ORG, "legacy");
    const g = emptyGrants({ userId: ME, orgAdmin: false, orgGuest: false, isAgent: false, denied: false });
    rows.spaces.set("S", { id: "S", organizationId: ORG, name: "S", slug: "s", icon: null, color: null, visibility: "WORKSPACE", ownerId: OTHER });
    const chain = ["F1", "F2", "F3", "F4"];
    chain.forEach((id, i) =>
      rows.folders.set(id, { id, organizationId: ORG, spaceId: "S", parentFolderId: i ? chain[i - 1] : null, name: id, icon: null, color: null, visibility: i === 2 ? "PRIVATE" : "WORKSPACE", ownerId: OTHER, position: 0 }),
    );
    rows.lists.set("L", { id: "L", organizationId: ORG, spaceId: "S", folderId: "F4", name: "L", slug: "l", icon: null, color: null, visibility: "PRIVATE", ownerId: OTHER });
    expect(floorFor(rows, g, { kind: "list", id: "L" })).toBe("none");
    g.folder.set("F1", "GUEST");
    expect(floorFor(rows, g, { kind: "list", id: "L" })).toBe("VIEW");
  });
});

describe("sub-pages", () => {
  const CUTOFF = Date.UTC(2026, 8, 25);
  const setup = (createdAt: Date | null, cutoff: number | null) => {
    const rows = emptyRows(ORG, "legacy");
    rows.legacyBefore = cutoff;
    const g = emptyGrants({ userId: ME, orgAdmin: false, orgGuest: false, isAgent: false, denied: false });
    // The parent is anchored on a Space the viewer does not reach.
    rows.spaces.set("S", { id: "S", organizationId: ORG, name: "S", slug: "s", icon: null, color: null, visibility: "PRIVATE", ownerId: OTHER });
    rows.docs.set("P", { id: "P", organizationId: ORG, title: "P", entityType: "SPACE", entityId: "S", parentId: null, createdById: OTHER });
    rows.docs.set("C", { id: "C", organizationId: ORG, title: "C", entityType: null, entityId: null, parentId: "P", createdById: OTHER, createdAt });
    return { rows, g };
  };
  it("made before the cutoff keep today's reach: every page with no anchor opened to the org (A8)", () => {
    const { rows, g } = setup(new Date(CUTOFF - 1000), CUTOFF);
    expect(floorFor(rows, g, { kind: "doc", id: "P" })).toBe("none");
    expect(floorFor(rows, g, { kind: "doc", id: "C" })).toBe("EDIT");
  });
  it("keep it too when the cutoff or the page's date is unknown (never a loss)", () => {
    expect(floorFor(setup(new Date(CUTOFF + 1000), null).rows, setup(null, null).g, { kind: "doc", id: "C" })).toBe("EDIT");
    const { rows, g } = setup(null, CUTOFF);
    expect(floorFor(rows, g, { kind: "doc", id: "C" })).toBe("EDIT");
  });
  it("made at or after the cutoff get no floor: they follow their parent (A6)", () => {
    for (const at of [CUTOFF, CUTOFF + 1000]) {
      const { rows, g } = setup(new Date(at), CUTOFF);
      expect(floorFor(rows, g, { kind: "doc", id: "C" })).toBe("none");
    }
  });
  it("still keep a restricted listing's cut before the cutoff", () => {
    const { rows, g } = setup(new Date(CUTOFF - 1000), CUTOFF);
    rows.docSharing.set("C", { restricted: true });
    expect(floorFor(rows, g, { kind: "doc", id: "C" })).toBe("none");
  });
});

describe("only today's rows earn the floor (A2 for new grants, A8 for existing ones)", () => {
  const CUTOFF = Date.UTC(2026, 8, 25);
  const tree = () => {
    const rows = emptyRows(ORG, "legacy");
    rows.legacyBefore = CUTOFF;
    const g = emptyGrants({ userId: ME, orgAdmin: false, orgGuest: false, isAgent: false, denied: false });
    rows.spaces.set("S", { id: "S", organizationId: ORG, name: "S", slug: "s", icon: null, color: null, visibility: "WORKSPACE", ownerId: OTHER });
    rows.folders.set("F", { id: "F", organizationId: ORG, spaceId: "S", parentFolderId: null, name: "F", icon: null, color: null, visibility: "WORKSPACE", ownerId: OTHER, position: 0 });
    rows.folders.set("FP", { id: "FP", organizationId: ORG, spaceId: "S", parentFolderId: "F", name: "FP", icon: null, color: null, visibility: "PRIVATE", ownerId: OTHER, position: 0 });
    rows.lists.set("LP", { id: "LP", organizationId: ORG, spaceId: "S", folderId: "F", name: "LP", slug: "lp", icon: null, color: null, visibility: "PRIVATE", ownerId: OTHER });
    g.folder.set("F", "MEMBER");
    g.since = new Map();
    return { rows, g };
  };
  it("a Folder row from before the cutoff reaches the Private List and sub-folder inside, as today", () => {
    const { rows, g } = tree();
    g.since?.set("folder:F", CUTOFF - 1);
    expect(floorFor(rows, g, { kind: "list", id: "LP" })).toBe("VIEW");
    expect(floorFor(rows, g, { kind: "folder", id: "FP" })).toBe("VIEW");
  });
  it("a Folder row written at or after the cutoff reaches neither", () => {
    const { rows, g } = tree();
    g.since?.set("folder:F", CUTOFF);
    expect(floorFor(rows, g, { kind: "list", id: "LP" })).toBe("none");
    expect(floorFor(rows, g, { kind: "folder", id: "FP" })).toBe("none");
  });
  it("drops only the new rows, and hands back the same grants when nothing is new", () => {
    const { rows, g } = tree();
    g.space.set("S", "ADMIN");
    g.since?.set("space:S", CUTOFF - 1);
    g.since?.set("folder:F", CUTOFF + 5);
    const kept = legacyGrantsOf(rows, g);
    expect([...kept.space.keys()]).toEqual(["S"]);
    expect([...kept.folder.keys()]).toEqual([]);
    g.since?.set("folder:F", CUTOFF - 5);
    expect(legacyGrantsOf(rows, g)).toBe(g);
    expect(writtenBeforeCutoff(rows, CUTOFF - 1)).toBe(true);
    expect(writtenBeforeCutoff(rows, CUTOFF)).toBe(false);
    expect(writtenBeforeCutoff({ ...rows, legacyBefore: null }, CUTOFF + 1)).toBe(true);
  });
  it("today's canEditSpace comes from a Space row written before the cutoff only", () => {
    const { rows, g } = tree();
    g.space.set("S", "ADMIN");
    g.since?.set("space:S", CUTOFF - 1);
    expect(legacySpaceManages(rows, g, "S")).toBe(true);
    g.since?.set("space:S", CUTOFF + 1);
    expect(legacySpaceManages(rows, g, "S")).toBe(false);
  });
});

describe("canvases", () => {
  it("give today's myRole where whiteboardSpaceVisible admits", () => {
    const rows = emptyRows(ORG, "legacy");
    const g = emptyGrants({ userId: ME, orgAdmin: false, orgGuest: false, isAgent: false, denied: false });
    rows.spaces.set("S", { id: "S", organizationId: ORG, name: "S", slug: "s", icon: null, color: null, visibility: "WORKSPACE", ownerId: OTHER });
    rows.folders.set("PF", { id: "PF", organizationId: ORG, spaceId: "S", parentFolderId: null, name: "PF", icon: null, color: null, visibility: "PRIVATE", ownerId: OTHER, position: 0 });
    rows.canvases.set("W", { id: "W", organizationId: ORG, spaceId: "S", folderId: "PF", ownerId: OTHER, name: "W" });
    rows.canvases.set("U", { id: "U", organizationId: ORG, spaceId: null, folderId: null, ownerId: OTHER, name: "U" });
    expect(floorFor(rows, g, { kind: "canvas", id: "W" })).toBe("none");
    expect(floorFor(rows, g, { kind: "canvas", id: "U" })).toBe("EDIT");
    g.space.set("S", "GUEST");
    expect(floorFor(rows, g, { kind: "canvas", id: "W" })).toBe("VIEW");
    g.space.set("S", "MEMBER");
    expect(floorFor(rows, g, { kind: "canvas", id: "W" })).toBe("EDIT");
    rows.canvases.set("W", { id: "W", organizationId: ORG, spaceId: "S", folderId: "PF", ownerId: ME, name: "W" });
    expect(floorFor(rows, g, { kind: "canvas", id: "W" })).toBe("FULL");
  });

  it("a denied viewer has no floor anywhere", () => {
    const rows = emptyRows(ORG, "legacy");
    const g = emptyGrants({ userId: ME, orgAdmin: true, orgGuest: false, isAgent: false, denied: true });
    rows.canvases.set("U", { id: "U", organizationId: ORG, spaceId: null, folderId: null, ownerId: ME, name: "U" });
    expect(floorFor(rows, g, { kind: "canvas", id: "U" })).toBe("none");
  });
});

describe("the copy of resolveDocRole (doc-sharing.ts:51-65)", () => {
  const v = (over: Partial<{ userId: string; accessLevel: string | null; createdById: string | null }> = {}) => ({
    userId: ME, accessLevel: "EMPLOYEE", createdById: OTHER, ...over,
  });
  it("matches the table", () => {
    expect(legacyResolveDocRole({ restricted: true }, v({ createdById: ME }))).toBe("edit"); // creator
    expect(legacyResolveDocRole({ restricted: true }, v({ accessLevel: "COMPANY_ADMIN" }))).toBe("edit"); // admin
    expect(legacyResolveDocRole({ restricted: true }, v({ accessLevel: "SUPER_ADMIN" }))).toBe("edit");
    expect(legacyResolveDocRole(undefined, v())).toBe("edit"); // no entry
    expect(legacyResolveDocRole({ members: { [ME]: "edit" } }, v())).toBe("edit"); // listed edit
    expect(legacyResolveDocRole({ restricted: true, members: { [ME]: "view" } }, v())).toBe("view"); // listed view
    expect(legacyResolveDocRole({ restricted: true, members: { [OTHER]: "edit" } }, v())).toBeNull(); // restricted unlisted
    expect(legacyResolveDocRole({ members: { [OTHER]: "edit" } }, v())).toBe("edit"); // unrestricted unlisted
  });

  it("the floor reads a person's members projection only when they hold no roles entry", () => {
    const entry: DocSharingFact = { restricted: true, members: { [ME]: "view", [OTHER]: "edit" }, roles: { [ME]: "VIEW" } };
    expect(legacyEntryFor(entry, ME)).toEqual({ restricted: true, members: { [OTHER]: "edit" } });
    expect(legacyEntryFor(entry, OTHER)).toEqual({ restricted: true, members: { [ME]: "view", [OTHER]: "edit" } });
    expect(legacyEntryFor(undefined, ME)).toBeUndefined();
  });
});
