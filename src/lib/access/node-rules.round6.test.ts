// Round six of the placement rule (node-rules.ts P1 to P7): the breaks the
// round five attackers proved, as unit tests that fail without their rule.
//
//   break 3  in an org-wide Space every Member held Can edit on the docs and
//            tables inside while the Space read Can view (R6b and R7b lifted
//            the "everyone" reach, and the legacy floor lifted it again), so a
//            person with no membership at all added sub-pages, rewrote docs,
//            imported into tables and pointed forms at them: the org-wide
//            rule is no row, it gives the Space's Can view on what is inside.
//   breaks 5 and 6  a Space OWNER or ADMIN could no longer take someone
//            else's canvas, doc or table out of their Space (the "landing"
//            failure), which worked before node-access: P7 exempts the
//            manager of the Space it leaves; the return trip is P2's (the
//            node's owner or an org admin), and a narrow grant still never
//            takes a node out of every Space.
//   item 4   POST /api/docs made a doc on any anchor string, which fell
//            through R6's open fallback: DOC_ANCHOR_KINDS is the one set.

import { describe, expect, it } from "vitest";
import {
  DOC_ANCHOR_KINDS,
  DOC_ANCHOR_REFUSAL,
  NODE_ACCESS_DELTAS,
  NodeEvaluator,
  createDecision,
  emptyGrants,
  emptyRows,
  fileMoveVerdict,
  formDestinationVerdict,
  isDocAnchorKind,
  moveRefusal,
  moveVerdict,
  objectGrantKey,
  type MemberRole,
  type NodeRef,
  type NodeRole,
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
  folder(id: string, spaceId: string, parent: string | null = null, visibility: NodeVisibility = "WORKSPACE") {
    this.rows.folders.set(id, {
      id, organizationId: ORG, spaceId, parentFolderId: parent, name: id, icon: null, color: null, visibility, ownerId: OTHER, position: 0,
    });
    return this;
  }
  list(id: string, spaceId: string, folderId: string | null, visibility: NodeVisibility = "WORKSPACE") {
    this.rows.lists.set(id, { id, organizationId: ORG, spaceId, folderId, name: id, slug: id, icon: null, color: null, visibility, ownerId: OTHER });
    return this;
  }
  doc(id: string, o: { entityType?: string; entityId?: string; parentId?: string; createdById?: string; at?: number } = {}) {
    this.rows.docs.set(id, {
      id, organizationId: ORG, title: id, entityType: o.entityType ?? null, entityId: o.entityId ?? null,
      parentId: o.parentId ?? null, createdById: o.createdById ?? OTHER, createdAt: new Date(o.at ?? NEW),
    });
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
  form(id: string, o: { list?: string | null; table?: string | null; createdById?: string } = {}) {
    this.rows.forms.set(id, { id, organizationId: ORG, createdById: o.createdById ?? OTHER, name: id, targetBoardId: o.list ?? null, targetTableId: o.table ?? null });
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
  as(v: Partial<NodeViewer>) {
    this.g = { ...this.g, viewer: viewer(v) };
    return this;
  }
  role(ref: NodeRef): NodeRole {
    return new NodeEvaluator(this.rows, this.g).effective(ref).role;
  }
  move(ref: NodeRef, dest: Place) {
    return moveVerdict(this.rows, this.g, ref, dest);
  }
  create(place: Place, what: PlaceKind): boolean {
    return createDecision(this.rows, this.g, place, what);
  }
}

const sp = (id: string): NodeRef => ({ kind: "space", id });
const fo = (id: string): NodeRef => ({ kind: "folder", id });
const li = (id: string): NodeRef => ({ kind: "list", id });
const cv = (id: string): NodeRef => ({ kind: "canvas", id });
const dc = (id: string): NodeRef => ({ kind: "doc", id });
const tb = (id: string): NodeRef => ({ kind: "table", id });

// ── break 3: the org-wide reach is Can view, on what is inside too ──

describe("break 3: the org-wide reach gives Can view on the docs and tables inside, as on the Space itself", () => {
  // An org-wide Space O with a Folder, a List in it, docs on the Space, the
  // Folder and the List, a sub-page, a table and a canvas, all someone else's.
  const orgWide = (rule: PrivateRule = "legacy") =>
    new W(rule).space("O", "ORG").folder("FO", "O").list("LO", "O", "FO")
      .doc("DO", { entityType: "SPACE", entityId: "O" }).doc("DO1", { parentId: "DO" })
      .doc("DF", { entityType: "FOLDER", entityId: "FO" }).doc("DL", { entityType: "BOARD", entityId: "LO" })
      .table("TO", "O").canvas("CO", "O");

  it("a Member with no row at all views the Space and every doc, sub-page and table inside it, and edits none of them", () => {
    for (const rule of ["legacy", "strict"] as const) {
      const w = orgWide(rule);
      expect(w.role(sp("O"))).toBe("VIEW");
      for (const id of ["DO", "DO1", "DF", "DL"]) expect(w.role(dc(id)), `${rule} ${id}`).toBe("VIEW");
      expect(w.role(tb("TO"))).toBe("VIEW");
      expect(w.role(cv("CO"))).toBe("VIEW");
      expect(w.role(li("LO"))).toBe("VIEW");
    }
  });

  it("so Can view never creates there: no sub-page under its docs, no doc in the Space or its Folder, no form pointed at its table (P1)", () => {
    const w = orgWide();
    expect(w.create(dc("DO"), "doc")).toBe(false);
    expect(w.create(dc("DO1"), "doc")).toBe(false);
    expect(w.create(sp("O"), "doc")).toBe(false);
    expect(w.create(fo("FO"), "doc")).toBe(false);
    expect(w.create(tb("TO"), "form")).toBe(false);
    expect(w.create(sp("O"), "table")).toBe(false);
  });

  it("the legacy floor never lifts it: a doc and a sub-page from before the cutoff read Can view too", () => {
    const w = orgWide().doc("DOLD", { entityType: "SPACE", entityId: "O", at: OLD }).doc("DOLD1", { parentId: "DOLD", at: OLD });
    expect(w.role(dc("DOLD"))).toBe("VIEW");
    expect(w.role(dc("DOLD1"))).toBe("VIEW");
    expect(w.create(dc("DOLD"), "doc")).toBe(false);
  });

  it("a Can view row written by this release reads the same as no row: the floor drops it and keeps no org-wide lift", () => {
    const w = orgWide().on("space", "O", "GUEST", NEW).on("folder", "FO", "GUEST", NEW);
    for (const id of ["DO", "DO1", "DF", "DL"]) expect(w.role(dc(id)), id).toBe("VIEW");
    expect(w.role(tb("TO"))).toBe("VIEW");
  });

  it("A8 holds for rows: a Can view row from before the cutoff keeps today's Can edit on the docs and tables inside", () => {
    const w = orgWide().on("space", "O", "GUEST", OLD);
    expect(w.role(dc("DO"))).toBe("EDIT");
    expect(w.role(tb("TO"))).toBe("EDIT");
  });

  it("P7 holds: a Space member edits, a Space ADMIN, the doc's creator and an org admin manage", () => {
    const member = orgWide().on("space", "O", "MEMBER");
    expect(member.role(dc("DO"))).toBe("EDIT");
    expect(member.role(tb("TO"))).toBe("EDIT");
    const admin = orgWide().on("space", "O", "ADMIN");
    expect(admin.role(dc("DO"))).toBe("FULL");
    expect(admin.role(tb("TO"))).toBe("FULL");
    const creator = orgWide().doc("MINE", { entityType: "SPACE", entityId: "O", createdById: ME }).table("TM", "O", ME);
    expect(creator.role(dc("MINE"))).toBe("FULL");
    expect(creator.role(tb("TM"))).toBe("FULL");
    expect(orgWide().as({ orgAdmin: true }).role(dc("DO"))).toBe("FULL");
  });

  it("the org root's rule is untouched: a root doc and a table in no Space stay Can edit for every Member", () => {
    const w = new W().doc("DR").table("TR", null);
    expect(w.role(dc("DR"))).toBe("EDIT");
    expect(w.role(tb("TR"))).toBe("EDIT");
  });

  it("an org-wide List in a members-only Space: everyone views the List and the docs on it, never edits", () => {
    const w = new W().space("S").folder("F", "S").list("LX", "S", "F", "ORG").doc("DX", { entityType: "BOARD", entityId: "LX" });
    expect(w.role(li("LX"))).toBe("VIEW");
    expect(w.role(dc("DX"))).toBe("VIEW");
    expect(w.create(li("LX"), "doc")).toBe(false);
  });

  it("the deltas say so", () => {
    for (const id of ["C2", "C3"]) {
      const d = NODE_ACCESS_DELTAS.find((x) => x.id === id);
      expect(d?.text).toMatch(/and so does the org-wide reach: an org-wide Space/);
      expect(d?.text).not.toMatch(/the org-wide reach keep today's Can edit/);
    }
  });
});

// ── breaks 5 and 6: a Space manager takes any node out of their Space ─

describe("breaks 5 and 6: a Space OWNER or ADMIN takes any node out of their Space, as before node-access (P7)", () => {
  // A private Space A: Folder FA with List LA, a canvas and a doc in FA, a
  // doc and a table at A's root, a form sending to LA, all someone else's;
  // and PR, a page of the org's (no Space) made by someone else.
  const world = (rule: PrivateRule = "legacy") =>
    new W(rule).space("A", "PRIVATE").folder("FA", "A").list("LA", "A", "FA")
      .canvas("CA", "A", "FA").doc("DR", { entityType: "SPACE", entityId: "A" }).doc("DF", { entityType: "FOLDER", entityId: "FA" })
      .table("TA", "A").form("FRM", { list: "LA" }).doc("PR");
  const file = { spaceId: "A", spaceFolderId: "FA", uploadedById: OTHER };

  it("as Space ADMIN (a row of this release), as OWNER from before the cutoff, and under the strict rule: the canvas, the docs, the table, the form and the file all go out", () => {
    const managers = [
      world().on("space", "A", "ADMIN"),
      world().on("space", "A", "OWNER", OLD),
      world("strict").on("space", "A", "ADMIN"),
    ];
    for (const w of managers) {
      expect(w.move(cv("CA"), null)).toEqual({ ok: true, same: false });
      expect(w.move(dc("DR"), null)).toEqual({ ok: true, same: false });
      expect(w.move(dc("DF"), null)).toEqual({ ok: true, same: false });
      expect(w.move(tb("TA"), null)).toEqual({ ok: true, same: false });
      expect(w.move(dc("DF"), dc("PR"))).toEqual({ ok: true, same: false });
      expect(formDestinationVerdict(w.rows, w.g, "FRM", { list: null })).toEqual({ ok: true, same: false });
      expect(fileMoveVerdict(w.rows, w.g, file, null)).toEqual({ ok: true, same: false });
    }
  });

  it("the return trip is P2's: at the org root the node's owner or an org admin brings it back, a Space ADMIN cannot", () => {
    const out = new W().space("A", "PRIVATE").canvas("CA", null).table("TA", null).doc("DR").on("space", "A", "ADMIN");
    expect(out.move(cv("CA"), sp("A"))).toEqual({ ok: false, failure: "node" });
    expect(out.move(tb("TA"), sp("A"))).toEqual({ ok: false, failure: "node" });
    expect(out.move(dc("DR"), sp("A"))).toEqual({ ok: false, failure: "node" });
    const mine = new W().space("A", "PRIVATE").canvas("CA", null, null, ME).table("TA", null, ME).doc("DR", { createdById: ME }).on("space", "A", "ADMIN");
    expect(mine.move(cv("CA"), sp("A"))).toEqual({ ok: true, same: false });
    expect(mine.move(tb("TA"), sp("A"))).toEqual({ ok: true, same: false });
    expect(mine.move(dc("DR"), sp("A"))).toEqual({ ok: true, same: false });
    expect(out.as({ orgAdmin: true }).move(cv("CA"), sp("A"))).toEqual({ ok: true, same: false });
  });

  it("a Folder ADMIN (a narrow grant) still never takes anything out of every Space: not to the org root (source), not under a page of the org's (landing)", () => {
    const narrow = world().on("folder", "FA", "ADMIN");
    expect(narrow.move(cv("CA"), null)).toEqual({ ok: false, failure: "source" });
    expect(narrow.move(dc("DF"), null)).toEqual({ ok: false, failure: "source" });
    expect(narrow.move(dc("DF"), dc("PR"))).toEqual({ ok: false, failure: "landing" });
    expect(fileMoveVerdict(narrow.rows, narrow.g, file, null)).toEqual({ ok: false, failure: "source" });
    expect(moveRefusal("doc", "landing")).toBe("You need Full access to this doc itself, not only through its Space, to take it out of every Space.");
  });

  it("a form: a List ADMIN alone still cannot stop it sending anywhere (landing), a Space member who only edits cannot either (node)", () => {
    const listAdmin = world().on("list", "LA", "ADMIN");
    expect(formDestinationVerdict(listAdmin.rows, listAdmin.g, "FRM", { list: null })).toEqual({ ok: false, failure: "landing", slot: null });
    const member = world().on("space", "A", "MEMBER");
    expect(formDestinationVerdict(member.rows, member.g, "FRM", { list: null })).toEqual({ ok: false, failure: "node", slot: null });
  });

  it("M3 holds: a canvas's or a table's own grant never takes it out, with Can edit on the Space it is the node that refuses", () => {
    const w = world().on("space", "A", "MEMBER").onObject("canvas", "CA", "ADMIN").onObject("table", "TA", "ADMIN");
    expect(w.move(cv("CA"), null)).toEqual({ ok: false, failure: "node" });
    expect(w.move(tb("TA"), null)).toEqual({ ok: false, failure: "node" });
  });
});

// ── item 4: a doc is made only on an anchor the model knows ──────────

describe("item 4: DOC_ANCHOR_KINDS is the one set of anchors a doc is made on or moved to", () => {
  it("is exactly a Space, a Folder, a List and a task", () => {
    expect([...DOC_ANCHOR_KINDS].sort()).toEqual(["BOARD", "BOARD_ITEM", "FOLDER", "SPACE"]);
    for (const k of DOC_ANCHOR_KINDS) expect(isDocAnchorKind(k)).toBe(true);
  });

  it("refuses every other string, case included, and nothing", () => {
    for (const x of ["folder", "Folder", "space", "board", "WHITEBOARD", "TABLE", "FORM", "TASK", "LEAD", "NOTEPAD", "", " SPACE", null, undefined]) {
      expect(isDocAnchorKind(x), String(x)).toBe(false);
    }
  });

  it("answers with one plain sentence", () => {
    expect(DOC_ANCHOR_REFUSAL).toBe("A doc can be added to a Space, a Folder, a List or a task.");
  });
});
