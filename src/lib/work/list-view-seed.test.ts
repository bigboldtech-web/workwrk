// The views a new List is born with, the self-heal that tops up an old one,
// and how a List template's views land on the List it creates. Board comes
// first everywhere, and a pin is only ever one somebody set.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CORE_LIST_VIEWS,
  TASK_LIST_VIEW_TYPES,
  coreListViewRows,
  needsCoreListViews,
  missingCoreListViews,
  templateDefaultViewType,
  planTemplateViews,
} from "./list-view-seed";
import { resolveDefaultView, readPinnedDefault, type DefaultViewCandidate } from "./default-view";

const MARK = { byId: "u-creator", at: "2026-09-24T10:00:00.000Z" };

/** Rows as createBoard stores them: shared, owned by the creator. */
function asStored(rows: ReturnType<typeof coreListViewRows>): DefaultViewCandidate[] {
  return rows.map((r, i) => ({ ...r, id: `v${i}`, isShared: true, ownerId: "u-creator" }));
}

const label = (t: string) =>
  ({ TABLE: "List", KANBAN: "Board", CALENDAR: "Calendar", GANTT: "Gantt", TIMELINE: "Timeline" } as Record<string, string>)[t] ?? t;

describe("CORE_LIST_VIEWS", () => {
  it("is Board, List, Calendar, Gantt, Board first", () => {
    expect(CORE_LIST_VIEWS.map((v) => [v.name, v.type])).toEqual([
      ["Board", "KANBAN"],
      ["List", "TABLE"],
      ["Calendar", "CALENDAR"],
      ["Gantt", "GANTT"],
    ]);
  });

  it("knows the task view types (the ones that make a List a task List)", () => {
    expect([...TASK_LIST_VIEW_TYPES].sort()).toEqual(["CALENDAR", "GANTT", "KANBAN", "TABLE", "TIMELINE"]);
  });
});

describe("coreListViewRows", () => {
  it("opens a new List on Board with no phantom pin, for no default type and for KANBAN", () => {
    for (const t of [null, undefined, "KANBAN"] as const) {
      const rows = coreListViewRows(t, null);
      expect(rows.map((r) => [r.name, r.type, r.displayOrder, r.isDefault])).toEqual([
        ["Board", "KANBAN", 0, false],
        ["List", "TABLE", 1, false],
        ["Calendar", "CALENDAR", 2, false],
        ["Gantt", "GANTT", 3, false],
      ]);
      expect(rows[1].config).toEqual({ groupBy: "status" });
      expect(rows[0].config).toEqual({});
      const r = resolveDefaultView(asStored(rows));
      expect(r?.view.name).toBe("Board");
      expect(r?.pinned).toBe(false);
    }
  });

  it("ignores a mark handed in with KANBAN: nobody pinned the Board fallback", () => {
    const rows = coreListViewRows("KANBAN", MARK);
    expect(rows.every((r) => !r.isDefault && readPinnedDefault(r.config) === null)).toBe(true);
  });

  it("keeps Board first and pins List when the creator asked for TABLE", () => {
    const rows = coreListViewRows("TABLE", MARK);
    expect(rows.map((r) => r.name)).toEqual(["Board", "List", "Calendar", "Gantt"]);
    expect(rows[0].isDefault).toBe(false);
    expect(rows[1].isDefault).toBe(true);
    expect(rows[1].config).toEqual({ groupBy: "status", pinned: MARK });
    const r = resolveDefaultView(asStored(rows));
    expect(r?.view.name).toBe("List");
    expect(r?.reason).toBe("pinned");
    expect(r?.pinnedById).toBe("u-creator");
  });

  it("pins Calendar or Gantt the same way", () => {
    for (const [t, name] of [["CALENDAR", "Calendar"], ["GANTT", "Gantt"]] as const) {
      const rows = coreListViewRows(t, MARK);
      expect(rows.filter((r) => r.isDefault).map((r) => r.name)).toEqual([name]);
      expect(resolveDefaultView(asStored(rows))?.view.name).toBe(name);
    }
  });

  it("appends a non-core task type (TIMELINE) after the four, as the pinned default", () => {
    const rows = coreListViewRows("TIMELINE", MARK);
    expect(rows.map((r) => [r.name, r.type, r.displayOrder, r.isDefault])).toEqual([
      ["Board", "KANBAN", 0, false],
      ["List", "TABLE", 1, false],
      ["Calendar", "CALENDAR", 2, false],
      ["Gantt", "GANTT", 3, false],
      ["Timeline", "TIMELINE", 4, true],
    ]);
    expect(readPinnedDefault(rows[4].config)).toEqual(MARK);
    expect(resolveDefaultView(asStored(rows))?.view.name).toBe("Timeline");
  });

  it("appends nothing for a type that is not a task view", () => {
    const rows = coreListViewRows("DOC", MARK);
    expect(rows).toHaveLength(4);
    expect(rows.some((r) => r.isDefault)).toBe(false);
  });

  it("hands out fresh config objects every call", () => {
    const a = coreListViewRows(null, null);
    (a[1].config as Record<string, unknown>).groupBy = "priority";
    expect(coreListViewRows(null, null)[1].config).toEqual({ groupBy: "status" });
  });
});

