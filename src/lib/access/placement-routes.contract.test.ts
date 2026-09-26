// Contracts over the SOURCE of every route the placement sweep covers
// (node-rules P1 to P7). The rule itself is tested in
// node-rules.placement.test.ts; these pin that each create, move, reorder,
// delete and restore door still asks it, since the doors need a database and
// a session the unit suite does not have. A route that drops its call to the
// rule fails here before it can ship.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("Folders", () => {
  it("the sidebar reorder moves through the one move helper, never a bare row write", () => {
    const route = read("src/app/api/folders/reorder/route.ts");
    expect(route).toMatch(/await moveFolder\(ctx, movedId,/);
    expect(route).not.toMatch(/updateFolder\(/);
  });
  it("PATCH refuses a spaceId field and moves a new parent through the helper", () => {
    const route = read("src/app/api/folders/[id]/route.ts");
    expect(route).toMatch(/if \(parsed\.data\.spaceId !== undefined\) \{\s*return NextResponse\.json\(\{ error: "A folder's Space comes from where it sits/);
    expect(route).toMatch(/moved = await moveFolder\(gate\.ctx, id, \{ parentFolderId, position \}\)/);
  });
  it("both deletes take the whole subtree and ask checkFolderDelete first", () => {
    const route = read("src/app/api/folders/[id]/route.ts");
    const del = route.slice(route.indexOf("export async function DELETE("));
    expect(del.indexOf("checkFolderDelete(gate.ctx, id)")).toBeGreaterThan(0);
    expect(del.indexOf("checkFolderDelete(gate.ctx, id)")).toBeLessThan(del.indexOf("moveToTrash("));
    const trash = read("src/lib/trash.ts");
    expect(trash).toMatch(/const subtree = await folderBranch\(db, row\.organizationId, id\)/);
    expect(trash).toMatch(/await tx\.folder\.deleteMany\(\{ where: \{ id: \{ in: ids \} \} \}\)/);
  });
  it("the Move dialog's route, create and duplicate ask the rule", () => {
    expect(read("src/app/api/folders/[id]/move/route.ts")).toMatch(/await moveFolder\(ctx, id, \{ spaceId: parsed\.data\.spaceId, parentFolderId:/);
    expect(read("src/app/api/folders/route.ts")).toMatch(/await resolveCreate\(\s*nodeCtxFromLevel\([^)]*\),\s*\{ spaceId: parsed\.data\.spaceId, folderId: parsed\.data\.parentFolderId \?\? null \},\s*"folder",/);
    expect(read("src/app/api/folders/[id]/duplicate/route.ts")).toMatch(/await checkCreate\(ctx, parentRef, "folder"\)/);
  });
  it("a Folder edit can no longer write a Space or a parent, and a create reads its parent under a lock", () => {
    const lib = read("src/lib/folder.ts");
    const input = lib.slice(lib.indexOf("export interface UpdateFolderInput {"), lib.indexOf("export async function isFolderDescendant("));
    expect(input).not.toMatch(/spaceId\?:/);
    expect(input).not.toMatch(/parentFolderId\?:/);
    expect(lib).toMatch(/const parent = await lockParentFolder\(tx, input\.organizationId, input\.parentFolderId\)/);
  });
});

describe("Lists", () => {
  it("re-foldering is a move through moveList, and an edit never writes a Folder", () => {
    expect(read("src/app/api/boards/[id]/route.ts")).toMatch(/const moved = await moveList\(nodeCtxFromLevel\([^)]*\), id, \{ folderId: nextFolderId \}\)/);
    expect(read("src/app/api/boards/[id]/move/route.ts")).toMatch(/await moveList\(nodeCtxFromLevel\([^)]*\), id, \{ spaceId, folderId \}\)/);
    const lib = read("src/lib/board.ts");
    expect(lib).not.toMatch(/if \(patch\.folderId !== undefined\) data\.folderId = patch\.folderId;/);
    expect(lib).toMatch(/const parent = await lockParentFolder\(tx, input\.organizationId, input\.folderId\)/);
  });
  it("create and duplicate ask the create rule where the List lands", () => {
    expect(read("src/app/api/boards/route.ts")).toMatch(/"list",\s*\);/);
    expect(read("src/app/api/boards/[id]/duplicate/route.ts")).toMatch(/await checkCreate\(/);
  });
});

describe("Docs", () => {
  it("POST asks Can view, the parent's anchor, then Can edit", () => {
    const route = read("src/app/api/docs/route.ts");
    const post = route.slice(route.indexOf("export async function POST("));
    expect(post).toMatch(/await canReadDocPlace\(nodeCtx, anchor, parentId\)/);
    expect(post).toMatch(/anchorAgreesWithParent\(anchor, parentHome\)/);
    expect(post).toMatch(/await canCreateDocAt\(nodeCtx, anchor, parentId\)/);
  });
  it("find-or-create finds at Can view and creates at Can edit", () => {
    const route = read("src/app/api/docs/by-entity/route.ts");
    expect(route.indexOf("canReadDocPlace(nodeCtx, anchor, null)")).toBeLessThan(route.indexOf("canCreateDocAt(nodeCtx, anchor, null)"));
    expect(route.indexOf("canCreateDocAt(nodeCtx, anchor, null)")).toBeLessThan(route.indexOf("prisma.doc.create("));
  });
  it("restore checks the place is live and Can edit there", () => {
    const route = read("src/app/api/docs/[id]/restore/route.ts");
    expect(route).toMatch(/await docPlaceLive\(ctx\.orgId, place\)/);
    expect(route.indexOf("canCreateDocAt(")).toBeLessThan(route.indexOf("data: { archivedAt: null }"));
  });
  it("the doc gate is Can edit (node-access createDecision), not Can view", () => {
    expect(read("src/lib/access/node-access.ts")).toMatch(/floor === "EDIT" \? !createDecision\(rows, grants, r, "doc"\)/);
  });
});

describe("Trash restore", () => {
  it("both tabs check the landing container before writing", () => {
    const server = read("src/lib/trash-server.ts");
    expect(server).toMatch(/const landing = await archiveLanding\(viewer, type, id\);/);
    expect(server).toMatch(/const landing = await snapshotLanding\(viewer, snap\.entityType, snap\.snapshot\);/);
  });
  it("a snapshot re-derives its Space from its parent as it is now", () => {
    const trash = read("src/lib/trash.ts");
    expect(trash).toMatch(/if \(parent\) row\.spaceId = parent\.spaceId;/);
    expect(trash).toMatch(/if \(folder\) row\.spaceId = folder\.spaceId;/);
    expect(trash).toMatch(/if \(!folder\) throw new Error\("The folder this canvas lived in is gone\."\);/);
  });
});

describe("Tables, canvases, files", () => {
  it("tables: create, move, duplicate and import ask the rule", () => {
    expect(read("src/app/api/tables/route.ts")).toMatch(/await resolveCreate\(nodeCtxFromLevel\(userId, orgId, level\), \{ spaceId \}, "table"\)/);
    expect(read("src/app/api/tables/[id]/route.ts")).toMatch(/const check = await checkMove\(tableCtx\(orgId, getUserId\(session\), session\), \{ kind: "table", id \}/);
    expect(read("src/app/api/tables/[id]/duplicate/route.ts")).toMatch(/await checkCreate\(tableCtx\(orgId, userId, session\)/);
    expect(read("src/app/api/tables/[id]/import/route.ts")).toMatch(/if \(!table\.canEdit\) return jsonError\(/);
  });
  it("canvases: create, move and duplicate ask the rule", () => {
    expect(read("src/app/api/whiteboards/route.ts")).toMatch(/await resolveCreate\(nodeCtx, \{ spaceId: parsed\.data\.spaceId \?\? null, folderId: parsed\.data\.folderId \?\? null \}, "canvas", \{ root: true \}\)/);
    expect(read("src/app/api/whiteboards/[id]/route.ts")).toMatch(/const moved = await moveCanvas\(nodeCtx, id, \{/);
    expect(read("src/app/api/whiteboards/[id]/duplicate/route.ts")).toMatch(/await canCreateAt\(nodeCtx, container, "canvas"\)/);
  });
  it("files: an upload into a Folder or a Space's root, and a move in the Space tree, ask the rule", () => {
    expect(read("src/app/api/files/route.ts")).toMatch(/const placed = await resolveCreate\(nodeCtx, \{ spaceId, folderId: spaceFolderId \}, "file"\)/);
    expect(read("src/app/api/files/[id]/route.ts")).toMatch(/const check = await checkFileMove\(/);
  });
});

describe("Forms, templates, Spaces", () => {
  it("a form's destination needs Can edit on create, change and copy", () => {
    expect(read("src/app/api/forms/route.ts")).toMatch(/await checkFormDestination\(nodeCtxFromViewer\(viewer\), \{ boardId: targetBoardId, tableId: targetTableId \}\)/);
    expect(read("src/app/api/forms/[id]/route.ts")).toMatch(/await checkFormDestination\(nodeCtxFromViewer\(editor\), \{ boardId: newBoard, tableId: newTable \}\)/);
    expect(read("src/app/api/forms/[id]/duplicate/route.ts")).toMatch(/targetBoardId: keepBoard \? source\.targetBoardId : null/);
  });
  it("a template lands where the rule allows", () => {
    const route = read("src/app/api/template-center/[id]/apply/route.ts");
    expect(route).toMatch(/const placed = await resolveCreate\(nodeCtx, \{ spaceId, folderId \}, what\)/);
    expect(route).not.toMatch(/gateSpace\(/);
  });
  it("Space nesting has one check, a sub-Space needs Can edit on a live parent, a copy Full access on its Space", () => {
    expect(read("src/app/api/spaces/[id]/route.ts")).toMatch(/await spaceReparentRefusal\(id, parsed\.data\.parentSpaceId, c\)/);
    expect(read("src/app/api/spaces/[id]/move/route.ts")).toMatch(/await spaceReparentRefusal\(id, parentSpaceId, c\)/);
    expect(read("src/lib/space.ts")).toMatch(/const verdict = spaceNestVerdict\(\{ spaceId, managesSpace, current:/);
    const create = read("src/app/api/spaces/route.ts");
    expect(create).toMatch(/await canContributeSpace\(parsed\.data\.parentSpaceId, c\.userId, c\.accessLevel\)/);
    expect(create).toMatch(/if \(parent\.archivedAt\) return NextResponse\.json\(\{ error: "That Space is archived\." \}, \{ status: 400 \}\);/);
    // Break 10 of round one: a Space OWNER or ADMIN who is not a manager
    // duplicates their own Space again (rule 7), so no manager floor here.
    const dup = read("src/app/api/spaces/[id]/duplicate/route.ts");
    expect(dup).toMatch(/if \(!\(await canEditSpace\(id, u\.id, accessLevel\)\)\)/);
    expect(dup).not.toMatch(/SPACE_CREATE_LEVELS/);
  });
});

describe("the clients", () => {
  it("the Move dialog lists the rule's own destinations and keeps a refused choice", () => {
    const dialog = read("src/components/layout/os/move-target-dialog.tsx");
    expect(dialog).toMatch(/\/api\/move\/destinations\?kind=/);
    expect(dialog).toMatch(/setRefusal\(\{ key, message \}\);/);
  });
  it("the sidebar drag goes to the move endpoints and shows the refusal", () => {
    const row = read("src/components/layout/os/space-tree-row.tsx");
    expect(row).toMatch(/treeWrite\(`\/api\/boards\/\$\{p\.id\}\/move`/);
    expect(row).toMatch(/treeWrite\(`\/api\/folders\/\$\{p\.id\}\/move`/);
    expect(row).toMatch(/else toast\(moved\.error\);/);
  });
});
