import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/access/legacy-reach", () => ({ legacyReachOf: vi.fn() }));

import { eventAllowedForAuthor, narrowerAuthor, type AutomationAuthor } from "./author-reach";

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

describe("narrowerAuthor", () => {
  const reach = (userId: string, opts: { admin?: boolean; manager?: boolean; read: string[]; write: string[] }): AutomationAuthor => ({
    userId, admin: !!opts.admin, manager: !!opts.manager,
    canRead: async (b) => opts.read.includes(b),
    canWrite: async (b) => opts.write.includes(b),
  });
  const adminCreator = reach("admin", { admin: true, manager: true, read: ["HR", "Ops"], write: ["HR", "Ops"] });
  const managerPublisher = reach("mgr", { manager: true, read: ["Ops"], write: ["Ops"] });

  it("a run published by someone else reaches only where both people could", async () => {
    const r = narrowerAuthor(adminCreator, managerPublisher)!;
    expect(await r.canRead("HR")).toBe(false);
    expect(await r.canWrite("HR")).toBe(false);
    expect(await r.canRead("Ops")).toBe(true);
    expect(await r.canWrite("Ops")).toBe(true);
    expect(r.admin).toBe(false);
    expect(r.manager).toBe(true);
    expect(r.userId).toBe("admin");
  });

  it("the creator's own publish is unchanged, and a departed person reaches nothing", () => {
    expect(narrowerAuthor(adminCreator, reach("admin", { read: [], write: [] }))).toBe(adminCreator);
    expect(narrowerAuthor(adminCreator, null)).toBeNull();
    expect(narrowerAuthor(null, managerPublisher)).toBeNull();
  });
});
