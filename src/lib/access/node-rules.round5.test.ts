// Round five of the placement rule (node-rules.ts P1 to P7): the breaks the
// round four attackers proved, as unit tests that fail without their rule.
//
//   break 1  a bare `position` on PATCH /api/folders/[id] reordered a parent
//            the caller held nothing on: a reorder under the same parent is
//            P4, Full access on the node AND on that parent (moveVerdict
//            `same`), and the route now asks it (the contract test).
//   break 2  a form's destination was moved away from a List the editor could
//            not see, with nothing on the form and nothing on what it left:
//            a form lives where it sends responses, so changing that is a
//            move under P2 (formDestinationVerdict).
//   break 4  every Member held Can edit on every form (R9 "everyone"), so a
//            person with nothing on a private Space rewrote its form's
//            questions: R9 now inherits the destination's role, and every
//            Member opens the form read-only.

import { describe, expect, it } from "vitest";
import {
  NodeEvaluator,
  createDecision,
  currentPlace,
  emptyGrants,
  emptyRows,
  formDestinationChangeable,
  formDestinationRef,
  formDestinationRefusal,
  formDestinationVerdict,
  moveVerdict,
  objectGrantKey,
  placeHolds,
  type MemberRole,
  type NodeRows,
  type NodeViewer,
  type ViewerGrants,
} from "./node-rules";

const ORG = "org-1";
const ME = "u-me";
const OTHER = "u-other";

function viewer(over: Partial<NodeViewer> = {}): NodeViewer {
  return { userId: ME, orgAdmin: false, orgGuest: false, isAgent: false, denied: false, ...over };
}

/**
 * Two private Spaces. SA holds Folder FA with List LA in it; SB holds List LB
 * at its root and a table TB. Form FRM (made by OTHER) sends responses to LA;
 * form FREE sends nowhere yet; form FT sends to the table.
 */
function world(v: NodeViewer = viewer()): { rows: NodeRows; g: ViewerGrants } {
  const rows = emptyRows(ORG, "strict");
  for (const id of ["SA", "SB"]) rows.spaces.set(id, { id, organizationId: ORG, name: id, slug: id, icon: null, color: null, visibility: "PRIVATE", ownerId: OTHER });
  rows.folders.set("FA", { id: "FA", organizationId: ORG, spaceId: "SA", parentFolderId: null, name: "FA", icon: null, color: null, visibility: "WORKSPACE", ownerId: OTHER, position: 0 });
  rows.lists.set("LA", { id: "LA", organizationId: ORG, spaceId: "SA", folderId: "FA", name: "LA", slug: "la", icon: null, color: null, visibility: "WORKSPACE", ownerId: OTHER });
  rows.lists.set("LB", { id: "LB", organizationId: ORG, spaceId: "SB", folderId: null, name: "LB", slug: "lb", icon: null, color: null, visibility: "WORKSPACE", ownerId: OTHER });
  rows.tables.set("TB", { id: "TB", organizationId: ORG, spaceId: "SB", createdById: OTHER, name: "TB" });
  rows.forms.set("FRM", { id: "FRM", organizationId: ORG, createdById: OTHER, name: "FRM", targetBoardId: "LA", targetTableId: null });
  rows.forms.set("FREE", { id: "FREE", organizationId: ORG, createdById: OTHER, name: "FREE", targetBoardId: null, targetTableId: null });
  rows.forms.set("FT", { id: "FT", organizationId: ORG, createdById: OTHER, name: "FT", targetBoardId: null, targetTableId: "TB" });
  const g = emptyGrants(v);
  g.since = new Map();
  return { rows, g };
}

