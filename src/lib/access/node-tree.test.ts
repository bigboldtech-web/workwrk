// node-tree.ts: the Space tree one person sees, the path view, the counts
// and the Manage access panel's people.

import { describe, expect, it } from "vitest";
import {
  accessEntries, assembleSpaceTree, inheritanceOf, keepsRestrictedDoc, pathViewRows, renderedCounts,
  type FolderNode, type PanelPersonInput, type SpaceTreeResult,
} from "./node-tree";
import {
  emptyGrants,
  emptyRows,
  objectGrantKey,
  type DocSharingFact,
  type MemberRole,
  type NodeRows,
  type NodeViewer,
  type NodeVisibility,
  type PrivateRule,
  type ViewerGrants,
} from "./node-rules";

const ORG = "org-1";
const ME = "u-me";
const OTHER = "u-other";

function viewer(userId = ME, over: Partial<NodeViewer> = {}): NodeViewer {
  return { userId, orgAdmin: false, orgGuest: false, isAgent: false, denied: false, ...over };
}

class T {
  rows: NodeRows;
  g: ViewerGrants;
  constructor(rule: PrivateRule = "strict") {
    this.rows = emptyRows(ORG, rule);
    this.g = emptyGrants(viewer());
  }
  space(id: string, visibility: NodeVisibility = "WORKSPACE") {
    this.rows.spaces.set(id, { id, organizationId: ORG, name: `Space ${id}`, slug: id.toLowerCase(), icon: null, color: null, visibility, ownerId: OTHER });
    return this;
  }
  folder(id: string, parent: string | null = null, visibility: NodeVisibility = "WORKSPACE", ownerId = OTHER, spaceId = "S", position = 0) {
    this.rows.folders.set(id, { id, organizationId: ORG, spaceId, parentFolderId: parent, name: `Folder ${id}`, icon: null, color: null, visibility, ownerId, position });
    return this;
  }
  list(id: string, folderId: string | null, visibility: NodeVisibility = "WORKSPACE", ownerId = OTHER) {
    this.rows.lists.set(id, { id, organizationId: ORG, spaceId: "S", folderId, name: `List ${id}`, slug: id.toLowerCase(), icon: null, color: null, visibility, ownerId, settings: {} });
    return this;
  }
  doc(id: string, o: { entityType?: string | null; entityId?: string | null; parentId?: string | null; createdById?: string } = {}) {
    this.rows.docs.set(id, { id, organizationId: ORG, title: `Doc ${id}`, entityType: o.entityType ?? null, entityId: o.entityId ?? null, parentId: o.parentId ?? null, createdById: o.createdById ?? OTHER });
    return this;
  }
  canvas(id: string, folderId: string | null, spaceId: string | null = "S") {
    this.rows.canvases.set(id, { id, organizationId: ORG, spaceId, folderId, ownerId: OTHER, name: `Canvas ${id}` });
    return this;
  }
  table(id: string) {
    this.rows.tables.set(id, { id, organizationId: ORG, spaceId: "S", createdById: OTHER, name: `Table ${id}`, description: null });
    return this;
  }
  sharing(docId: string, entry: DocSharingFact) {
    this.rows.docSharing.set(docId, entry);
    return this;
  }
  on(kind: "space" | "folder" | "list", id: string, role: MemberRole) {
    this.g[kind].set(id, role);
    return this;
  }
  onObject(kind: "table" | "canvas" | "form", id: string, role: MemberRole) {
    this.g.object.set(objectGrantKey(kind, id), role);
    return this;
  }
  tree(): SpaceTreeResult | null {
    return assembleSpaceTree({ rows: this.rows, grants: this.g, spaceId: "S" });
  }
}

const names = (nodes: Array<{ id: string }>) => nodes.map((n) => n.id);
function folder(tree: SpaceTreeResult, id: string): FolderNode {
  const walk = (nodes: FolderNode[]): FolderNode | null => {
    for (const n of nodes) {
      if (n.id === id) return n;
      const hit = walk(n.childFolders);
      if (hit) return hit;
    }
    return null;
  };
  const hit = walk(tree.folders);
  if (!hit) throw new Error(`no folder ${id}`);
  return hit;
}

