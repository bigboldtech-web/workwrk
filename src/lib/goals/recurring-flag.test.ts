// The RECURRING_GOALS switch (docs/plans/recurring-goals.md 2.0): off by
// default, on only for "1" or "true", read at call time as MCP_OFFERED is.
// Fails on the code before step 1: the module does not exist.

import { afterEach, describe, expect, it } from "vitest";

import { RECURRING_GOALS_OFF, recurringGoalsOn } from "./recurring-flag";

const saved = process.env.RECURRING_GOALS;
afterEach(() => {
  if (saved === undefined) delete process.env.RECURRING_GOALS;
  else process.env.RECURRING_GOALS = saved;
});

describe("recurringGoalsOn", () => {
  it("is off when the variable is unset", () => {
    delete process.env.RECURRING_GOALS;
    expect(recurringGoalsOn()).toBe(false);
  });

  it("is on for 1 or true, in any case, with spaces around", () => {
    for (const v of ["1", "true", "TRUE", " True ", "1\n"]) {
      process.env.RECURRING_GOALS = v;
      expect(recurringGoalsOn(), JSON.stringify(v)).toBe(true);
    }
  });

  it("is off for anything else", () => {
    for (const v of ["", "0", "false", "off", "yes", "on", "2", "truthy"]) {
      process.env.RECURRING_GOALS = v;
      expect(recurringGoalsOn(), JSON.stringify(v)).toBe(false);
    }
  });

  it("reads the variable at call time, so turning it off takes effect without a reload", () => {
    process.env.RECURRING_GOALS = "1";
    expect(recurringGoalsOn()).toBe(true);
    process.env.RECURRING_GOALS = "0";
    expect(recurringGoalsOn()).toBe(false);
  });

  it("refuses in plain words", () => {
    expect(RECURRING_GOALS_OFF).toBe("Repeating goals are not turned on.");
    expect(RECURRING_GOALS_OFF).not.toMatch(/—|–|--/);
  });
});