const role = (w: { rows: NodeRows; g: ViewerGrants }, kind: "form" | "list", id: string) => new NodeEvaluator(w.rows, w.g).effective({ kind, id }).role;
const onList = (w: { rows: NodeRows; g: ViewerGrants }, id: string, r: MemberRole) => { w.g.list.set(id, r); return w; };
const onFolder = (w: { rows: NodeRows; g: ViewerGrants }, id: string, r: MemberRole) => { w.g.folder.set(id, r); return w; };
const onForm = (w: { rows: NodeRows; g: ViewerGrants }, id: string, r: MemberRole) => { w.g.object.set(objectGrantKey("form", id), r); return w; };

describe("break 4, R9: a form inherits the role held where it sends responses", () => {
  it("a Member with nothing on the List opens the form read-only (Can view), never edits it", () => {
    const w = world();
    expect(role(w, "list", "LA")).toBe("none");
    expect(role(w, "form", "FRM")).toBe("VIEW");
  });

  it("Can view on the List is Can view on the form; Can edit edits; Full access manages", () => {
    expect(role(onList(world(), "LA", "GUEST"), "form", "FRM")).toBe("VIEW");
    expect(role(onList(world(), "LA", "MEMBER"), "form", "FRM")).toBe("EDIT");
    expect(role(onList(world(), "LA", "ADMIN"), "form", "FRM")).toBe("FULL");
    // Through the Folder above the List as well: the chain, not the row.
    expect(role(onFolder(world(), "FA", "ADMIN"), "form", "FRM")).toBe("FULL");
  });

  it("a form sending nowhere yet keeps the org root's rule (every Member edits), and one feeding a table follows the table", () => {
    expect(role(world(), "form", "FREE")).toBe("EDIT");
    expect(role(world(), "form", "FT")).toBe("VIEW");
    const tableEditor = world();
    tableEditor.g.space.set("SB", "MEMBER");
    expect(role(tableEditor, "form", "FT")).toBe("EDIT");
  });

  it("the creator keeps Full access wherever it sends responses, and a form grant gives its role", () => {
    const creator = world();
    creator.rows.forms.set("FRM", { ...creator.rows.forms.get("FRM")!, createdById: ME });
    expect(role(creator, "form", "FRM")).toBe("FULL");
    expect(role(onForm(world(), "FRM", "MEMBER"), "form", "FRM")).toBe("EDIT");
    expect(role(onForm(world(), "FRM", "ADMIN"), "form", "FRM")).toBe("FULL");
  });

  it("a Guest holds nothing unless given the form, and an org admin holds everything", () => {
    expect(role(world(viewer({ orgGuest: true })), "form", "FRM")).toBe("none");
    expect(role(onForm(world(viewer({ orgGuest: true })), "FRM", "GUEST"), "form", "FRM")).toBe("VIEW");
    expect(role(world(viewer({ orgAdmin: true })), "form", "FRM")).toBe("FULL");
  });
});

