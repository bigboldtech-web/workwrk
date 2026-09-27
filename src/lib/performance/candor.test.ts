import { describe, expect, it } from "vitest";
import { candorStatusOf, candorTransitionBlocked, cleanCandorAnswers, normalizeCandorPrompts } from "./candor";

describe("normalizeCandorPrompts", () => {
  it("gives string prompts stable ids that survive a second read", () => {
    const once = normalizeCandorPrompts(["What should we start?", "Rate the week"]);
    expect(once.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(normalizeCandorPrompts(once)).toEqual(once);
  });
  it("keeps real ids, repairs duplicates and unknown types", () => {
    const p = normalizeCandorPrompts([{ id: "a", text: "x", type: "rating" }, { id: "a", text: "y", type: "weird" }, { text: "z" }]);
    expect(p.map((x) => x.id)).toEqual(["a", "p2", "p3"]);
    expect(p[1].type).toBe("text");
  });
});

describe("cleanCandorAnswers", () => {
  const prompts = normalizeCandorPrompts([{ id: "r", text: "Rate", type: "rating" }, { id: "t", text: "Say", type: "text" }, { id: "s", text: "SSC", type: "start_stop_continue" }]);
  it("keeps only answers to real prompts with bounded values", () => {
    const a = cleanCandorAnswers([
      { promptId: "r", value: 9 },
      { promptId: "r", value: 4 },
      { promptId: "t", value: "hello" },
      { promptId: "ghost", value: "x" },
      { promptId: "s", value: { start: "a", stop: "", continue: "c" } },
    ], prompts);
    expect(a).toEqual([
      { promptId: "r", value: 4 },
      { promptId: "t", value: "hello" },
      { promptId: "s", value: { start: "a", stop: "", continue: "c" } },
    ]);
  });
  it("answers null when nothing is usable", () => {
    expect(cleanCandorAnswers([{ promptId: "t", value: "  " }], prompts)).toBeNull();
    expect(cleanCandorAnswers("nope", prompts)).toBeNull();
  });
});

describe("candor moves", () => {
  it("launches, closes and reopens, never back to draft", () => {
    expect(candorTransitionBlocked("DRAFT", "ACTIVE")).toBeNull();
    expect(candorTransitionBlocked("ACTIVE", "CLOSED")).toBeNull();
    expect(candorTransitionBlocked("CLOSED", "ACTIVE")).toBeNull();
    expect(candorTransitionBlocked("DRAFT", "CLOSED")).not.toBeNull();
    expect(candorTransitionBlocked("ACTIVE", "DRAFT")).not.toBeNull();
  });
  it("reads Open for an active session", () => {
    expect(candorStatusOf("ACTIVE").label).toBe("Open");
  });
});
