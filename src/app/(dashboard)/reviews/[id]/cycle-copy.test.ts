import { describe, expect, it } from "vitest";
import { audienceInSentence, audiencePhrase, calibrationConfirmText, launchConfirmText, launchNobodyText } from "./cycle-types";

describe("calibrationConfirmText", () => {
  it("never tells the runner that anyone not done can still submit", () => {
    const t = calibrationConfirmText({ total: 23, selfDone: 0, managerDone: 0 });
    expect(t).not.toMatch(/Anyone not done yet can still submit/);
    expect(t).toMatch(/^Self reviews close now: 23 people have not sent one and cannot anymore\./);
    expect(t).toMatch(/23 manager reviews are still to come and can still be submitted/);
  });
  it("names one person in the singular", () => {
    expect(calibrationConfirmText({ total: 1, selfDone: 0, managerDone: 0 })).toBe(
      "Self reviews close now: 1 person has not sent one and cannot anymore. 1 manager review is still to come and can still be submitted, but a submitted one can no longer be changed.",
    );
  });
  it("says everything is in when it is", () => {
    expect(calibrationConfirmText({ total: 4, selfDone: 4, managerDone: 4 })).toBe(
      "Every self review is in. Every manager review is in, and none can be changed after this.",
    );
  });
  it("falls back to the rule without a count", () => {
    expect(calibrationConfirmText(null)).toMatch(/^Self reviews close now: anyone who has not submitted theirs cannot anymore\./);
  });
});

describe("launch confirm", () => {
  it("names the people count and who they are", () => {
    expect(launchConfirmText({ count: 24, audienceType: "ALL", named: null, covers: null, clipped: false })).toBe(
      "This creates a review for 24 people (everyone in the company) and emails each of them.",
    );
    expect(launchConfirmText({ count: 1, audienceType: "USERS", named: 1, covers: null, clipped: true })).toBe(
      "This creates a review for 1 person (the person it names who is in your reporting line) and emails each of them.",
    );
  });
  it("keeps a department's own spelling", () => {
    expect(launchConfirmText({ count: 3, audienceType: "DEPARTMENTS", named: null, covers: "PC walk dept", clipped: false })).toBe(
      "This creates a review for 3 people (the people in PC walk dept) and emails each of them.",
    );
  });
  it("never offers Launch for nobody", () => {
    const p = { count: 0, audienceType: "USERS", named: 2, covers: null, clipped: true };
    expect(launchConfirmText(p)).toBeNull();
    expect(launchNobodyText(p)).toMatch(/^Nobody active is covered \(the 2 people it names who are in your reporting line\)/);
  });
  it("a manager's Everyone cycle is their line, never the company", () => {
    expect(audiencePhrase({ audienceType: "ALL", named: null, covers: null, clipped: true })).toBe("everyone in your reporting line");
  });
});

describe("audienceInSentence", () => {
  it("lowercases the fixed words only", () => {
    expect(audienceInSentence("Everyone")).toBe("everyone");
    expect(audienceInSentence("3 people")).toBe("3 people");
    expect(audienceInSentence("1 person")).toBe("1 person");
    expect(audienceInSentence("PC walk dept")).toBe("PC walk dept");
    expect(audienceInSentence("Engineering, Sales")).toBe("Engineering, Sales");
    expect(audienceInSentence(null)).toBeNull();
  });
});
