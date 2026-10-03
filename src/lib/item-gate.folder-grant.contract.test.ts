// A folder grantee reads the tasks of the Lists under the folder they were
// granted, with the role the grant gives them and nothing more.
//
// Before this, the List page showed a folder grantee its tasks, but every
// /api/items/[id]* door gated through gateItem, whose List role came from a
// reader that knew nothing of Folder grants, and answered 404: the task
// drawer, the subtasks pill and the realtime refresh all dead-ended on a task
// the List had just drawn. Bird's eye shows the same reader the same cards,
// so it has to open.
//
// The one node-access resolver answers it now: the List's role for this
// viewer is decided over one world (the List's own grant, its owner, its
// Folder chain with the Folder grant's own role, its Space, the PRIVATE cut),
// so a Folder grant with Can view reads and one with Can edit writes, exactly
// as the grant says (node-rules W1). Two halves, because vitest here runs
// pure modules in node with no database:
//
//   1. the SOURCE half: gateItem asks the resolver ONCE for the List, after
//      the org-admin short cut, never a per-helper ladder and never a second
//      reader or a legacy folder door; the crumbs' listIsReadable asks the
//      same resolver's Can view;
//   2. the DECISION half: a List role of VIEW lets the task be read and never
//      edited, moved, archived or deleted.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { allowsItemAction, decideItem, taskSideOfListRole } from "./item-role";

const code = readFileSync(join(__dirname, "item-gate.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

function between(src: string, from: string, to: string): string {
  const start = src.indexOf(from);
  expect(start, from).toBeGreaterThan(-1);
  const end = src.indexOf(to, start + from.length);
  expect(end, to).toBeGreaterThan(-1);
  return src.slice(start, end);
}

describe("gateItem takes a folder grantee's role from the one resolver", () => {
  const listRoleBlock = between(code, 'let listRole: ItemDecision["role"] = "none";', "const creatorId");

  it("asks the resolver once for the List, over one world", () => {
    expect(listRoleBlock).toMatch(/await nodeRole\(nodeCtxFromLevel\(c\.userId, c\.organizationId, c\.accessLevel\), \{ kind: "list", id: item\.boardId \}\)/);
    expect(listRoleBlock.match(/nodeRole\(/g)?.length).toBe(1);
  });

  it("runs no second reader and no legacy folder door", () => {
    expect(listRoleBlock).not.toMatch(/getBoardForReader\(|canContributeBoard\(|canEditBoard\(/);
    expect(code).not.toMatch(/getBoardForReaderOrFolderGrantee\(|folderGrantCovers\(|accessibleFolderIds\(/);
  });

  it("reads the Space Owner rung as Full access and fabricates nothing else", () => {
    // The List role's task half comes from one pure map (founder decision 3
    // added the List's two rungs below Can edit to it).
    expect(listRoleBlock).toMatch(/\(\{ listRole, assigneeLift \} = taskSideOfListRole\(d\.role\)\);/);
    expect(taskSideOfListRole("OWNER").listRole).toBe("FULL");
    for (const r of ["FULL", "EDIT", "COMMENT", "VIEW", "none"] as const) expect(taskSideOfListRole(r).listRole, r).toBe(r);
    // Can edit assigned tasks is Can comment on the task, plus the assignee lift.
    expect(taskSideOfListRole("ASSIGNED")).toEqual({ listRole: "COMMENT", assigneeLift: true });
    expect(taskSideOfListRole("COMMENT").assigneeLift).toBe(false);
  });

  it("keeps the org-admin short cut ahead of every List read", () => {
    expect(listRoleBlock).toMatch(/if \(!orgAdmin\) \{/);
  });

  it("links a grantee's crumbs to the List page that opens for them", () => {
    const readable = between(code, "export async function listIsReadable", "\n}\n");
    expect(readable).toMatch(/await getBoardForReader\(item\.boardId, c\.userId, c\.accessLevel\)/);
    expect(readable).not.toMatch(/folderGrantCovers/);
  });
});

describe("a List role of VIEW reads the task and changes nothing", () => {
  const decision = decideItem({
    orgAdmin: false,
    guest: false,
    agent: false,
    creator: false,
    assignee: false,
    listRole: "VIEW",
    archived: false,
    list: { id: "l1", name: "Granted List" },
  });

  it("resolves to VIEW through the List", () => {
    expect(decision.role).toBe("VIEW");
  });

  it("allows the read and refuses every write", () => {
    expect(allowsItemAction(decision, "view", { creator: false })).toBe(true);
    for (const write of ["edit", "move", "archive", "delete"] as const) {
      expect({ write, allowed: allowsItemAction(decision, write, { creator: false }) }).toEqual({ write, allowed: false });
    }
  });
});
