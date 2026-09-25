// The live walk's group 1 findings, as pure rules over one world:
//   1. a Folder or List role never moves the node out of the container it
//      sits in (A4): moveDecision's source gate;
//   2 and 3. a Can view grant on a Space, Folder or List made by this release
//      gives Can view on the docs inside, not Can edit and sharing (A5), while
//      rows from before the cutoff keep today's reach (A8).

import { describe, expect, it } from "vitest";
import {
  decide,
  emptyGrants,
  emptyRows,
  moveDecision,
  roleAtLeast,
  type MemberRole,
  type NodeRef,
  type NodeRows,
  type NodeViewer,
  type NodeVisibility,
  type PrivateRule,
  type ViewerGrants,
} from "./node-rules";
import { MANAGE_BAR } from "./access-panel";

const ORG = "org-1";
const ME = "u-me";
const OTHER = "u-other";
const CUTOFF = Date.UTC(2026, 8, 25);
const NEW = CUTOFF + 1;
const OLD = CUTOFF - 1;

function viewer(): NodeViewer {
  return { userId: ME, orgAdmin: false, orgGuest: false, isAgent: false, denied: false };
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
    this.rows.folders.set(id, { id, organizationId: ORG, spaceId, parentFolderId: parent, name: id, icon: null, color: null, visibility, ownerId: OTHER, position: 0 });
    return this;
  }
  list(id: string, spaceId: string | null, folderId: string | null) {
    this.rows.lists.set(id, { id, organizationId: ORG, spaceId, folderId, name: id, slug: id, icon: null, color: null, visibility: "WORKSPACE", ownerId: OTHER });
    return this;
  }
  doc(id: string, o: { entityType?: string; entityId?: string; parentId?: string }) {
    this.rows.docs.set(id, {
      id, organizationId: ORG, title: id, entityType: o.entityType ?? null, entityId: o.entityId ?? null,
      parentId: o.parentId ?? null, createdById: OTHER, createdAt: new Date(NEW),
    });
    return this;
  }
  on(kind: "space" | "folder" | "list", id: string, role: MemberRole, at: number) {
    this.g[kind].set(id, role);
    this.g.since?.set(`${kind}:${id}`, at);
    return this;
  }
  role(kind: NodeRef["kind"], id: string) {
    return decide(this.rows, this.g, { kind, id }).role;
  }
  move(ref: NodeRef, dest: NodeRef | null) {
    return moveDecision(this.rows, this.g, ref, dest);
  }
}

// ── 1. moves never act on the container they leave ───────────────────