/** The AX shape: Folder A holds A1 (nested), a PRIVATE sub-folder and Lists; Folder B beside it. */
function ax(rule: PrivateRule = "strict") {
  return new T(rule).space("S")
    .folder("A").folder("A1", "A", "WORKSPACE", OTHER, "S", 1).folder("AP", "A", "PRIVATE", OTHER, "S", 2).folder("B", null, "WORKSPACE", OTHER, "S", 3)
    .list("LA", "A").list("LAP", "A", "PRIVATE").list("LA1", "A1").list("LIN", "AP").list("LB", "B").list("LROOT", null)
    .doc("DA", { entityType: "FOLDER", entityId: "A" }).doc("DB", { entityType: "FOLDER", entityId: "B" })
    .doc("DS", { entityType: "SPACE", entityId: "S" });
}

describe("a scoped grantee's tree", () => {
  it("shows the path Space and path Folder A holding only A1, at its real depth, with no siblings", () => {
    const tree = ax().on("folder", "A1", "MEMBER").tree()!;
    expect(tree.access).toBe("path");
    expect(tree.spaceRole).toBeNull();
    expect(names(tree.folders)).toEqual(["A"]);
    const a = folder(tree, "A");
    expect(a).toMatchObject({ path: true, role: null, visibility: null, ownerId: null });
    expect(names(a.childFolders)).toEqual(["A1"]);
    expect(a.boards).toEqual([]);
    expect(a.docs).toEqual([]);
    expect(a._count).toEqual({ boards: 0, childFolders: 1 });
    const a1 = folder(tree, "A1");
    expect(a1).toMatchObject({ path: false, role: "edit", visibility: "WORKSPACE" });
    expect(names(a1.boards)).toEqual(["LA1"]);
    expect(tree.boards).toEqual([]);
    expect(tree.docs).toEqual([]);
  });

  it("shows no child that is readable only because everyone at the org can open it", () => {
    const tree = ax().list("ORGL", "A", "ORG").list("ORGR", null, "ORG").on("folder", "A1", "MEMBER").tree()!;
    expect(names(folder(tree, "A").boards)).toEqual([]);
    expect(tree.boards).toEqual([]);
  });

  it("a Folder grantee sees their Folder in full, a path Space, and nothing beside it", () => {
    const tree = ax().on("folder", "A", "ADMIN").tree()!;
    expect(tree.access).toBe("path");
    expect(names(tree.folders)).toEqual(["A"]);
    const a = folder(tree, "A");
    expect(a).toMatchObject({ path: false, role: "full" });
    expect(names(a.childFolders)).toEqual(["A1"]); // the PRIVATE sub-folder is pruned under the strict rule
    expect(names(a.boards)).toEqual(["LA"]);
    expect(names(a.docs)).toEqual(["DA"]);
    expect(tree.docs).toEqual([]);
    expect(renderedCounts(tree)).toEqual({ folders: 2, lists: 2, docs: 1, tables: 0, canvases: 0 });
  });
});

describe("a full reader", () => {
  it("prunes PRIVATE Folders and Lists they cannot open", () => {
    const tree = ax().on("space", "S", "MEMBER").tree()!;
    expect(tree.access).toBe("member");
    expect(tree.spaceRole).toBe("edit");
    expect(names(tree.folders)).toEqual(["A", "B"]);
    expect(names(folder(tree, "A").childFolders)).toEqual(["A1"]);
    expect(names(folder(tree, "A").boards)).toEqual(["LA"]);
    expect(names(tree.boards)).toEqual(["LROOT"]);
    expect(names(tree.docs)).toEqual(["DS"]);
  });

  it("shows a PRIVATE Folder they own or were named on", () => {
    expect(names(folder(ax().folder("AP", "A", "PRIVATE", ME, "S", 2).on("space", "S", "MEMBER").tree()!, "A").childFolders)).toEqual(["A1", "AP"]);
    expect(folder(ax().on("space", "S", "MEMBER").on("folder", "AP", "GUEST").tree()!, "AP")).toMatchObject({ path: false, role: "view" });
  });

  it("shows a PRIVATE Folder holding a List they were given as a path", () => {
    const tree = ax().on("space", "S", "MEMBER").on("list", "LIN", "GUEST").tree()!;
    const ap = folder(tree, "AP");
    expect(ap).toMatchObject({ path: true, role: null, visibility: null, ownerId: null });
    expect(names(ap.boards)).toEqual(["LIN"]);
  });
});

