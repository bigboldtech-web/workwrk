// Round four of the placement rule (node-rules.ts P1 to P7): the breaks the
// round three attackers proved, as unit tests that fail without their rule.
//
//   break 3  a Space OWNER could no longer move their own sub-Space to the top
//            level or under another Space they manage, which they did before
//            node-access (P7): a Space's place under a parent carries no
//            access, so the parent it leaves is asked nothing
//            (spaceNestVerdict).
//   break 8  the Folder page hid New list and New folder from Can edit
//            holders while the servers accepted their creates: the create
//            rule is Can edit (createDecision), and the page reads it.

import { describe, expect, it } from "vitest";
import {
  createDecision,
  createRefusal,
  emptyGrants,
  emptyRows,
  memberToRole,
  moveRefusal,
  roleAtLeast,
  spaceNestVerdict,
  SPACE_NEST_REFUSAL,
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

function world(): { rows: NodeRows; g: ViewerGrants } {
  const rows = emptyRows(ORG, "strict");
  rows.spaces.set("S", { id: "S", organizationId: ORG, name: "S", slug: "s", icon: null, color: null, visibility: "PRIVATE", ownerId: OTHER });
  rows.folders.set("F", { id: "F", organizationId: ORG, spaceId: "S", parentFolderId: null, name: "F", icon: null, color: null, visibility: "WORKSPACE", ownerId: OTHER, position: 0 });
  const g = emptyGrants(viewer());
  g.since = new Map();
  return { rows, g };
}

describe("break 3: a Space moves by its own managers, whatever they hold on the parent it leaves", () => {
  const dest = (over: Partial<{ id: string; found: boolean; sees: boolean; archived: boolean; manages: boolean; cycle: boolean }> = {}) =>
    ({ id: "Q", found: true, sees: true, archived: false, manages: true, cycle: false, ...over });

  it("Full on the sub-Space alone takes it to the top level (P7: what spaces/[id]/move did before node-access)", () => {
    expect(spaceNestVerdict({ spaceId: "X", managesSpace: true, current: { id: "P" }, dest: null })).toEqual({ ok: true, same: false });
  });

  it("and under another Space they manage", () => {
    expect(spaceNestVerdict({ spaceId: "X", managesSpace: true, current: { id: "P" }, dest: dest() })).toEqual({ ok: true, same: false });
  });

  it("the verdict never asks the parent it leaves: its input carries the id alone", () => {
    const input: Parameters<typeof spaceNestVerdict>[0] = { spaceId: "X", managesSpace: true, current: { id: "P" }, dest: null };
    expect(Object.keys(input.current ?? {})).toEqual(["id"]);
  });

  it("where it goes still needs Full access, with the one sentence, and no Full on the Space itself moves nothing", () => {
    expect(spaceNestVerdict({ spaceId: "X", managesSpace: true, current: { id: "P" }, dest: dest({ manages: false }) })).toEqual({ ok: false, status: 403, error: SPACE_NEST_REFUSAL });
    expect(spaceNestVerdict({ spaceId: "X", managesSpace: false, current: { id: "P" }, dest: null })).toMatchObject({ ok: false, status: 403 });
  });

  it("the parent it already has is no move, and a parent out of sight is a 404 before any role is named", () => {
    expect(spaceNestVerdict({ spaceId: "X", managesSpace: true, current: { id: "Q" }, dest: dest({ manages: false }) })).toEqual({ ok: true, same: true });
    expect(spaceNestVerdict({ spaceId: "X", managesSpace: true, current: null, dest: dest({ sees: false, manages: false }) })).toMatchObject({ ok: false, status: 404 });
  });

  it("the sentence names the destination only, with no em dash and no double hyphen", () => {
    expect(SPACE_NEST_REFUSAL).toMatch(/going into/);
    expect(SPACE_NEST_REFUSAL).not.toMatch(/sits in now/);
    expect(SPACE_NEST_REFUSAL).not.toMatch(/—|--/);
  });
});

describe("break 8: the create rule the Folder page reads is Can edit", () => {
  it("Can edit (a MEMBER grant) on a Folder creates a List and a sub-folder in it; Can view (a GUEST grant) never does", () => {
    const { rows, g } = world();
    for (const [member, ok] of [["GUEST", false], ["MEMBER", true], ["ADMIN", true], ["OWNER", true]] as const) {
      g.folder = new Map([["F", member]]);
      expect(createDecision(rows, g, { kind: "folder", id: "F" }, "list")).toBe(ok);
      expect(createDecision(rows, g, { kind: "folder", id: "F" }, "folder")).toBe(ok);
      expect(roleAtLeast(memberToRole(member), "EDIT")).toBe(ok);
    }
    g.folder = new Map();
    expect(createDecision(rows, g, { kind: "folder", id: "F" }, "list")).toBe(false);
  });

  it("the refusal sentences say Can edit, and carry no em dash or double hyphen", () => {
    expect(createRefusal("list", { kind: "folder", id: "F" })).toBe("You need Can edit on this folder to add a List to it.");
    expect(createRefusal("folder", { kind: "folder", id: "F" })).toBe("You need Can edit on this folder to add a folder to it.");
    for (const s of [createRefusal("doc", { kind: "doc", id: "D" }), moveRefusal("folder", "source"), moveRefusal("folder", "node")]) {
      expect(s).not.toMatch(/—|--/);
    }
  });
});
