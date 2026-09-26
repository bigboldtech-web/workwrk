// THE PLACEMENT RULE (node-rules.ts P1 to P7), one block per rule. Each block
// is written from the worst case the founder named on 2026-09-25: a person
// with a narrow grant reshaping or breaking a structure other people depend
// on, and a person with Can view creating content. Every assertion below
// fails if its rule is taken out.

import { describe, expect, it } from "vitest";
import {
  anchorAgreesWithParent,
  createDecision,
  createRefusal,
  currentPlace,
  derivePlacement,
  emptyGrants,
  emptyRows,
  fileMoveVerdict,
  folderDeleteAllowed,
  moveDecision,
  moveRefusal,
  moveVerdict,
  objectGrantKey,
  placeHolds,
  type MemberRole,
  type NodeRef,
  type NodeRows,
  type NodeViewer,
  type NodeVisibility,
  type Place,
  type PlaceKind,
  type PrivateRule,
  type ViewerGrants,
} from "./node-rules";

const ORG = "org-1";
const ME = "u-me";
const OTHER = "u-other";
const CUTOFF = Date.UTC(2026, 8, 25);
const NEW = CUTOFF + 1;
const OLD = CUTOFF - 1;

function viewer(over: Partial<NodeViewer> = {}): NodeViewer {
  return { userId: ME, orgAdmin: false, orgGuest: false, isAgent: false, denied: false, ...over };
}

class W {
  rows: NodeRows;
  g: ViewerGrants;
  constructor(rule: PrivateRule = "legacy") {
    this.rows = emptyRows(ORG, rule);
    this.rows.legacyBefore = CUTOFF;
    this.g = emptyGrants(viewer());
    this.g.since = new Map();
  }
  space(id: string, visibility: NodeVisibility = "WORKSPACE") {
    this.rows.spaces.set(id, { id, organizationId: ORG, name: id, slug: id, icon: null, color: null, visibility, ownerId: OTHER });
    return this;
  }
  folder(id: string, spaceId: string, parent: string | null = null, o: { visibility?: NodeVisibility; archived?: boolean; ownerId?: string } = {}) {
    this.rows.folders.set(id, {
      id, organizationId: ORG, spaceId, parentFolderId: parent, name: id, icon: null, color: null,
      visibility: o.visibility ?? "WORKSPACE", ownerId: o.ownerId ?? OTHER, position: 0, ...(o.archived ? { archived: true } : {}),
    });
    return this;
  }
  list(id: string, spaceId: string | null, folderId: string | null, visibility: NodeVisibility = "WORKSPACE") {
    this.rows.lists.set(id, { id, organizationId: ORG, spaceId, folderId, name: id, slug: id, icon: null, color: null, visibility, ownerId: OTHER });
    return this;
  }
  doc(id: string, o: { entityType?: string; entityId?: string; parentId?: string; createdById?: string } = {}) {
    this.rows.docs.set(id, {
      id, organizationId: ORG, title: id, entityType: o.entityType ?? null, entityId: o.entityId ?? null,
      parentId: o.parentId ?? null, createdById: o.createdById ?? OTHER, createdAt: new Date(NEW),
    });
    return this;
  }
  item(id: string, boardId: string) {
    this.rows.items.set(id, { id, organizationId: ORG, boardId });
    return this;
  }
  canvas(id: string, spaceId: string | null, folderId: string | null = null, ownerId: string = OTHER) {
    this.rows.canvases.set(id, { id, organizationId: ORG, spaceId, folderId, ownerId, name: id });
    return this;
  }
  table(id: string, spaceId: string | null, createdById: string = OTHER) {
    this.rows.tables.set(id, { id, organizationId: ORG, spaceId, createdById, name: id });
    return this;
  }
  on(kind: "space" | "folder" | "list", id: string, role: MemberRole, at: number = NEW) {
    this.g[kind].set(id, role);
    this.g.since?.set(`${kind}:${id}`, at);
    return this;
  }
  onObject(kind: "table" | "canvas" | "form", id: string, role: MemberRole) {
    this.g.object.set(objectGrantKey(kind, id), role);
    return this;
  }
  onDoc(id: string, role: "FULL" | "EDIT" | "COMMENT" | "VIEW") {
    const entry = this.rows.docSharing.get(id) ?? {};
    this.rows.docSharing.set(id, { ...entry, roles: { ...(entry.roles ?? {}), [ME]: role } });
    return this;
  }
  as(v: Partial<NodeViewer>) {
    this.g = { ...this.g, viewer: viewer(v) };
    return this;
  }
  creates(place: Place, what: PlaceKind) {
    return createDecision(this.rows, this.g, place, what);
  }
  move(ref: NodeRef, dest: Place) {
    return moveVerdict(this.rows, this.g, ref, dest);
  }
}

