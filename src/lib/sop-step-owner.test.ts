import { describe, expect, it } from "vitest";
import {
  availableFrom,
  contentSpawnBoardId,
  isOutOfOfficeStatus,
  pickJobTitleHolder,
  planRunPicks,
  readSopStepOrigin,
  runnableSteps,
  stepCreatesTask,
  stepJobTitle,
  withoutStoredSopTitle,
  type HolderCandidate,
} from "./sop-step-owner";
import { encodePresence } from "./people/presence-codec";
import { flowFromSteps, stepsFromFlow } from "@/components/sops/sop-steps-editor";

const NOW = new Date("2026-10-01T09:00:00Z");
const person = (over: Partial<HolderCandidate> & { id: string }): HolderCandidate => ({
  name: over.id, status: "ACTIVE", isAgent: false, deletedAt: null, presenceStatus: null, presenceUntil: null, openTasks: 0, ...over,
});

describe("pickJobTitleHolder (the soonest available rule)", () => {
  it("leaves the task unassigned with a notice when nobody holds the title, never a guess", () => {
    const p = pickJobTitleHolder([], "Onboarding lead", NOW);
    expect(p.kind).toBe("nobody");
    if (p.kind === "nobody") expect(p.notice).toContain("Nobody holds the Onboarding lead job title");
  });

  it("does not count removed people, AI agents or INACTIVE accounts as holders", () => {
    const p = pickJobTitleHolder([
      person({ id: "a", deletedAt: new Date("2026-01-01") }),
      person({ id: "b", isAgent: true }),
      person({ id: "c", status: "INACTIVE" }),
    ], "Finance", NOW);
    expect(p.kind).toBe("nobody");
  });

  it("picks the one holder who is available now", () => {
    const p = pickJobTitleHolder([person({ id: "sam" })], "Onboarding lead", NOW);
    expect(p).toMatchObject({ kind: "assigned", userId: "sam", holders: 1 });
  });

  it("prefers someone available now over someone out of office", () => {
    const p = pickJobTitleHolder([
      person({ id: "a", presenceStatus: "ooo", presenceUntil: new Date("2026-10-03T09:00:00Z") }),
      person({ id: "b", openTasks: 40 }),
    ], "Onboarding lead", NOW);
    expect(p).toMatchObject({ kind: "assigned", userId: "b" });
  });

  it("among people all out of office, picks the one back soonest", () => {
    const p = pickJobTitleHolder([
      person({ id: "a", presenceStatus: "ooo", presenceUntil: "2026-10-09T09:00:00Z" }),
      person({ id: "b", presenceStatus: "ooo", presenceUntil: "2026-10-02T09:00:00Z" }),
    ], "Onboarding lead", NOW);
    expect(p).toMatchObject({ kind: "assigned", userId: "b" });
  });

  it("breaks a tie on availability by the fewest open tasks, then by id", () => {
    expect(pickJobTitleHolder([person({ id: "a", openTasks: 5 }), person({ id: "b", openTasks: 2 })], "X", NOW)).toMatchObject({ userId: "b" });
    expect(pickJobTitleHolder([person({ id: "z", openTasks: 2 }), person({ id: "m", openTasks: 2 })], "X", NOW)).toMatchObject({ userId: "m" });
  });

  it("counts an out of office that already ended as available now", () => {
    const c = person({ id: "a", presenceStatus: "ooo", presenceUntil: "2026-09-30T09:00:00Z" });
    expect(availableFrom(c, NOW)?.getTime()).toBe(NOW.getTime());
  });

  it("leaves the task unassigned when every holder is away with no return date", () => {
    const p = pickJobTitleHolder([person({ id: "a", status: "ON_LEAVE" }), person({ id: "b", presenceStatus: "ooo" })], "Finance", NOW);
    expect(p.kind).toBe("unavailable");
    if (p.kind === "unavailable") expect(p.notice).toContain("All 2 people who hold the Finance job title are away");
  });

  it("counts people on probation, on a PIP or serving notice as working", () => {
    for (const status of ["PROBATION", "PIP", "NOTICE_PERIOD"]) {
      expect(pickJobTitleHolder([person({ id: "a", status })], "X", NOW).kind).toBe("assigned");
    }
  });
});

