// A source contract for dragging tasks up and down (the route needs a
// database and the views need a browser, neither of which the unit suite
// carries). It pins what a later edit could silently undo:
//
//   1. PUT /api/boards/[id]/order gates like reordering one linked task
//      (readable List, else 404; contribute, else 403), writes only this
//      List's own order under its order lock, and reads no legacy signal;
//   2. the Board drops a card at a place, not only into a column;
//   3. the List view drags inside groups and is off only while sorted.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const code = (rel: string) =>
  readFileSync(join(process.cwd(), rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const ROUTE = code("src/app/api/boards/[id]/order/route.ts");
const KANBAN = code("src/components/board-view/board-kanban-view.tsx");
const TABLE = code("src/components/board-view/board-table-view.tsx");

describe("PUT /api/boards/[id]/order", () => {
  it("gates on the List: readable (404 names nothing) then contribute (403)", () => {
    expect(ROUTE).toMatch(/await itemCtx\(\)/);
    expect(ROUTE).toMatch(/if \(!\(await boardForViewer\(c, id\)\)\) return NextResponse\.json\(\{ error: "Not found" \}, \{ status: 404 \}\);/);
    expect(ROUTE).toMatch(/if \(!\(await canContributeFor\(c, id\)\)\) return NextResponse\.json\(\{ error: "no_access", reason: "list_read_only" \}, \{ status: 403 \}\);/);
    expect(ROUTE.indexOf("boardForViewer(c, id)")).toBeLessThan(ROUTE.indexOf("canContributeFor(c, id)"));
    expect(ROUTE).not.toMatch(/accessLevel|getServerSession/);
  });

  it("reads the List's whole order itself, under its order lock, never from the client", () => {
    expect(ROUTE).toMatch(/await listOrderLock\(tx, id\);/);
    expect(ROUTE).not.toMatch(/ids: z\./);
    expect(ROUTE).toMatch(/const order = moveInOrder\(/);
    // Home rows: this List's live top-level tasks, or one task's live subtasks.
    expect(ROUTE).toMatch(/WHERE i\."boardId" = \$\{id\} AND i\."organizationId" = \$\{c\.organizationId\}\s*AND i\."parentItemId" IS NULL AND i\."archivedAt" IS NULL/);
    expect(ROUTE).toMatch(/WHERE i\."boardId" = \$\{id\} AND i\."organizationId" = \$\{c\.organizationId\}\s*AND i\."parentItemId" = \$\{parentId\} AND i\."archivedAt" IS NULL/);
    // Links: this List's, for a live top-level task homed in another live List.
    expect(ROUTE).toMatch(/WHERE l\."boardId" = \$\{id\} AND i\."organizationId" = \$\{c\.organizationId\}\s*AND i\."boardId" <> \$\{id\} AND i\."parentItemId" IS NULL AND i\."archivedAt" IS NULL\s*AND hb\."archivedAt" IS NULL/);
    expect(ROUTE).toMatch(/const linksOn = !parentId && \(await listLinksAvailable\(\)\);/);
    // Writes are scoped the same way, ids as ONE parameter.
    expect(ROUTE).toMatch(/WHERE i\.id = v\.id AND i\."boardId" = \$\{id\} AND i\."organizationId" = \$\{c\.organizationId\}/);
    expect(ROUTE).toMatch(/WHERE l\."itemId" = v\.id AND l\."boardId" = \$\{id\}/);
    expect(ROUTE).not.toMatch(/Prisma\.join/);
  });

  it("stamps updatedAt on the rows it moved, from a parameter, so open Lists take the new numbers", () => {
    expect(ROUTE).toMatch(/UPDATE "Item" AS i SET position = v\.p, "updatedAt" = \$\{now\}/);
    expect(ROUTE).toMatch(/AND i\.position IS DISTINCT FROM v\.p/);
    expect(ROUTE).not.toMatch(/"updatedAt" = now\(\)/i);
  });

  it("refuses, and says why, when the task or its neighbours left the List meanwhile", () => {
    expect(ROUTE).toMatch(/if \(!order\) throw new OrderChanged\(\);/);
    expect(ROUTE).toMatch(/error: "order_changed"/);
  });
});

describe("the Board drops a card at a place", () => {
  it("plans every drop with the one planner and keeps columns in the List's order", () => {
    expect(KANBAN).toMatch(/const plan = planDrop\(column, id, index\);/);
    expect(KANBAN).toMatch(/for \(const \[k, arr\] of g\) g\.set\(k, \[\.\.\.arr\]\.sort\(byPosition\)\);/);
  });

  it("moves a linked card's LINK place and checks its home status first", () => {
    expect(KANBAN).toMatch(/fetch\(`\/api\/boards\/\$\{boardId\}\/links\/\$\{id\}`/);
    expect(KANBAN).toMatch(/const target = homeStatusTarget\(card, status, statuses\);/);
    expect(KANBAN).toMatch(/setError\(linkedStatusRefusal\(card, label, target\.reason\)\);/);
  });

  it("renumbers through the order route when neighbours have no room", () => {
    expect(KANBAN).toMatch(/fetch\(`\/api\/boards\/\$\{boardId\}\/order`/);
  });
});

describe("the List view drags inside groups", () => {
  it("is off only while sorted, never because the rows are grouped", () => {
    expect(TABLE).toMatch(/const sortingRows = sortCol !== null \|\| sortKey !== "none";/);
    expect(TABLE).toMatch(/dragEnabled=\{rowCanArrange && !sortingRows && indent === 0 && !row\.parentItemId && kind !== "linked-subtask"\}/);
    // Arranging is a List write (Can edit on the List): a row opened only
    // because it is assigned to the viewer is edited in place, never dragged.
    expect(TABLE).toMatch(/const rowCanArrange = linkedRowEditable\(row, canEdit\);/);
    expect(TABLE).not.toMatch(/Drag disabled while grouped/);
  });

  it("across status groups takes that status, by the linked rules for a linked row", () => {
    expect(TABLE).toMatch(/if \(groupBy !== "status" \|\| !declared\)/);
    expect(TABLE).toMatch(/const target = homeStatusTarget\(dragged, declared\.value, statuses\);/);
    expect(TABLE).toMatch(/const plan = planDrop\(group, draggedId, indexFor\(group, draggedId, targetId, side\)\);/);
  });
});

describe("a refused status leaves the task where it was", () => {
  it("writes the status before the place, and stops when it is refused", () => {
    const k = KANBAN.indexOf("if (Object.keys(body).length > 0 && !(await patchCard(id, body, body as Partial<BoardItemRow>))) return;");
    expect(k).toBeGreaterThan(-1);
    expect(KANBAN).toMatch(/else if \(homeStatus && !\(await patchCard\(id, \{ status: homeStatus \}, \{ status: homeStatus \}\)\)\) \{\s*return;/);
    expect(k).toBeLessThan(KANBAN.indexOf("await putOrder(id, plan.afterId, plan.beforeId);"));
    expect(TABLE).toMatch(/if \(status && !\(await handleUpdate\(draggedId, \{ status \}\)\)\) return;/);
    expect(TABLE.indexOf("await handleUpdate(draggedId, { status })")).toBeLessThan(TABLE.indexOf("fetch(`/api/boards/${boardId}/order`"));
  });
});