describe("the source gate on a Folder or List move (A4)", () => {
  /** Space S (root Folders F and G, F holds A and B), Space T with Folder TF. */
  const world = (rule: PrivateRule = "legacy") =>
    new W(rule).space("S").space("T")
      .folder("F", "S").folder("A", "S", "F").folder("B", "S", "F").folder("G", "S").folder("TF", "T")
      .list("LF", "S", "F").list("LA", "S", "A").list("LROOT", "S", null);

  it("a Folder Full grantee cannot carry the Folder into another Space, even into a Folder they hold Full on", () => {
    for (const rule of ["legacy", "strict"] as const) {
      const w = world(rule).on("folder", "F", "ADMIN", NEW).on("folder", "TF", "ADMIN", NEW);
      expect(w.role("folder", "F")).toBe("FULL");
      expect(w.role("folder", "TF")).toBe("FULL");
      expect(w.move({ kind: "folder", id: "F" }, { kind: "folder", id: "TF" })).toBe(false);
    }
  });

  it("nor out of the Space's root into a sibling Folder they hold Full on", () => {
    const w = world().on("folder", "F", "ADMIN", NEW).on("folder", "G", "ADMIN", NEW);
    expect(w.move({ kind: "folder", id: "F" }, { kind: "folder", id: "G" })).toBe(false);
  });

  it("a Full grantee on a sub-folder alone cannot pull it out of its parent", () => {
    const w = world().on("folder", "A", "ADMIN", NEW).on("folder", "G", "ADMIN", NEW);
    expect(w.move({ kind: "folder", id: "A" }, { kind: "folder", id: "G" })).toBe(false);
  });

  it("reparents freely inside the subtree they hold Full on", () => {
    const w = world().on("folder", "F", "ADMIN", NEW);
    expect(w.move({ kind: "folder", id: "A" }, { kind: "folder", id: "B" })).toBe(true);
    expect(w.move({ kind: "list", id: "LA" }, { kind: "folder", id: "B" })).toBe(true);
    expect(w.move({ kind: "list", id: "LF" }, { kind: "folder", id: "A" })).toBe(true);
    // Out of F to the Space root needs Full on the Space: refused.
    expect(w.move({ kind: "folder", id: "A" }, { kind: "space", id: "S" })).toBe(false);
  });

  it("a Full holder of the parent Folder still cannot carry a child into another Space", () => {
    const w = world().on("folder", "F", "ADMIN", NEW).on("folder", "TF", "ADMIN", NEW);
    expect(w.move({ kind: "folder", id: "A" }, { kind: "folder", id: "TF" })).toBe(false);
    expect(w.move({ kind: "list", id: "LF" }, { kind: "folder", id: "TF" })).toBe(false);
  });

  it("a move to the container it already sits in needs nothing on the source", () => {
    const w = world().on("folder", "A", "ADMIN", NEW);
    expect(w.move({ kind: "folder", id: "A" }, { kind: "folder", id: "F" })).toBe(false); // no Full on F: the destination gate
    const x = world().on("list", "LA", "ADMIN", NEW).on("folder", "A", "ADMIN", NEW);
    expect(x.move({ kind: "list", id: "LA" }, { kind: "folder", id: "A" })).toBe(true);
  });

  it("a List Full grantee cannot pull the List out of its Folder, or out of the Space's root", () => {
    const w = world().on("list", "LA", "ADMIN", NEW).on("list", "LROOT", "ADMIN", NEW).on("folder", "G", "ADMIN", NEW).on("folder", "TF", "ADMIN", NEW);
    expect(w.role("list", "LA")).toBe("FULL");
    expect(w.move({ kind: "list", id: "LA" }, { kind: "folder", id: "G" })).toBe(false);
    expect(w.move({ kind: "list", id: "LA" }, { kind: "folder", id: "TF" })).toBe(false);
    expect(w.move({ kind: "list", id: "LROOT" }, { kind: "folder", id: "G" })).toBe(false);
  });

  it("a Space editor still moves Folders and Lists anywhere they manage, across Spaces included (A8)", () => {
    const old = world().on("space", "S", "ADMIN", OLD).on("space", "T", "ADMIN", OLD);
    expect(old.move({ kind: "folder", id: "F" }, { kind: "folder", id: "TF" })).toBe(true);
    expect(old.move({ kind: "folder", id: "F" }, { kind: "space", id: "T" })).toBe(true);
    expect(old.move({ kind: "list", id: "LA" }, { kind: "folder", id: "G" })).toBe(true);
    const fresh = world("strict").on("space", "S", "ADMIN", NEW).on("space", "T", "ADMIN", NEW);
    expect(fresh.move({ kind: "folder", id: "F" }, { kind: "folder", id: "TF" })).toBe(true);
    expect(fresh.move({ kind: "list", id: "LA" }, { kind: "space", id: "T" })).toBe(true);
  });

  it("a Space editor on the source alone still needs Full where it goes", () => {
    const w = world().on("space", "S", "ADMIN", OLD);
    expect(w.move({ kind: "folder", id: "F" }, { kind: "folder", id: "TF" })).toBe(false);
  });

  it("an org admin moves anything", () => {
    const w = world();
    w.g = { ...w.g, viewer: { ...viewer(), orgAdmin: true } };
    expect(w.move({ kind: "folder", id: "F" }, { kind: "folder", id: "TF" })).toBe(true);
  });
});

