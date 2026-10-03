import { describe, expect, it } from "vitest";
import { linkEndVisible, linkVisible, linkWriteVerdict, type LinkEndFacts, type LinkWriteFacts } from "./entity-link-ends";

const ME = "u-me";

function facts(open: string[]): LinkEndFacts {
  const openSet = new Set(open);
  return {
    userId: ME,
    nodeOpens: (kind, id) => openSet.has(`${kind}:${id}`),
    readableFiles: new Set(["file-ok"]),
    tasks: new Map([
      ["t-open", { boardId: "L1", ownerId: null, assigneeIds: [] }],
      ["t-hidden", { boardId: "L2", ownerId: null, assigneeIds: [] }],
      ["t-mine", { boardId: "L2", ownerId: null, assigneeIds: [ME] }],
    ]),
  };
}

describe("entity link ends", () => {
  const f = facts(["list:L1", "doc:D1"]);
  it("gates the source as well as the target", () => {
    const toOpenTask = { sourceType: "DOC", sourceId: "D-hidden", targetType: "BOARD_ITEM", targetId: "t-open" };
    expect(linkVisible(toOpenTask, f)).toBe(false);
    expect(linkVisible({ ...toOpenTask, sourceId: "D1" }, f)).toBe(true);
  });
  it("gates a Folder end and a task end, which passed ungated before", () => {
    expect(linkEndVisible("FOLDER", "F1", f)).toBe(false);
    expect(linkEndVisible("FOLDER", "F1", facts(["folder:F1"]))).toBe(true);
    expect(linkEndVisible("BOARD_ITEM", "t-hidden", f)).toBe(false);
    expect(linkEndVisible("BOARD_ITEM", "t-open", f)).toBe(true);
  });
  it("opens a task through its assignment, and never a task id that is not in the org", () => {
    expect(linkEndVisible("BOARD_ITEM", "t-mine", f)).toBe(true);
    expect(linkEndVisible("BOARD_ITEM", "t-gone", f)).toBe(false);
    // A legacy TASK row is not a node.
    expect(linkEndVisible("TASK", "t-gone", f)).toBe(true);
  });
  it("reads files by the file rule and passes ends that are not nodes", () => {
    expect(linkEndVisible("FILE", "file-ok", f)).toBe(true);
    expect(linkEndVisible("FILE", "file-no", f)).toBe(false);
    expect(linkEndVisible("SOP", "s1", f)).toBe(true);
  });
});

describe("SOP, goal, key result, KRA and KPI ends follow their own read rules", () => {
  const sets: Partial<LinkEndFacts> = {
    readableSops: new Set(["sop-ok"]),
    readableGoals: new Set(["goal-ok"]),
    readableKeyResults: new Set(["kr-ok"]),
    readableKras: new Set(["KRA:kra-ok", "KPI:kpi-ok"]),
  };
  const f: LinkEndFacts = { ...facts(["list:L1"]), ...sets };
  it("shows a readable end and hides any other, a guessed or foreign id included", () => {
    expect(linkEndVisible("SOP", "sop-ok", f)).toBe(true);
    expect(linkEndVisible("SOP", "sop-hidden", f)).toBe(false);
    expect(linkEndVisible("OKR", "goal-ok", f)).toBe(true);
    expect(linkEndVisible("OKR", "goal-private", f)).toBe(false);
    expect(linkEndVisible("KEY_RESULT", "kr-ok", f)).toBe(true);
    expect(linkEndVisible("KEY_RESULT", "kr-of-private-goal", f)).toBe(false);
    expect(linkEndVisible("KRA", "kra-ok", f)).toBe(true);
    expect(linkEndVisible("KPI", "kpi-ok", f)).toBe(true);
    expect(linkEndVisible("KPI", "kra-ok", f)).toBe(false);
    expect(linkEndVisible("KRA", "kra-other-org", f)).toBe(false);
  });
  it("a Guest (empty KRA set) sees no KRA or KPI end", () => {
    const guest: LinkEndFacts = { ...f, readableKras: new Set() };
    expect(linkEndVisible("KRA", "kra-ok", guest)).toBe(false);
    expect(linkEndVisible("KPI", "kpi-ok", guest)).toBe(false);
  });
  it("drops a whole link from an open task to a private goal", () => {
    expect(linkVisible({ sourceType: "BOARD_ITEM", sourceId: "t-open", targetType: "OKR", targetId: "goal-private" }, f)).toBe(false);
    expect(linkVisible({ sourceType: "BOARD_ITEM", sourceId: "t-open", targetType: "OKR", targetId: "goal-ok" }, f)).toBe(true);
  });
  it("people and reviews still pass as before", () => {
    expect(linkEndVisible("USER", "anyone", f)).toBe(true);
    expect(linkEndVisible("REVIEW", "r1", f)).toBe(true);
  });

  const w: LinkWriteFacts = {
    ...f,
    nodeEdits: (kind, id) => kind === "list" && id === "L1",
    editableTasks: new Set(["t-open"]),
    editableFiles: new Set(),
  };
  it("adding a link from a task you edit to a SOP or goal you cannot read is not found", () => {
    expect(linkWriteVerdict({ sourceType: "BOARD_ITEM", sourceId: "t-open", targetType: "SOP", targetId: "sop-hidden" }, w)).toEqual({ ok: false, status: 404, error: "Not found" });
    expect(linkWriteVerdict({ sourceType: "BOARD_ITEM", sourceId: "t-open", targetType: "OKR", targetId: "goal-private" }, w)).toEqual({ ok: false, status: 404, error: "Not found" });
    expect(linkWriteVerdict({ sourceType: "BOARD_ITEM", sourceId: "t-open", targetType: "SOP", targetId: "sop-ok" }, w)).toEqual({ ok: true });
  });
  it("a SOP or KRA you cannot read is not a source you can add links to or remove them from", () => {
    expect(linkWriteVerdict({ sourceType: "SOP", sourceId: "sop-hidden", targetType: "BOARD_ITEM", targetId: "t-open" }, w)).toEqual({ ok: false, status: 404, error: "Not found" });
    expect(linkWriteVerdict({ sourceType: "KRA", sourceId: "kra-other-org", targetType: "BOARD_ITEM", targetId: "t-open" }, w)).toEqual({ ok: false, status: 404, error: "Not found" });
  });
});
