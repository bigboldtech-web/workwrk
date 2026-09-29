// Round six of the placement rule (node-rules P1 to P7): the routes and the
// Trash listing keep the fixes the round five attackers proved missing. Each
// test reads the source it names and fails if the fix is taken out.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const between = (src: string, from: string, to: string) => src.slice(src.indexOf(from), src.indexOf(to));

describe("break 3: the org-wide reach is Can view on the docs and tables inside, and no floor lifts it", () => {
  it("R6b and R7b give the org-wide reach its own role, and keep no older lift that is the org-wide rule alone", () => {
    const rules = read("src/lib/access/node-rules.ts");
    const docRole = between(rules, "private anchoredDocRole(", "private spaceTableRole(");
    expect(docRole).toMatch(/if \(reach\.via\.type === "everyone"\) return \{ role: inheritRole\(reach\.role\), via: reach\.via \};/);
    expect(docRole).toMatch(/if \(oldReach\.role === "none" \|\| oldReach\.via\.type === "everyone"\) return capped;/);
    expect(docRole).not.toMatch(/if \(reach\.via\.type === "everyone"\) return lift\(reach\);/);
    const tableRole = between(rules, "private spaceTableRole(", "private anchorReach(");
    expect(tableRole).toMatch(/if \(reach\.via\.type === "everyone"\) return \{ role: inheritRole\(reach\.role\), via: reach\.via \};/);
    expect(tableRole).toMatch(/if \(oldReach\.role === "none" \|\| oldReach\.via\.type === "everyone"\) return capped;/);
  });
  it("the effective role skips the floor for a reach the org-wide rule alone gives", () => {
    const fn = between(read("src/lib/access/node-rules.ts"), "private computeEffective(", "floorRole(ref: NodeRef): NodeRole {");
    expect(fn).toMatch(/if \(best\.via\.type === "everyone" && best\.via\.node !== null\) return best;/);
    expect(fn.indexOf("best.via.type === \"everyone\"")).toBeLessThan(fn.indexOf("const floor = floorFor("));
  });
  it("the legacy doc floor caps a reach the org-wide rule alone gives at Can view, and keeps today's readability", () => {
    const floor = read("src/lib/access/legacy-floor.ts");
    const fn = between(floor, "function docFloor(", "function withOrgWideClosed(");
    expect(fn).toMatch(/if \(role === "edit" && !legacyAllows\(withOrgWideClosed\(inputs\), "docAccessible"\)\) return "VIEW";/);
    expect(fn.indexOf('if (!legacyAllows(inputs, "docAccessible")) return "none";')).toBeLessThan(fn.indexOf("withOrgWideClosed(inputs)"));
    const closed = between(floor, "function withOrgWideClosed(", "function canvasFloor(");
    expect(closed).toMatch(/v === "ORG" \? "WORKSPACE" : v/);
  });
});

