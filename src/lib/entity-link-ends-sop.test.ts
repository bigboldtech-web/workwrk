import { describe, expect, it } from "vitest";
import { linkEndVisible, linkVisible, linkWriteVerdict, type LinkEndFacts, type LinkWriteFacts } from "./entity-link-ends";

// A task an SOP run made links back to its SOP (BOARD_ITEM -> SOP, Required
// reading, context "Step 1: ..."). When that SOP is filed in a folder the
// task's reader holds no grant on, the link must not name it, count it or
// carry its step text: the whole link is dropped, as the trail drops it.

const ME = "u-eve";

function facts(readableSops?: string[]): LinkEndFacts {
  return {
    userId: ME,
    nodeOpens: (kind, id) => kind === "list" && id === "L-open",
    readableFiles: new Set(),
    ...(readableSops ? { readableSops: new Set(readableSops) } : {}),
    tasks: new Map([["t-spawned", { boardId: "L-open", ownerId: null, assigneeIds: [] }]]),
  };
}

const spawnedLink = { sourceType: "BOARD_ITEM", sourceId: "t-spawned", targetType: "SOP", targetId: "sop-restricted" };

describe("SOP ends of an entity link", () => {
  it("drops a link to a SOP the reader may not read, even on a task they can open", () => {
    expect(linkVisible(spawnedLink, facts(["sop-open"]))).toBe(false);
    expect(linkEndVisible("SOP", "sop-restricted", facts([]))).toBe(false);
  });

  it("keeps a link to a SOP the reader may read", () => {
    expect(linkVisible({ ...spawnedLink, targetId: "sop-open" }, facts(["sop-open"]))).toBe(true);
  });

  it("gates a SOP source too (a SOP page's links, read by someone the SOP is hidden from)", () => {
    const fromSop = { sourceType: "SOP", sourceId: "sop-restricted", targetType: "BOARD_ITEM", targetId: "t-spawned" };
    expect(linkVisible(fromSop, facts([]))).toBe(false);
  });

  it("passes a SOP end as before when the caller hands in no SOP decisions (the write checks)", () => {
    expect(linkVisible(spawnedLink, facts())).toBe(true);
    const write: LinkWriteFacts = { ...facts(), nodeEdits: () => true, editableTasks: new Set(["t-spawned"]), editableFiles: new Set() };
    expect(linkWriteVerdict(spawnedLink, write)).toEqual({ ok: true });
  });
});