describe("out of office, as the product really stores it (PUT /api/me/presence)", () => {
  // Exactly what the Set status presets write: encodePresence puts the emoji
  // in front of the label, and the preset's return time goes to presenceUntil.
  const back = "2026-10-05T09:00:00Z";
  const vacation = encodePresence({ emoji: "🏖️", label: "Vacation", expiresAt: back });
  const sickToday = encodePresence({ emoji: "🤒", label: "Sick", expiresAt: "2026-10-01T23:59:00Z" });

  it("reads the Vacation and Sick presets, OOO and out of office as away, and nothing else", () => {
    expect(vacation).toBe("🏖️ Vacation");
    expect(isOutOfOfficeStatus(vacation)).toBe(true);
    expect(isOutOfOfficeStatus(sickToday)).toBe(true);
    expect(isOutOfOfficeStatus("ooo")).toBe(true);
    expect(isOutOfOfficeStatus("OOO till Monday")).toBe(true);
    expect(isOutOfOfficeStatus("✈️ Out of office")).toBe(true);
    expect(isOutOfOfficeStatus("📅 In a meeting")).toBe(false);
    expect(isOutOfOfficeStatus("📚 Focusing")).toBe(false);
    expect(isOutOfOfficeStatus("Cooool")).toBe(false);
    expect(isOutOfOfficeStatus(null)).toBe(false);
  });

  it("gives the task to the holder at work, not the one on vacation, even when the vacationer's id sorts first", () => {
    const p = pickJobTitleHolder([
      person({ id: "a-lea", presenceStatus: vacation, presenceUntil: back }),
      person({ id: "b-leo" }),
    ], "Onboarding lead", NOW);
    expect(p).toMatchObject({ kind: "assigned", userId: "b-leo" });
  });

  it("gives the task to the holder at work, not the one off sick, even with fewer open tasks", () => {
    const p = pickJobTitleHolder([
      person({ id: "a-lea", presenceStatus: sickToday, presenceUntil: "2026-10-01T23:59:00Z", openTasks: 0 }),
      person({ id: "b-leo", openTasks: 9 }),
    ], "Onboarding lead", NOW);
    expect(p).toMatchObject({ kind: "assigned", userId: "b-leo" });
  });

  it("counts the vacationer from their return time when they are the only holder", () => {
    const c = person({ id: "a", presenceStatus: vacation, presenceUntil: back });
    expect(availableFrom(c, NOW)?.toISOString()).toBe(new Date(back).toISOString());
  });

  it("treats a vacation with no return time as no known moment, and one that ended as available now", () => {
    expect(availableFrom(person({ id: "a", presenceStatus: vacation }), NOW)).toBeNull();
    expect(availableFrom(person({ id: "a", presenceStatus: vacation, presenceUntil: "2026-09-30T09:00:00Z" }), NOW)?.getTime()).toBe(NOW.getTime());
  });

  it("does not count a meeting or focus status as away", () => {
    const meeting = encodePresence({ emoji: "📅", label: "In a meeting", expiresAt: back });
    expect(availableFrom(person({ id: "a", presenceStatus: meeting, presenceUntil: back }), NOW)?.getTime()).toBe(NOW.getTime());
  });
});