describe("needsCoreListViews / missingCoreListViews (the ensureCoreListViews self-heal)", () => {
  it("tops up a task List that lacks a core type", () => {
    expect(needsCoreListViews([{ type: "TABLE" }])).toBe(true);
    expect(needsCoreListViews([{ type: "TABLE" }, { type: "KANBAN" }, { type: "CALENDAR" }])).toBe(true);
  });

  it("leaves a full set, a List with no TABLE view and an empty List alone", () => {
    expect(needsCoreListViews([{ type: "KANBAN" }, { type: "TABLE" }, { type: "CALENDAR" }, { type: "GANTT" }])).toBe(false);
    expect(needsCoreListViews([{ type: "DOC" }])).toBe(false);
    expect(needsCoreListViews([{ type: "KANBAN" }])).toBe(false);
    expect(needsCoreListViews([])).toBe(false);
  });

  it("appends the missing ones in CORE order, never as the default", () => {
    expect(missingCoreListViews([{ type: "TABLE" }])).toEqual([
      { name: "Board", type: "KANBAN", config: {} },
      { name: "Calendar", type: "CALENDAR", config: {} },
      { name: "Gantt", type: "GANTT", config: {} },
    ]);
    expect(missingCoreListViews([{ type: "TABLE" }, { type: "GANTT" }]).map((v) => v.name)).toEqual(["Board", "Calendar"]);
    expect(missingCoreListViews([{ type: "KANBAN" }, { type: "TABLE" }, { type: "CALENDAR" }, { type: "GANTT" }])).toEqual([]);
  });

  it("seeds a missing List view grouped by status, like a new one", () => {
    expect(missingCoreListViews([{ type: "KANBAN" }]).find((v) => v.type === "TABLE")?.config).toEqual({ groupBy: "status" });
  });
});

describe("templateDefaultViewType (review #33)", () => {
  it("reads no preference, TABLE (the old system default) and KANBAN as Board", () => {
    expect(templateDefaultViewType({})).toBe("KANBAN");
    expect(templateDefaultViewType({ defaultView: "TABLE" })).toBe("KANBAN");
    expect(templateDefaultViewType({ defaultView: "KANBAN" })).toBe("KANBAN");
  });

  it("keeps a real preference", () => {
    expect(templateDefaultViewType({ defaultView: "CALENDAR" })).toBe("CALENDAR");
    expect(templateDefaultViewType({ defaultView: "TIMELINE" })).toBe("TIMELINE");
  });

  it("creates on Board when a payload view carries the pin, which planTemplateViews then applies", () => {
    expect(templateDefaultViewType({ defaultView: "CALENDAR", views: [{ pinned: true }] })).toBe("KANBAN");
    expect(templateDefaultViewType({ defaultView: "CALENDAR", views: [{ pinned: false }] })).toBe("CALENDAR");
  });

  it("makes a single-view List (a Doc, Form or Canvas List) again as that one view, pin or no pin", () => {
    // snapshotBoard of a Doc List: its one view resolves as a choice, so it
    // carries `pinned`. Reading that as "open on Board" would hand it back as
    // a task List with Board, List, Calendar and Gantt beside the Doc.
    expect(templateDefaultViewType({ defaultView: "DOC", views: [{ type: "DOC", pinned: true }] })).toBe("DOC");
    expect(templateDefaultViewType({ defaultView: "FORM", views: [{ type: "FORM" }] })).toBe("FORM");
    expect(templateDefaultViewType({ defaultView: "WHITEBOARD" })).toBe("WHITEBOARD");
  });

  it("keeps a task List a task List when its pinned view is a Doc", () => {
    // A Doc view added to a task List and pinned there: the List is created
    // on Board with its task views, and planTemplateViews pins the Doc.
    const payload = {
      defaultView: "DOC",
      views: [{ type: "KANBAN" }, { type: "TABLE" }, { type: "DOC", pinned: true }],
    };
    expect(templateDefaultViewType(payload)).toBe("KANBAN");
  });
});

