// Round seven of the placement rule (node-rules.ts P1 to P7): the breaks the
// round six attackers proved, as unit tests that fail without their rule.
//
//   break 1  a Folder Full or List Full grantee took another person's doc out
//            of a private Space through a page of their own at the org root:
//            fullWhereItLands read the role where the doc would land, and the
//            mover's own page lent it Full access. The Full access that goes
//            with a node is the node's own, read at the org root.
//   item 5   a Space OWNER or ADMIN could no longer bring an org-root canvas,
//            doc or table back into their own Space, which worked before
//            node-access (P7): whoever manages the destination Space pulls a
//            node in from the org root with Can edit on it.
//   item 3   a half anchor (a kind with an empty id, an id with no kind) was
//            stored as-is by POST /api/docs: docAnchorInput refuses it.

import { describe, expect, it } from "vitest";
import {
  DOC_HALF_ANCHOR_REFUSAL,
  DOC_PARENT_EMPTY_REFUSAL,
  NodeEvaluator,
  docAnchorInput,
  emptyGrants,
  emptyRows,
  fullWhereItLands,
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
  type PrivateRule,
  type ViewerGrants,
} from "./node-rules";

const ORG = "org-1";
const ME = "u-me";
const OTHER = "u-other";
const CUTOFF = Date.UTC(2026, 8, 25);
const NEW = CUTOFF + 1;

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
  share(docId: string, role: "FULL" | "EDIT" | "COMMENT" | "VIEW") {
    const entry = this.rows.docSharing.get(docId) ?? {};
    this.rows.docSharing.set(docId, { ...entry, roles: { ...(entry.roles ?? {}), [ME]: role } });
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
}

const sp = (id: string): NodeRef => ({ kind: "space", id });
const fo = (id: string): NodeRef => ({ kind: "folder", id });
const li = (id: string): NodeRef => ({ kind: "list", id });
const cv = (id: string): NodeRef => ({ kind: "canvas", id });
const dc = (id: string): NodeRef => ({ kind: "doc", id });
const tb = (id: string): NodeRef => ({ kind: "table", id });

// ── break 1: the Full access that goes with a node is its own ────────

