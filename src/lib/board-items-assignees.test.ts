// The owner-only assignee patch — the rule that stops a list-row owner
// change from deleting the rest of the task's assignees.
//
// Reported by the founder: "from the list row he cannot assign people, but
// inside the opened task he can". The row wrote ownerId alone, and the old
// server rule turned that into assigneeIds = [ownerId]. Three assignees
// became one, with no warning and no undo. Every case below is written from
// the direction of DATA SURVIVAL: what was on the task before must still be
// on the task after, unless the patch explicitly said otherwise.

import { describe, it, expect } from "vitest";
import { applyHandoverAssignees, applyOwnerOnlyPatch } from "@/lib/board-items-shared";

describe("applyOwnerOnlyPatch — setting an owner", () => {
  it("keeps all three assignees when the owner changes (the reported bug)", () => {
    const out = applyOwnerOnlyPatch(["a", "b", "c"], "a", "b");
    expect(out.assigneeIds).toEqual(["b", "a", "c"]);
    expect(out.ownerId).toBe("b");
  });

  it("moves the new owner to the front and preserves everyone else's order", () => {
    const out = applyOwnerOnlyPatch(["a", "b", "c", "d"], "a", "c");
    expect(out.assigneeIds).toEqual(["c", "a", "b", "d"]);
  });

  it("adds an owner who was not yet an assignee without dropping anyone", () => {
    const out = applyOwnerOnlyPatch(["a", "b"], "a", "z");
    expect(out.assigneeIds).toEqual(["z", "a", "b"]);
    expect(out.ownerId).toBe("z");
  });

  it("never duplicates the owner when they are already the owner", () => {
    const out = applyOwnerOnlyPatch(["a", "b", "c"], "a", "a");
    expect(out.assigneeIds).toEqual(["a", "b", "c"]);
    expect(out.ownerId).toBe("a");
  });

  it("assigns onto an empty task", () => {
    const out = applyOwnerOnlyPatch([], null, "a");
    expect(out.assigneeIds).toEqual(["a"]);
    expect(out.ownerId).toBe("a");
  });

  it("repairs a legacy row whose ownerId never made it into assigneeIds", () => {
    const out = applyOwnerOnlyPatch([], "legacy", "b");
    expect(out.assigneeIds).toEqual(["b", "legacy"]);
    expect(out.ownerId).toBe("b");
  });

  it("dedupes a stored set that already carried a repeat", () => {
    const out = applyOwnerOnlyPatch(["a", "b", "a"], "a", "b");
    expect(out.assigneeIds).toEqual(["b", "a"]);
  });

  it("tolerates a null stored set", () => {
    const out = applyOwnerOnlyPatch(null, null, "a");
    expect(out.assigneeIds).toEqual(["a"]);
  });
});

describe("applyOwnerOnlyPatch — unassigning the owner", () => {
  it("removes only the outgoing owner and promotes the next assignee", () => {
    const out = applyOwnerOnlyPatch(["a", "b", "c"], "a", null);
    expect(out.assigneeIds).toEqual(["b", "c"]);
    expect(out.ownerId).toBe("b");
  });

  it("empties the task only when the owner was the sole assignee", () => {
    const out = applyOwnerOnlyPatch(["a"], "a", null);
    expect(out.assigneeIds).toEqual([]);
    expect(out.ownerId).toBeNull();
  });

  it("is a no-op set-wise when there was no owner to remove", () => {
    const out = applyOwnerOnlyPatch(["a", "b"], null, null);
    expect(out.assigneeIds).toEqual(["a", "b"]);
    expect(out.ownerId).toBe("a");
  });

  it("stays empty on an already unassigned task", () => {
    const out = applyOwnerOnlyPatch([], null, null);
    expect(out.assigneeIds).toEqual([]);
    expect(out.ownerId).toBeNull();
  });

  it("keeps ownerId equal to assigneeIds[0] in every branch", () => {
    for (const next of ["b", "z", null] as const) {
      const out = applyOwnerOnlyPatch(["a", "b", "c"], "a", next);
      expect(out.ownerId).toBe(out.assigneeIds[0] ?? null);
    }
  });
});

// ── Offboarding handover ────────────────────────────────────────────
//
// The handover route wrote ownerId alone, which left rows where ownerId was
// NOT assigneeIds[0] — the invariant applyOwnerOnlyPatch reads a row's history
// from. Every case below is written from the direction the reviewer proved:
// what must survive the handover, and what must not come back afterwards.
describe("applyHandoverAssignees — offboarding", () => {
  it("hands the task to the recipient and keeps everybody else on it", () => {
    expect(applyHandoverAssignees(["leaver", "x", "y"], "leaver", "recipient")).toEqual([
      "recipient",
      "x",
      "y",
    ]);
  });

  it("takes the offboarded person off, so an unassign cannot promote them back", () => {
    const next = applyHandoverAssignees(["leaver", "x"], "leaver", "recipient");
    expect(next).not.toContain("leaver");
    // The whole point: with the set repaired, the next unassign drops the
    // recipient and promotes a real remaining assignee, not the leaver.
    const after = applyOwnerOnlyPatch(next, next[0], null);
    expect(after.ownerId).toBe("x");
    expect(after.assigneeIds).toEqual(["x"]);
  });

  it("leaves ownerId === assigneeIds[0] true for the row it writes", () => {
    const next = applyHandoverAssignees(["leaver"], "leaver", "recipient");
    expect(next[0]).toBe("recipient");
    // And the repair branch has nothing to repair, so it invents nobody.
    expect(applyOwnerOnlyPatch(next, "recipient", "newperson")).toEqual({
      assigneeIds: ["newperson", "recipient"],
      ownerId: "newperson",
    });
  });

  it("does not duplicate the recipient when they were already an assignee", () => {
    expect(applyHandoverAssignees(["leaver", "recipient", "x"], "leaver", "recipient")).toEqual([
      "recipient",
      "x",
    ]);
  });

  it("drops junk without dropping people", () => {
    expect(applyHandoverAssignees(["leaver", "   ", "x"], "leaver", "recipient")).toEqual([
      "recipient",
      "x",
    ]);
  });

  it("handles a legacy row with no assignee set at all", () => {
    expect(applyHandoverAssignees(null, "leaver", "recipient")).toEqual(["recipient"]);
    expect(applyHandoverAssignees([], "leaver", "recipient")).toEqual(["recipient"]);
  });
});

// ── Whitespace ids ──────────────────────────────────────────────────
describe("applyOwnerOnlyPatch — junk ids", () => {
  it("does not carry a whitespace-only id forward as a permanent assignee", () => {
    const out = applyOwnerOnlyPatch(["a", "   ", "b"], "a", "b");
    expect(out.assigneeIds).toEqual(["b", "a"]);
  });
});