const sp = (id: string): NodeRef => ({ kind: "space", id });
const fo = (id: string): NodeRef => ({ kind: "folder", id });
const li = (id: string): NodeRef => ({ kind: "list", id });
const pg = (id: string): NodeRef => ({ kind: "doc", id });

// ── P1: Can edit creates, Can view and Can comment never do ───────────

describe("P1 create inside a container needs Can edit", () => {
  const world = () => new W().space("S").space("O", "ORG").folder("F", "S").folder("FT", "S", null, { archived: true }).folder("FT1", "S", "FT").list("L", "S", "F");

  it("a Can view grant on a Folder creates nothing in it: no doc, List, sub-folder, canvas or file", () => {
    const w = world().on("folder", "F", "GUEST");
    for (const what of ["doc", "list", "folder", "canvas", "file"] as const) expect(w.creates(fo("F"), what)).toBe(false);
  });

  it("Can edit on the Folder creates every kind a Folder holds, and never a table (tables live at a Space root)", () => {
    const w = world().on("folder", "F", "MEMBER");
    for (const what of ["doc", "list", "folder", "canvas", "file"] as const) expect(w.creates(fo("F"), what)).toBe(true);
    expect(w.creates(fo("F"), "table")).toBe(false);
  });

  it("a Space viewer creates nothing at the Space root, a Space member creates every kind there", () => {
    const guest = world().on("space", "S", "GUEST");
    for (const what of ["doc", "list", "folder", "canvas", "table", "file"] as const) expect(guest.creates(sp("S"), what)).toBe(false);
    const member = world().on("space", "S", "MEMBER");
    for (const what of ["doc", "list", "folder", "canvas", "table", "file"] as const) expect(member.creates(sp("S"), what)).toBe(true);
  });

  it("the org-wide reach of an org-wide Space is Can view: it creates nothing there", () => {
    const w = world();
    for (const what of ["doc", "canvas", "table", "list"] as const) expect(w.creates(sp("O"), what)).toBe(false);
  });

  it("Can edit on one doc makes sub-pages under it; Can comment and Can view never do", () => {
    const base = () => world().doc("P", { entityType: "FOLDER", entityId: "F" });
    expect(base().onDoc("P", "EDIT").creates(pg("P"), "doc")).toBe(true);
    expect(base().onDoc("P", "COMMENT").creates(pg("P"), "doc")).toBe(false);
    expect(base().onDoc("P", "VIEW").creates(pg("P"), "doc")).toBe(false);
  });

  it("a doc on a List or on a task needs Can edit on the List", () => {
    expect(world().on("list", "L", "GUEST").creates(li("L"), "doc")).toBe(false);
    expect(world().on("list", "L", "MEMBER").creates(li("L"), "doc")).toBe(true);
  });

  it("nothing is created in a Folder in Trash, or in a Folder under one", () => {
    const w = world().on("space", "S", "ADMIN");
    expect(w.creates(fo("FT"), "list")).toBe(false);
    expect(w.creates(fo("FT1"), "doc")).toBe(false);
  });

  it("the org root keeps today's rule: a doc, a table and a form for anyone signed in, a canvas and a file for Members, never a List or a Folder", () => {
    const member = world();
    for (const what of ["doc", "table", "form", "canvas", "file"] as const) expect(member.creates(null, what)).toBe(true);
    expect(member.creates(null, "list")).toBe(false);
    expect(member.creates(null, "folder")).toBe(false);
    const guest = world().as({ orgGuest: true });
    expect(guest.creates(null, "doc")).toBe(true);
    expect(guest.creates(null, "canvas")).toBe(false);
    expect(guest.creates(null, "file")).toBe(false);
  });

  it("an org admin creates in every container; a denied viewer nowhere", () => {
    const admin = world().as({ orgAdmin: true });
    expect(admin.creates(fo("F"), "list")).toBe(true);
    expect(admin.creates(sp("S"), "table")).toBe(true);
    const denied = world().on("space", "S", "OWNER").as({ denied: true });
    expect(denied.creates(sp("S"), "doc")).toBe(false);
    expect(denied.creates(null, "doc")).toBe(false);
  });

  it("P7: a Space OWNER or ADMIN from before the cutoff makes Lists and Folders in a Private Folder that does not name them; a new row does not, and neither makes a doc there", () => {
    const build = (at: number) => new W().space("S").folder("PF", "S", null, { visibility: "PRIVATE" }).on("space", "S", "ADMIN", at);
    const old = build(OLD);
    expect(old.creates(fo("PF"), "list")).toBe(true);
    expect(old.creates(fo("PF"), "folder")).toBe(true);
    expect(old.creates(fo("PF"), "doc")).toBe(false);
    expect(build(NEW).creates(fo("PF"), "list")).toBe(false);
  });

  it("placeHolds: which kinds may live where", () => {
    expect(placeHolds(fo("F"), "table")).toBe(false);
    expect(placeHolds(null, "list")).toBe(false);
    expect(placeHolds(pg("P"), "doc")).toBe(true);
    expect(placeHolds(pg("P"), "canvas")).toBe(false);
    expect(placeHolds(null, "form")).toBe(true);
    expect(placeHolds(sp("S"), "form")).toBe(false);
  });
});

