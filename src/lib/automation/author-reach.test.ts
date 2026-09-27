import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/access/legacy-reach", () => ({ legacyReachOf: vi.fn() }));

import { eventAllowedForAuthor } from "./author-reach";

const member = { userId: "u1", admin: false, manager: false };
const manager = { userId: "u2", admin: false, manager: true };
const admin = { userId: "u3", admin: true, manager: true };

describe("eventAllowedForAuthor", () => {
  it("lets every creator run on task and time events", () => {
    for (const a of [member, manager, admin]) {
      expect(eventAllowedForAuthor("task.status_changed", {}, a)).toBe(true);
      expect(eventAllowedForAuthor("schedule.every", {}, a)).toBe(true);
    }
  });
  it("a Member's automation runs on a review or KPI only when it is about them", () => {
    expect(eventAllowedForAuthor("review.completed", { userId: "someone" }, member)).toBe(false);
    expect(eventAllowedForAuthor("review.completed", { userId: "u1" }, member)).toBe(true);
    expect(eventAllowedForAuthor("kpi.recorded", { userId: "someone" }, member)).toBe(false);
    expect(eventAllowedForAuthor("kpi.recorded", { userId: "someone" }, manager)).toBe(true);
  });
  it("never runs a Member's automation on the Cashkr-era sales events", () => {
    expect(eventAllowedForAuthor("lead.created", {}, member)).toBe(false);
    expect(eventAllowedForAuthor("quote.accepted", {}, member)).toBe(false);
    expect(eventAllowedForAuthor("lead.created", {}, admin)).toBe(true);
  });
  it("a creator no longer in the workspace reaches no person events", () => {
    expect(eventAllowedForAuthor("review.completed", { userId: "u1" }, null)).toBe(false);
    expect(eventAllowedForAuthor("task.created", {}, null)).toBe(true);
  });
});
