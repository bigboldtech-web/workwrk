// Round three of the placement sweep: contracts over the SOURCE of each door
// the round two attackers broke, so a route or a picker that drops its call
// to the rule fails here before it ships. The rules themselves are unit
// tested in node-rules.round3.test.ts, node-placement.round3.test.ts and
// entity-link-write.test.ts; these doors need a database, a session or a
// browser.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const between = (text: string, from: string, to?: string) => {
  const start = text.indexOf(from);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = to ? text.indexOf(to, start + from.length) : text.length;
  return text.slice(start, end < 0 ? text.length : end);
};

describe("break 1: a Folder move rewrites the branch it read under the locks", () => {
  it("moveFolder rewrites the ids lockFolderBranch answered, never the ids read before the transaction", () => {
    const fn = between(read("src/lib/access/node-placement.ts"), "export async function moveFolder(", "function isLockConflict(");
    const tx = between(fn, "await prisma.$transaction(async (tx) => {");
    expect(tx).toMatch(/const ids = await lockFolderBranch\(tx, org, folder\.id\);/);
    expect(tx).toMatch(/tx\.folder\.updateMany\(\{ where: \{ id: \{ in: below \} \}/);
    expect(tx).toMatch(/const below = ids\.slice\(1\);/);
    expect(tx).toMatch(/tx\.board\.updateMany\(\{ where: \{ folderId: \{ in: ids \} \}/);
  });
  it("a Folder going to Trash locks its branch the same way, so a sub-folder made meanwhile is captured, never dropped loose", () => {
    const fn = between(read("src/lib/trash.ts"), "export async function moveToTrash(");
    expect(fn).toMatch(/const folderIds = type === "folder" \? await lockFolderBranch\(tx, ctx\.organizationId, id\) : \[\];/);
    expect(between(read("src/app/api/folders/[id]/route.ts"), "export async function DELETE(")).toMatch(/if \(err instanceof PlacementConflict\)/);
  });
  it("every Folder create reads its parent under the share lock the move waits for", () => {
    expect(between(read("src/lib/folder.ts"), "export async function createFolder(")).toMatch(/lockParentFolder\(tx, input\.organizationId, input\.parentFolderId\)/);
  });
});

describe("break 2: a Folder move asks Full access on everything it carries", () => {
  it("before the transaction and again under the locks", () => {
    const fn = between(read("src/lib/access/node-placement.ts"), "export async function moveFolder(", "function isLockConflict(");
    expect(fn.match(/checkFolderSubtreeMove\(ctx, folder\.id,/g)?.length).toBe(2);
    expect(between(fn, "const ids = await lockFolderBranch(")).toMatch(/const whole = await checkFolderSubtreeMove\(ctx, folder\.id, ids, canvases\);/);
  });
  it("and the Move dialog offers nothing for such a Folder, with the reason", () => {
    const fn = between(read("src/lib/access/node-placement.ts"), "export async function moveDestinations(", "export async function createDestinations(");
    expect(fn).toMatch(/const whole = await checkFolderSubtreeMove\(ctx, ref\.id,/);
    expect(fn).toMatch(/if \(refusal\) return false;/);
  });
});

describe("break 3: adding or removing a link asks the link write rule", () => {
  it("POST /api/entity-links asks linkWriteRefusalFor before it writes", () => {
    const post = between(read("src/app/api/entity-links/route.ts"), "export async function POST(");
    const gate = post.indexOf("await linkWriteRefusalFor(c, {");
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(post.indexOf("await createEntityLink({"));
  });
  it("DELETE /api/entity-links/[id] asks it before it deletes", () => {
    const del = between(read("src/app/api/entity-links/[id]/route.ts"), "export async function DELETE(");
    const gate = del.indexOf("await linkWriteRefusalFor(c, existing);");
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(del.indexOf("prisma.entityLink.delete("));
  });
  it("the server half builds the facts from the one resolver, the task gate and the file rules", () => {
    const fn = between(read("src/lib/entity-link-authz.ts"), "export async function linkWriteRefusalFor(");
    expect(fn).toMatch(/nodeRoles\(ctx, nodeRefs\)/);
    expect(fn).toMatch(/gateItem\(link\.sourceId, .*"edit"\)/);
    expect(fn).toMatch(/readableFileIds\(\{ ids: fileIds, viewer \}\)/);
    expect(fn).toMatch(/checkFileEdit\(ctx, file\)/);
    expect(fn).toMatch(/linkWriteVerdict\(link, facts\)/);
  });
});

describe("break 4: a List's file gallery answers to the file read rule", () => {
  it("GET /api/files?boardId= gates every file before it signs a URL", () => {
    const branch = between(read("src/app/api/files/route.ts"), "const boardId = sp.get(\"boardId\");", "const folderIdRaw");
    expect(branch).toMatch(/const readable = await gateFiles\(files, /);
    expect(branch).toMatch(/withFreshFileUrls\(readable\)/);
    expect(branch).not.toMatch(/withFreshFileUrls\(files\)/);
  });
});

describe("break 5: a Folder or Space template carries only the Lists the saver could save", () => {
  it("save-as hands both snapshots the Full-access filter", () => {
    const route = read("src/app/api/template-center/save-as/route.ts");
    expect(route).toMatch(/snapshotFolder\(input\.folderId, \{ canSaveList: fullLists \}\)/);
    expect(route).toMatch(/snapshotSpace\(input\.spaceId, \{ canSaveList: fullLists \}\)/);
    expect(between(route, "const fullLists = async")).toMatch(/roleAtLeast\(roles\.get\(`list:\$\{id\}`\)\?\.role \?\? "none", "FULL"\)/);
  });
  it("the snapshots skip every List the filter leaves out", () => {
    const lib = read("src/lib/template-center.ts");
    for (const fn of ["export async function snapshotFolder(", "export async function snapshotSpace("]) {
      const body = between(lib, fn, "return {");
      expect(body).toMatch(/const keep = await keptLists\(/);
      expect(body).toMatch(/if \(!keep\.has\(b\.id\)\) continue;/);
    }
  });
});

describe("break 6: the create pickers offer exactly the places the create rule accepts", () => {
  it("Create list, Create sprint and the Template Center ask GET /api/move/destinations?create=", () => {
    const list = read("src/components/layout/os/create-list-modal.tsx");
    expect(list).toMatch(/fetch\("\/api\/move\/destinations\?create=list"/);
    expect(list).not.toMatch(/fetch\("\/api\/spaces"/);
    expect(list).not.toMatch(/\/api\/folders\?spaceId=/);
    expect(read("src/components/layout/os/create-sprint-modal.tsx")).toMatch(/fetch\("\/api\/move\/destinations\?create=list"/);
    const tc = read("src/components/templates/template-center.tsx");
    expect(tc).toMatch(/`\/api\/move\/destinations\?create=\$\{createKind\}`/);
    expect(tc).not.toMatch(/apiFetch<\{ spaces: SpaceRef\[\] \}>\("\/api\/spaces"/);
  });
  it("the endpoint answers create= from createDecision per place: each Folder, each Space root and the org root", () => {
    const lib = read("src/lib/access/node-placement.ts");
    expect(between(lib, "export async function createDestinations(", "export async function fileMoveDestinations(")).toMatch(/placeDestinations\(ctx, what, \(rows, grants, place\) => createDecision\(rows, grants, place, what\)\)/);
    const walk = between(lib, "async function placeDestinations(");
    expect(walk).toMatch(/if \(accepts\(rows, grants, fr\)\) pick\.add\(f\.id\);/);
    expect(walk).toMatch(/const rootPick = placeHolds\(spaceRef, what\) && accepts\(rows, grants, spaceRef\);/);
    expect(walk).toMatch(/pickable: accepts\(rows, grants, null\)/);
  });
});

describe("break 7: the Space page offers create to Can edit, as the server accepts", () => {
  it("spaceCanCreate is Can edit or higher, and the empty cards say so", () => {
    const page = read("src/app/(dashboard)/spaces/[slug]/page.tsx");
    expect(page).toMatch(/const spaceCanCreate = spaceCanEdit;/);
    expect(page).not.toMatch(/Creating one needs Full access/);
    expect(page).toMatch(/Creating one needs Can edit on this Space\./);
  });
});

describe("break 8: the Space Move dialog lists the parents spaces/[id]/move accepts", () => {
  it("every kind asks the destinations endpoint; the Top level shows only when the verdict picks it", () => {
    const dialog = read("src/components/layout/os/move-target-dialog.tsx");
    expect(dialog).toMatch(/fetch\(`\/api\/move\/destinations\?kind=\$\{destKind\}&id=/);
    expect(dialog).not.toMatch(/\/api\/spaces\?paths=0/);
    expect(dialog).toMatch(/kind === "space" && top\?\.pickable \?/);
  });
  it("the endpoint answers kind=space from spaceNestVerdict", () => {
    const fn = between(read("src/lib/space.ts"), "export async function spaceNestDestinations(", "export interface CreateSpaceInput");
    expect(fn).toMatch(/spaceNestVerdict\(\{ spaceId, managesSpace, current, dest \}\)/);
  });
});

describe("break 9: every move out of every Space asks the landing rule", () => {
  it("moveVerdict refuses the push when Full access would not go with the node", () => {
    const fn = between(read("src/lib/access/node-rules.ts"), "export function moveVerdict(", "export function moveDecision(");
    // Round six: a manager of the Space it leaves is exempt (P7), everyone else needs Full access that goes with the node.
    // Round seven: the Full access is read on the node itself, at the org root, never where it lands.
    expect(fn).toMatch(/if \(leavesEverySpace\(rows, ref, dest\) && !managesSpaceOf\(ev, ref\) && !fullWhereItLands\(rows, grants, ref\)\) \{\n\s+return \{ ok: false, failure: "landing" \};/);
  });
  it("and the canvas, table and doc moves all go through checkMove", () => {
    const lib = read("src/lib/access/node-placement.ts");
    expect(between(lib, "export async function moveCanvas(", "export async function moveTable(")).toMatch(/checkMove\(ctx, \{ kind: "canvas", id: canvas\.id \}, dest\)/);
    expect(between(lib, "export async function moveTable(", "// ── docs")).toMatch(/checkMove\(ctx, \{ kind: "table", id: table\.id \}, dest\)/);
    expect(read("src/app/api/docs/[id]/route.ts")).toMatch(/const check = await checkMove\(nodeCtx, \{ kind: "doc", id \}, dest\);/);
  });
});

describe("rule 5 beyond the Move dialog: every picker that places a node asks the rule", () => {
  it("the Tables, Canvases and Docs bulk moves offer the common destinations, never the Space list", () => {
    for (const [file, kind] of [["src/app/(dashboard)/tables/page.tsx", "table"], ["src/app/(dashboard)/canvas/page.tsx", "canvas"], ["src/app/(dashboard)/docs/(hub)/page.tsx", "doc"]] as const) {
      const page = read(file);
      expect(page).toMatch(new RegExp(`commonMoveDestinations\\("${kind}", `));
      expect(page).toMatch(/\.\.\.\(bulkDests\?\.root \? \[\{ options: \[\{ value: "none"/);
      expect(page).toMatch(/options: \(bulkDests\?\.spaces \?\? \[\]\)\.map\(/);
    }
  });
  it("the file Move dialog asks kind=file, and the endpoint answers it from fileMoveVerdict", () => {
    const dialog = read("src/components/files/move-file-dialog.tsx");
    expect(dialog).toMatch(/`\/api\/move\/destinations\?kind=file&id=\$\{encodeURIComponent\(fileId\)\}`/);
    expect(dialog).not.toMatch(/"\/api\/spaces"/);
    expect(dialog).not.toMatch(/\/api\/folders\?spaceId=/);
    const route = read("src/app/api/move/destinations/route.ts");
    expect(route).toMatch(/if \(!file \|\| !\(await canReadFileAs\(ctx, file\)\)\)/);
    expect(route).toMatch(/fileMoveDestinations\(ctx, file\)/);
    const fn = between(read("src/lib/access/node-placement.ts"), "export async function fileMoveDestinations(", "async function placeDestinations(");
    expect(fn).toMatch(/const v = fileMoveVerdict\(rows, grants, file, place\);/);
  });
  it("the table row menu opened at its picker and the doc row menu's fallback ask the move rule too", () => {
    const table = read("src/components/tables/table-row-menu.tsx");
    expect(table).not.toMatch(/apiFetch<\{ spaces\?: SpaceRow\[\] \}>\("\/api\/spaces"/);
    expect(table.match(/\/api\/move\/destinations\?kind=table&id=/g)?.length).toBe(2);
    const doc = read("src/components/docs/doc-row-menu.tsx");
    expect(doc).not.toMatch(/\/api\/spaces\?paths=0&counts=0/);
    expect(doc).toMatch(/`\/api\/move\/destinations\?kind=doc&id=\$\{encodeURIComponent\(doc\.id\)\}`/);
  });
});