// ── P2: Full on the node and on what it leaves, Can edit where it goes ─

describe("P2 a move needs Full access on the node and where it is now, and Can edit where it goes", () => {
  /** Space S: F (holds A and B, A holds LA), G, list LF in F, LROOT at the root. Space T: TF. Org-wide Space O. */
  const world = (rule: PrivateRule = "legacy") =>
    new W(rule).space("S").space("T").space("O", "ORG")
      .folder("F", "S").folder("A", "S", "F").folder("B", "S", "F").folder("G", "S").folder("TF", "T")
      .list("LF", "S", "F").list("LA", "S", "A").list("LROOT", "S", null);

  it("(a) a Folder Full grantee cannot drag their Folder into another Space, even onto a Folder they hold Full on", () => {
    for (const rule of ["legacy", "strict"] as const) {
      const w = world(rule).on("folder", "F", "ADMIN").on("folder", "TF", "ADMIN");
      expect(w.move(fo("F"), fo("TF"))).toEqual({ ok: false, failure: "source" });
      expect(w.move(fo("F"), sp("T"))).toEqual({ ok: false, failure: "source" });
    }
  });

  it("Full access on the node and on its current container, and Can edit where it goes: allowed (Can edit is enough at the destination)", () => {
    const w = world().on("folder", "F", "ADMIN").on("folder", "G", "MEMBER");
    expect(w.move(fo("A"), fo("G"))).toEqual({ ok: true, same: false });
    expect(w.move(li("LA"), fo("G"))).toEqual({ ok: true, same: false });
  });

  it("Can view where it goes never takes it", () => {
    const w = world().on("folder", "F", "ADMIN").on("folder", "G", "GUEST");
    expect(w.move(fo("A"), fo("G"))).toEqual({ ok: false, failure: "destination" });
  });

  it("Full access on the node alone never takes it out of its parent", () => {
    const w = world().on("folder", "A", "ADMIN").on("folder", "G", "ADMIN");
    expect(w.move(fo("A"), fo("G"))).toEqual({ ok: false, failure: "source" });
    const l = world().on("list", "LROOT", "ADMIN").on("folder", "G", "ADMIN");
    expect(l.move(li("LROOT"), fo("G"))).toEqual({ ok: false, failure: "source" });
  });

  it("Can edit on the node is not Full access: refused on the node", () => {
    const w = world().on("space", "S", "MEMBER");
    expect(w.move(fo("A"), fo("G"))).toEqual({ ok: false, failure: "node" });
  });

  it("leaving the Space also needs Full access on the Space it leaves", () => {
    const w = world().on("folder", "F", "ADMIN").on("folder", "TF", "ADMIN");
    expect(w.move(fo("A"), fo("TF"))).toEqual({ ok: false, failure: "source" });
    expect(w.move(li("LF"), fo("TF"))).toEqual({ ok: false, failure: "source" });
    const both = world().on("space", "S", "ADMIN").on("folder", "TF", "MEMBER");
    expect(both.move(fo("A"), fo("TF"))).toEqual({ ok: true, same: false });
  });

  it("P7: the Full holders of both ends inside one Space move as before", () => {
    const w = world().on("folder", "A", "ADMIN").on("folder", "G", "ADMIN");
    expect(w.move(li("LA"), fo("G"))).toEqual({ ok: true, same: false });
  });

  it("P7: a Space editor still moves Folders and Lists anywhere they manage, across Spaces included", () => {
    const old = world().on("space", "S", "ADMIN", OLD).on("space", "T", "ADMIN", OLD);
    expect(old.move(fo("F"), fo("TF")).ok).toBe(true);
    expect(old.move(li("LA"), fo("G")).ok).toBe(true);
    const fresh = world("strict").on("space", "S", "ADMIN").on("space", "T", "ADMIN");
    expect(fresh.move(fo("F"), sp("T")).ok).toBe(true);
  });

  it("P7: a Space ADMIN from before the cutoff moves a List into a Private Folder that does not name them; a new row does not", () => {
    const build = (at: number) => new W().space("S").folder("PF", "S", null, { visibility: "PRIVATE" }).list("L", "S", null).on("space", "S", "ADMIN", at);
    expect(build(OLD).move(li("L"), fo("PF")).ok).toBe(true);
    expect(build(NEW).move(li("L"), fo("PF"))).toEqual({ ok: false, failure: "destination" });
  });

  it("an org admin moves anything; a denied viewer nothing", () => {
    expect(world().as({ orgAdmin: true }).move(fo("F"), fo("TF")).ok).toBe(true);
    expect(world().on("space", "S", "OWNER").as({ denied: true }).move(fo("A"), fo("G")).ok).toBe(false);
  });

  it("(e) a Can edit holder of one doc cannot move it into an org-wide Space they only view", () => {
    const w = world().doc("D", { entityType: "FOLDER", entityId: "F" }).onDoc("D", "EDIT");
    expect(w.move(pg("D"), sp("O"))).toEqual({ ok: false, failure: "node" });
    // Even Full access on the doc and on its Folder does not drop it into a Space they only read.
    const full = world().doc("D", { entityType: "FOLDER", entityId: "F", createdById: ME }).on("folder", "F", "ADMIN").on("space", "S", "ADMIN");
    expect(full.move(pg("D"), sp("O"))).toEqual({ ok: false, failure: "destination" });
    expect(full.move(pg("D"), fo("G")).ok).toBe(true);
  });

  it("a doc's creator who only edits the Folder it sits in cannot take it out of that Folder", () => {
    const w = world().on("space", "S", "MEMBER").doc("D", { entityType: "FOLDER", entityId: "F", createdById: ME });
    expect(w.move(pg("D"), fo("G"))).toEqual({ ok: false, failure: "source" });
  });

  it("a sub-page leaves its parent page only with Full access on that page", () => {
    const w = world().doc("P", { entityType: "FOLDER", entityId: "F" }).doc("SUB", { parentId: "P", createdById: ME }).on("folder", "G", "ADMIN");
    w.onDoc("P", "EDIT");
    expect(currentPlace(w.rows, pg("SUB"))).toEqual(pg("P"));
    expect(w.move(pg("SUB"), fo("G"))).toEqual({ ok: false, failure: "source" });
    w.onDoc("P", "FULL");
    expect(w.move(pg("SUB"), fo("G")).ok).toBe(true);
  });

  it("a doc on a task lives on the task's List", () => {
    const w = world().item("T1", "LA").doc("TD", { entityType: "BOARD_ITEM", entityId: "T1" });
    expect(currentPlace(w.rows, pg("TD"))).toEqual(li("LA"));
  });

  it("M3: a canvas's own grant never moves it, even Full access", () => {
    const w = world().canvas("C", "S", "F").onObject("canvas", "C", "ADMIN").on("folder", "G", "ADMIN");
    expect(w.move({ kind: "canvas", id: "C" }, fo("G"))).toEqual({ ok: false, failure: "node" });
  });

  it("a canvas out of every Space (the whole org opens it) needs Full access on its Folder and on its Space", () => {
    const folderOnly = world().canvas("C", "S", "F").on("folder", "F", "ADMIN");
    expect(folderOnly.move({ kind: "canvas", id: "C" }, null)).toEqual({ ok: false, failure: "source" });
    const spaceToo = world().canvas("C", "S", "F").on("space", "S", "ADMIN");
    expect(spaceToo.move({ kind: "canvas", id: "C" }, null)).toEqual({ ok: true, same: false });
    const contributor = world().canvas("C", "S", "F").on("space", "S", "MEMBER", OLD);
    expect(contributor.move({ kind: "canvas", id: "C" }, null).ok).toBe(false);
  });

  it("a canvas moves into a Folder, not only a Space, under the same rule", () => {
    const w = world().canvas("C", "S", null).on("space", "S", "ADMIN");
    expect(w.move({ kind: "canvas", id: "C" }, fo("G")).ok).toBe(true);
    expect(w.move({ kind: "canvas", id: "C" }, fo("TF"))).toEqual({ ok: false, failure: "destination" });
  });

  it("a table's creator who only edits its Space cannot move it out; a Space manager can; the table's own grant never can", () => {
    const creator = world().table("TB", "S", ME).on("space", "S", "MEMBER").on("space", "T", "ADMIN");
    expect(creator.move({ kind: "table", id: "TB" }, sp("T"))).toEqual({ ok: false, failure: "source" });
    const manager = world().table("TB", "S").on("space", "S", "ADMIN").on("space", "T", "MEMBER");
    expect(manager.move({ kind: "table", id: "TB" }, sp("T")).ok).toBe(true);
    const granted = world().table("TB", "S").onObject("table", "TB", "ADMIN").on("space", "T", "ADMIN");
    expect(granted.move({ kind: "table", id: "TB" }, sp("T"))).toEqual({ ok: false, failure: "node" });
  });

  it("a table outside every Space moves into a Space its creator can edit", () => {
    const w = world().table("TB", null, ME).on("space", "T", "MEMBER");
    expect(w.move({ kind: "table", id: "TB" }, sp("T")).ok).toBe(true);
    expect(w.move({ kind: "table", id: "TB" }, fo("TF")).ok).toBe(false);
  });

  it("the boolean form answers the same", () => {
    const w = world().on("folder", "F", "ADMIN").on("folder", "TF", "ADMIN");
    expect(moveDecision(w.rows, w.g, fo("F"), fo("TF"))).toBe(false);
  });
});