describe("break 1: a narrow grant never takes another person's doc out of a private Space through a page of the mover's own", () => {
  // Private Space SA with Folder FA; DA is someone else's doc on FA with a
  // sub-page DA1; PG is a page of MY OWN at the org root; PS is someone
  // else's root page shared to me with Full access; LN is a List in no
  // Space. I hold only Full access (ADMIN) on FA.
  const world = () =>
    new W().space("SA", "PRIVATE").folder("FA", "SA")
      .doc("DA", { entityType: "FOLDER", entityId: "FA" }).doc("DA1", { parentId: "DA" })
      .doc("PG", { createdById: ME }).doc("PS").share("PS", "FULL")
      .list("LN", null, null).on("list", "LN", "MEMBER")
      .on("folder", "FA", "ADMIN");

  it("the grant reads as Full access on the doc and on the Folder, so the control (to the org root) fails on the Space it leaves", () => {
    const w = world();
    expect(w.role(dc("DA"))).toBe("FULL");
    expect(w.role(fo("FA"))).toBe("FULL");
    expect(w.role(dc("PG"))).toBe("FULL");
    expect(w.move(dc("DA"), null)).toEqual({ ok: false, failure: "source" });
  });

  it("under my own root page, under a root page shared to me with Full access, or onto a List in no Space: the landing refusal, every time", () => {
    const w = world();
    expect(w.move(dc("DA"), dc("PG"))).toEqual({ ok: false, failure: "landing" });
    expect(w.move(dc("DA"), dc("PS"))).toEqual({ ok: false, failure: "landing" });
    expect(w.move(dc("DA"), li("LN"))).toEqual({ ok: false, failure: "landing" });
    expect(moveRefusal("doc", "landing")).toBe("You need Full access to this doc itself, not only through its Space, to take it out of every Space.");
  });

  it("fullWhereItLands is the doc's own Full access, read at the org root: not mine through the Folder, not mine through the page it would go under", () => {
    const w = world();
    expect(fullWhereItLands(w.rows, w.g, dc("DA"))).toBe(false);
    // The doc's creator, an org admin, or a Full share on the doc itself.
    const mine = new W().space("SA", "PRIVATE").folder("FA", "SA").doc("DA", { entityType: "FOLDER", entityId: "FA", createdById: ME }).doc("PG", { createdById: ME }).on("folder", "FA", "ADMIN");
    expect(fullWhereItLands(mine.rows, mine.g, dc("DA"))).toBe(true);
    expect(mine.move(dc("DA"), dc("PG"))).toEqual({ ok: true, same: false });
    const shared = world().share("DA", "FULL");
    expect(fullWhereItLands(shared.rows, shared.g, dc("DA"))).toBe(true);
    expect(shared.move(dc("DA"), dc("PG"))).toEqual({ ok: true, same: false });
    expect(world().as({ orgAdmin: true }).move(dc("DA"), dc("PG"))).toEqual({ ok: true, same: false });
  });

  it("a Space ADMIN still pushes it under a root page (P7, the manager of the Space it leaves), a Space MEMBER does not", () => {
    const manager = world().on("space", "SA", "ADMIN");
    expect(manager.move(dc("DA"), dc("PG"))).toEqual({ ok: true, same: false });
    const member = new W().space("SA", "PRIVATE").folder("FA", "SA").doc("DA", { entityType: "FOLDER", entityId: "FA" }).doc("PG", { createdById: ME }).on("space", "SA", "MEMBER");
    expect(member.move(dc("DA"), dc("PG")).ok).toBe(false);
  });

  it("the same for a List Full grantee and a doc on the List, and for a canvas or a table in the Folder", () => {
    const w = new W().space("SB", "PRIVATE").folder("FB", "SB").list("LBB", "SB", "FB")
      .doc("DBB", { entityType: "BOARD", entityId: "LBB" }).doc("PG2", { createdById: ME })
      .canvas("CB", "SB", "FB").table("TB", "SB")
      .on("list", "LBB", "ADMIN").on("folder", "FB", "ADMIN");
    expect(w.role(dc("DBB"))).toBe("FULL");
    expect(w.move(dc("DBB"), dc("PG2"))).toEqual({ ok: false, failure: "landing" });
    expect(w.move(dc("DBB"), null)).toEqual({ ok: false, failure: "source" });
    expect(w.move(cv("CB"), null)).toEqual({ ok: false, failure: "source" });
    expect(fullWhereItLands(w.rows, w.g, cv("CB"))).toBe(false);
  });

  it("a move that stays inside the Space asks nothing of the landing rule: into another Folder of it, or under a page anchored in it", () => {
    const w = world().folder("FA2", "SA").doc("PA", { entityType: "FOLDER", entityId: "FA", createdById: ME }).on("folder", "FA2", "MEMBER");
    expect(w.move(dc("DA"), fo("FA2"))).toEqual({ ok: true, same: false });
    expect(w.move(dc("DA"), dc("PA"))).toEqual({ ok: true, same: false });
  });
});

// ── item 5: the return trip from the org root (P7) ───────────────────

