// The workspace export's rows and names, and its notes rule held to the
// app's own (node-rules notepadOwnerOf, R6a).

import { describe, expect, it } from "vitest";
import { emptyRows, notepadOwnerOf, type DocFact } from "@/lib/access/node-rules";
import { parseCsv } from "@/lib/csv";
import type { FieldDef } from "@/lib/field-catalog";
import {
  TASK_COLUMNS,
  asciiSlug,
  checklistText,
  commentCsvLine,
  contentFileName,
  fieldValues,
  isNoteDoc,
  linkCsvLine,
  taskCsvHeader,
  taskCsvLine,
  type DocTreeRow,
  type TaskForExport,
} from "./workspace-format";

const cells = (line: string) => parseCsv(line)[0];

describe("file names", () => {
  it("are ASCII slugs of the title with the id, the same on every export", () => {
    expect(asciiSlug("Café plan – Q4!", "untitled")).toBe("cafe-plan-q4");
    expect(asciiSlug("🚀🚀", "untitled")).toBe("untitled");
    expect(asciiSlug("   ", "table")).toBe("table");
    const long = asciiSlug("a ".repeat(80), "x");
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith("-")).toBe(false);
    expect(contentFileName("docs", "Café plan", "cm1", "md", "untitled")).toBe("docs/cafe-plan-cm1.md");
    expect(contentFileName("docs", "../../etc/passwd", "cm2", "md", "untitled")).toBe("docs/etc-passwd-cm2.md");
  });
});

describe("which Docs are notes", () => {
  const doc = (id: string, parentId: string | null, entityType: string | null = null, entityId: string | null = null): DocTreeRow => ({ id, parentId, entityType, entityId });

  function both(rows: DocTreeRow[], id: string): { ours: boolean; app: boolean } {
    const tree = new Map(rows.map((r) => [r.id, r]));
    const facts = emptyRows("org");
    for (const r of rows) facts.docs.set(r.id, { ...r, organizationId: "org", title: r.id, createdById: null } as DocFact);
    return { ours: isNoteDoc(tree, tree.get(id)!), app: notepadOwnerOf(facts, facts.docs.get(id)!) !== undefined };
  }

  it("matches the app's rule: a note, every page under it, and nothing else", () => {
    const rows = [
      doc("note", null, "NOTEPAD", "u1"),
      doc("child", "note"),
      doc("grandchild", "child"),
      doc("space-doc", null, "SPACE", "s1"),
      doc("under-space", "space-doc"),
      doc("bare-notepad", null, "NOTEPAD", null),
      doc("under-bare", "bare-notepad"),
      doc("loop-a", "loop-b"),
      doc("loop-b", "loop-a"),
      doc("orphan", "missing"),
    ];
    const want: Record<string, boolean> = {
      note: true, child: true, grandchild: true, "space-doc": false, "under-space": false,
      "bare-notepad": false, "under-bare": false, "loop-a": false, "loop-b": false, orphan: false,
    };
    for (const id of Object.keys(want)) {
      const got = both(rows, id);
      expect(got.ours, id).toBe(want[id]);
      expect(got.app, id).toBe(want[id]);
    }
  });

  it("stops at the same depth as the app", () => {
    const rows: DocTreeRow[] = [doc("p0", null, "NOTEPAD", "u1")];
    for (let i = 1; i <= 12; i++) rows.push(doc(`p${i}`, `p${i - 1}`));
    for (let i = 0; i <= 12; i++) {
      const got = both(rows, `p${i}`);
      expect(got.ours, `p${i}`).toBe(got.app);
    }
    expect(both(rows, "p8").ours).toBe(true);
    expect(both(rows, "p9").ours).toBe(false);
  });
});

describe("field values", () => {
  const fields: FieldDef[] = [
    { key: "stage", label: "Stage", type: "DROPDOWN", position: 1, options: { choices: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }] } },
    { key: "labels", label: "Labels", type: "LABELS", position: 2, options: { choices: [{ value: "x", label: "Urgent" }] } },
    { key: "points", label: "Points", type: "NUMBER", position: 0 },
    { key: "reviewer", label: "Reviewer", type: "PEOPLE", position: 3 },
    { key: "total", label: "Total", type: "FORMULA", position: 4 },
    { key: "notes", label: "Notes", type: "TEXT", position: 5 },
    { key: "notes_2", label: "Notes", type: "TEXT", position: 6 },
    { key: "constructor", label: "Builder", type: "TEXT", position: 7 },
    { key: "empty", label: "Empty", type: "TEXT", position: 8 },
  ];

  it("names each value by its field, choices by their label, in the List's order", () => {
    const got = fieldValues(fields, { stage: "b", labels: ["x", "gone"], points: 5, reviewer: ["u1"], total: 99, notes: "one", notes_2: "two", empty: "", $connectKeys: ["k"] });
    expect(got).toEqual({ Points: 5, Stage: "Beta", Labels: ["Urgent", "gone"], Reviewer: ["u1"], "Notes (notes)": "one", "Notes (notes_2)": "two" });
    expect(Object.keys(got)[0]).toBe("Points");
  });

  it("never reads a value off the object's prototype", () => {
    expect(fieldValues(fields, {})).toEqual({});
  });
});

