import { describe, expect, it } from "vitest";
import { DRAFT_PREFIXES, draftKey } from "./draft-keys";

describe("performance draft keys", () => {
  it("carry the user, so two people on one browser never share a draft", () => {
    expect(draftKey("review-self:", "u1", "c1")).not.toBe(draftKey("review-self:", "u2", "c1"));
    expect(draftKey("workwrk:candor-answers:", "u1", "s1")).toBe("workwrk:candor-answers:u:u1:s1");
  });
  it("start with a prefix the sign-out sweep clears", () => {
    for (const p of DRAFT_PREFIXES) expect(DRAFT_PREFIXES.some((q) => draftKey(p, "u", "o").startsWith(q))).toBe(true);
  });
});