// ── P4: the same parent is a reorder ─────────────────────────────────

describe("P4 a reorder under the parent it already has", () => {
  const world = () => new W().space("S").folder("F", "S").folder("A", "S", "F").folder("B", "S", "F");

  it("is `same`, and needs Full access on the node and on that parent, as reordering does today", () => {
    const w = world().on("folder", "F", "ADMIN");
    expect(w.move(fo("A"), fo("F"))).toEqual({ ok: true, same: true });
    const nodeOnly = world().on("folder", "A", "ADMIN");
    expect(nodeOnly.move(fo("A"), fo("F"))).toEqual({ ok: false, failure: "source" });
  });

  it("a reorder that changes the parent is a move", () => {
    const w = world().on("folder", "F", "ADMIN");
    expect(w.move(fo("A"), fo("B"))).toEqual({ ok: true, same: false });
  });
});

// ── P3: the Space comes from the parent ──────────────────────────────

describe("P3 a node's Space is derived from its parent", () => {
  const folder = (o: Partial<{ id: string; organizationId: string; spaceId: string; inTrash: boolean }> = {}) =>
    ({ id: "F", organizationId: ORG, spaceId: "A", inTrash: false, ...o });
  const space = (o: Partial<{ id: string; organizationId: string; archived: boolean }> = {}) => ({ id: "A", organizationId: ORG, archived: false, ...o });

  it("(b) a Space that disagrees with the parent Folder is refused", () => {
    expect(derivePlacement(ORG, { spaceId: "B", folderId: "F" }, { folder: folder(), space: space() })).toEqual({ ok: false, status: 400, message: "That folder is in another Space." });
  });

  it("the parent settles the Space when the request names none", () => {
    expect(derivePlacement(ORG, { folderId: "F" }, { folder: folder(), space: space() })).toEqual({ ok: true, spaceId: "A", folderId: "F" });
    expect(derivePlacement(ORG, { spaceId: "A", folderId: "F" }, { folder: folder(), space: space() })).toEqual({ ok: true, spaceId: "A", folderId: "F" });
  });

  it("a parent from another org, or one that matched nothing, is not found", () => {
    expect(derivePlacement(ORG, { folderId: "F" }, { folder: folder({ organizationId: "org-2" }), space: space() }).ok).toBe(false);
    expect(derivePlacement(ORG, { folderId: "F" }, { folder: null, space: null })).toMatchObject({ ok: false, status: 404 });
  });

  it("a parent in Trash is refused", () => {
    expect(derivePlacement(ORG, { folderId: "F" }, { folder: folder({ inTrash: true }), space: space() })).toMatchObject({ ok: false, status: 400 });
  });

  it("the Space root: a Space in the org and not archived", () => {
    expect(derivePlacement(ORG, { spaceId: "A" }, { space: space() })).toEqual({ ok: true, spaceId: "A", folderId: null });
    expect(derivePlacement(ORG, { spaceId: "A" }, { space: space({ organizationId: "org-2" }) })).toMatchObject({ ok: false, status: 404 });
    expect(derivePlacement(ORG, { spaceId: "A" }, { space: space({ archived: true }) })).toMatchObject({ ok: false, status: 400 });
  });

  it("no Folder and no Space is the org root only for the kinds that may live there", () => {
    expect(derivePlacement(ORG, {}, {}, { root: true })).toEqual({ ok: true, spaceId: null, folderId: null });
    expect(derivePlacement(ORG, {}, {})).toMatchObject({ ok: false, status: 400 });
  });

  it("a sub-page's anchor must be its parent page's", () => {
    const home = { kind: "anchor" as const, entityType: "FOLDER", entityId: "F" };
    expect(anchorAgreesWithParent(null, home)).toBe(true);
    expect(anchorAgreesWithParent({ entityType: "FOLDER", entityId: "F" }, home)).toBe(true);
    expect(anchorAgreesWithParent({ entityType: "SPACE", entityId: "B" }, home)).toBe(false);
    expect(anchorAgreesWithParent({ entityType: "SPACE", entityId: "B" }, { kind: "root" })).toBe(false);
    expect(anchorAgreesWithParent({ entityType: "SPACE", entityId: "B" }, { kind: "closed" })).toBe(false);
  });
});