describe("list-tasks.csv", () => {
  const task: TaskForExport = {
    id: "t1", boardId: "b1", parentItemId: "p1", title: "=HYPERLINK(\"x\")", status: "todo", priority: "HIGH",
    ownerId: "u1", assigneeIds: ["u1", "u2"], startAt: null, dueAt: new Date("2026-10-05T00:00:00Z"), archivedAt: null,
    createdAt: new Date("2026-10-01T09:00:00Z"), updatedAt: new Date("2026-10-02T09:00:00Z"),
    metadata: { description: "<p>Hello <b>team</b></p><ul><li>one</li></ul>", checklist: [{ text: "Draft", done: true }, { text: "Send", done: false }], points: 3 },
  };

  it("keeps the first eleven columns where they were", () => {
    expect(TASK_COLUMNS.slice(0, 11)).toEqual(["id", "listId", "title", "status", "priority", "ownerId", "assigneeIds", "startAt", "dueAt", "archivedAt", "createdAt"]);
    expect(cells(taskCsvHeader().slice(1))).toEqual([...TASK_COLUMNS]);
  });

  it("writes the content: description as text, checklist, tags, field values, formula-safe text", () => {
    const row = cells(taskCsvLine(task, { statusLabel: "To do", tags: ["Q4", "Ops"], fields: [{ key: "points", label: "Points", type: "NUMBER", position: 0 }] }));
    const at = (c: (typeof TASK_COLUMNS)[number]) => row[TASK_COLUMNS.indexOf(c)];
    expect(at("title")).toBe("'=HYPERLINK(\"x\")");
    expect(at("assigneeIds")).toBe("u1 u2");
    expect(at("dueAt")).toBe("2026-10-05T00:00:00.000Z");
    expect(at("parentId")).toBe("p1");
    expect(at("statusLabel")).toBe("To do");
    expect(at("tags")).toBe("Q4; Ops");
    expect(at("description")).toContain("Hello team");
    expect(at("description")).toContain("one");
    expect(at("description")).not.toContain("<");
    expect(at("checklist")).toBe("[x] Draft\n[ ] Send");
    expect(JSON.parse(at("fields"))).toEqual({ Points: 3 });
    expect(at("updatedAt")).toBe("2026-10-02T09:00:00.000Z");
  });

  it("writes an empty fields cell when the task has no values", () => {
    const row = cells(taskCsvLine({ ...task, metadata: {} }, { statusLabel: "", tags: [], fields: [] }));
    expect(row[TASK_COLUMNS.indexOf("fields")]).toBe("");
    expect(row[TASK_COLUMNS.indexOf("checklist")]).toBe("");
  });

  it("is a checklist of boxes, ignoring broken items", () => {
    expect(checklistText({ checklist: [{ text: "A", done: true }, null, { done: true }, { text: "B" }] })).toBe("[x] A\n[ ] B");
    expect(checklistText(null)).toBe("");
  });
});

describe("list-links.csv and task-comments.csv", () => {
  it("reads a linked List's own values from its namespace", () => {
    const meta = { points: 1, $lists: { b2: { points: 7 } } };
    const row = cells(linkCsvLine({ itemId: "t1", boardId: "b2", position: 1024, createdAt: new Date("2026-10-03T00:00:00Z") }, meta, [{ key: "points", label: "Points", type: "NUMBER", position: 0 }]));
    expect(row).toEqual(["t1", "b2", "1024", JSON.stringify({ Points: 7 }), "2026-10-03T00:00:00.000Z"]);
  });

  it("writes a comment as plain text with its files", () => {
    const row = cells(commentCsvLine(
      { id: "c1", entityId: "t1", authorId: "u1", body: "<p>Looks <i>good</i> to me</p>", createdAt: new Date("2026-10-03T00:00:00Z"), updatedAt: new Date("2026-10-03T00:00:00Z") },
      "Mona Mech",
      ["brief.pdf", "photo.png"],
    ));
    expect(row.slice(0, 6)).toEqual(["c1", "t1", "u1", "Mona Mech", "Looks good to me", "brief.pdf; photo.png"]);
  });
});