describe("breaks 5 and 6: the manager of the Space a node leaves is exempt from the landing rule (P7)", () => {
  it("moveVerdict asks managesSpaceOf before fullWhereItLands, and managesSpaceOf is Full access on the node's Space", () => {
    const rules = read("src/lib/access/node-rules.ts");
    const fn = between(rules, "export function moveVerdict(", "export function moveDecision(");
    expect(fn).toMatch(/if \(leavesEverySpace\(rows, ref, dest\) && !managesSpaceOf\(ev, ref\) && !fullWhereItLands\(rows, grants, ref\)\) \{/);
    expect(fn).toMatch(/function managesSpaceOf\(ev: NodeEvaluator, ref: NodeRef\): boolean \{\n\s+const spaceId = spaceOfNode\(ev\.rows, ref\);\n\s+return !!spaceId && managesPlace\(ev, \{ kind: "space", id: spaceId \}\);/);
  });
  it("a form's emptied destinations and a file out of every Space ask the same of the Space they leave", () => {
    const rules = read("src/lib/access/node-rules.ts");
    const form = between(rules, "export function formDestinationVerdict(", "export function formDestinationChangeable(");
    expect(form).toMatch(/if \(space && !managesPlace\(ev, \{ kind: "space", id: space \}\) && !fullWhereItLands\(rows, grants, \{ kind: "form", id: formId \}\)\) \{/);
    const file = between(rules, "export function fileMoveVerdict(", "export function filePlace(");
    expect(file).not.toMatch(/failure: "landing"/);
    expect(file).toMatch(/if \(dest === null && source && from\.kind !== "space" && !managesPlace\(ev, \{ kind: "space", id: source \}\)\) \{/);
  });
  it("the canvas and doc routes still move through the one helper, so the exemption reaches PATCH /api/whiteboards/[id] and PUT /api/docs/[id]", () => {
    expect(read("src/app/api/whiteboards/[id]/route.ts")).toMatch(/const moved = await moveCanvas\(nodeCtx, id, \{/);
    const docs = read("src/app/api/docs/[id]/route.ts");
    expect(docs).toMatch(/const check = await checkMove\(nodeCtx, \{ kind: "doc", id \}, dest\);/);
  });
});

describe("item 4: a doc is made on an anchor the model knows, on every create route, and moved onto the same set", () => {
  it("POST /api/docs refuses any other entityType before anything is read or written", () => {
    const route = read("src/app/api/docs/route.ts");
    // Round seven: the anchor is read through docAnchorInput first (a half anchor is refused), then M2.
    const check = route.indexOf('if (anchorIn.entityType && anchorIn.entityType !== "NOTEPAD" && !isDocAnchorKind(anchorIn.entityType)) {');
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(route.indexOf("await canReadDocPlace(nodeCtx, anchor, parentId)"));
    expect(check).toBeLessThan(route.indexOf("prisma.doc.create("));
    expect(route).toMatch(/return NextResponse\.json\(\{ error: DOC_ANCHOR_REFUSAL, code: "invalid_anchor", message: DOC_ANCHOR_REFUSAL \}, \{ status: 400 \}\);/);
  });
  it("POST /api/docs/by-entity refuses it too, before the find and the create", () => {
    const route = read("src/app/api/docs/by-entity/route.ts");
    const check = route.indexOf('if (parsed.data.entityType !== "NOTEPAD" && !isDocAnchorKind(parsed.data.entityType)) {');
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(route.indexOf("await canReadDocPlace(nodeCtx, anchor, null)"));
    expect(check).toBeLessThan(route.indexOf("prisma.doc.findFirst("));
  });
  it("PUT /api/docs/[id] moves onto the same set, not a set of its own", () => {
    const route = read("src/app/api/docs/[id]/route.ts");
    expect(route).toMatch(/if \(anchorChanges && nextType && !isDocAnchorKind\(nextType\)\) \{/);
    expect(route).not.toMatch(/MOVABLE_ANCHORS/);
  });
});

describe("item 2: the Trash page offers Restore exactly where the restore would restore (P5 for Trash)", () => {
  it("the listing blocks a row whose landing place is gone or in Trash, for everyone, before the role checks", () => {
    const server = read("src/lib/trash-server.ts");
    const fn = between(server, "async function landingRefusals(", "const FOLDER_GONE =");
    const gone = fn.indexOf("const gone = await landingPlaceBlocks(viewer.organizationId, landed);");
    expect(gone).toBeGreaterThan(0);
    expect(gone).toBeLessThan(fn.indexOf("if (viewerIsOwnerOrAdmin(viewer)) return out;"));
    expect(fn).toMatch(/if \(!place \|\| \(place\.kind === "list" && what !== "doc"\)\) continue;/);
    expect(fn).toMatch(/if \(out\.has\(r\.id\)\) continue;/);
  });
  it("the place blocks read the Folder chain as the restore does, and tell a Folder in Trash from one that is gone", () => {
    const server = read("src/lib/trash-server.ts");
    const fn = between(server, "async function landingPlaceBlocks(", "async function readArchived(");
    expect(fn).toMatch(/\[id, await folderPlacementFact\(organizationId, id\)\] as const/);
    expect(fn).toMatch(/prisma\.trashItem\.findMany\(\{ where: \{ organizationId, entityType: "folder", entityId: \{ in: goneFolders \} \}/);
    expect(fn).toMatch(/if \(!f\) out\.set\(refKey\(\{ kind: "folder", id \}\), trashedFolders\.has\(id\) \? PARENT_IN_TRASH : FOLDER_GONE\);/);
    expect(fn).toMatch(/else if \(f\.inTrash\) out\.set\(refKey\(\{ kind: "folder", id \}\), PARENT_IN_TRASH\);/);
    expect(fn).toMatch(/else if \(s\.archivedAt\) out\.set\(refKey\(\{ kind: "space", id \}\), SPACE_ARCHIVED\);/);
    expect(fn).toMatch(/if \(!d \|\| d\.archivedAt\) out\.set\(refKey\(\{ kind: "doc", id \}\), PAGE_GONE\);/);
  });
  it("the restore answers the same sentence for a parent Folder that sits in Trash", () => {
    const server = read("src/lib/trash-server.ts");
    const fn = between(server, "async function landingCheck(", "async function folderTrashRow(");
    expect(fn).toMatch(/if \(!f\) return \{ ok: false, status: 409, message: \(await folderTrashRow\(viewer\.organizationId, place\.id\)\) \? PARENT_IN_TRASH : PLACE_GONE \};/);
  });
});
