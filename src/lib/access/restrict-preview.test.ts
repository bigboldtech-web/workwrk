// restrictPreview (node-access.ts): what turning Restricted on for a Folder
// or List would cut, answered by the resolver over the world with the node
// set to PRIVATE. The Manage access dialog's confirm reads it, so a Full
// holder is told before they lock themselves out.
//
// node-access.ts is server code; its database and session imports are
// stubbed so the pure function loads in node.

import { describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("../auth", () => ({ authOptions: {} }));
vi.mock("../prisma", () => ({ prisma: {} }));
vi.mock("../doc-lock", () => ({ readDocLock: vi.fn() }));

import { presentNodeName, restrictPreview } from "./node-access";
import { emptyGrants, emptyRows, type MemberRole, type NodeRows, type NodeViewer, type NodeVisibility, type PrivateRule, type ViewerGrants } from "./node-rules";

const ORG = "org-1";

function viewer(userId: string, over: Partial<NodeViewer> = {}): NodeViewer {
  return { userId, orgAdmin: false, orgGuest: false, isAgent: false, denied: false, ...over };
}

function world(rule: PrivateRule = "strict", spaceVisibility: NodeVisibility = "WORKSPACE"): NodeRows {
  const rows = emptyRows(ORG, rule);
  rows.spaces.set("S", { id: "S", organizationId: ORG, name: "Space S", slug: "s", icon: null, color: null, visibility: spaceVisibility, ownerId: "owner" });
  rows.folders.set("A", { id: "A", organizationId: ORG, spaceId: "S", parentFolderId: null, name: "Folder A", icon: null, color: null, visibility: "WORKSPACE", ownerId: "maker", position: 0 });
  rows.folders.set("A1", { id: "A1", organizationId: ORG, spaceId: "S", parentFolderId: "A", name: "Sub A1", icon: null, color: null, visibility: "WORKSPACE", ownerId: "maker", position: 0 });
  rows.lists.set("L", { id: "L", organizationId: ORG, spaceId: "S", folderId: "A", name: "List L", slug: "list-l", icon: null, color: null, visibility: "WORKSPACE", ownerId: "maker", settings: {} });
  return rows;
}

function person(id: string, rows: Array<["space" | "folder" | "list", string, MemberRole]> = [], over: Partial<NodeViewer> = {}): { id: string; active: boolean; grants: ViewerGrants } {
  const g = emptyGrants(viewer(id, over));
  for (const [kind, nodeId, role] of rows) g[kind].set(nodeId, role);
  return { id, active: true, grants: g };
}

describe("restrictPreview", () => {
  it("a Full holder on the parent Folder who restricts the sub-folder loses it, and so does everyone else who inherits", () => {
    const rows = world();
    const one = person("one", [["folder", "A", "ADMIN"]]);
    const two = person("two", [["folder", "A", "MEMBER"]]);
    const p = restrictPreview(rows, { kind: "folder", id: "A1" }, one.grants, [one, two]);
    expect(p).toEqual({ viewerKeeps: false, others: 1, everyone: false });
  });

  it("someone listed on the node itself keeps it, and is not counted", () => {
    const rows = world();
    const one = person("one", [["folder", "A", "ADMIN"], ["folder", "A1", "ADMIN"]]);
    const two = person("two", [["folder", "A", "MEMBER"], ["folder", "A1", "MEMBER"]]);
    expect(restrictPreview(rows, { kind: "folder", id: "A1" }, one.grants, [one, two])).toEqual({ viewerKeeps: true, others: 0, everyone: false });
  });

  it("the Folder's owner and org admins keep it; people who cannot sign in are not counted", () => {
    const rows = world();
    rows.orgAdmins.add("admin");
    const maker = person("maker", [["space", "S", "MEMBER"]]);
    const admin = person("admin", [], { orgAdmin: true });
    const gone = { ...person("gone", [["space", "S", "MEMBER"]]), active: false };
    const member = person("member", [["space", "S", "MEMBER"]]);
    expect(restrictPreview(rows, { kind: "folder", id: "A" }, maker.grants, [maker, admin, gone, member])).toEqual({ viewerKeeps: true, others: 1, everyone: false });
    expect(restrictPreview(rows, { kind: "folder", id: "A" }, admin.grants, [maker, admin, gone, member])?.viewerKeeps).toBe(true);
  });

  it("a List keeps its Space OWNER (the pierce) and cuts the rest of the Folder's people", () => {
    const rows = world();
    const owner = person("owner", [["space", "S", "OWNER"]]);
    const spaceAdmin = person("sa", [["space", "S", "ADMIN"]]);
    const viaFolder = person("vf", [["folder", "A", "MEMBER"]]);
    expect(restrictPreview(rows, { kind: "list", id: "L" }, owner.grants, [owner, spaceAdmin, viaFolder])).toEqual({ viewerKeeps: true, others: 2, everyone: false });
  });

  it("in an org-wide Space, everyone at the org loses a Folder that goes Restricted", () => {
    const rows = world("strict", "ORG");
    const me = person("me", [["folder", "A1", "ADMIN"]]);
    expect(restrictPreview(rows, { kind: "folder", id: "A1" }, me.grants, [me])).toEqual({ viewerKeeps: true, others: 0, everyone: true });
  });

  it("under the legacy rule an older Folder row the legacy floor keeps is not counted as a loss; a new one is", () => {
    const older = world("legacy");
    older.legacyBefore = null; // every row reads as written before the cutoff
    const one = person("one", [["folder", "A", "ADMIN"]]);
    expect(restrictPreview(older, { kind: "folder", id: "A1" }, one.grants, [one])?.viewerKeeps).toBe(true);
    const newer = world("legacy");
    newer.legacyBefore = 1_000;
    const fresh = person("one", [["folder", "A", "ADMIN"]]);
    fresh.grants.since = new Map([["folder:A", 2_000]]);
    expect(restrictPreview(newer, { kind: "folder", id: "A1" }, fresh.grants, [fresh])?.viewerKeeps).toBe(false);
  });

  it("asks nothing of a node that is already Restricted, or of a kind with no switch", () => {
    const rows = world();
    rows.folders.set("A1", { ...rows.folders.get("A1")!, visibility: "PRIVATE" });
    const one = person("one", [["folder", "A", "ADMIN"]]);
    expect(restrictPreview(rows, { kind: "folder", id: "A1" }, one.grants, [one])).toBeNull();
    expect(restrictPreview(rows, { kind: "space", id: "S" }, one.grants, [one])).toBeNull();
    expect(restrictPreview(rows, { kind: "doc", id: "D" }, one.grants, [one])).toBeNull();
  });

  it("does not change the world it was given", () => {
    const rows = world();
    const one = person("one", [["folder", "A", "ADMIN"]]);
    restrictPreview(rows, { kind: "folder", id: "A1" }, one.grants, [one]);
    restrictPreview(rows, { kind: "list", id: "L" }, one.grants, [one]);
    expect(rows.folders.get("A1")?.visibility).toBe("WORKSPACE");
    expect(rows.lists.get("L")?.visibility).toBe("WORKSPACE");
  });
});

describe("presentNodeName (the activity feed's names)", () => {
  it("names a node the world holds, and nothing it does not", () => {
    const rows = world();
    expect(presentNodeName(rows, { kind: "folder", id: "A1" })).toBe("Sub A1");
    expect(presentNodeName(rows, { kind: "space", id: "S" })).toBe("Space S");
    // nodeName falls back to the noun for a missing row; the feed must not
    // print "Folder" as if it were a name.
    expect(presentNodeName(rows, { kind: "folder", id: "missing" })).toBeNull();
    rows.docs.set("D", { id: "D", organizationId: ORG, title: "  ", entityType: null, entityId: null, parentId: null, createdById: "maker" });
    expect(presentNodeName(rows, { kind: "doc", id: "D" })).toBeNull();
  });
});
