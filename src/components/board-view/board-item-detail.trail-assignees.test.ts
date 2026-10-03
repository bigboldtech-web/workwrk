import { describe, expect, it } from "vitest";
import { settleTrailAssignees, trailAssigneeSignature, type TrailAssigneeStamp } from "./board-item-detail";

// The Connection trail's "this task is unassigned" notice is decided by the
// server from the stored assignees, so the trail must read again once an
// assignee change has SAVED, and not on the optimistic render (that read can
// win the race with the PATCH and answer with the old assignees).
const start: TrailAssigneeStamp = { sig: "", at: "2026-10-01T10:00:00.000Z", pending: false, n: 0 };
const SAVED = "2026-10-01T10:00:05.000Z";

describe("trailAssigneeSignature", () => {
  it("prefers the resolved assignees, then the ids, then the owner", () => {
    expect(trailAssigneeSignature({ assignees: [{ id: "a", firstName: "", lastName: "", avatar: null }], assigneeIds: ["x"], ownerId: "y" })).toBe("a");
    expect(trailAssigneeSignature({ assignees: [], assigneeIds: ["x", "z"], ownerId: "x" })).toBe("x,z");
    expect(trailAssigneeSignature({ ownerId: "y" })).toBe("y");
    expect(trailAssigneeSignature({ ownerId: null })).toBe("");
  });
});

describe("settleTrailAssignees", () => {
  it("assigning someone reads the trail again once the save answers", () => {
    const optimistic = settleTrailAssignees(start, "leo", start.at);
    expect(optimistic.n).toBe(0);
    expect(optimistic.pending).toBe(true);
    const saved = settleTrailAssignees(optimistic, "leo", SAVED);
    expect(saved.n).toBe(1);
    expect(saved.pending).toBe(false);
  });

  it("removing every assignee reads again too, so the notice can come back", () => {
    const held: TrailAssigneeStamp = { sig: "leo", at: SAVED, pending: false, n: 1 };
    const cleared = settleTrailAssignees(settleTrailAssignees(held, "", SAVED), "", "2026-10-01T10:01:00.000Z");
    expect(cleared.n).toBe(2);
  });

  it("a change that comes with a new updatedAt (reload, realtime) reads at once", () => {
    expect(settleTrailAssignees(start, "leo", SAVED).n).toBe(1);
  });

  it("a host without updatedAt reads at once instead of waiting forever", () => {
    expect(settleTrailAssignees({ ...start, at: "" }, "leo", "").n).toBe(1);
  });

  it("an unrelated save does not read the trail again, and nothing changed returns the same object", () => {
    const other = settleTrailAssignees(start, "", SAVED);
    expect(other.n).toBe(0);
    expect(other.at).toBe(SAVED);
    expect(settleTrailAssignees(other, "", SAVED)).toBe(other);
  });
});