describe("the legacy floor in the tree", () => {
  it("renders floor-only nodes under a rendered parent and never makes a path", () => {
    const tree = ax("legacy").on("folder", "A", "ADMIN").tree()!;
    const a = folder(tree, "A");
    expect(names(a.childFolders)).toEqual(["A1", "AP"]);
    expect(folder(tree, "AP")).toMatchObject({ path: false, role: "view" });
    expect(names(a.boards)).toEqual(["LA", "LAP"]);
  });

  it("a floor-only node under a parent that does not render stays hidden", () => {
    const t = new T("legacy").space("S").folder("Q", null, "PRIVATE").folder("QA", "Q", "WORKSPACE", ME);
    // QA is readable today through its owner only; Q gives nothing: no path, nothing renders.
    expect(t.tree()).toBeNull();
  });

  it("a floor-only canvas whose Folder does not render sits at the Space root", () => {
    const tree = new T("legacy").space("S").folder("PF", null, "PRIVATE").canvas("W", "PF").on("space", "S", "MEMBER").tree()!;
    expect(tree.folders).toEqual([]);
    expect(names(tree.whiteboards)).toEqual(["W"]);
  });
});

describe("placement", () => {
  it("nests canvases only under rendered same-Space Folders", () => {
    const tree = ax().canvas("WA", "A").canvas("WSTALE", "elsewhere").canvas("WP", "AP").on("space", "S", "MEMBER").tree()!;
    expect(names(folder(tree, "A").whiteboards)).toEqual(["WA"]);
    expect(names(tree.whiteboards)).toEqual(["WSTALE"]);
  });

  it("a canvas granted inside a PRIVATE Folder shows the Folder as a path and nests in it", () => {
    const tree = ax().canvas("WP", "AP").onObject("canvas", "WP", "GUEST").tree()!;
    expect(folder(tree, "A").path).toBe(true);
    expect(folder(tree, "AP").path).toBe(true);
    expect(names(folder(tree, "AP").whiteboards)).toEqual(["WP"]);
  });

  it("a granted sub-page with an unreadable parent sits under its top anchor's container", () => {
    const tree = ax().doc("DBS", { parentId: "DB" }).doc("DBSS", { parentId: "DBS" })
      .sharing("DBSS", { roles: { [ME]: "VIEW" }, members: { [ME]: "view" } }).tree()!;
    const b = folder(tree, "B");
    expect(b.path).toBe(true);
    expect(names(b.docs)).toEqual(["DBSS"]);
    expect(names(tree.folders)).toEqual(["B"]);
  });

  it("a granted BOARD or BOARD_ITEM doc whose List is unreadable sits under the List's container", () => {
    const t = ax();
    t.rows.items.set("I", { id: "I", organizationId: ORG, boardId: "LA1" });
    t.doc("DL", { entityType: "BOARD", entityId: "LAP" }).doc("DI", { entityType: "BOARD_ITEM", entityId: "I" })
      .sharing("DL", { roles: { [ME]: "EDIT" } }).sharing("DI", { roles: { [ME]: "COMMENT" } });
    const tree = t.tree()!;
    expect(names(folder(tree, "A").docs)).toEqual(["DL"]);
    expect(names(folder(tree, "A1").docs)).toEqual(["DI"]);
    expect(folder(tree, "A1").boards).toEqual([]);
  });

  it("a doc whose List is readable is reached through the List, not listed again", () => {
    const tree = ax().on("space", "S", "MEMBER").doc("DL", { entityType: "BOARD", entityId: "LA" }).sharing("DL", { roles: { [ME]: "EDIT" } }).tree()!;
    expect(names(folder(tree, "A").docs)).toEqual(["DA"]);
  });

  it("a table grant makes the Space a path holding that table", () => {
    const tree = ax().table("T1").table("T2").onObject("table", "T1", "MEMBER").tree()!;
    expect(tree.access).toBe("path");
    expect(tree.tables).toEqual([{ id: "T1", name: "Table T1", description: null, canManage: false, role: "edit" }]);
    expect(tree.folders).toEqual([]);
  });
});

