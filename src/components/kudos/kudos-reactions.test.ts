import { describe, expect, it } from "vitest";
import { reactionRetryNeeded, toggleReaction } from "./kudos-reactions";

// What the row shows mid-flight and whether a Try again still has to send
// anything are the two things a failed reaction can get wrong. The request
// carries the wanted state (see src/lib/kudos-reaction.test.ts), so a resend
// cannot undo a reaction; skipping one the person already made by hand just
// spares the round trip.

describe("toggleReaction", () => {
  it("adds my reaction and bumps the chip", () => {
    const next = toggleReaction([{ emoji: "🔥", count: 1 }], [], "🔥");
    expect(next.counts).toEqual([{ emoji: "🔥", count: 2 }]);
    expect(next.mine).toEqual(["🔥"]);
  });

  it("removes my reaction and drops a chip that reaches zero", () => {
    const next = toggleReaction([{ emoji: "🔥", count: 1 }, { emoji: "🙌", count: 3 }], ["🔥"], "🔥");
    expect(next.counts).toEqual([{ emoji: "🙌", count: 3 }]);
    expect(next.mine).toEqual([]);
  });

  it("never mutates what it was given, so a rollback restores the real row", () => {
    const counts = [{ emoji: "🔥", count: 1 }];
    const mine: string[] = [];
    toggleReaction(counts, mine, "🔥");
    expect(counts).toEqual([{ emoji: "🔥", count: 1 }]);
    expect(mine).toEqual([]);
  });
});

describe("reactionRetryNeeded", () => {
  it("resends a failed add after the rollback took it off", () => {
    expect(reactionRetryNeeded([], "🔥", true)).toBe(true);
  });

  it("resends a failed remove after the rollback put it back", () => {
    expect(reactionRetryNeeded(["🔥"], "🔥", false)).toBe(true);
  });

  it("sends nothing when the person already added it by hand before Try again", () => {
    expect(reactionRetryNeeded(["🔥"], "🔥", true)).toBe(false);
  });

  it("sends nothing when the person already removed it by hand before Try again", () => {
    expect(reactionRetryNeeded(["🙌"], "🔥", false)).toBe(false);
  });
});
