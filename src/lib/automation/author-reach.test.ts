import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/access/legacy-reach", () => ({ legacyReachOf: vi.fn() }));

import { eventAllowedForAuthor, narrowerAuthor, runReach, type AutomationAuthor } from "./author-reach";

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

describe("runReach", () => {
  const reach = (userId: string, write: string[]): AutomationAuthor => ({
    userId, admin: false, manager: false,
    canRead: async (b) => write.includes(b) || b === "open",
    canWrite: async (b) => write.includes(b),
  });
  const people: Record<string, AutomationAuthor | null> = {
    creator: reach("creator", ["L1", "L2", "HR"]),
    publisher: reach("publisher", ["L1", "L2"]),
    retrier: reach("retrier", ["L1"]),
    gone: null,
  };
  const loads: string[] = [];
  const load = async (id: string) => { loads.push(id); return people[id] ?? null; };

  it("an automation with nobody on record keeps the behaviour it always had", async () => {
    expect(await runReach(load, { creatorId: null, publisherId: null })).toBeUndefined();
  });

  it("caps by everyone whose choice is in what runs, the retrier included, and the creator stays the run's person", async () => {
    const run = await runReach(load, { creatorId: "creator", publisherId: "publisher" });
    expect(await run!.canWrite("L2")).toBe(true);
    expect(await run!.canWrite("HR")).toBe(false);
    const retried = await runReach(load, { creatorId: "creator", publisherId: "publisher", retrierId: "retrier" });
    expect(await retried!.canWrite("L2")).toBe(false);
    expect(await retried!.canWrite("L1")).toBe(true);
    expect(retried!.userId).toBe("creator");
  });

  it("a row with no creator is capped by its publisher, never by nobody", async () => {
    const run = await runReach(load, { creatorId: null, publisherId: "publisher" });
    expect(run!.userId).toBe("publisher");
    expect(await run!.canWrite("HR")).toBe(false);
  });

  it("anyone no longer in the workspace makes the run reach no List, and one person is read once", async () => {
    expect(await runReach(load, { creatorId: "creator", publisherId: "gone" })).toBeNull();
    loads.length = 0;
    await runReach(load, { creatorId: "creator", publisherId: "creator" });
    expect(loads).toEqual(["creator"]);
  });
});
