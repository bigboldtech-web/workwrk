// Round three, break 3 (entity-link-ends linkWriteVerdict): POST and DELETE
// /api/entity-links checked nothing but the goal sources, so a person with
// Can view on a task, or with no access at all, attached a file to it and
// removed other people's attachments; and a link to a file they could not
// open became the door to it (break 4). A link on a node is content added to
// it, so the placement rule's create rule holds (node-rules P1): Can edit on
// the source, and the other end one the person can open.

import { describe, expect, it } from "vitest";
import { linkWriteRefusal, linkWriteVerdict, type LinkWriteFacts } from "./entity-link-ends";

const ME = "u-me";

/** One person's reach: the nodes they open and edit, the tasks, and the files. */
function facts(o: {
  opens?: string[];
  edits?: string[];
  editableTasks?: string[];
  readableFiles?: string[];
  editableFiles?: string[];
} = {}): LinkWriteFacts {
  const opens = new Set([...(o.opens ?? []), ...(o.edits ?? [])]);
  const edits = new Set(o.edits ?? []);
  return {
    userId: ME,
    nodeOpens: (kind, id) => opens.has(`${kind}:${id}`),
    nodeEdits: (kind, id) => edits.has(`${kind}:${id}`),
    readableFiles: new Set(o.readableFiles ?? []),
    editableFiles: new Set(o.editableFiles ?? []),
    tasks: new Map([
      ["TV", { boardId: "LV", ownerId: null, assigneeIds: [] }],
      ["TBB", { boardId: "LB", ownerId: null, assigneeIds: [] }],
      ["TMINE", { boardId: "LB", ownerId: null, assigneeIds: [ME] }],
    ]),
    editableTasks: new Set(o.editableTasks ?? []),
  };
}

const onTask = (task: string, file: string) => ({ sourceType: "BOARD_ITEM", sourceId: task, targetType: "FILE", targetId: file });

describe("adding or removing a link needs Can edit on its source", () => {
  it("Can view on the task's List never attaches a file to the task, nor removes one", () => {
    const f = facts({ opens: ["list:LV"], readableFiles: ["F-mine"] });
    expect(linkWriteVerdict(onTask("TV", "F-mine"), f)).toEqual({ ok: false, status: 403, error: linkWriteRefusal("BOARD_ITEM") });
    expect(linkWriteRefusal("BOARD_ITEM")).toBe("You need Can edit on this task to add or remove its links and attachments.");
  });

  it("a task the person cannot open at all reads as not found, so a guessed id confirms nothing", () => {
    const f = facts({ opens: ["list:LV"], readableFiles: ["F-mine"] });
    expect(linkWriteVerdict(onTask("TBB", "F-mine"), f)).toEqual({ ok: false, status: 404, error: "Not found" });
  });

  it("the task edit rule lets them: Can edit on its List, or being its assignee", () => {
    expect(linkWriteVerdict(onTask("TV", "F-mine"), facts({ edits: ["list:LV"], editableTasks: ["TV"], readableFiles: ["F-mine"] }))).toEqual({ ok: true });
    expect(linkWriteVerdict(onTask("TMINE", "F-mine"), facts({ editableTasks: ["TMINE"], readableFiles: ["F-mine"] }))).toEqual({ ok: true });
  });

  it("every node source asks Can edit on itself: a List, a doc, a canvas, a Folder, a Space, a table, a form", () => {
    const cases: Array<[string, string]> = [
      ["BOARD", "list"], ["DOC", "doc"], ["NOTE", "doc"], ["WHITEBOARD", "canvas"], ["FOLDER", "folder"], ["SPACE", "space"], ["TABLE", "table"], ["FORM", "form"],
    ];
    for (const [type, kind] of cases) {
      const link = { sourceType: type, sourceId: "N1", targetType: "SOP", targetId: "S1" };
      expect(linkWriteVerdict(link, facts({ opens: [`${kind}:N1`] }))).toEqual({ ok: false, status: 403, error: linkWriteRefusal(type) });
      expect(linkWriteVerdict(link, facts({ edits: [`${kind}:N1`] }))).toEqual({ ok: true });
      expect(linkWriteVerdict(link, facts())).toEqual({ ok: false, status: 404, error: "Not found" });
    }
  });

  it("a file source asks the file edit rule", () => {
    const link = { sourceType: "FILE", sourceId: "F1", targetType: "DOC", targetId: "D1" };
    expect(linkWriteVerdict(link, facts({ readableFiles: ["F1"], opens: ["doc:D1"] })).ok).toBe(false);
    expect(linkWriteVerdict(link, facts({ readableFiles: ["F1"], editableFiles: ["F1"], opens: ["doc:D1"] }))).toEqual({ ok: true });
  });

  it("sources that are not nodes keep their own gates (a SOP, a KRA, a person)", () => {
    expect(linkWriteVerdict({ sourceType: "SOP", sourceId: "S1", targetType: "KRA", targetId: "K1" }, facts())).toEqual({ ok: true });
  });

  it("a legacy TASK id that is no task is not a node, as the read rule has it", () => {
    expect(linkWriteVerdict({ sourceType: "TASK", sourceId: "legacy-1", targetType: "SOP", targetId: "S1" }, facts())).toEqual({ ok: true });
  });
});

describe("the other end must be one the person can open", () => {
  it("a file they cannot open is never attached, so the link is no door to it (break 4)", () => {
    const f = facts({ edits: ["list:LV"], editableTasks: ["TV"], readableFiles: [] });
    expect(linkWriteVerdict(onTask("TV", "F-secret"), f)).toEqual({ ok: false, status: 404, error: "Not found" });
  });

  it("nor a doc, a canvas or a List in a Space they cannot see", () => {
    const f = facts({ edits: ["list:LV"], editableTasks: ["TV"] });
    for (const [type, kind] of [["DOC", "doc"], ["WHITEBOARD", "canvas"], ["BOARD", "list"]] as const) {
      const link = { sourceType: "BOARD_ITEM", sourceId: "TV", targetType: type, targetId: "X1" };
      expect(linkWriteVerdict(link, f).ok).toBe(false);
      expect(linkWriteVerdict(link, facts({ edits: ["list:LV"], editableTasks: ["TV"], opens: [`${kind}:X1`] }))).toEqual({ ok: true });
    }
  });

  it("the sentence names what is needed and carries no em dash or double hyphen", () => {
    for (const type of ["BOARD_ITEM", "BOARD", "DOC", "WHITEBOARD", "FOLDER", "SPACE", "TABLE", "FORM", "FILE", "OTHER"]) {
      expect(linkWriteRefusal(type)).toMatch(/^You need Can edit on this \w+ to add or remove its links and attachments\.$/);
      expect(linkWriteRefusal(type)).not.toMatch(/\u2014|-{2}/);
    }
  });
});
