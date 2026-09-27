// Round five of the placement rule (node-rules P1 to P7): the routes, the
// builder and the Trash keep the fixes the round four attackers proved
// missing. Each test reads the source it names and fails if the fix is
// taken out.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");

describe("break 1: a bare position on PATCH /api/folders/[id] is a P4 reorder through the one move helper", () => {
  it("placing includes a position, and no position is written straight through updateFolder", () => {
    const route = read("src/app/api/folders/[id]/route.ts");
    expect(route).toMatch(/const placing = parentFolderId !== undefined \|\| spaceId !== undefined \|\| position !== undefined;/);
    expect(route).toMatch(/const patch = \{ \.\.\.rest \};/);
    expect(route).not.toMatch(/!placing && position !== undefined/);
    // The helper is asked before anything is written, with the parent the Folder has.
    const helper = route.indexOf("moved = await moveFolder(gate.ctx, id, {");
    const write = route.indexOf("await updateFolder(id, patch, tx)");
    expect(helper).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(helper);
    expect(route).toMatch(/parentFolderId: parentFolderId !== undefined \? parentFolderId : gate\.folder\.parentFolderId,/);
  });
});

describe("break 2 and 4: a form's destination change is a move, and its role comes from the destination", () => {
  it("PATCH /api/forms/[id] asks checkFormDestinationChange for a changed List or table slot before any write", () => {
    const route = read("src/app/api/forms/[id]/route.ts");
    const gate = route.indexOf("await checkFormDestinationChange(nodeCtxFromViewer(editor), existing.id, {");
    expect(gate).toBeGreaterThan(0);
    expect(route).toMatch(/const boardChanges = nextBoard !== undefined && nextBoard !== existing\.targetBoardId;/);
    expect(route).toMatch(/const tableChanges = nextTable !== undefined && nextTable !== existing\.targetTableId;/);
    expect(route).toMatch(/boardId: boardChanges \? nextBoard : undefined,/);
    expect(route).toMatch(/tableId: tableChanges \? nextTable : undefined,/);
    expect(gate).toBeLessThan(route.indexOf("prisma.formDefinition.updateMany("));
    expect(gate).toBeLessThan(route.indexOf("prisma.formDefinition.update("));
    // The old one-sided gate is gone.
    expect(route).not.toMatch(/checkFormDestination\(nodeCtxFromViewer\(editor\)/);
    expect(route).not.toMatch(/interim, access engine inert/);
  });

  it("GET /api/forms/[id] answers canChangeDestination from the rule, and the builder's Goes to card reads it", () => {
    const route = read("src/app/api/forms/[id]/route.ts");
    expect(route).toMatch(/formDestinationChangeableFor\(nodeCtxFromViewer\(viewer\), form\.id\)/);
    expect(route).toMatch(/canChangeDestination,/);
    const builder = read("src/components/forms/form-builder.tsx");
    expect(builder).toMatch(/<GoesToCard listDest=\{listDest\} tableDest=\{tableDest\} readOnly=\{locked \|\| !form\.canChangeDestination\}/);
  });

  it("checkFormDestinationChange loads the form, both ends and the new destination in one world, and answers the rule's sentence", () => {
    const lib = read("src/lib/access/node-placement.ts");
    const fn = lib.slice(lib.indexOf("export async function checkFormDestinationChange("), lib.indexOf("export async function formDestinationChangeableFor("));
    expect(fn).toMatch(/for \(const id of \[form\.targetBoardId, board\?\.id\]\) if \(id\) refs\.push\(\{ kind: "list", id \}\);/);
    expect(fn).toMatch(/for \(const id of \[form\.targetTableId, table\?\.id\]\) if \(id\) refs\.push\(\{ kind: "table", id \}\);/);
    expect(fn).toMatch(/const verdict = formDestinationVerdict\(rows, grants, form\.id, asked\);/);
    expect(fn).toMatch(/return fail\(403, formDestinationRefusal\(verdict\.failure, verdict\.slot\)\);/);
    // A List the viewer cannot open reads as gone, as before (a guessed id confirms nothing).
    expect(fn).toMatch(/if \(board && !roleAtLeast\(ev\.effective\(\{ kind: "list", id: board\.id \}\)\.role, "VIEW"\)\) return fail\(400, "That List no longer exists"\);/);
  });

  it("R9 no longer hands every Member Can edit on every form: the destination's role, Can view for everyone, the creator at Full", () => {
    const rules = read("src/lib/access/node-rules.ts");
    const r9 = rules.slice(rules.indexOf("  // R9\n  private form(id: string): Res {"), rules.indexOf("   * R9 RESPONSES:"));
    expect(r9).toMatch(/const dest = formDestinationRef\(f\);/);
    expect(r9).toMatch(/if \(parentRes\.role !== "none"\) cands\.push\(up\(parentRes\)\);/);
    expect(r9).toMatch(/if \(member\) cands\.push\(\{ role: "VIEW", via: \{ type: "everyone", node: null \}, prio: P_EVERYONE \}\);/);
    expect(r9).not.toMatch(/if \(!this\.grants\.viewer\.orgGuest\) cands\.push\(\{ role: "EDIT"/);
  });

  it("the sources carry no em dash and no double hyphen", () => {
    for (const p of ["src/app/api/forms/[id]/route.ts", "src/app/api/folders/[id]/route.ts", "src/lib/access/node-placement.ts", "src/lib/trash-server.ts"]) {
      expect(read(p)).not.toMatch(/—|--/);
    }
  });
});

describe("break 3: the Trash page offers Restore exactly where the route restores", () => {
  it("the archive gate hands inScope the recorded archiver, as the listing does", () => {
    const server = read("src/lib/trash-server.ts");
    expect(server).toMatch(/return inScope\(scope, \{ \.\.\.anchor\.anchor, ownId: id, type \}, anchor\.archivedById, anchor\.ownerId\)/);
    expect(server).not.toMatch(/return inScope\(scope, \{ \.\.\.anchor\.anchor, ownId: id, type \}, null, anchor\.ownerId\)/);
    // The archiver is read only when the column exists, with the same fallback the listing has.
    const anchor = server.slice(server.indexOf("async function archiveAnchor("), server.indexOf("async function readArchiveAnchor("));
    expect(anchor).toMatch(/if \(await archivedByColumnAvailable\(\)\) \{/);
    expect(anchor).toMatch(/return await readArchiveAnchor\(type, id, organizationId, \{ archivedById: true \}\);/);
    expect(anchor).toMatch(/return readArchiveAnchor\(type, id, organizationId, \{\}\);/);
  });

  it("the listing computes each row's landing over one world and blocks what P1 refuses, with the restore's own sentence", () => {
    const server = read("src/lib/trash-server.ts");
    expect(server).toMatch(/const \[missingParents, landingBlocked\] = await Promise\.all\(\[missingParentIds\(page\), landingRefusals\(viewer, page\)\]\);/);
    expect(server).toMatch(/restorable: !parentGone && !blocked,/);
    // Round seven: a List in Trash blocks a task's restore like a gone one (its own sentence).
    expect(server).toMatch(/blockedReason: listState === "gone" \? "Its list is gone" : listState === "archived" \? LIST_IN_TRASH_FOR_TASK : blocked,/);
    const fn = server.slice(server.indexOf("async function landingRefusals("), server.indexOf("async function readArchived("));
    expect(fn).toMatch(/if \(viewerIsOwnerOrAdmin\(viewer\)\) return out;/);
    expect(fn).toMatch(/const \{ rows, grants \} = await loadWorld\(nodeCtxFromViewer\(viewer\), \[\.\.\.places\.values\(\)\], \{ chain: true \}\);/);
    expect(fn).toMatch(/: createDecision\(rows, grants, place, what\);/);
    expect(fn).toMatch(/if \(!ok\) out\.set\(r\.id, CANT_RESTORE_HERE\);/);
    // An archived Folder lands under its parent Folder, as archiveLanding restores it.
    expect(server).toMatch(/landing: \{ place: inTree\(f\.parentFolderId, f\.spaceId\), what: "folder" as const \}/);
  });
});
