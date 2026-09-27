// Round two of the placement sweep: contracts over the SOURCE of each door the
// attackers broke in round one, so a route that drops its call to the rule
// fails here before it ships. The rules themselves are unit tested in
// node-rules.round2.test.ts; these doors need a database and a session.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("break 0: a doc move takes its page tree", () => {
  it("PUT writes the tree move through writeDocTreeMove, never a bare row update", () => {
    const route = read("src/app/api/docs/[id]/route.ts");
    const put = route.slice(route.indexOf("export async function PUT("), route.indexOf("export const PATCH = PUT;"));
    expect(put).toMatch(/const written = await writeDocTreeMove\(ctx\.orgId, id, \{/);
    const tree = put.slice(put.indexOf("if (isTreeOnly) {"), put.indexOf("// Optimistic-concurrency precondition."));
    expect(tree).not.toMatch(/prisma\.doc\.update\(/);
  });
  it("the helper plans the subtree inside the transaction and rewrites it there", () => {
    const lib = read("src/lib/access/node-placement.ts");
    const fn = lib.slice(lib.indexOf("export async function writeDocTreeMove("), lib.indexOf("export async function docAnchorPlaceOf("));
    expect(fn).toMatch(/const plan = subtreeAnchorPlan\(homeAfter, await docDescendants\(tx, organizationId, docId\)\);/);
    expect(fn).toMatch(/await tx\.doc\.updateMany\(\{ where: \{ id: \{ in: rewrite \}, organizationId \}/);
  });
});

describe("breaks 1 and 5: a file at a Space's root needs Can edit on the Space", () => {
  it("the upload has no Space exception left: canCreateAt is createDecision for every kind", () => {
    const access = read("src/lib/access/node-access.ts");
    const fn = access.slice(access.indexOf("export async function canCreateAt("), access.indexOf("function viewerOfCtx("));
    expect(fn).not.toMatch(/what === "file"/);
    expect(fn).toMatch(/return createDecision\(rows, grants, container, what\);/);
  });
  it("POST /api/files resolves both places through resolveCreate and locks a folder parent", () => {
    const route = read("src/app/api/files/route.ts");
    expect(route).toMatch(/if \(spaceFolderId \|\| spaceId\) \{\s*const placed = await resolveCreate\(/);
    expect(route).toMatch(/const parent = await lockParentFolder\(tx, orgId, spaceFolderId\);/);
    expect(route).not.toMatch(/canCreateAt\(/);
  });
});

describe("break 2: every row of a copy takes its Space from a locked parent", () => {
  it("the Folder copy locks its parent for the root, each sub-folder and each List", () => {
    const route = read("src/app/api/folders/[id]/duplicate/route.ts");
    expect(route).toMatch(/const parent = await lockParentFolder\(tx, organizationId, src\.parentFolderId\);/);
    expect(route.match(/await lockParentFolder\(tx, organizationId, node\.targetId\)/g)?.length).toBe(2);
    expect(route).not.toMatch(/spaceId: src\.spaceId,\s*parentFolderId: node\.targetId/);
    expect(route).toMatch(/data: \{ folderId: node\.targetId, spaceId: parent\.spaceId \}/);
  });
  it("a List copy and a canvas copy read their Folder under the lock too", () => {
    expect(read("src/lib/board.ts")).toMatch(/const parent = await lockParentFolder\(tx, organizationId, src\.folderId\);/);
    expect(read("src/app/api/whiteboards/[id]/duplicate/route.ts")).toMatch(/const parent = await lockParentFolder\(tx, ctx\.orgId, folderId\);/);
  });
});

describe("break 4: a Space goes to Trash with everything placed in it", () => {
  it("the capture takes canvases, tables with their rows, files, grants and sub-Spaces", () => {
    const trash = read("src/lib/trash.ts");
    const space = trash.slice(trash.indexOf("  space: {"), trash.indexOf("  file_folder: {"));
    for (const k of ["canvases", "tables", "tableRows", "files", "spaceMembers", "folderMembers", "childSpaces"]) {
      expect(space).toMatch(new RegExp(`${k}: ${k} as unknown as Row\\[\\]`));
    }
    expect(space).toMatch(/await db\.whiteboard\.createMany\(/);
    expect(space).toMatch(/await db\.dataTable\.createMany\(/);
    expect(space).toMatch(/await db\.fileEntry\.createMany\(/);
    expect(space).toMatch(/await db\.spaceMember\.createMany\(/);
  });
  it("the live delete removes what the capture took, in the same transaction", () => {
    const trash = read("src/lib/trash.ts");
    expect(trash).toMatch(/if \(canvasIds\.length\) await tx\.whiteboard\.deleteMany\(\{ where: \{ id: \{ in: canvasIds \} \} \}\);\s*if \(tableIds\.length\) await tx\.dataTable\.deleteMany/);
  });
  it("a purge of an archived Space or Folder is refused while canvases, tables or files still sit in it", () => {
    const server = read("src/lib/trash-server.ts");
    const fn = server.slice(server.indexOf("async function liveChildrenOf("));
    expect(fn).toMatch(/prisma\.whiteboard\.count\(\{ where: \{ spaceId: id, organizationId, archivedAt: null \} \}\)/);
    expect(fn).toMatch(/prisma\.fileEntry\.count\(\{ where: \{ spaceFolderId: id, organizationId \} \}\)/);
    expect(fn).toMatch(/prisma\.folder\.count\(\{ where: \{ parentFolderId: id, organizationId, archivedAt: null \} \}\)/);
  });
});

describe("breaks 6 and 7: a restore from Trash checks where it lands", () => {
  it("a file lands under Can edit, and comes back in its folder's Space as it is now", () => {
    const server = read("src/lib/trash-server.ts");
    expect(server).toMatch(/case "file": \{[\s\S]*?return landingCheck\(viewer, folder \? \{ kind: "folder", id: folder \} : space \? \{ kind: "space", id: space \} : null, "file"\);/);
    const trash = read("src/lib/trash.ts");
    const file = trash.slice(trash.indexOf("  file: {"), trash.indexOf("  policy: {"));
    expect(file).toMatch(/row\.spaceId = folder\.spaceId;/);
  });
  it("a form's destination is asked again with checkFormDestination", () => {
    const server = read("src/lib/trash-server.ts");
    expect(server).toMatch(/case "form":\s*return formLanding\(viewer, \{ boardId: str\("targetBoardId"\), tableId: str\("targetTableId"\) \}\);/);
    expect(server).toMatch(/const gate = await checkFormDestination\(nodeCtxFromViewer\(viewer\),/);
  });
});

describe("break 9: a file's own edits and its Trash need Can edit where it sits", () => {
  it("PATCH (name, description, drive folder) and DELETE ask checkFileEdit", () => {
    const route = read("src/app/api/files/[id]/route.ts");
    const patch = route.slice(route.indexOf("export async function PATCH("), route.indexOf("export async function DELETE("));
    expect(patch).toMatch(/const edit = await checkFileEdit\(/);
    const del = route.slice(route.indexOf("export async function DELETE("));
    expect(del.indexOf("checkFileEdit(")).toBeGreaterThan(0);
    expect(del.indexOf("checkFileEdit(")).toBeLessThan(del.indexOf("moveToTrash("));
  });
});

describe("break 3: Space nesting asks the Space and where it goes, never the parent it leaves (round three, break 3)", () => {
  it("spaceReparentRefusal hands spaceNestVerdict the current parent's id alone, and the destination's archived state", () => {
    const lib = read("src/lib/space.ts");
    const fn = lib.slice(lib.indexOf("export async function spaceReparentRefusal("), lib.indexOf("export interface CreateSpaceInput"));
    expect(fn).not.toMatch(/if \(!parentSpaceId\) return null;/);
    expect(fn).not.toMatch(/canEditSpace\(currentId/);
    expect(fn).toMatch(/current: currentId \? \{ id: currentId \} : null/);
    expect(fn).toMatch(/archived: !!parent\?\.archivedAt/);
  });
  it("and the Space Move dialog asks no role on the parent it leaves either", () => {
    const lib = read("src/lib/space.ts");
    const fn = lib.slice(lib.indexOf("export async function spaceNestDestinations("), lib.indexOf("export interface CreateSpaceInput"));
    expect(fn).not.toMatch(/canEditSpace\(currentId/);
    expect(fn).toMatch(/const current = currentId \? \{ id: currentId \} : null;/);
  });
});

describe("break 12: P7's create is not a 404", () => {
  it("resolveCreate asks the create rule before it answers not found", () => {
    const lib = read("src/lib/access/node-placement.ts");
    const fn = lib.slice(lib.indexOf("export async function resolveCreate("), lib.indexOf("export async function lockParentFolder("));
    expect(fn).toMatch(/if \(!createDecision\(rows, grants, named, what\) && !\(await seesPlace\(ctx, new NodeEvaluator\(rows, grants\), named\)\)\)/);
  });
});
