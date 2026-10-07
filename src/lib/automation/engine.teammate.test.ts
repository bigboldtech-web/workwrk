// The engine and an "Ask an AI teammate" step (docs/plans/ai-teammates-phase2.md
// step 7): a later step reads the answer of the last teammate step that
// succeeded; the step runs with its workflow's name and publisher; and a run
// whose teammate step failed is never handed to the retry cron (asking again
// would spend again).

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const st = vi.hoisted(() => ({
  actions: [] as Row[],
  seen: [] as Array<{ key: string; ctx: Row }>,
  teammateFails: false,
  /** The step (counted from 1) whose teammate fails. */
  failAt: 0,
  finished: [] as Row[],
  steps: [] as Row[],
  /** An older row with no published version runs its draft. */
  noVersion: false,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    automationWorkflow: {
      // Three people (review round 6): Max made it, Olivia published the live
      // version, Sam last saved the draft. The run's publisher is Olivia.
      findMany: async () => [{ id: "wf1", name: "Support triage", severity: "MINOR", definition: { actions: st.actions }, publishedVersionId: st.noVersion ? null : "v1", createdById: "u-max", updatedById: "u-sam" }],
      update: async () => ({}),
    },
    automationWorkflowVersion: { findMany: async () => (st.noVersion ? [] : [{ id: "v1", definitionJson: { actions: st.actions }, createdById: "u-olivia" }]) },
    organization: { findUnique: async () => ({ settings: {} }) },
    automationRun: {
      count: async () => 0,
      create: async () => ({ id: "run1" }),
      update: async (a: { data: Row }) => void st.finished.push(a.data),
    },
    automationRunStep: { create: async (a: { data: Row }) => void st.steps.push(a.data) },
  },
}));
vi.mock("./usage", () => ({ getUsageState: async () => ({ blocked: false, used: 0, limit: 100 }), recordUsage: async () => {}, notifyLimitExceeded: async () => {} }));
vi.mock("./author-reach", () => ({
  runReach: async () => undefined,
  loadAuthor: async () => null,
  authorCanRead: async () => true,
  eventAllowedForAuthor: () => true,
}));
vi.mock("./registry-triggers", () => ({ triggerDisplayName: (k: string) => k }));
vi.mock("./registry-actions", () => {
  const record = (key: string) => async (ctx: Row) => {
    st.seen.push({ key, ctx });
    if (key === "ask_teammate" && (st.teammateFails || st.seen.length === st.failAt)) throw new Error("Triage didn't answer.");
    if (key === "ask_teammate") return { teammate: "Triage", teammateSlug: "t-triage", answer: `Answer ${st.seen.length}`, waiting: 0, agentRunId: "r1" };
    return { ok: true };
  };
  const ACTIONS: Record<string, Row> = {
    ask_teammate: { key: "ask_teammate", name: "Ask an AI teammate", safeToRetry: false, execute: record("ask_teammate") },
    add_comment: { key: "add_comment", name: "Add a comment", safeToRetry: false, execute: record("add_comment") },
    create_notification: { key: "create_notification", name: "Notify", safeToRetry: true, execute: record("create_notification") },
  };
  return { getAction: (k: string) => ACTIONS[k] };
});

import { runAutomationForWorkflow, teammateStepData } from "./engine";

const fire = () => runAutomationForWorkflow({ organizationId: "org1", event: "task.created", payload: { id: "i1", title: "Printer down", createdAt: "2026-10-07T10:00:00Z" }, workflowId: "wf1" });

beforeEach(() => {
  st.seen = [];
  st.teammateFails = false;
  st.failAt = 0;
  st.finished = [];
  st.steps = [];
  st.noVersion = false;
});