describe("item 5: whoever manages a Space brings a node in from the org root with Can edit on it (P7)", () => {
  // CA, DR and TA are someone else's, in no Space at all; SA is a private
  // Space with a Folder FA; SM is a Space I am only a MEMBER of.
  const world = () =>
    new W().space("SA", "PRIVATE").folder("FA", "SA").space("SM", "PRIVATE")
      .canvas("CA", null).doc("DR").table("TA", null);

  it("a Space ADMIN or OWNER pulls a root canvas, doc or table into the Space they manage, and into a Folder of it", () => {
    for (const role of ["ADMIN", "OWNER"] as const) {
      const w = world().on("space", "SA", role);
      expect(w.role(cv("CA"))).toBe("EDIT");
      expect(w.move(cv("CA"), sp("SA")), role).toEqual({ ok: true, same: false });
      expect(w.move(cv("CA"), fo("FA")), role).toEqual({ ok: true, same: false });
      expect(w.move(dc("DR"), sp("SA")), role).toEqual({ ok: true, same: false });
      expect(w.move(dc("DR"), fo("FA")), role).toEqual({ ok: true, same: false });
      expect(w.move(tb("TA"), sp("SA")), role).toEqual({ ok: true, same: false });
    }
  });

  it("a Space MEMBER, a Folder ADMIN inside the Space, and a Member with no row at all do not: the node is still someone else's", () => {
    expect(world().on("space", "SM", "MEMBER").move(cv("CA"), sp("SM"))).toEqual({ ok: false, failure: "node" });
    expect(world().on("space", "SM", "MEMBER").move(dc("DR"), sp("SM"))).toEqual({ ok: false, failure: "node" });
    expect(world().on("folder", "FA", "ADMIN").move(cv("CA"), fo("FA"))).toEqual({ ok: false, failure: "node" });
    expect(world().on("folder", "FA", "ADMIN").move(dc("DR"), fo("FA"))).toEqual({ ok: false, failure: "node" });
    expect(world().move(cv("CA"), sp("SA")).ok).toBe(false);
  });

  it("the pull-in is for the org root only: a doc under a root page, or a canvas in another Space, still needs Full access on it and where it is", () => {
    const w = world().doc("PR").doc("DP", { parentId: "PR" }).space("SO", "WORKSPACE").canvas("CO", "SO").on("space", "SA", "ADMIN");
    expect(w.move(dc("DP"), sp("SA"))).toEqual({ ok: false, failure: "node" });
    expect(w.move(cv("CO"), sp("SA"))).toEqual({ ok: false, failure: "node" });
  });

  it("once inside, the Space manager pushes it out again and the round trip is whole (breaks 5 and 6 of round six kept)", () => {
    const w = new W().space("SA", "PRIVATE").canvas("CA", "SA").doc("DA", { entityType: "SPACE", entityId: "SA" }).on("space", "SA", "ADMIN");
    expect(w.move(cv("CA"), null)).toEqual({ ok: true, same: false });
    expect(w.move(dc("DA"), null)).toEqual({ ok: true, same: false });
  });
});

// ── item 3: half anchors ─────────────────────────────────────────────

describe("item 3: docAnchorInput takes both halves of an anchor or neither", () => {
  it("a kind with an empty or missing id, and an id with an empty or missing kind, are refused with the one sentence", () => {
    for (const [type, id] of [["BOARD", ""], ["FOLDER", null], ["SPACE", undefined], ["BOARD_ITEM", "  "], ["", "f1"], [null, "f1"], [undefined, "f1"], ["  ", "f1"]] as const) {
      expect(docAnchorInput(type, id), `${String(type)} / ${String(id)}`).toEqual({ ok: false, error: DOC_HALF_ANCHOR_REFUSAL });
    }
  });
  it("both empty is the org root, both given is the anchor as sent", () => {
    for (const [type, id] of [["", ""], [null, null], [undefined, undefined], ["", null], [null, ""]] as const) {
      expect(docAnchorInput(type, id), `${String(type)} / ${String(id)}`).toEqual({ ok: true, entityType: null, entityId: null });
    }
    expect(docAnchorInput("FOLDER", "f1")).toEqual({ ok: true, entityType: "FOLDER", entityId: "f1" });
    expect(docAnchorInput("NOTEPAD", "u1")).toEqual({ ok: true, entityType: "NOTEPAD", entityId: "u1" });
  });
  it("the sentences are plain, with no double hyphen or em dash", () => {
    for (const text of [DOC_HALF_ANCHOR_REFUSAL, DOC_PARENT_EMPTY_REFUSAL]) {
      expect(text).not.toMatch(/--|—/);
      expect(text.endsWith(".")).toBe(true);
    }
  });
});