describe("planTemplateViews", () => {
  // What createBoard(KANBAN) made for the new List a template is applied into.
  const created = () => [
    { id: "c-board", name: "Board", type: "KANBAN", displayOrder: 0, config: {} },
    { id: "c-list", name: "List", type: "TABLE", displayOrder: 1, config: { groupBy: "status" } },
    { id: "c-cal", name: "Calendar", type: "CALENDAR", displayOrder: 2, config: {} },
    { id: "c-gantt", name: "Gantt", type: "GANTT", displayOrder: 3, config: {} },
  ];

  it("matches a snapshot's core views to the created ones instead of doubling the tabs", () => {
    const plan = planTemplateViews(
      created(),
      [
        { type: "KANBAN", name: "Board", config: {} },
        { type: "TABLE", name: "List", config: { groupBy: "status" } },
        { type: "CALENDAR", name: "Calendar", config: {} },
        { type: "GANTT", name: "Gantt", config: {} },
      ],
      label,
    );
    expect(plan.creates).toEqual([]);
    // Nothing differs from what createBoard wrote, so nothing is rewritten.
    expect(plan.updates).toEqual([]);
  });

  it("carries a pin onto the matching created view, as a pin-only update", () => {
    const plan = planTemplateViews(
      created(),
      [{ type: "KANBAN", name: "Board" }, { type: "TABLE", name: "List", pinned: true }],
      label,
    );
    expect(plan.updates).toEqual([{ id: "c-list", config: { groupBy: "status" }, pin: true }]);
    expect(plan.creates).toEqual([]);
  });

  it("merges a template's config over the created one and never carries a stored mark", () => {
    const plan = planTemplateViews(
      created(),
      [{ type: "TABLE", name: "List", config: { groupBy: "priority", colWidths: { title: 300 }, pinned: { byId: "x", at: MARK.at } } }],
      label,
    );
    expect(plan.updates).toEqual([
      { id: "c-list", config: { groupBy: "priority", colWidths: { title: 300 } }, pin: false },
    ]);
  });

  it("matches names trimmed and case-insensitively, and defaults a missing name to the type's label", () => {
    const plan = planTemplateViews(
      created(),
      [
        { type: "KANBAN", name: "  board ", config: { groupBy: "priority" } },
        { type: "GANTT", config: { ganttWeeks: 6 } },
      ],
      label,
    );
    expect(plan.updates.map((u) => u.id)).toEqual(["c-board", "c-gantt"]);
    expect(plan.creates).toEqual([]);
  });

  it("creates every other view after the created ones, in payload order, without a mark", () => {
    const plan = planTemplateViews(
      created(),
      [
        { type: "TABLE", name: "Table", config: { grid: "monday", pinned: { byId: "x", at: MARK.at } } },
        { type: "TIMELINE" },
        { type: "TABLE", name: "List", config: { groupBy: "assignee" } },
        { type: "TABLE", name: "List", config: { groupBy: "priority" } },
      ],
      label,
    );
    expect(plan.creates).toEqual([
      { name: "Table", type: "TABLE", config: { grid: "monday" }, displayOrder: 4, pin: false },
      { name: "Timeline", type: "TIMELINE", config: {}, displayOrder: 5, pin: false },
      // The second "List" has no created view left to match, so it is a tab of its own.
      { name: "List", type: "TABLE", config: { groupBy: "priority" }, displayOrder: 6, pin: false },
    ]);
    expect(plan.updates).toEqual([{ id: "c-list", config: { groupBy: "assignee" }, pin: false }]);
  });

  it("pins only the FIRST payload view that carries the pin", () => {
    const plan = planTemplateViews(
      created(),
      [
        { type: "TIMELINE", pinned: true },
        { type: "TABLE", name: "List", pinned: true },
      ],
      label,
    );
    expect(plan.creates).toEqual([{ name: "Timeline", type: "TIMELINE", config: {}, displayOrder: 4, pin: true }]);
    expect(plan.updates).toEqual([]);
  });

  it("keeps the mark createBoard wrote on a template's preferred view when its config is merged", () => {
    const rows = created().map((c) => (c.id === "c-cal" ? { ...c, config: { pinned: MARK } } : c));
    const plan = planTemplateViews(rows, [{ type: "CALENDAR", name: "Calendar", config: { dateFieldKey: "dueAt" } }], label);
    expect(plan.updates).toEqual([{ id: "c-cal", config: { pinned: MARK, dateFieldKey: "dueAt" }, pin: false }]);
  });

  it("starts creates at 0 when nothing was created", () => {
    const plan = planTemplateViews([], [{ type: "KANBAN" }], label);
    expect(plan.creates).toEqual([{ name: "Board", type: "KANBAN", config: {}, displayOrder: 0, pin: false }]);
  });

  it("does not mutate the created rows or the payload", () => {
    const rows = created();
    const payload = [{ type: "TABLE", name: "List", config: { groupBy: "priority" }, pinned: true }];
    planTemplateViews(rows, payload, label);
    expect(rows[1].config).toEqual({ groupBy: "status" });
    expect(payload[0].config).toEqual({ groupBy: "priority" });
  });
});