// ── the delete that takes a subtree ──────────────────────────────────

describe("a Folder delete takes only what the viewer manages", () => {
  const world = () =>
    new W().space("S").folder("FX", "S").folder("FX1", "S", "FX").folder("FXP", "S", "FX", { visibility: "PRIVATE" })
      .list("LX", "S", "FX").canvas("CX", "S", "FX1");
  const inside = { folders: ["FX1", "FXP"], lists: ["LX"], canvases: ["CX"] };

  it("a Folder Full grantee cannot trash a Folder holding a Private sub-folder that does not name them", () => {
    for (const rule of ["legacy", "strict"] as const) {
      const w = world().on("folder", "FX", "ADMIN");
      w.rows.privateRule = rule;
      expect(folderDeleteAllowed(w.rows, w.g, "FX", inside)).toBe(false);
    }
  });

  it("with Full access on everything inside, they can", () => {
    const w = world().on("folder", "FX", "ADMIN").on("folder", "FXP", "ADMIN");
    expect(folderDeleteAllowed(w.rows, w.g, "FX", inside)).toBe(true);
  });

  it("a Space manager and an org admin keep today's delete", () => {
    expect(folderDeleteAllowed(world().on("space", "S", "ADMIN").rows, world().on("space", "S", "ADMIN").g, "FX", inside)).toBe(true);
    const admin = world().as({ orgAdmin: true });
    expect(folderDeleteAllowed(admin.rows, admin.g, "FX", inside)).toBe(true);
  });

  it("Can edit on the Folder never deletes it", () => {
    const w = world().on("folder", "FX", "MEMBER");
    expect(folderDeleteAllowed(w.rows, w.g, "FX", { folders: [], lists: [], canvases: [] })).toBe(false);
  });
});