describe("an Ask an AI teammate step in a run", () => {
  it("hands its answer to the steps after it, never to the ones before", async () => {
    st.actions = [
      { key: "create_notification", params: {} },
      { key: "ask_teammate", params: { teammate: "t-triage", request: "Summarise {{title}}" } },
      { key: "add_comment", params: { body: "{{teammate.answer}}" } },
    ];
    expect(await fire()).toBe(1);
    expect(st.seen.map((s) => s.key)).toEqual(["create_notification", "ask_teammate", "add_comment"]);
    expect(st.seen[0].ctx.stepData).toEqual({});
    expect(st.seen[2].ctx.stepData).toEqual({ teammate: { answer: "Answer 2", name: "Triage" } });
    // The step runs knowing which automation, and who published what runs.
    expect(st.seen[1].ctx).toMatchObject({ workflowName: "Support triage", publisherId: "u-olivia", workflowCreatorId: "u-max" });
  });

  it("runs as whoever last saved the draft when no version is published (review round 6)", async () => {
    st.noVersion = true;
    st.actions = [{ key: "ask_teammate", params: { teammate: "t-triage", request: "x" } }];
    await fire();
    expect(st.seen[0].ctx).toMatchObject({ publisherId: "u-sam", workflowCreatorId: "u-max" });
  });

  it("leaves no answer when a later teammate step fails, never the earlier one's (review round 1)", async () => {
    st.failAt = 2;
    st.actions = [
      { key: "ask_teammate", params: {} },
      { key: "ask_teammate", params: {} },
      { key: "add_comment", params: {} },
    ];
    await fire();
    expect(st.seen.map((s) => s.key)).toEqual(["ask_teammate", "ask_teammate", "add_comment"]);
    expect(st.seen[2].ctx.stepData).toEqual({ teammateFailed: true });
  });

  it("gives a run whose teammate step failed no retry state", async () => {
    st.teammateFails = true;
    st.actions = [
      { key: "ask_teammate", params: {} },
      { key: "create_notification", params: {} },
    ];
    await fire();
    const done = st.finished.at(-1) ?? {};
    expect(done.status).toBe("PARTIAL");
    expect(done.triggerPayload).toBeUndefined();
    expect(st.seen[1].ctx.stepData).toEqual({ teammateFailed: true });
    expect(st.seen[1].ctx.teammateInRun).toBe(true);
  });

  it("reads an output's answer and name, and nothing else", () => {
    expect(teammateStepData({ answer: "A", teammate: "T", agentRunId: "r" })).toEqual({ teammate: { answer: "A", name: "T" } });
    expect(teammateStepData(null)).toEqual({ teammate: { answer: "", name: "" } });
  });
});

describe("stepDataBefore (a retried step, src/lib/automation/retry.ts)", () => {
  it("rebuilds the latest teammate step's answer before the step, and none when that one failed", async () => {
    const { stepDataBefore } = await import("./retry");
    const steps = [
      { order: 1, stepType: "ACTION", stepKey: "ask_teammate", status: "SUCCESS", outputJson: { answer: "First", teammate: "Triage" } },
      { order: 2, stepType: "ACTION", stepKey: "ask_teammate", status: "FAILED", outputJson: {} },
      { order: 3, stepType: "ACTION", stepKey: "create_notification", status: "FAILED", outputJson: {} },
      { order: 4, stepType: "ACTION", stepKey: "ask_teammate", status: "SUCCESS", outputJson: { answer: "Later", teammate: "Triage" } },
    ];
    expect(stepDataBefore(steps, 3)).toEqual({ teammateFailed: true });
    expect(stepDataBefore(steps, 2)).toEqual({ teammate: { answer: "First", name: "Triage" } });
    expect(stepDataBefore(steps, 5)).toEqual({ teammate: { answer: "Later", name: "Triage" } });
    expect(stepDataBefore(steps, 1)).toEqual({});
  });

  it("knows a run has a teammate step wherever it sits (review round 4)", async () => {
    const { teammateInSteps } = await import("./retry");
    expect(teammateInSteps([{ stepType: "ACTION", stepKey: "assign_user" }, { stepType: "ACTION", stepKey: "ask_teammate" }])).toBe(true);
    expect(teammateInSteps([{ stepType: "CONDITION", stepKey: "ask_teammate" }, { stepType: "ACTION", stepKey: "assign_user" }])).toBe(false);
  });
});