// A source contract, like view-save-gate.contract.test.ts: board.ts and
// template-center.ts pull in Prisma, which the node unit environment does not
// carry, so these read the files. They pin the one property a later edit
// could quietly undo: every List creation path seeds through the rows above.
describe("every List creation path seeds through these rows (decision 8)", () => {
  const board = readFileSync(join(process.cwd(), "src/lib/board.ts"), "utf8");
  const templates = readFileSync(join(process.cwd(), "src/lib/template-center.ts"), "utf8");

  it("createBoard defaults to the Board and writes the core rows, pinning only a requested other type", () => {
    expect(board).toMatch(/const viewType = input\.defaultViewType \?\? "KANBAN";/);
    expect(board).toMatch(/coreListViewRows\(viewType, mark\)/);
    expect(board).toMatch(/viewType === "KANBAN" \? null :/);
  });

  it("the Personal list is born with the same rows and no default", () => {
    expect(board).toMatch(/coreListViewRows\(null, null\)/);
  });

  it("the self-heal appends only the missing rows, under a per-List lock", () => {
    expect(board).toMatch(/pg_advisory_xact_lock\(hashtext\(\$\{`core-views:\$\{boardId\}`\}\)\)/);
    expect(board).toMatch(/missingCoreListViews\(current\)/);
  });

  it("the Lists API reports the resolved default, not the raw flag", () => {
    expect(board).not.toMatch(/views: \{ where: \{ isDefault: true \}/);
    expect(board).toMatch(/resolvedDefaultViewIds\(rows\.map/);
  });

  it("a template creates its List through templateDefaultViewType and lays its views with planTemplateViews", () => {
    expect(templates).toMatch(/templateDefaultViewType\(payload\)/);
    expect(templates).toMatch(/planTemplateViews\(created, payloadViews/);
    expect(templates).not.toMatch(/payload\.defaultView \?\? "TABLE"/);
  });
});
