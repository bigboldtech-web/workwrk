// Who may save or publish an AI teammate step, and what a run's other
// viewers read of it (docs/plans/ai-teammates-phase2.md step 7).

import { describe, expect, it, vi } from "vitest";

const usable = vi.hoisted(() => ({ slugs: new Set<string>(["t-triage"]) }));
vi.mock("@/lib/agents/teammate-server", () => ({
  loadTeammate: async (slug: string) => (usable.slugs.has(slug) ? { id: "a1", slug, name: "Triage", status: "ENABLED" } : null),
}));

import type { Viewer } from "@/lib/access/types";
import { AUTOMATION_TEAMMATE_COPY } from "@/lib/agents/teammate-copy";
import { hideTeammateAnswers, teammateStepProblem, teammateStepSlugs } from "./teammate-step";

const viewer = { userId: "u-max", organizationId: "org1" } as Viewer;
const withStep = (slug: string) => ({ actions: [{ key: "add_comment", params: { body: "x" } }, { key: "ask_teammate", params: { teammate: slug, request: "Summarise {{title}}" } }] });

describe("teammateStepProblem", () => {
  it("lets anything without a teammate step through", async () => {
    expect(await teammateStepProblem({ actions: [{ key: "add_comment", params: {} }] }, { saverId: "u-olivia", creatorId: "u-max", viewer })).toBeNull();
  });

  it("refuses anyone but the creator a teammate step, as 403", async () => {
    expect(await teammateStepProblem(withStep("t-triage"), { saverId: "u-olivia", creatorId: "u-max", viewer })).toEqual({
      status: 403,
      error: AUTOMATION_TEAMMATE_COPY.creatorOnly,
      code: "teammate_step_creator_only",
    });
    expect(await teammateStepProblem(withStep("t-triage"), { saverId: "u-max", creatorId: null, viewer })).toMatchObject({ status: 403 });
  });

  it("refuses a teammate the creator cannot use, as 400", async () => {
    expect(await teammateStepProblem(withStep("t-olivias-private"), { saverId: "u-max", creatorId: "u-max", viewer })).toEqual({
      status: 400,
      error: AUTOMATION_TEAMMATE_COPY.teammateNotFound,
      code: "teammate_not_found",
    });
    expect(await teammateStepProblem(withStep(""), { saverId: "u-max", creatorId: "u-max", viewer })).toMatchObject({ code: "teammate_not_found" });
  });

  it("lets the creator save one with their own teammate", async () => {
    expect(await teammateStepProblem(withStep("t-triage"), { saverId: "u-max", creatorId: "u-max", viewer })).toBeNull();
  });

  it("reads every action shape the engine reads", () => {
    expect(teammateStepSlugs({ actions: [{ action: "ask_teammate", config: { teammate: "a" } }, { type: "ask_teammate", params: { teammate: "b" } }, { key: "x" }] })).toEqual(["a", "b"]);
    expect(teammateStepSlugs(null)).toEqual([]);
  });
});

describe("hideTeammateAnswers", () => {
  const steps = [
    { order: 0, stepType: "TRIGGER", stepKey: "task.created", outputJson: {} },
    { order: 1, stepType: "ACTION", stepKey: "create_notification", outputJson: { notificationId: "n1" } },
    { order: 2, stepType: "ACTION", stepKey: "ask_teammate", inputJson: { teammate: "t-salary-coach", request: "Summarise {{title}}" } as unknown, outputJson: { teammate: "Salary Coach", answer: "Max's 1:1 notes say...", agentRunId: "r1" } },
    { order: 3, stepType: "ACTION", stepKey: "create_task", outputJson: { title: "Max's 1:1 notes say..." } },
  ];

  it("hides the answer and what every later action returned, and keeps the rest", () => {
    const out = hideTeammateAnswers(steps);
    expect(out[1].outputJson).toEqual({ notificationId: "n1" });
    // Nor which teammate: its name and slug are its person's (review round 1).
    expect(out[2].outputJson).toEqual({ answerHidden: true });
    expect(out[3].outputJson).toEqual({ outputHidden: true });
    expect(JSON.stringify(out)).not.toContain("1:1 notes");
    expect(out[2].inputJson).toEqual({ teammate: null, request: "Summarise {{title}}" });
    expect(JSON.stringify(out)).not.toMatch(/Salary Coach|t-salary-coach/);
  });

  it("claims no hidden answer for a step that returned nothing (review round 4)", () => {
    // As the engine stores a failed step: status FAILED, output {} (review round 5).
    const failed = [
      { order: 1, stepType: "ACTION", stepKey: "ask_teammate", status: "FAILED", inputJson: { teammate: "t-salary-coach", request: "x" } as unknown, outputJson: {} as unknown },
      { order: 2, stepType: "ACTION", stepKey: "add_comment", status: "FAILED", outputJson: {} as unknown },
      { order: 3, stepType: "ACTION", stepKey: "add_comment", status: "SUCCESS", outputJson: { body: "x" } as unknown },
    ];
    const out = hideTeammateAnswers(failed);
    expect(out.map((s) => s.outputJson)).toEqual([{}, {}, { outputHidden: true }]);
    expect(out[0].inputJson).toEqual({ teammate: null, request: "x" });
  });

  it("changes nothing in a run without a teammate step", () => {
    expect(hideTeammateAnswers([steps[0], steps[1]])).toEqual([steps[0], steps[1]]);
  });
});

describe("teammateSlugsUsableBy (a copy's teammate steps; review round 2)", () => {
  it("keeps a teammate the new owner can use and empties one they cannot", async () => {
    const { teammateSlugsUsableBy } = await import("./teammate-step");
    const def = { actions: [{ key: "ask_teammate", params: { teammate: "t-triage", request: "a" } }, { key: "ask_teammate", params: { teammate: "t-olivias-private", request: "b" } }, { key: "add_comment", params: {} }] };
    const out = await teammateSlugsUsableBy(def, viewer);
    expect(out.actions).toEqual([
      { key: "ask_teammate", params: { teammate: "t-triage", request: "a" } },
      { key: "ask_teammate", params: { teammate: null, request: "b" } },
      { key: "add_comment", params: {} },
    ]);
  });
});