describe("the stored step fields", () => {
  it("reads a job title and the create flag tolerantly", () => {
    expect(stepJobTitle({ jobTitle: { roleId: "r1", title: " Onboarding lead " } })).toEqual({ roleId: "r1", title: "Onboarding lead" });
    expect(stepJobTitle({ jobTitle: { title: "no id" } })).toBeNull();
    expect(stepJobTitle(null)).toBeNull();
    expect(stepCreatesTask({ createsTask: true })).toBe(true);
    expect(stepCreatesTask({ createsTask: "yes" })).toBe(false);
    expect(contentSpawnBoardId({ spawn: { boardId: "b1" } })).toBe("b1");
    expect(contentSpawnBoardId({})).toBeNull();
  });

  it("keeps the job title and the create flag across the flow layout and back (no silent loss on save)", () => {
    const steps = [{ id: "s1", title: "Kick off", description: "<p>x</p>", jobTitle: { roleId: "r1", title: "Onboarding lead" }, createsTask: true }, { id: "s2", title: "Plain" }];
    const flow = flowFromSteps(steps);
    const back = stepsFromFlow(flow);
    expect(back[0]).toMatchObject({ id: "s1", jobTitle: { roleId: "r1", title: "Onboarding lead" }, createsTask: true });
    expect(back[1].jobTitle).toBeUndefined();
    expect(back[1].createsTask).toBeUndefined();
  });

  it("numbers the runnable steps from the list layout, else the flow", () => {
    const list = runnableSteps({ steps: [{ id: "a", title: "One" }, { id: "b", title: "Two", createsTask: true, jobTitle: { roleId: "r", title: "T" } }] });
    expect(list.map((s) => [s.n, s.stepId, s.createsTask])).toEqual([[1, "a", false], [2, "b", true]]);
    const flow = runnableSteps({ steps: [], flow: { steps: [{ id: "f", title: "Flow step", createsTask: true }] } });
    expect(flow[0]).toMatchObject({ n: 1, stepId: "f", createsTask: true });
  });

  it("reads back the origin a spawned task stores", () => {
    const o = readSopStepOrigin({ sopStep: { sopId: "s", stepId: "st", n: 3, sopTitle: "SOP", stepTitle: "Step", runId: "run_1", jobTitle: { roleId: "r", title: "Lead" }, assignedBy: "none", notice: "Nobody" } });
    expect(o).toMatchObject({ sopId: "s", n: 3, jobTitle: { roleId: "r", title: "Lead" }, assignedBy: "none", notice: "Nobody" });
    expect(readSopStepOrigin({})).toBeNull();
  });

  it("reads an origin with no stored SOP title (runs no longer store it)", () => {
    const o = readSopStepOrigin({ sopStep: { sopId: "s", stepId: "st", n: 1, stepTitle: "Step", runId: "run_1" } });
    expect(o).toMatchObject({ sopId: "s", stepId: "st", sopTitle: "SOP" });
  });

  it("never sends a stored SOP title to a reader, and keeps the pointer a retry and the trail need", () => {
    const meta = { kraId: "k", sopStep: { sopId: "s", sopTitle: "MW flow", stepId: "f1", n: 1, runId: "run_1", stepTitle: "Flow step one" } };
    const out = withoutStoredSopTitle(meta);
    expect(JSON.stringify(out)).not.toContain("MW flow");
    expect(out).toEqual({ kraId: "k", sopStep: { sopId: "s", stepId: "f1", n: 1, runId: "run_1", stepTitle: "Flow step one" } });
    // The stored value is not changed in place.
    expect(meta.sopStep.sopTitle).toBe("MW flow");
    // Nothing to drop: the same object back.
    const plain = { a: 1 };
    expect(withoutStoredSopTitle(plain)).toBe(plain);
    expect(withoutStoredSopTitle(null)).toBeNull();
  });
});

describe("planRunPicks (one run, step by step)", () => {
  const steps = [
    { stepId: "a", n: 1, title: "One", jobTitle: { roleId: "lead", title: "Lead" }, createsTask: true },
    { stepId: "b", n: 2, title: "Two", jobTitle: null, createsTask: false },
    { stepId: "c", n: 3, title: "Three", jobTitle: { roleId: "lead", title: "Lead" }, createsTask: true },
    { stepId: "d", n: 4, title: "Four", jobTitle: { roleId: "gone", title: "Gone" }, createsTask: true },
  ];
  const holders = new Map([["lead", [person({ id: "amy" }), person({ id: "bob" })]]]);
  const titles = new Map([["lead", "Onboarding lead"]]);

  it("spreads two steps with the same job title across its holders within one run", () => {
    const plan = planRunPicks(steps, holders, titles, NOW);
    const who = plan.map((s) => (s.pick?.kind === "assigned" ? s.pick.userId : s.pick?.kind ?? null));
    expect(who).toEqual(["amy", null, "bob", "nobody"]);
    expect(plan[0].currentTitle).toBe("Onboarding lead");
  });

  it("counts nothing extra for a step a retried run already made", () => {
    const plan = planRunPicks(steps, holders, titles, NOW, new Set(["a"]));
    expect(plan[2].pick).toMatchObject({ kind: "assigned", userId: "amy" });
  });

  it("gives a deleted job title the visible nobody notice, never a guess", () => {
    const plan = planRunPicks(steps, holders, titles, NOW);
    expect(plan[3].pick).toMatchObject({ kind: "nobody" });
    expect(plan[3].currentTitle).toBeNull();
  });
});
