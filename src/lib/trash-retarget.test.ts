import { describe, expect, it } from "vitest";
import { retargetTaskSnapshot } from "./trash-retarget";
import { projectRowMetadata } from "./list-metadata";

// Task T lived in home H (budget 1) and was linked into B, where B's own
// values were budget 42 and stage "b-only". H is gone; T is restored to B.
const snapshot = () => ({
  row: { id: "T", boardId: "H", title: "t", metadata: { budget: 1, description: "body", $lists: { B: { budget: 42, stage: "b-only" } } } },
  children: {
    subtasks: [
      { id: "S1", boardId: "H", parentItemId: "T", metadata: { budget: 3, $lists: { B: { stage: "sub-b" } } } },
      { id: "S2", boardId: "X", parentItemId: "T", metadata: { budget: 9, $lists: { B: { stage: "moved-away" } } } },
    ],
    listLinks: [
      { itemId: "T", boardId: "B", position: 1, createdAt: "2026-09-01T00:00:00.000Z" },
      { itemId: "T", boardId: "C", position: 2, createdAt: "2026-09-02T00:00:00.000Z" },
    ],
  },
});

type Snap = ReturnType<typeof snapshot>;

describe("retargetTaskSnapshot", () => {
  it("lifts the target List's own values to the top when the task was linked into it", () => {
    const out = retargetTaskSnapshot(snapshot(), "B") as Snap;
    expect(out.row.boardId).toBe("B");
    expect(out.row.metadata).toEqual({ description: "body", budget: 42, stage: "b-only", $lists: { H: { budget: 1 } } });
    // What B's readers now see as the home is what they saw in B before.
    const home = projectRowMetadata(out.row.metadata, { kind: "home", contextStoredKeys: new Set(["budget", "stage"]), contextConnectKeys: new Set(), readable: new Set() });
    expect(home.metadata).toEqual({ description: "body", budget: 42, stage: "b-only" });
  });

  it("uses the old home's field keys when they are known, parking only those", () => {
    const s = snapshot();
    (s.row.metadata as Record<string, unknown>).loose = "not a field of H";
    const out = retargetTaskSnapshot(s, "B", { fromKeys: ["budget"] }) as Snap;
    expect(out.row.metadata).toEqual({ description: "body", loose: "not a field of H", budget: 42, stage: "b-only", $lists: { H: { budget: 1 } } });
  });

  it("swaps a same-home subtask with its parent, and not one moved elsewhere on its own", () => {
    const out = retargetTaskSnapshot(snapshot(), "B") as Snap;
    expect(out.children.subtasks.map((t) => t.boardId)).toEqual(["B", "B"]);
    expect(out.children.subtasks[0].metadata).toEqual({ stage: "sub-b", $lists: { H: { budget: 3 } } });
    expect(out.children.subtasks[1].metadata).toEqual({ budget: 9, $lists: { B: { stage: "moved-away" } } });
  });

  it("drops only the link into the new home", () => {
    const out = retargetTaskSnapshot(snapshot(), "B") as Snap;
    expect(out.children.listLinks.map((l) => l.boardId)).toEqual(["C"]);
  });

  it("is today's retarget exactly when the task was NOT linked into the target, stale namespace or not", () => {
    const out = retargetTaskSnapshot(snapshot(), "Z") as Snap;
    expect(out.row).toEqual({ ...snapshot().row, boardId: "Z" });
    expect(out.children.subtasks.map((t) => t.metadata)).toEqual(snapshot().children.subtasks.map((t) => t.metadata));
    // A namespace for B left behind by a removed link is not what B shows.
    const s = snapshot();
    s.children.listLinks = s.children.listLinks.filter((l) => l.boardId !== "B");
    const stale = retargetTaskSnapshot(s, "B") as Snap;
    expect(stale.row.metadata).toEqual(snapshot().row.metadata);
  });

  it("never mutates the stored snapshot, and passes a non-object through", () => {
    const s = snapshot();
    const before = JSON.stringify(s);
    retargetTaskSnapshot(s, "B");
    expect(JSON.stringify(s)).toBe(before);
    expect(retargetTaskSnapshot(null, "B")).toBeNull();
  });
});