// ── 2 and 3. a Can view grant is read only on the docs inside ────────

describe("the role an anchored doc's reach gives (R6b)", () => {
  const world = (rule: PrivateRule = "legacy", spaceVis: NodeVisibility = "WORKSPACE") =>
    new W(rule).space("S", spaceVis).folder("F", "S").folder("FP", "S", "F", "PRIVATE").list("L", "S", "F")
      .doc("DF", { entityType: "FOLDER", entityId: "F" })
      .doc("DS", { entityType: "SPACE", entityId: "S" })
      .doc("DL", { entityType: "BOARD", entityId: "L" })
      .doc("DP", { entityType: "FOLDER", entityId: "FP" })
      .doc("SUB", { parentId: "DF" });

  const canShare = (w: W, id: string) => roleAtLeast(w.role("doc", id), MANAGE_BAR.doc);

  it("a Folder Can view grant made by this release gives Can view on its docs and sub-pages, and no sharing", () => {
    for (const rule of ["legacy", "strict"] as const) {
      const w = world(rule).on("folder", "F", "GUEST", NEW);
      expect(w.role("folder", "F")).toBe("VIEW");
      expect(w.role("doc", "DF")).toBe("VIEW");
      expect(w.role("doc", "DL")).toBe("VIEW");
      expect(w.role("doc", "SUB")).toBe("VIEW");
      expect(canShare(w, "DF")).toBe(false);
    }
  });

  it("a Folder Can view grant from before the cutoff keeps today's Can edit (A8)", () => {
    for (const rule of ["legacy", "strict"] as const) {
      const w = world(rule).on("folder", "F", "GUEST", OLD);
      expect(w.role("doc", "DF")).toBe("EDIT");
      expect(canShare(w, "DF")).toBe(true);
    }
  });

  it("a workspace with no cutoff on record reads every row as today's", () => {
    const w = world().on("folder", "F", "GUEST", NEW);
    w.rows.legacyBefore = null;
    expect(w.role("doc", "DF")).toBe("EDIT");
  });

  it("Can edit gives Can edit and Full gives Full, new or old", () => {
    expect(world().on("folder", "F", "MEMBER", NEW).role("doc", "DF")).toBe("EDIT");
    expect(world().on("folder", "F", "ADMIN", NEW).role("doc", "DF")).toBe("FULL");
    expect(world().on("space", "S", "MEMBER", NEW).role("doc", "DS")).toBe("EDIT");
    expect(world().on("space", "S", "OWNER", NEW).role("doc", "DS")).toBe("FULL");
  });

  it("a new Space Can view gives Can view on its docs; an old one keeps Can edit", () => {
    expect(world().on("space", "S", "GUEST", NEW).role("doc", "DS")).toBe("VIEW");
    expect(world().on("space", "S", "GUEST", OLD).role("doc", "DS")).toBe("EDIT");
  });

  it("a Can view grant on a PRIVATE sub-folder gives Can view on its docs", () => {
    const w = world().on("folder", "FP", "GUEST", NEW);
    expect(w.role("doc", "DP")).toBe("VIEW");
  });

  it("a person holding an older row and a new one keeps the older reach", () => {
    const w = world().on("space", "S", "GUEST", OLD).on("folder", "F", "GUEST", NEW);
    expect(w.role("doc", "DF")).toBe("EDIT");
  });

  it("the org-wide reach of an org-wide Space still edits its docs (today's rule, no row)", () => {
    expect(world("legacy", "ORG").role("doc", "DS")).toBe("EDIT");
    const w = world("legacy", "ORG").on("folder", "F", "GUEST", NEW);
    expect(w.role("doc", "DF")).toBe("EDIT");
  });
});