describe("Spaces", () => {
  it("an org-wide Space is never a path", () => {
    const tree = new T().space("S", "ORG").folder("A").on("folder", "A", "ADMIN").tree()!;
    expect(tree.access).toBe("member");
    expect(tree.spaceRole).toBe("view");
  });

  it("is null when the viewer holds neither a role nor a path", () => {
    expect(ax().tree()).toBeNull();
  });
});

describe("the path view", () => {
  it("lists exactly the tree's children with Work addresses", () => {
    const tree = ax().on("folder", "A1", "MEMBER").table("T1").onObject("table", "T1", "MEMBER").tree()!;
    expect(pathViewRows(tree, { kind: "space", id: "S" }, "s").map((r) => [r.kind, r.id, r.href, r.path])).toEqual([
      ["folder", "A", "/folders/A", true],
      ["table", "T1", "/spaces/s/tables/T1", false],
    ]);
    expect(pathViewRows(tree, { kind: "folder", id: "A" }, "s").map((r) => [r.kind, r.id])).toEqual([["folder", "A1"]]);
    expect(pathViewRows(tree, { kind: "folder", id: "missing" }, "s")).toEqual([]);
  });
});

// ── the panel ─────────────────────────────────────────────────────────

function person(id: string, name: string, grants: Partial<Record<"space" | "folder" | "list" | "object", Array<[string, MemberRole]>>> = {}, over: Partial<NodeViewer> = {}, active = true): PanelPersonInput {
  const g = emptyGrants(viewer(id, over));
  for (const [k, pairs] of Object.entries(grants) as Array<[keyof typeof grants, Array<[string, MemberRole]>]>) {
    for (const [nodeId, role] of pairs ?? []) g[k].set(nodeId, role);
  }
  return { person: { id, name, email: `${id}@acme.test`, avatar: null, active }, grants: g };
}

const hrefOf = (r: { kind: string; id: string }) => `/${r.kind}/${r.id}`;

