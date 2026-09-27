// Round two of the placement hardening (node-rules.ts P1 to P7), one block per
// break the attackers proved against round one. Every assertion fails when
// its rule is taken out: each block says which line of node-rules.ts it pins.

import { describe, expect, it } from "vitest";
import {
  NODE_ACCESS_DELTAS,
  PLACE_ANCHORS,
  SPACE_NEST_REFUSAL,
  decide,
  emptyGrants,
  emptyRows,
  fileEditDecision,
  moveVerdict,
  objectGrantKey,
  spaceNestVerdict,
  subtreeAnchorPlan,
  type DocHome,
  type MemberRole,
  type NodeRef,
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
  space(id: string, visibility: NodeVisibility = "PRIVATE") {
    this.rows.spaces.set(id, { id, organizationId: ORG, name: id, slug: id, icon: null, color: null, visibility, ownerId: OTHER });
    return this;
  }
  folder(id: string, spaceId: string, parent: string | null = null) {
    this.rows.folders.set(id, {
      id, organizationId: ORG, spaceId, parentFolderId: parent, name: id, icon: null, color: null,
      visibility: "WORKSPACE", ownerId: OTHER, position: 0,
    });
    return this;
  }
  list(id: string, spaceId: string, folderId: string | null) {
    this.rows.lists.set(id, { id, organizationId: ORG, spaceId, folderId, name: id, slug: id, icon: null, color: null, visibility: "WORKSPACE", ownerId: OTHER });
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
  as(v: Partial<NodeViewer>) {
    this.g = { ...this.g, viewer: viewer(v) };
    return this;
  }
  role(ref: NodeRef) {
    return decide(this.rows, this.g, ref).role;
  }
  move(ref: NodeRef, dest: Place) {
    return moveVerdict(this.rows, this.g, ref, dest);
  }
}

const fo = (id: string): NodeRef => ({ kind: "folder", id });
const sp = (id: string): NodeRef => ({ kind: "space", id });
const li = (id: string): NodeRef => ({ kind: "list", id });
const tb = (id: string): NodeRef => ({ kind: "table", id });

// ── break 11: rule 2 as stated, nothing more ─────────────────────────

describe("rule 2: Full on the node and on where it is now, Can edit where it goes, and nothing on either Space", () => {
  // Space A: FA holds FA1 (with FA2 below it) and LA1 in FA1. Space B: FB, FB1 in it.
  const world = (rule: PrivateRule = "legacy") =>
    new W(rule).space("A").space("B")
      .folder("FA", "A").folder("FA1", "A", "FA").folder("FA2", "A", "FA1").folder("FA3", "A", "FA")
      .folder("FB", "B").folder("FB1", "B", "FB")
      .list("LA1", "A", "FA1");

  it("verify.employee's walk: Full on FA and on FB moves FA1, LA1 and FA3 into Space B", () => {
    for (const rule of ["legacy", "strict"] as const) {
      const w = world(rule).on("folder", "FA", "ADMIN").on("folder", "FB", "ADMIN");
      expect(w.move(fo("FA1"), fo("FB"))).toEqual({ ok: true, same: false });
      expect(w.move(li("LA1"), fo("FB"))).toEqual({ ok: true, same: false });
      expect(w.move(fo("FA3"), fo("FB1"))).toEqual({ ok: true, same: false });
    }
  });

  it("the worst case stays shut: the grantee never drags the Folder they were given out of its Space", () => {
    const w = world().on("folder", "FA", "ADMIN").on("folder", "FB", "ADMIN");
    expect(w.move(fo("FA"), fo("FB"))).toEqual({ ok: false, failure: "source" });
    expect(w.move(fo("FA"), sp("B"))).toEqual({ ok: false, failure: "source" });
  });

  it("Can view where it goes never takes it, and Can edit on the node is not Full access", () => {
    expect(world().on("folder", "FA", "ADMIN").on("folder", "FB", "GUEST").move(fo("FA1"), fo("FB"))).toEqual({ ok: false, failure: "destination" });
    expect(world().on("folder", "FA", "MEMBER").on("folder", "FB", "ADMIN").move(fo("FA1"), fo("FB"))).toEqual({ ok: false, failure: "node" });
  });
});

// ── break 8: a Can view Space role never climbs on a table ────────────

describe("R7b: the role a table's Space gives (delta C3)", () => {
  const world = (visibility: NodeVisibility = "PRIVATE") => new W().space("S", visibility).table("T", "S");

  it("a Can view Space row written by this release gives Can view on its tables, never Can edit", () => {
    expect(world().on("space", "S", "GUEST", NEW).role(tb("T"))).toBe("VIEW");
  });

  it("a row from before the cutoff keeps today's Can edit (A8)", () => {
    expect(world().on("space", "S", "GUEST", OLD).role(tb("T"))).toBe("EDIT");
  });

  it("the org-wide reach gives Can view (round six, break 3), a member edits, a manager and the creator manage", () => {
    expect(world("ORG").role(tb("T"))).toBe("VIEW");
    expect(world().on("space", "S", "MEMBER", NEW).role(tb("T"))).toBe("EDIT");
    expect(world().on("space", "S", "ADMIN", NEW).role(tb("T"))).toBe("FULL");
    const creator = new W().space("S").table("T", "S", ME).on("space", "S", "GUEST", NEW);
    expect(creator.role(tb("T"))).toBe("FULL");
  });

  it("a table grant still pierces at its own role", () => {
    const w = world().on("space", "S", "GUEST", NEW);
    w.g.object.set(objectGrantKey("table", "T"), "MEMBER");
    expect(w.role(tb("T"))).toBe("EDIT");
  });

  it("the delta is listed, and moves nothing on deploy", () => {
    const c3 = NODE_ACCESS_DELTAS.find((d) => d.id === "C3");
    expect(c3?.mode).toBe("always");
    expect(c3?.kind).toBe("information");
  });
});

// ── break 9: a Can view grantee never removes another person's file ──

describe("fileEditDecision: rename, re-file or Trash a file", () => {
  const world = () => new W().space("S").folder("F", "S");
  const inF = (uploadedById: string = OTHER) => ({ spaceId: "S", spaceFolderId: "F", uploadedById });
  const atRoot = (uploadedById: string = OTHER) => ({ spaceId: "S", spaceFolderId: null, uploadedById });

  it("Can view on the Folder never removes or renames a file in it, another person's or even their own", () => {
    expect(fileEditDecision(world().on("folder", "F", "GUEST").rows, world().on("folder", "F", "GUEST").g, inF())).toBe(false);
    const w = world().on("folder", "F", "GUEST");
    expect(fileEditDecision(w.rows, w.g, inF(ME))).toBe(false);
  });

  it("Can edit where it sits does, at a Folder and at the Space root", () => {
    const w = world().on("folder", "F", "MEMBER");
    expect(fileEditDecision(w.rows, w.g, inF())).toBe(true);
    const root = world().on("space", "S", "MEMBER");
    expect(fileEditDecision(root.rows, root.g, atRoot())).toBe(true);
    const viewer = world().on("space", "S", "GUEST");
    expect(fileEditDecision(viewer.rows, viewer.g, atRoot())).toBe(false);
  });

  it("an org admin does; a file of the org's keeps today's rule (any Member, a Guest only for their own)", () => {
    const admin = world().as({ orgAdmin: true });
    expect(fileEditDecision(admin.rows, admin.g, inF())).toBe(true);
    const loose = { spaceId: null, spaceFolderId: null, uploadedById: OTHER };
    const member = world();
    expect(fileEditDecision(member.rows, member.g, loose)).toBe(true);
    const guest = world().as({ orgGuest: true });
    expect(fileEditDecision(guest.rows, guest.g, loose)).toBe(false);
    expect(fileEditDecision(guest.rows, guest.g, { ...loose, uploadedById: ME })).toBe(true);
    const denied = world().on("space", "S", "OWNER").as({ denied: true });
    expect(fileEditDecision(denied.rows, denied.g, atRoot(ME))).toBe(false);
  });
});

// ── break 0: a page tree moves whole ──────────────────────────────────

describe("subtreeAnchorPlan: a sub-page with its own anchor follows its moved parent", () => {
  const at = (entityType: string, entityId: string): DocHome => ({ kind: "anchor", entityType, entityId });

  it("every page beneath with a place anchor takes the new home; the ones already there are left alone", () => {
    const plan = subtreeAnchorPlan(at("FOLDER", "FE"), [
      { id: "DC", entityType: "FOLDER", entityId: "FA1" },
      { id: "DD", entityType: null, entityId: null },
      { id: "DE", entityType: "FOLDER", entityId: "FE" },
      { id: "DS", entityType: "SPACE", entityId: "B" },
    ]);
    expect(plan).toEqual({ ok: true, rewrite: ["DC", "DS"] });
  });

  it("a note beneath is its owner's alone and is never rewritten", () => {
    expect(subtreeAnchorPlan(at("SPACE", "B"), [{ id: "N", entityType: "NOTEPAD", entityId: ME }])).toEqual({ ok: true, rewrite: [] });
  });

  it("a tree whose new home is no place is refused while a page beneath has a place of its own; with none it goes", () => {
    const placed = [{ id: "DC", entityType: "FOLDER", entityId: "FA1" }];
    expect(subtreeAnchorPlan({ kind: "root" }, placed)).toEqual({ ok: false });
    expect(subtreeAnchorPlan({ kind: "closed" }, placed)).toEqual({ ok: false });
    expect(subtreeAnchorPlan({ kind: "root" }, [{ id: "DD", entityType: null, entityId: null }])).toEqual({ ok: true, rewrite: [] });
    expect(subtreeAnchorPlan(at("PROJECT", "X"), placed)).toEqual({ ok: false });
  });

  it("the place anchors are the four a move writes", () => {
    expect([...PLACE_ANCHORS].sort()).toEqual(["BOARD", "BOARD_ITEM", "FOLDER", "SPACE"]);
  });
});

// ── break 3: nesting a Space asks Full on the Space and where it goes ──
//
// Round two asked Full access on the parent it leaves as well. Round three's
// break 3 proved that took away what a Space OWNER did before node-access
// (their sub-Space to the top level, or under another Space they manage),
// against P7, and a Space's place under a parent carries no access: so the
// parent it leaves is asked nothing.

describe("spaceNestVerdict: a Space moves by its own managers, into a Space they manage", () => {
  const dest = (over: Partial<{ id: string; found: boolean; sees: boolean; archived: boolean; manages: boolean; cycle: boolean }> = {}) =>
    ({ id: "Q", found: true, sees: true, archived: false, manages: true, cycle: false, ...over });

  it("Full on a sub-Space takes it to the top level, or under another Space the mover manages, with no role on the parent it leaves (P7)", () => {
    const current = { id: "P" };
    expect(spaceNestVerdict({ spaceId: "X", managesSpace: true, current, dest: dest() })).toEqual({ ok: true, same: false });
    expect(spaceNestVerdict({ spaceId: "X", managesSpace: true, current, dest: null })).toEqual({ ok: true, same: false });
  });

  it("from the top level the same: under a Space they manage", () => {
    expect(spaceNestVerdict({ spaceId: "X", managesSpace: true, current: null, dest: dest() })).toEqual({ ok: true, same: false });
  });

  it("but never back under a parent they do not manage: the destination needs Full access", () => {
    expect(spaceNestVerdict({ spaceId: "X", managesSpace: true, current: { id: "P" }, dest: dest({ manages: false }) })).toEqual({ ok: false, status: 403, error: SPACE_NEST_REFUSAL });
  });

  it("an archived parent is refused, as every other placement refuses one", () => {
    expect(spaceNestVerdict({ spaceId: "X", managesSpace: true, current: null, dest: dest({ archived: true }) })).toEqual({ ok: false, status: 400, error: "That Space is archived." });
  });

  it("no Full on where it goes, a cycle, itself, a parent out of sight or out of the org are refused", () => {
    expect(spaceNestVerdict({ spaceId: "X", managesSpace: true, current: null, dest: dest({ manages: false }) })).toEqual({ ok: false, status: 403, error: SPACE_NEST_REFUSAL });
    expect(spaceNestVerdict({ spaceId: "X", managesSpace: true, current: null, dest: dest({ cycle: true }) }).ok).toBe(false);
    expect(spaceNestVerdict({ spaceId: "X", managesSpace: true, current: null, dest: dest({ id: "X" }) })).toMatchObject({ ok: false, status: 400 });
    expect(spaceNestVerdict({ spaceId: "X", managesSpace: true, current: null, dest: dest({ sees: false }) })).toMatchObject({ ok: false, status: 404 });
    expect(spaceNestVerdict({ spaceId: "X", managesSpace: true, current: null, dest: dest({ found: false }) })).toMatchObject({ ok: false, status: 404 });
  });

  it("no Full on the Space itself moves nothing; the parent it already has is no move", () => {
    expect(spaceNestVerdict({ spaceId: "X", managesSpace: false, current: null, dest: dest() })).toMatchObject({ ok: false, status: 403 });
    expect(spaceNestVerdict({ spaceId: "X", managesSpace: true, current: { id: "Q" }, dest: dest({ manages: false }) })).toEqual({ ok: true, same: true });
  });

  it("the refusal is one plain sentence with no double hyphen or em dash", () => {
    expect(SPACE_NEST_REFUSAL).not.toMatch(/—|--/);
  });
});
