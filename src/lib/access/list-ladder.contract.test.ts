// The List ladder's rules that live in routes and views (founder decision 3,
// review rounds 1 and 2), held to the source so a regression fails here:
//
//   arranging   PATCH /api/items/[id] refuses position and groupKey below
//               Can edit on the List (list_read_only), as the order route does
//   watching    a watch-only PATCH needs Can view, and below Can edit it adds
//               or removes the caller alone
//   saving      the List table and kanban save exactly the rows they draw as
//               open (rowFieldsEditable), and any reader's watch goes through
//   archiving   the row and card menus archive once: the views only remove
//               the row afterwards
//   members     the member routes' GUEST onto a rung row changes nothing

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { memberRouteKeepsRow } from "./grant-plan";

const root = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("the List ladder in the task route", () => {
  const route = read("src/app/api/items/[id]/route.ts");

  it("refuses arranging below Can edit on the List", () => {
    expect(route).toMatch(/if \(\(parsed\.data\.position !== undefined \|\| parsed\.data\.groupKey !== undefined\) && !gate\.canAddToList\) \{\n\s+return NextResponse\.json\(\{ error: "no_access", reason: "list_read_only", requestAccess: true \}, \{ status: 403 \}\);/);
  });

  it("lets any reader watch, and below Can edit only themselves", () => {
    expect(route).toMatch(/const onlyWatching = parsed\.data\.watcherIds !== undefined && keys\.every\(\(k\) => k === "watcherIds" \|\| k === "contextBoardId"\);/);
    expect(route).toMatch(/gateItem\(id, c, parsed\.data\.boardId \? "move" : onlyWatching \? "view" : "edit"\)/);
    expect(route).toMatch(/parsed\.data\.watcherIds = wants \? \[\.\.\.others, c\.userId\] : others;/);
  });
});

describe("the List ladder in the List views", () => {
  const table = read("src/components/board-view/board-table-view.tsx");
  const kanban = read("src/components/board-view/board-kanban-view.tsx");

  it("draws and saves a table row by one rule", () => {
    expect(table).toMatch(/const rowCanEdit = rowFieldsEditable\(row, canEdit, assigneeEdit\);/);
    expect(table).toMatch(/const may = row \? rowFieldsEditable\(row, canEdit, assigneeEdit\) : canEdit;\n\s+if \(!may && !watchOnlyPatch\(patch\)\) return false;/);
    expect(table).toMatch(/if \(!rowFieldsEditable\(row, canEdit, assigneeEdit\)\) return \{ ok: false, message: "You can't change this task here\." \};/);
  });

  it("draws and saves a kanban card by the same rule", () => {
    expect(kanban).toMatch(/const cardCanEdit = rowFieldsEditable\(card, canEdit, assigneeEdit\);/);
    expect(kanban).toMatch(/const mayChange = card \? rowFieldsEditable\(card, canEdit, assigneeEdit\) : canEdit;\n\s+if \(!mayChange && !watchOnlyPatch\(apiBody\)\) return false;/);
  });

  it("archives once: after the menu's own archive, the views only take the row away", () => {
    const archived = table.slice(table.indexOf("const handleArchived = useCallback("), table.indexOf("}, [reportRemoved]);", table.indexOf("const handleArchived = useCallback(")));
    expect(archived).toMatch(/setItems\(\(prev\) => prev\.filter\(\(r\) => r\.id !== id\)\);/);
    expect(archived).not.toMatch(/confirm\(|fetch\(/);
    expect(table).toMatch(/onArchive=\{handleArchived\}/);
    expect(kanban).toMatch(/onArchive=\{\(\) => removeLocal\(card\.id\)\}/);
    expect(kanban).not.toMatch(/const archiveCard = useCallback/);
  });

  it("keeps arranging at Can edit on the List: grip, select and Add subtask follow canArrange", () => {
    expect(table).toMatch(/canArrange=\{rowCanArrange\}/);
    expect(table).toMatch(/\{canArrange \? \(\n\s+<span\n\s+className=\{`w-3 shrink-0 inline-flex justify-center/);
    expect(table).toMatch(/\{canArrange \? \(\n\s+<CheckBox/);
    expect(table).toMatch(/canAddSubtask=\{canArrange\}/);
    expect(kanban).toMatch(/canArrange=\{cardCanArrange\}/);
  });
});

describe("every task menu writes once, and offers only what its host can open", () => {
  const menu = read("src/components/board-view/item-more-menu.tsx");
  const host = read("src/components/board-view/item-context-menu.tsx");
  const table = read("src/components/board-view/board-table-view.tsx");
  const kanban = read("src/components/board-view/board-kanban-view.tsx");
  const between = (src: string, from: string, to: string) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));

  it("hands its host the copy it made, and the hosts only show it", () => {
    expect(menu).toMatch(/onDuplicated\?\.\(data\.item\.id, data\.item\);/);
    expect(between(table, "const handleDuplicated = useCallback(", "}, [reportCreated, boardId, refetchList]);")).not.toMatch(/\bfetch\(/);
    expect(between(kanban, "const cardDuplicated = useCallback(", "}, [reportCreated, boardId, refetch]);")).not.toMatch(/\bfetch\(/);
    expect(host).not.toMatch(/\/duplicate`, \{ method: "POST" \}/);
  });

  it("the right-click host never asks or archives a second time", () => {
    expect(host).toMatch(/onArchived=\{onItemRemoved && target \? \(\) => onItemRemoved\(target\.id\) : undefined\}/);
    expect(host).not.toMatch(/method: "DELETE"/);
    expect(host).not.toMatch(/useConfirm/);
  });

  it("offers Share only where the host can open it", () => {
    expect(menu).toMatch(/\.filter\(\(row\) => !\(row\.key === "share" && !onShare\)\)/);
  });

  it("gives the right-click menu each row's own role and List writes", () => {
    expect(host).toMatch(/const mayEdit = !!target && \(rowCanEdit \? rowCanEdit\(target\) : canEdit\);/);
    expect(host).toMatch(/assigneeOnly=\{!!target && kind === "home" && !!relationOnly\?\.\(target\)\}/);
  });
});

describe("the List ladder on every surface that lists a person's own tasks", () => {
  it("the planner holds a frozen task still", () => {
    expect(read("src/app/api/calendar/events/route.ts")).toMatch(/editable: calendar === "my" && kind === "task" && !\(it\.boardId && readOnlyBoardIds\.has\(it\.boardId\)\),/);
  });

  it("My work decides each row as the gate does, Assigned by me included", () => {
    const route = read("src/app/api/me/work/route.ts");
    expect(route).toMatch(/scope === "delegated"\n\s+\? sides\.addable\.has\(it\.boardId\) \|\| \(madeByViewer\.has\(it\.id\) && !sides\.withheld\.has\(it\.boardId\)\)\n\s+: !sides\.withheld\.has\(it\.boardId\);/);
    expect(route).toMatch(/canAddToList: sides\.addable\.has\(it\.boardId\),/);
  });

  it("Everything applies rules 9 and 5 where the List's lift applies", () => {
    const everything = read("src/lib/everything.ts");
    expect(everything).toMatch(/lifts && madeByViewer\.has\(it\.id\) \? "FULL"/);
    expect(everything).toMatch(/: lifts && mine && !atLeast\(listRole, "EDIT"\) \? "EDIT"/);
    expect(everything).toMatch(/canAddToList: atLeast\(listRole, "EDIT"\),/);
  });

  it("the List page hands every view the same per-row rule as the Table", () => {
    const canvas = read("src/components/board-view/board-canvas.tsx");
    expect(canvas).toMatch(/editableRow: \(row: BoardItemRow\) => rowFieldsEditable\(row, canEdit, assigneeEdit\),/);
    expect(canvas.match(/editableRow=\{rowRules\?\.editableRow\}/g)?.length).toBe(5);
    expect(canvas.match(/deletableRow=\{deletableRow\}/g)?.length).toBe(5);
    // The row rule stands on its own in the Gantt: canEdit is the List's add right.
    expect(read("src/components/board-view/board-gantt-view.tsx")).toMatch(/\(editableRow \? editableRow\(it\) : linkedRowEditable\(it, canEdit\)\)/);
  });
});

describe("the task page and drawer for a rung", () => {
  it("offer no List writes to the task's maker below Can edit", () => {
    for (const p of ["src/components/board-view/item-drawer-host.tsx", "src/app/(dashboard)/item/[id]/page.tsx"]) {
      expect(read(p), p).toMatch(/assigneeOnly=\{decision\.via === "assignee" \|\| \(decision\.via === "creator" && task\.canAddToList === false\)\}/);
    }
  });

  it("offer Manage fields and statuses with Full access on the List, never in a List the task is only shown in", () => {
    expect(read("src/lib/item-gate.ts")).toMatch(/canManageList = roleAtLeast\(d\.role, "FULL"\);/);
    expect(read("src/app/api/items/[id]/route.ts")).toMatch(/canManageList: linked \? false : gate\.canManageList,/);
  });

  it("offer the Watchers picker to editors only", () => {
    expect(read("src/components/board-view/board-item-detail.tsx")).toMatch(/open=\{canEdit && open\}/);
  });

  it("drop Mark complete and Rename where they cannot work", () => {
    const menu = read("src/components/board-view/item-more-menu.tsx");
    expect(menu).toMatch(/\.filter\(\(row\) => !\(row\.key === "complete" && completionStatuses\.length === 0\)\)/);
    expect(menu).toMatch(/\.filter\(\(row\) => !\(row\.key === "rename" && !onRenameRequested\)\);/);
  });
});

describe("a raise writes and reports what it gave", () => {
  it("the grant writer and the request route both use the written role", () => {
    const grants = read("src/lib/access/grants.ts");
    expect(grants).toMatch(/role: plan\.role \?\? requested, noChange: false, notify: plan\.notify/);
    expect(grants).toMatch(/notifyGrantee\(actor, ref, gate\.rows, userId, outcome\.role \?\? requested, outcome\.notify\)/);
    expect(read("src/app/api/access-requests/[id]/route.ts")).toMatch(/if \(change\.role\) granted = change\.role;/);
  });
});

describe("the List ladder in the member routes", () => {
  it("treats their GUEST onto a rung row as no change, and every other write as written", () => {
    expect(memberRouteKeepsRow("list", "GUEST", "COMMENT")).toBe(true);
    expect(memberRouteKeepsRow("list", "GUEST", "ASSIGNED")).toBe(true);
    expect(memberRouteKeepsRow("list", "GUEST", "GUEST")).toBe(true);
    expect(memberRouteKeepsRow("list", "MEMBER", "COMMENT")).toBe(false);
    expect(memberRouteKeepsRow("list", "GUEST", "MEMBER")).toBe(false);
    expect(memberRouteKeepsRow("list", "GUEST", null)).toBe(false);
    // A rung is a List's alone: nowhere else does GUEST stand in for one.
    expect(memberRouteKeepsRow("folder", "GUEST", "COMMENT")).toBe(false);
  });

  it("is the rule the grant writer applies to the member routes", () => {
    expect(read("src/lib/access/grants.ts")).toMatch(/const noChange = stored \? memberRouteKeepsRow\(ref\.kind, stored, cur\.stored\) : plan\.noChange;/);
  });
});
