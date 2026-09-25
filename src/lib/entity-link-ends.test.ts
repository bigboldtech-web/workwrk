import { describe, expect, it } from "vitest";
import { linkEndVisible, linkVisible, type LinkEndFacts } from "./entity-link-ends";

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
