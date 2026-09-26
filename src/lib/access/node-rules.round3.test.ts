// Round three of the placement rule (node-rules.ts P1 to P7): the breaks the
// round two attackers proved, each as the worst case the founder named on
// 2026-09-25. Every assertion below fails if its rule is taken out.
//
//   break 9  a Space manager pushed someone else's canvas, doc or table out of
//            every Space to the org root, then could not bring it back: the
//            node's Full access has to go with it (fullWhereItLands).
//   break 2  a Folder grantee moved a Private sub-folder they cannot open,
//            with its List and task, into another Space: a Folder moves with
//            everything beneath it, so the move needs Full access on all of
//            it, as its delete does (folderMoveAllowed).

import { describe, expect, it } from "vitest";
import {
  emptyGrants,
  emptyRows,
  folderDeleteAllowed,
  folderMoveAllowed,
  FOLDER_SUBTREE_MOVE_REFUSAL,
  fullWhereItLands,
  leavesEverySpace,
  moveRefusal,
  moveVerdict,
  objectGrantKey,
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
  doc(id: string, o: { entityType?: string; entityId?: string; parentId?: string; createdById?: string } = {}) {
    this.rows.docs.set(id, {
      id, organizationId: ORG, title: id, entityType: o.entityType ?? null, entityId: o.entityId ?? null,
      parentId: o.parentId ?? null, createdById: o.createdById ?? OTHER, createdAt: new Date(NEW),
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
  move(ref: NodeRef, dest: Place) {
    return moveVerdict(this.rows, this.g, ref, dest);
  }
}

const sp = (id: string): NodeRef => ({ kind: "space", id });
const fo = (id: string): NodeRef => ({ kind: "folder", id });
const cv = (id: string): NodeRef => ({ kind: "canvas", id });
const dc = (id: string): NodeRef => ({ kind: "doc", id });
const tb = (id: string): NodeRef => ({ kind: "table", id });

// ── break 9: out of every Space, Full access goes with the node ──────

describe("break 9: a push out of every Space needs Full access that goes with the node", () => {
  // Space A with Folder FA; a canvas in FA, a doc and a table at A's root,
  // all made by someone else. The mover is Space ADMIN of A.
  const world = (owner: string = OTHER) =>
    new W().space("A", "PRIVATE").folder("FA", "A")
      .canvas("CA", "A", "FA", owner).doc("DR", { entityType: "SPACE", entityId: "A", createdById: owner }).table("TA", "A", owner)
      .on("space", "A", "ADMIN");

  it("a Space ADMIN never pushes someone else's canvas, doc or table to the org root (the one-way door)", () => {
    const w = world();
    expect(w.move(cv("CA"), null)).toEqual({ ok: false, failure: "landing" });
    expect(w.move(dc("DR"), null)).toEqual({ ok: false, failure: "landing" });
    expect(w.move(tb("TA"), null)).toEqual({ ok: false, failure: "landing" });
    expect(moveRefusal("canvas", "landing")).toBe("You need Full access to this canvas itself, not only through its Space, to take it out of every Space.");
  });

  it("the same Space ADMIN still moves each of them anywhere inside the Space tree they reach", () => {
    const w = world().space("B").on("space", "B", "MEMBER");
    expect(w.move(cv("CA"), sp("A")).ok).toBe(true);
    expect(w.move(cv("CA"), sp("B")).ok).toBe(true);
    expect(w.move(dc("DR"), fo("FA")).ok).toBe(true);
    expect(w.move(tb("TA"), sp("B")).ok).toBe(true);
  });

  it("the owner who manages the Space takes their own out, and can bring it back: no one-way door", () => {
    const w = world(ME);
    expect(w.move(cv("CA"), null)).toEqual({ ok: true, same: false });
    expect(w.move(dc("DR"), null)).toEqual({ ok: true, same: false });
    expect(w.move(tb("TA"), null)).toEqual({ ok: true, same: false });
    // At the org root, the way back in: the owner keeps Full access there.
    const out = new W().space("A", "PRIVATE").canvas("CA", null, null, ME).table("TA", null, ME).doc("DR", { createdById: ME }).on("space", "A", "ADMIN");
    expect(out.move(cv("CA"), sp("A")).ok).toBe(true);
    expect(out.move(tb("TA"), sp("A")).ok).toBe(true);
    expect(out.move(dc("DR"), sp("A")).ok).toBe(true);
  });

  it("an org admin keeps today's rights (P7): Full access everywhere, the org root included", () => {
    const w = world().as({ orgAdmin: true });
    expect(w.move(cv("CA"), null).ok).toBe(true);
    expect(w.move(dc("DR"), null).ok).toBe(true);
    expect(w.move(tb("TA"), null).ok).toBe(true);
  });

  it("a Full share on the doc itself goes with it, so its holder who manages the Space may take it out", () => {
    const w = world().onDoc("DR", "FULL");
    expect(w.move(dc("DR"), null)).toEqual({ ok: true, same: false });
  });

  it("a canvas's or a table's own grant never takes it out (M3), even with Full access on the Space", () => {
    const w = world().onObject("canvas", "CA", "ADMIN").onObject("table", "TA", "ADMIN");
    expect(w.move(cv("CA"), null)).toEqual({ ok: false, failure: "landing" });
    expect(w.move(tb("TA"), null)).toEqual({ ok: false, failure: "landing" });
  });

  it("fullWhereItLands reads the role at the org root; leavesEverySpace names the moves it guards", () => {
    const w = world();
    expect(leavesEverySpace(w.rows, cv("CA"), null)).toBe(true);
    expect(leavesEverySpace(w.rows, cv("CA"), sp("A"))).toBe(false);
    expect(fullWhereItLands(w.rows, w.g, cv("CA"), null)).toBe(false);
    const mine = world(ME);
    expect(fullWhereItLands(mine.rows, mine.g, cv("CA"), null)).toBe(true);
  });
});

// ── break 2: a Folder moves with everything beneath it ───────────────

describe("break 2: a Folder move needs Full access on everything it carries", () => {
  // Space A > FA > FA1 > { FA2, FA1P (Private, List LA1P and canvas CP) };
  // Space B > FB1. The mover holds Full on FA and Can edit on FB1: exactly the
  // grants of the live proof.
  const world = (rule: PrivateRule = "strict") =>
    new W(rule).space("A", "PRIVATE").space("B", "PRIVATE")
      .folder("FA", "A").folder("FA1", "A", "FA").folder("FA2", "A", "FA1").folder("FA1P", "A", "FA1", "PRIVATE")
      .list("LA1P", "A", "FA1P").canvas("CP", "A", "FA1P")
      .folder("FB1", "B")
      .on("folder", "FA", "ADMIN").on("folder", "FB1", "MEMBER");
  const inside = { folders: ["FA2", "FA1P"], lists: ["LA1P"], canvases: ["CP"] };

  it("the grantee cannot carry the Private sub-folder they cannot open into another Space", () => {
    const w = world();
    // The top-level verdict alone would let it through: that was the hole.
    expect(w.move(fo("FA1"), fo("FB1")).ok).toBe(true);
    expect(folderMoveAllowed(w.rows, w.g, "FA1", inside)).toBe(false);
    expect(FOLDER_SUBTREE_MOVE_REFUSAL).toBe("You need Full access to everything in this folder to move it.");
  });

  it("nor a List or a canvas beneath it they hold less than Full access on", () => {
    const w = world();
    expect(folderMoveAllowed(w.rows, w.g, "FA1", { folders: ["FA2"], lists: ["LA1P"], canvases: [] })).toBe(false);
    expect(folderMoveAllowed(w.rows, w.g, "FA1", { folders: ["FA2"], lists: [], canvases: ["CP"] })).toBe(false);
  });

  it("with Full access on everything beneath it, the same grantee moves it", () => {
    const w = world().on("folder", "FA1P", "ADMIN");
    expect(folderMoveAllowed(w.rows, w.g, "FA1", inside)).toBe(true);
    expect(folderMoveAllowed(w.rows, w.g, "FA1", { folders: ["FA2"], lists: [], canvases: [] })).toBe(true);
  });

  it("a manager of the Folder's Space moves it whole, as they delete it whole", () => {
    const w = world().on("space", "A", "ADMIN");
    expect(folderMoveAllowed(w.rows, w.g, "FA1", inside)).toBe(true);
    expect(folderDeleteAllowed(w.rows, w.g, "FA1", inside)).toBe(true);
  });

  it("an org admin moves it whole", () => {
    expect(folderMoveAllowed(world().as({ orgAdmin: true }).rows, world().as({ orgAdmin: true }).g, "FA1", inside)).toBe(true);
  });

  it("the move asks exactly what the delete asks: one rule for taking a subtree", () => {
    const cases: Array<ReturnType<typeof world>> = [world(), world().on("folder", "FA1P", "ADMIN"), world().on("space", "A", "ADMIN"), world("legacy")];
    for (const w of cases) {
      expect(folderMoveAllowed(w.rows, w.g, "FA1", inside)).toBe(folderDeleteAllowed(w.rows, w.g, "FA1", inside));
    }
  });

  it("no Full access on the Folder itself moves nothing, whatever it carries", () => {
    const w = new W("strict").space("A").folder("FA", "A").folder("FA1", "A", "FA").on("folder", "FA", "MEMBER");
    expect(folderMoveAllowed(w.rows, w.g, "FA1", { folders: [], lists: [], canvases: [] })).toBe(false);
  });

  it("the refusal sentences carry no em dash and no double hyphen", () => {
    for (const text of [FOLDER_SUBTREE_MOVE_REFUSAL, moveRefusal("folder", "node"), moveRefusal("folder", "source"), moveRefusal("doc", "landing")]) {
      expect(text).not.toMatch(/\u2014|-{2}/);
    }
  });
});
