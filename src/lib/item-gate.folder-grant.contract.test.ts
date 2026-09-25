// A folder grantee reads the tasks of the Lists under the folder they were
// granted, and writes none of them.
//
// Before this, the List page showed a folder grantee its tasks (the List page
// gates with getBoardForReaderOrFolderGrantee, board.ts), but every
// /api/items/[id]* door gated through gateItem, whose List role came from
// getBoardForReader alone, and answered 404: the task drawer, the subtasks
// pill and the realtime refresh all dead-ended on a task the List had just
// drawn. Bird's eye shows the same reader the same cards, so it has to open.
//
// Two halves, because vitest here runs pure modules in node with no database:
//
//   1. the SOURCE half: gateItem asks the folder-grant door ONLY after
//      getBoardForReader refused, asks only the grant half (never the wrapper,
//      which would run getBoardForReader a second time), and it can only ever
//      yield VIEW; the crumbs' listIsReadable asks the List page's own gate,
//      split into its two halves the same way;
//   2. the DECISION half: a List role of VIEW lets the task be read and never
//      edited, moved, archived or deleted.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { allowsItemAction, decideItem } from "./item-role";

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

describe("gateItem gives a folder grantee VIEW, and only VIEW", () => {
  const listRoleBlock = between(code, 'let listRole: ItemDecision["role"] = "none";', "const creatorId");

  it("asks the folder-grant door only after the reader gate refused", () => {
    const reader = listRoleBlock.indexOf("await getBoardForReader(item.boardId");
    const grantee = listRoleBlock.indexOf("folderGrantCovers(item.board.folderId, c.userId)");
    expect(reader).toBeGreaterThan(-1);
    expect(grantee).toBeGreaterThan(reader);
    expect(listRoleBlock).toMatch(/\} else if \(item\.board\.folderId\) \{/);
  });

  it("runs the reader gate once: never the wrapper that repeats it", () => {
    expect(listRoleBlock.match(/getBoardForReader\(/g)?.length).toBe(1);
    expect(code).not.toMatch(/getBoardForReaderOrFolderGrantee\(/);
  });

  it("can only ever yield VIEW through the folder grant", () => {
    const branch = listRoleBlock.slice(listRoleBlock.indexOf("} else if (item.board.folderId) {"));
    expect(branch).toMatch(/\? "VIEW" : "none"/);
    expect(branch).not.toMatch(/"EDIT"|"FULL"/);
  });

  it("keeps the org-admin short cut ahead of every List read", () => {
    expect(listRoleBlock).toMatch(/if \(!orgAdmin\) \{/);
  });

  it("links a grantee's crumbs to the List page that opens for them", () => {
    const readable = between(code, "export async function listIsReadable", "\n}\n");
    const reader = readable.indexOf("await getBoardForReader(item.boardId, c.userId, c.accessLevel)");
    const grant = readable.indexOf("folderGrantCovers(item.board.folderId, c.userId)");
    expect(reader).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(reader);
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
