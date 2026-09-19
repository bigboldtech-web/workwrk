import { describe, it, expect } from "vitest";
import { describeItemActivity } from "./item-activity-describe";
import { ITEM_ACTIVITY_ACTIONS } from "./item-activity-kinds";

// The guard that matters: every action this product writes has a sentence.
// Without it, the next action added to the vocabulary silently reappears in the
// Activity tab as "start changed" — which is the bug this module removed.
describe("describeItemActivity completeness", () => {
  it("gives every declared action a sentence that is not the snake_case fallback", () => {
    // COMMENTED's real sentence happens to be its own snake_case form, so the
    // "not the fallback" heuristic cannot tell them apart. It is listed here
    // rather than weakening the check for every other action.
    const SENTENCE_EQUALS_FALLBACK = new Set(["COMMENTED"]);
    for (const action of ITEM_ACTIVITY_ACTIONS) {
      const fallback = action.toLowerCase().replace(/_/g, " ");
      const out = describeItemActivity({ action, meta: {} });
      if (!SENTENCE_EQUALS_FALLBACK.has(action)) {
        expect(out, `${action} fell through to the fallback`).not.toBe(fallback);
      }
      expect(out.length, `${action} rendered empty`).toBeGreaterThan(0);
    }
  });

  it("never prints the arrow glyph", () => {
    for (const action of ITEM_ACTIVITY_ACTIONS) {
      expect(describeItemActivity({ action, meta: { from: "a", to: "b" } })).not.toContain("→");
    }
  });

  it("still renders an unknown action as words rather than throwing", () => {
    expect(describeItemActivity({ action: "SOME_FUTURE_THING" })).toBe("some future thing");
  });
});

describe("describeItemActivity wording", () => {
  const statusLabel = (v: string) => (v === "TO_DO" ? "To do" : v === "DONE" ? "Done" : v);
  const personName = (id: string) => ({ u1: "Ada Lovelace", u2: "Grace Hopper" })[id] ?? null;
  const dateLabel = (iso: string) => iso.slice(0, 10);

  it("resolves status labels on both ends", () => {
    expect(
      describeItemActivity({ action: "STATUS_CHANGED", meta: { from: "TO_DO", to: "DONE" } }, { statusLabel }),
    ).toBe("changed status from To do to Done");
  });

  it("names the people added and removed", () => {
    expect(
      describeItemActivity(
        { action: "ASSIGNEES_CHANGED", meta: { added: ["u1"], removed: ["u2"] } },
        { personName },
      ),
    ).toBe("added Ada Lovelace and removed Grace Hopper as assignees");
  });

  it("counts people it cannot name instead of printing an id", () => {
    const out = describeItemActivity(
      { action: "ASSIGNEES_CHANGED", meta: { added: ["cmu6xikt5xvupmpvmw499cz5r"] } },
      { personName: () => null },
    );
    expect(out).not.toContain("cmu6x");
    expect(out).toBe("added someone as an assignee");
  });

  it("tells set, changed and cleared apart for dates", () => {
    expect(describeItemActivity({ action: "DUE_CHANGED", meta: { from: null, to: "2026-10-01T00:00:00.000Z" } }, { dateLabel }))
      .toBe("set the due date to 2026-10-01");
    expect(describeItemActivity({ action: "DUE_CHANGED", meta: { from: "2026-10-01T00:00:00.000Z", to: null } }, { dateLabel }))
      .toBe("cleared the due date");
    expect(describeItemActivity({ action: "START_CHANGED", meta: { from: "2026-09-01T00:00:00.000Z", to: "2026-09-08T00:00:00.000Z" } }, { dateLabel }))
      .toBe("changed the start date from 2026-09-01 to 2026-09-08");
  });

  it("names the fields that moved", () => {
    expect(describeItemActivity({ action: "FIELDS_UPDATED", meta: { fields: ["description"] } }))
      .toBe("updated description");
  });

  it("reports the subtasks a move carried with it", () => {
    expect(
      describeItemActivity({ action: "MOVED", meta: { subtasksMoved: 2, fromStatus: "TO_DO", toStatus: "TO_DO" } }),
    ).toBe("moved this task to another List with 2 subtasks");
  });
});
