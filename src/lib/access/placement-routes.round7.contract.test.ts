// Round seven of the placement rule (node-rules P1 to P7): the routes, the
// move check and the Trash listing keep the fixes the round six attackers
// proved missing. Each test reads the source it names and fails if the fix
// is taken out.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const between = (src: string, from: string, to: string) => src.slice(src.indexOf(from), src.indexOf(to));

describe("break 1: the Full access that goes with a node out of every Space is the node's own, read at the org root", () => {
  it("fullWhereItLands takes no destination and sets the node down at the org root", () => {
    const rules = read("src/lib/access/node-rules.ts");
    const fn = between(rules, "export function fullWhereItLands(", "export type MoveFailure =");
    expect(fn).toMatch(/export function fullWhereItLands\(rows: NodeRows, grants: ViewerGrants, ref: NodeRef\): boolean \{/);
    expect(fn).toMatch(/const moved = rowsWithNodeAt\(rows, ref, null\);/);
    const move = between(rules, "export function moveVerdict(", "export function moveDecision(");
    expect(move).toMatch(/!fullWhereItLands\(rows, grants, ref\)\) \{\n\s+return \{ ok: false, failure: "landing" \};/);
  });
});

describe("item 5: the return trip from the org root (P7)", () => {
  it("moveVerdict asks Can edit on a node in no Space when the viewer manages the destination's Space, Full access everywhere else", () => {
    const fn = between(read("src/lib/access/node-rules.ts"), "export function moveVerdict(", "export function moveDecision(");
    expect(fn).toMatch(/const destSpace = dest \? spaceOfPlace\(rows, dest\) : null;/);
    expect(fn).toMatch(/const pullIn = from === null && destSpace !== null && managesPlace\(ev, \{ kind: "space", id: destSpace \}\);/);
    expect(fn).toMatch(/if \(!roleAtLeast\(nodeEv\.effective\(ref\)\.role, pullIn \? "EDIT" : "FULL"\)\) return \{ ok: false, failure: "node" \};/);
  });
  it("the canvas, table and doc moves still go through checkMove, so the return trip reaches their routes", () => {
    const lib = read("src/lib/access/node-placement.ts");
    expect(between(lib, "export async function moveCanvas(", "export async function moveTable(")).toMatch(/checkMove\(ctx, \{ kind: "canvas", id: canvas\.id \}, dest\)/);
    expect(between(lib, "export async function moveTable(", "// ── docs")).toMatch(/checkMove\(ctx, \{ kind: "table", id: table\.id \}, dest\)/);
    expect(read("src/lib/docs/doc-save.ts")).toMatch(/const check = await checkMove\(nodeCtx, \{ kind: "doc", id \}, dest\);/);
    expect(read("src/app/api/whiteboards/[id]/route.ts")).toMatch(/moveCanvas\(/);
    expect(read("src/app/api/tables/[id]/route.ts")).toMatch(/checkMove\(tableCtx\(orgId, getUserId\(session\), session\), \{ kind: "table", id \}/);
  });
});

describe("item 2: a destination the viewer cannot see is a 404 whatever else the rule found wrong", () => {
  it("checkMove asks seesPlace on every refusal with a destination, before the 403 sentence", () => {
    const fn = between(read("src/lib/access/node-placement.ts"), "export async function checkMove(", "// ── P3");
    expect(fn).toMatch(/if \(dest && !\(await seesPlace\(ctx, new NodeEvaluator\(rows, grants\), dest\)\)\) \{\n\s+return fail\(404, "That place no longer exists\."\);/);
    expect(fn).not.toMatch(/verdict\.failure === "destination" &&/);
    expect(fn.indexOf('fail(404, "That place no longer exists.")')).toBeLessThan(fn.indexOf("fail(403, moveRefusal(what, verdict.failure))"));
  });
});

describe("items 3 and 4: POST /api/docs and PUT /api/docs/[id] refuse a half anchor and an empty parent id with a sentence", () => {
  it("POST normalises the anchor through docAnchorInput before M2, and stores what it answered", () => {
    const post = between(read("src/app/api/docs/route.ts"), "export async function POST(", "  const doc = await prisma.doc.create(");
    expect(post).toMatch(/if \(parsed\.data\.parentId === ""\) \{\n\s+return NextResponse\.json\(\{ error: DOC_PARENT_EMPTY_REFUSAL, code: "invalid_parent", message: DOC_PARENT_EMPTY_REFUSAL \}, \{ status: 400 \}\);/);
    expect(post).toMatch(/const anchorIn = docAnchorInput\(parsed\.data\.entityType, parsed\.data\.entityId\);\n\s+if \(!anchorIn\.ok\) return NextResponse\.json\(\{ error: anchorIn\.error, code: "invalid_anchor", message: anchorIn\.error \}, \{ status: 400 \}\);/);
    expect(post).toMatch(/const anchor = \{ entityType: anchorIn\.entityType, entityId: anchorIn\.entityId \};/);
    const create = between(read("src/app/api/docs/route.ts"), "  const doc = await prisma.doc.create(", "  return NextResponse.json({ doc });");
    expect(create).toMatch(/entityType: anchor\.entityType,\n\s+entityId: anchor\.entityId,\n\s+parentId,/);
  });
  it("PUT lays the patch over the row, refuses a half anchor, and writes both halves together", () => {
    // PUT's body is saveDocAs (src/lib/docs/doc-save.ts), the last function there.
    const save = read("src/lib/docs/doc-save.ts");
    const put = save.slice(save.indexOf("export async function saveDocAs("));
    expect(put).toMatch(/if \(parsed\.data\.parentId === ""\) \{\n\s+return NextResponse\.json\(\{ error: DOC_PARENT_EMPTY_REFUSAL, code: "invalid_parent", message: DOC_PARENT_EMPTY_REFUSAL \}, \{ status: 400 \}\);/);
    expect(put).toMatch(/if \(anchorChanges && !anchorIn\.ok\) \{\n\s+return NextResponse\.json\(\{ error: anchorIn\.error, code: "invalid_anchor", message: anchorIn\.error \}, \{ status: 400 \}\);/);
    expect(put).toMatch(/\.\.\.\(anchorChanges \? \{ entityType: nextType, entityId: nextId \} : \{\}\),/);
    expect(put).not.toMatch(/entityType: parsed\.data\.entityType \}/);
  });
});

describe("item 1: a task never comes back live into a List that is in Trash", () => {
  it("the listing reads the List's archivedAt, blocks the row with the sentence, and offers Restore to... only where a snapshot can be re-homed", () => {
    const server = read("src/lib/trash-server.ts");
    const fn = between(server, "async function missingParentIds(", "async function liveChildrenOf(");
    expect(fn).toMatch(/Promise<Map<string, "gone" \| "archived">>/);
    expect(fn).toMatch(/select: \{ id: true, archivedAt: true \}/);
    expect(fn).toMatch(/else if \(l\.archivedAt\) out\.set\(r\.id, "archived"\);/);
    expect(server).toMatch(/needsTarget: r\.type === "task" && \(listState === "gone" \|\| \(listState === "archived" && parseRowId\(r\.id\)\.archive === null\)\),/);
    expect(server).toMatch(/blockedReason: listState === "gone" \? "Its list is gone" : listState === "archived" \? LIST_IN_TRASH_FOR_TASK : blocked,/);
  });
  it("the restore refuses the archived List (409), refuses a target on an archived row instead of ignoring it, and only re-homes into a live List", () => {
    const server = read("src/lib/trash-server.ts");
    const landing = between(server, "async function listLanding(", "async function docLanding(");
    expect(landing).toMatch(/if \(list\.archivedAt\) return \{ ok: false, status: 409, message: LIST_IN_TRASH_FOR_TASK \};/);
    const restore = between(server, "export async function restoreTrashRow(", "const CANT_RESTORE_HERE =");
    expect(restore).toMatch(/if \(target\?\.targetBoardId\) \{\n\s+return \{ ok: false, status: 409, message: "An archived task comes back into its own list\./);
    expect(restore).toMatch(/where: \{ id: targetBoardId, organizationId: viewer\.organizationId, archivedAt: null \}/);
    expect(restore.indexOf("if (target?.targetBoardId) {")).toBeLessThan(restore.indexOf("const landing = await archiveLanding(viewer, type, id);"));
  });
});

describe("no double hyphen or em dash in the sentences these fixes added", () => {
  it("the sentences are plain", () => {
    const server = read("src/lib/trash-server.ts");
    for (const m of server.matchAll(/const (LIST_IN_TRASH_FOR_TASK) = "([^"]+)"/g)) expect(m[2]).not.toMatch(/--|—/);
    expect(server).toMatch(/An archived task comes back into its own list\. Only a task whose list is gone can be restored into another one\./);
  });
});