describe("accessEntries", () => {
  const panelWorld = () => ax().doc("DX", { entityType: "FOLDER", entityId: "A", createdById: "u-maker" });

  it("pins the owner first, not removable", () => {
    const t = panelWorld();
    const admin = person("u-boss", "Boss", { space: [["S", "OWNER"]] });
    const maker = person("u-maker", "Maker", { space: [["S", "MEMBER"]] });
    const out = accessEntries({ rows: t.rows, ref: { kind: "doc", id: "DX" }, people: [admin, maker], viewer: admin.grants, orgName: "Acme", hrefOf });
    expect(out.direct[0]).toMatchObject({ owner: true, role: "FULL", removable: false, editable: false, source: "Owner" });
    expect(out.direct[0].person.id).toBe("u-maker");
  });

  it("sets direct grants against inherited ones with their via, and alsoVia when an inherited role is higher", () => {
    const t = panelWorld();
    const actor = person("u-boss", "Boss", { space: [["S", "OWNER"]] });
    const guestHere = person("u-g", "Gina", { folder: [["A", "GUEST"]], space: [["S", "ADMIN"]] });
    const member = person("u-m", "Mo", { space: [["S", "MEMBER"]] });
    const out = accessEntries({ rows: t.rows, ref: { kind: "folder", id: "A" }, people: [actor, guestHere, member], viewer: actor.grants, orgName: "Acme", hrefOf });
    const gina = out.direct.find((d) => d.person.id === "u-g")!;
    expect(gina).toMatchObject({ role: "VIEW", source: "FolderMember", editable: true, removable: true });
    expect(gina.alsoVia).toEqual({ role: "FULL", via: { type: "node", kind: "space", id: "S", name: "Space S", href: "/space/S", canManage: true } });
    const byVia = out.inherited.map((e) => [e.person.id, e.role, e.via.type]);
    expect(byVia).toEqual([["u-boss", "FULL", "node"], ["u-m", "EDIT", "node"]]);
  });

  it("names a via the viewer can only pass through as hidden inherited access, never its members", () => {
    const t = panelWorld();
    const actor = person("u-a", "Ann", { folder: [["A", "ADMIN"]] });
    const member = person("u-m", "Mo", { space: [["S", "MEMBER"]] });
    const out = accessEntries({ rows: t.rows, ref: { kind: "folder", id: "A" }, people: [actor, member], viewer: actor.grants, orgName: "Acme", hrefOf });
    expect(out.inherited).toEqual([]);
    expect(out.hiddenInherited).toEqual([{ kind: "space", name: "Space S" }]);
    expect(out.viewer).toMatchObject({ role: "FULL", canManage: true, maxGrant: "FULL" });
  });

  it("marks a via the viewer cannot open at all as hidden", () => {
    // Under the legacy rule the owner of a Folder reads it with no reach into
    // its Space, and the floor never makes the Space a path for them: the
    // Space is neither openable nor on their way, so it is never named.
    const t = new T("legacy").space("S").folder("F", null, "WORKSPACE", "u-a");
    const actor = person("u-a", "Ann");
    const mo = person("u-m", "Mo", { space: [["S", "MEMBER"]] });
    const gil = person("u-g", "Gil", { folder: [["F", "GUEST"]], space: [["S", "ADMIN"]] });
    const out = accessEntries({ rows: t.rows, ref: { kind: "folder", id: "F" }, people: [actor, mo, gil], viewer: actor.grants, orgName: "Acme", hrefOf });
    expect(out.viewer.role).toBe("VIEW");
    expect(out.inherited.find((e) => e.person.id === "u-m")?.via).toEqual({ type: "hidden" });
    expect(out.direct.find((d) => d.person.id === "u-g")?.alsoVia).toEqual({ role: "FULL", via: { type: "hidden" } });
    expect(out.hiddenInherited).toEqual([]);
  });

  it("shows floor-only reach as the older rule", () => {
    const t = ax("legacy");
    const actor = person("u-boss", "Boss", { space: [["S", "OWNER"]] });
    const ann = person("u-a", "Ann", { folder: [["A", "ADMIN"]] });
    const out = accessEntries({ rows: t.rows, ref: { kind: "folder", id: "AP" }, people: [actor, ann], viewer: actor.grants, orgName: "Acme", hrefOf });
    const e = out.inherited.find((x) => x.person.id === "u-a")!;
    expect(e.via).toEqual({ type: "older_rule", from: { kind: "folder", name: "Folder A" } });
  });

  it("marks a legacy doc listing as a cap", () => {
    const t = panelWorld().sharing("DX", { members: { "u-v": "view" } });
    const actor = person("u-boss", "Boss", { space: [["S", "OWNER"]] });
    const v = person("u-v", "Vic", { space: [["S", "MEMBER"]] });
    const out = accessEntries({ rows: t.rows, ref: { kind: "doc", id: "DX" }, people: [actor, v], viewer: actor.grants, orgName: "Acme", hrefOf });
    expect(out.direct.find((d) => d.person.id === "u-v")).toMatchObject({ role: "COMMENT", cap: true, source: "DocSharingLegacy", alsoVia: null });
  });

  it("gives the everyone line per kind", () => {
    const org = new T().space("S", "ORG").folder("A").list("O", "A", "ORG");
    const out = accessEntries({ rows: org.rows, ref: { kind: "folder", id: "A" }, people: [], viewer: emptyGrants(viewer("u-x")), orgName: "Acme", hrefOf });
    expect(out.everyone).toEqual({ role: "VIEW", via: { type: "everyone", orgName: "Acme", from: { kind: "space", name: "Space S" } } });
    const t = new T().space("S");
    t.rows.forms.set("FM", { id: "FM", organizationId: ORG, createdById: OTHER, name: "Form", targetBoardId: null, targetTableId: null });
    const form = accessEntries({ rows: t.rows, ref: { kind: "form", id: "FM" }, people: [], viewer: emptyGrants(viewer("u-x")), orgName: "Acme", hrefOf });
    expect(form.everyone).toEqual({ role: "EDIT", via: { type: "everyone", orgName: "Acme", from: null } });
    const closed = accessEntries({ rows: ax().rows, ref: { kind: "folder", id: "A" }, people: [], viewer: emptyGrants(viewer("u-x")), orgName: "Acme", hrefOf });
    expect(closed.everyone).toBeNull();
  });

  it("flags the last Full holder of a Space", () => {
    const t = ax();
    const owner = person("u-o", "Olga", { space: [["S", "OWNER"]] });
    const gone = person("u-g", "Gone", { space: [["S", "ADMIN"]] }, {}, false);
    const m = person("u-m", "Mo", { space: [["S", "MEMBER"]] });
    const out = accessEntries({ rows: t.rows, ref: { kind: "space", id: "S" }, people: [owner, gone, m], viewer: owner.grants, orgName: "Acme", hrefOf });
    expect(out.direct.map((d) => [d.person.id, d.role, d.lastFull, d.removable])).toEqual([
      ["u-o", "OWNER", true, false],
      ["u-g", "FULL", false, true],
      ["u-m", "EDIT", false, true],
    ]);
  });

  it("caps each inherited group at 20 and counts the rest", () => {
    const t = ax();
    const actor = person("u-boss", "Boss", { space: [["S", "OWNER"]] });
    const many = Array.from({ length: 25 }, (_, i) => person(`u-${String(i).padStart(2, "0")}`, `P${String(i).padStart(2, "0")}`, { space: [["S", "MEMBER"]] }));
    const out = accessEntries({ rows: t.rows, ref: { kind: "folder", id: "A" }, people: [actor, ...many], viewer: actor.grants, orgName: "Acme", hrefOf });
    expect(out.inherited.length).toBe(20);
    expect(out.inheritedMore).toEqual([{ via: { type: "node", kind: "space", id: "S", name: "Space S", href: "/space/S", canManage: true }, more: 6 }]);
  });

  it("a note's panel is read only, lists its owner alone and has no admins line", () => {
    const t = new T().doc("N", { entityType: "NOTEPAD", entityId: "u-n" });
    t.rows.orgAdmins.add("u-admin");
    const owner = person("u-n", "Nell");
    const admin = person("u-admin", "Admin", {}, { orgAdmin: true });
    const out = accessEntries({ rows: t.rows, ref: { kind: "doc", id: "N" }, people: [owner, admin], viewer: admin.grants, orgName: "Acme", hrefOf });
    expect(out.notepadOwnerId).toBe("u-n");
    expect(out.viewer.canManage).toBe(false);
    expect(out.direct.map((d) => d.person.id)).toEqual(["u-n"]);
    expect(out.admins).toBeNull();
    expect(out.everyone).toBeNull();
  });

  it("a Can edit sharer on a doc cannot change a Full listing", () => {
    const t = panelWorld().sharing("DX", { roles: { "u-f": "FULL", "u-v": "VIEW" }, members: { "u-f": "edit", "u-v": "view" } });
    const actor = person("u-e", "Ed", { space: [["S", "MEMBER"]] });
    const out = accessEntries({ rows: t.rows, ref: { kind: "doc", id: "DX" }, people: [actor, person("u-f", "Fay"), person("u-v", "Val")], viewer: actor.grants, orgName: "Acme", hrefOf });
    expect(out.viewer).toMatchObject({ role: "EDIT", canManage: true, maxGrant: "EDIT" });
    expect(out.direct.find((d) => d.person.id === "u-f")).toMatchObject({ editable: false, removable: false });
    expect(out.direct.find((d) => d.person.id === "u-v")).toMatchObject({ editable: true, removable: true });
  });
});