// ── P6: the sentences ────────────────────────────────────────────────

describe("P6 a refusal names what is needed in one plain sentence", () => {
  it("the move sentences", () => {
    expect(moveRefusal("folder", "source")).toBe("You need Full access where this folder is now and Can edit where it is going.");
    expect(moveRefusal("folder", "destination")).toBe("You need Full access where this folder is now and Can edit where it is going.");
    expect(moveRefusal("list", "node")).toBe("You need Full access to this List to move it.");
  });

  it("the create sentences", () => {
    expect(createRefusal("doc", fo("F"))).toBe("You need Can edit on this folder to add a doc to it.");
    expect(createRefusal("list", sp("S"))).toBe("You need Can edit on this Space to add a List to it.");
    expect(createRefusal("canvas", null)).toBe("Only members of the workspace can add a canvas outside a Space.");
    expect(createRefusal("table", fo("F"))).toBe("A table can't be added there.");
  });

  it("no sentence carries a dash pair or a long dash", () => {
    const all = [
      moveRefusal("folder", "source"), moveRefusal("doc", "node"), createRefusal("form", null), createRefusal("doc", pg("P")),
    ];
    for (const s of all) {
      expect(s).not.toMatch(/-{2}/);
      expect(s).not.toMatch(/[\u2013\u2014]/);
    }
  });
});