describe("break 2, P2 for a form's destination: a move, with both ends asked", () => {
  const list = (w: { rows: NodeRows; g: ViewerGrants }, change: { list?: string | null; table?: string | null }) => formDestinationVerdict(w.rows, w.g, "FRM", change);

  it("a form lives where it sends responses, and a List or a table holds a form", () => {
    expect(formDestinationRef(world().rows.forms.get("FRM")!)).toEqual({ kind: "list", id: "LA" });
    expect(formDestinationRef(world().rows.forms.get("FT")!)).toEqual({ kind: "table", id: "TB" });
    expect(formDestinationRef(world().rows.forms.get("FREE")!)).toBeNull();
    expect(currentPlace(world().rows, { kind: "form", id: "FRM" })).toEqual({ kind: "list", id: "LA" });
    expect(currentPlace(world().rows, { kind: "form", id: "FREE" })).toBeNull();
    expect(placeHolds({ kind: "list", id: "LA" }, "form")).toBe(true);
    expect(placeHolds({ kind: "table", id: "TB" }, "form")).toBe(true);
    expect(placeHolds({ kind: "space", id: "SA" }, "form")).toBe(false);
    expect(placeHolds({ kind: "folder", id: "FA" }, "form")).toBe(false);
  });

  it("Full on one List of their own and nothing on the form: refused on the form itself (round four, break 2)", () => {
    const two = onList(world(), "LB", "ADMIN");
    expect(role(two, "form", "FRM")).toBe("VIEW");
    expect(list(two, { list: "LB" })).toEqual({ ok: false, failure: "node", slot: null });
  });

  it("Full on the form alone (a form grant, or its creator with Can edit on the List) never takes it away from a List they do not manage", () => {
    const grantee = onList(onForm(world(), "FRM", "ADMIN"), "LB", "MEMBER");
    expect(list(grantee, { list: "LB" })).toEqual({ ok: false, failure: "source", slot: "list" });
    expect(list(grantee, { list: null })).toEqual({ ok: false, failure: "source", slot: "list" });
    const creator = onList(onList(world(), "LA", "MEMBER"), "LB", "MEMBER");
    creator.rows.forms.set("FRM", { ...creator.rows.forms.get("FRM")!, createdById: ME });
    expect(role(creator, "form", "FRM")).toBe("FULL");
    expect(list(creator, { list: "LB" })).toEqual({ ok: false, failure: "source", slot: "list" });
  });

  it("Full where it sends now and Can edit where it will: allowed; Can view there: refused on the destination", () => {
    const both = onList(onList(world(), "LA", "ADMIN"), "LB", "MEMBER");
    expect(list(both, { list: "LB" })).toEqual({ ok: true, same: false });
    const viewThere = onList(onList(world(), "LA", "ADMIN"), "LB", "GUEST");
    expect(list(viewThere, { list: "LB" })).toEqual({ ok: false, failure: "destination", slot: "list" });
    const nothingThere = onList(world(), "LA", "ADMIN");
    expect(list(nothingThere, { list: "LB" })).toEqual({ ok: false, failure: "destination", slot: "list" });
  });

  it("the table slot is the same move: Full on the table it leaves, Can edit on the one it goes to", () => {
    const w = onList(world(), "LA", "ADMIN");
    // Nothing on SB: the table is out of reach, so it is no destination.
    expect(formDestinationVerdict(w.rows, w.g, "FRM", { table: "TB" })).toEqual({ ok: false, failure: "destination", slot: "table" });
    w.g.space.set("SB", "MEMBER");
    expect(formDestinationVerdict(w.rows, w.g, "FRM", { table: "TB" })).toEqual({ ok: true, same: false });
    const ft = world();
    ft.g.space.set("SB", "MEMBER");
    ft.rows.forms.set("FT", { ...ft.rows.forms.get("FT")!, createdById: ME });
    expect(formDestinationVerdict(ft.rows, ft.g, "FT", { table: null })).toEqual({ ok: false, failure: "source", slot: "table" });
  });

  it("emptying every destination takes the form out of its Space, so the Full access must be the form's own (fullWhereItLands)", () => {
    const listManager = onList(world(), "LA", "ADMIN");
    expect(list(listManager, { list: null })).toEqual({ ok: false, failure: "landing", slot: null });
    const creator = onList(world(), "LA", "ADMIN");
    creator.rows.forms.set("FRM", { ...creator.rows.forms.get("FRM")!, createdById: ME });
    expect(list(creator, { list: null })).toEqual({ ok: true, same: false });
    const admin = world(viewer({ orgAdmin: true }));
    expect(list(admin, { list: null })).toEqual({ ok: true, same: false });
  });

  it("org admins and Space managers keep today's rights (P7): both ends, any List in the org", () => {
    expect(list(world(viewer({ orgAdmin: true })), { list: "LB" })).toEqual({ ok: true, same: false });
    const owner = world();
    owner.g.space.set("SA", "OWNER");
    owner.g.space.set("SB", "MEMBER");
    expect(role(owner, "form", "FRM")).toBe("FULL");
    expect(list(owner, { list: "LB" })).toEqual({ ok: true, same: false });
  });

  it("what is stored again is no move, a gone destination is no container, and nothing moves for a denied viewer", () => {
    const w = world();
    expect(list(w, { list: "LA" })).toEqual({ ok: true, same: true });
    expect(list(w, {})).toEqual({ ok: true, same: true });
    const gone = onList(world(), "LB", "MEMBER");
    gone.rows.lists.delete("LA");
    gone.rows.forms.set("FRM", { ...gone.rows.forms.get("FRM")!, createdById: ME });
    expect(list(gone, { list: "LB" })).toEqual({ ok: true, same: false });
    expect(list(world(viewer({ denied: true })), { list: "LB" })).toEqual({ ok: false, failure: "node", slot: null });
  });

  it("a Full holder of the List sends its form somewhere else: P1's create on the new List (Can edit), never Full there", () => {
    const w = onList(onList(world(), "LA", "ADMIN"), "LB", "MEMBER");
    expect(createDecision(w.rows, w.g, { kind: "list", id: "LB" }, "form")).toBe(true);
    expect(createDecision(w.rows, w.g, { kind: "list", id: "LA" }, "form")).toBe(true);
    expect(createDecision(world().rows, world().g, { kind: "list", id: "LA" }, "form")).toBe(false);
  });

  it("canChangeDestination (P5): the form's Full access and Full where it sends now, whatever the destination will be", () => {
    expect(formDestinationChangeable(world().rows, world().g, "FRM")).toBe(false);
    expect(formDestinationChangeable(onForm(world(), "FRM", "ADMIN").rows, onForm(world(), "FRM", "ADMIN").g, "FRM")).toBe(false);
    const manager = onList(world(), "LA", "ADMIN");
    expect(formDestinationChangeable(manager.rows, manager.g, "FRM")).toBe(true);
    const free = world();
    expect(formDestinationChangeable(free.rows, free.g, "FREE")).toBe(false);
    const freeCreator = world();
    freeCreator.rows.forms.set("FREE", { ...freeCreator.rows.forms.get("FREE")!, createdById: ME });
    expect(formDestinationChangeable(freeCreator.rows, freeCreator.g, "FREE")).toBe(true);
    expect(formDestinationChangeable(world(viewer({ orgAdmin: true })).rows, world(viewer({ orgAdmin: true })).g, "FRM")).toBe(true);
  });

  it("the refusals are one plain sentence each, naming what is needed, with no em dash and no double hyphen", () => {
    expect(formDestinationRefusal("node", null)).toBe("You need Full access to this form to change where its responses go.");
    expect(formDestinationRefusal("source", "list")).toBe("You need Full access where this form sends responses now and Can edit where it will send them.");
    expect(formDestinationRefusal("destination", "list")).toBe("You need Can edit on that List to send responses to it.");
    expect(formDestinationRefusal("destination", "table")).toBe("You need Can edit on that table to send responses to it.");
    for (const f of ["node", "source", "destination", "landing"] as const) {
      const s = formDestinationRefusal(f, "list");
      expect(s).not.toMatch(/—|--/);
      expect(s.endsWith(".")).toBe(true);
    }
  });
});

describe("break 1, P4: a bare position is a reorder under the parent the Folder has", () => {
  it("Full on the Folder alone, nothing on its Space: the reorder is refused on the parent, as the sidebar drag refuses it", () => {
    const w = onFolder(world(), "FA", "ADMIN");
    expect(moveVerdict(w.rows, w.g, { kind: "folder", id: "FA" }, { kind: "space", id: "SA" })).toEqual({ ok: false, failure: "source" });
    const manager = onFolder(world(), "FA", "ADMIN");
    manager.g.space.set("SA", "ADMIN");
    expect(moveVerdict(manager.rows, manager.g, { kind: "folder", id: "FA" }, { kind: "space", id: "SA" })).toEqual({ ok: true, same: true });
  });
});