// ── General access wording and the doc Restricted switch ─────────────

describe("inheritanceOf: what a Folder or List inherits from", () => {
  const rows = () => {
    const r = emptyRows(ORG, "legacy");
    r.spaces.set("S", { id: "S", organizationId: ORG, name: "Space S", slug: "s", icon: null, color: null, visibility: "WORKSPACE", ownerId: OTHER });
    const folder = (id: string, parent: string | null, visibility: "PRIVATE" | "WORKSPACE") =>
      r.folders.set(id, { id, organizationId: ORG, spaceId: "S", parentFolderId: parent, name: `Folder ${id}`, icon: null, color: null, visibility, ownerId: OTHER, position: 0 });
    folder("Q", null, "PRIVATE");
    folder("Q1", "Q", "WORKSPACE");
    r.lists.set("LQ", { id: "LQ", organizationId: ORG, spaceId: "S", folderId: "Q", name: "List Q", slug: "lq", icon: null, color: null, visibility: "WORKSPACE", ownerId: OTHER });
    r.lists.set("LR", { id: "LR", organizationId: ORG, spaceId: "S", folderId: null, name: "List R", slug: "lr", icon: null, color: null, visibility: "WORKSPACE", ownerId: OTHER });
    return r;
  };
  it("names the List's own Folder, and the Restricted Folder above it, never the Space alone", () => {
    expect(inheritanceOf(rows(), { kind: "list", id: "LQ" })).toEqual({
      inheritsFrom: { kind: "folder", id: "Q", name: "Folder Q" },
      restrictedAbove: { id: "Q", name: "Folder Q" },
    });
  });
  it("names the parent Folder of a nested Folder", () => {
    expect(inheritanceOf(rows(), { kind: "folder", id: "Q1" }).inheritsFrom).toEqual({ kind: "folder", id: "Q", name: "Folder Q" });
  });
  it("names the Space at a Space's root, with nothing Restricted above", () => {
    expect(inheritanceOf(rows(), { kind: "list", id: "LR" })).toEqual({ inheritsFrom: { kind: "space", id: "S", name: "Space S" }, restrictedAbove: null });
    expect(inheritanceOf(rows(), { kind: "folder", id: "Q" })).toEqual({ inheritsFrom: { kind: "space", id: "S", name: "Space S" }, restrictedAbove: null });
  });
});

describe("keepsRestrictedDoc: who still opens a doc once it is Restricted", () => {
  const rows = () => {
    const r = emptyRows(ORG, "legacy");
    r.docs.set("D", { id: "D", organizationId: ORG, title: "D", entityType: "FOLDER", entityId: "F", parentId: null, createdById: OTHER });
    return r;
  };
  it("the people listed on it, its creator and org admins", () => {
    const r = rows();
    r.docSharing.set("D", { roles: { listed: "EDIT" }, members: { legacy: "view" } });
    r.orgAdmins.add("admin");
    expect(keepsRestrictedDoc(r, "D", "listed")).toBe(true);
    expect(keepsRestrictedDoc(r, "D", "legacy")).toBe(true);
    expect(keepsRestrictedDoc(r, "D", OTHER)).toBe(true);
    expect(keepsRestrictedDoc(r, "D", "admin")).toBe(true);
  });
  it("never someone who reaches it only through where it lives", () => {
    expect(keepsRestrictedDoc(rows(), "D", ME)).toBe(false);
  });
});