// ── P2 for a file placed in the Space tree ───────────────────────────

describe("P2 for a file in a Space or one of its Folders", () => {
  const world = () => new W().space("S").space("T").folder("F", "S").folder("G", "S").folder("TF", "T");
  const inF = (uploadedById: string = OTHER) => ({ spaceId: "S", spaceFolderId: "F", uploadedById });

  it("a reader who did not upload it and does not manage its Folder cannot move it anywhere", () => {
    const w = world().on("space", "S", "GUEST");
    expect(fileMoveVerdict(w.rows, w.g, inF(), null)).toEqual({ ok: false, failure: "node" });
  });

  it("its uploader who only edits the Folder cannot take it out of the Folder", () => {
    const w = world().on("space", "S", "MEMBER");
    expect(fileMoveVerdict(w.rows, w.g, inF(ME), fo("G"))).toEqual({ ok: false, failure: "source" });
  });

  it("Full access on its Folder moves it within the Space, never out of it or out to the whole org", () => {
    const w = world().on("folder", "F", "ADMIN").on("folder", "G", "MEMBER").on("folder", "TF", "ADMIN");
    expect(fileMoveVerdict(w.rows, w.g, inF(), fo("G"))).toEqual({ ok: true, same: false });
    expect(fileMoveVerdict(w.rows, w.g, inF(), fo("TF"))).toEqual({ ok: false, failure: "source" });
    expect(fileMoveVerdict(w.rows, w.g, inF(), null)).toEqual({ ok: false, failure: "source" });
  });

  it("a Space manager moves it anywhere they can edit; Can view where it goes never takes it", () => {
    const w = world().on("space", "S", "ADMIN").on("folder", "TF", "MEMBER");
    expect(fileMoveVerdict(w.rows, w.g, inF(), fo("TF")).ok).toBe(true);
    const viewOnly = world().on("space", "S", "ADMIN").on("folder", "TF", "GUEST");
    expect(fileMoveVerdict(viewOnly.rows, viewOnly.g, inF(), fo("TF"))).toEqual({ ok: false, failure: "destination" });
  });

  it("a file in no Space moves by its uploader into a Space they can edit", () => {
    const w = world().on("space", "T", "MEMBER");
    const loose = { spaceId: null, spaceFolderId: null, uploadedById: ME };
    expect(fileMoveVerdict(w.rows, w.g, loose, sp("T")).ok).toBe(true);
    expect(fileMoveVerdict(w.rows, w.g, { ...loose, uploadedById: OTHER }, sp("T"))).toEqual({ ok: false, failure: "node" });
  });
});
