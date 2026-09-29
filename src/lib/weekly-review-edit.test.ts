import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { weeklyEditRefusal } from "./weekly-review";

const now = new Date("2026-09-30T10:00:00Z"); // a Wednesday
const thisWeek = new Date("2026-09-28T00:00:00Z");
const lastWeek = new Date("2026-09-21T00:00:00Z");

describe("weeklyEditRefusal", () => {
  it("lets this week's draft or submitted review change", () => {
    expect(weeklyEditRefusal({ status: "DRAFT", managerStatus: null, periodStart: thisWeek }, "save", now)).toBeNull();
    expect(weeklyEditRefusal({ status: "SUBMITTED", managerStatus: "PENDING", periodStart: thisWeek }, "reopen", now)).toBeNull();
  });
  it("never reopens or edits a week the manager approved", () => {
    expect(weeklyEditRefusal({ status: "ACKNOWLEDGED", managerStatus: "APPROVED", periodStart: thisWeek }, "reopen", now)).toMatch(/approved/);
    expect(weeklyEditRefusal({ status: "ACKNOWLEDGED", managerStatus: "APPROVED", periodStart: thisWeek }, "save", now)).toMatch(/approved/);
  });
  it("a week with changes requested only reopens", () => {
    expect(weeklyEditRefusal({ status: "ACKNOWLEDGED", managerStatus: "CHANGES_REQUESTED", periodStart: thisWeek }, "reopen", now)).toBeNull();
    expect(weeklyEditRefusal({ status: "ACKNOWLEDGED", managerStatus: "CHANGES_REQUESTED", periodStart: thisWeek }, "save", now)).toMatch(/Reopen/);
  });
  it("a past week is a record", () => {
    expect(weeklyEditRefusal({ status: "DRAFT", managerStatus: null, periodStart: lastWeek }, "save", now)).toMatch(/this week/);
  });
  it("keeps a day's slack at the Monday boundary for time zones", () => {
    const mondayMorning = new Date("2026-09-28T09:00:00Z");
    expect(weeklyEditRefusal({ status: "DRAFT", managerStatus: null, periodStart: lastWeek }, "submit", mondayMorning)).toBeNull();
  });
});
