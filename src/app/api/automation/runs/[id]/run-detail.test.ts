// GET /api/automation/runs/[id] (docs/plans/ai-teammates-phase2.md step 7,
// Decision 23): an AI teammate step's answer, and what every later action
// returned, are read only by the automation's creator and by Owners and
// Admins. A manager who may edit every automation still reads them hidden
// (review round 4: nothing pinned the route's own choice).

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const st = vi.hoisted(() => ({ ctx: null as Row | null }));

const ANSWER = "Max's 1:1 notes say he wants to move teams.";

vi.mock("@/lib/automation/gate", () => ({
  requireAutomation: async () => st.ctx,
  // A manager holds edit on every automation: the answers must not follow it.
  workflowRights: () => ({ edit: true }),
}));
vi.mock("@/lib/automation/registry-actions", () => ({
  getAction: (key: string) => ({ name: key === "ask_teammate" ? "Ask an AI teammate" : "Add a comment", safeToRetry: key !== "ask_teammate" }),
}));
vi.mock("@/lib/automation/registry-triggers", () => ({ triggerDisplayName: () => "A task is created" }));
vi.mock("@/lib/automation/run-records-server", () => ({
  resolveRunRecords: async () => ({ canSeeDetail: () => true, record: () => null }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    automationRun: {
      findFirst: async () => ({
        id: "run1",
        organizationId: "org1",
        status: "SUCCESS",
        recordType: "task",
        recordId: "i1",
        triggerEventKey: "task.created",
        triggerPayload: { title: "Printer down" },
        workflow: { id: "wf1", name: "Support triage", status: "ACTIVE", severity: "MINOR", createdById: "u-max" },
        steps: [
          { id: "s0", order: 0, stepType: "TRIGGER", stepKey: "task.created", stepName: "task.created", status: "SUCCESS", inputJson: {}, outputJson: {}, errorMessage: null },
          { id: "s1", order: 1, stepType: "ACTION", stepKey: "ask_teammate", stepName: "ask_teammate", status: "SUCCESS", inputJson: { teammate: "t-salary-coach", request: "Summarise {{title}}" }, outputJson: { teammate: "Salary Coach", answer: ANSWER }, errorMessage: null },
          { id: "s2", order: 2, stepType: "ACTION", stepKey: "add_comment", stepName: "add_comment", status: "SUCCESS", inputJson: { body: "{{teammate.answer}}" }, outputJson: { body: ANSWER }, errorMessage: null },
        ],
      }),
    },
  },
}));

import { GET } from "./route";

const as = (userId: string, isAdmin: boolean) => {
  st.ctx = { userId, orgId: "org1", canCreate: true, canManage: true, isAdmin, viewer: { userId, organizationId: "org1" } };
};

async function open(): Promise<{ steps: Row[] }> {
  const res = await GET(new Request("https://app.example.test/api/automation/runs/run1") as never, { params: Promise.resolve({ id: "run1" }) });
  return ((await res.json()) as { run: { steps: Row[] } }).run;
}

beforeEach(() => {
  st.ctx = null;
});

describe("a run with an AI teammate step, in the Logs drawer", () => {
  it("hides the answer and every later output from a manager who did not make it", async () => {
    as("u-mia", false);
    const run = await open();
    expect(run.steps[1].outputJson).toEqual({ answerHidden: true });
    expect(run.steps[1].inputJson).toEqual({ teammate: null, request: "Summarise {{title}}" });
    expect(run.steps[2].outputJson).toEqual({ outputHidden: true });
    expect(JSON.stringify(run)).not.toMatch(/1:1 notes|Salary Coach|t-salary-coach/);
  });

  it("shows them whole to the creator and to an Admin", async () => {
    for (const [user, admin] of [["u-max", false], ["u-olivia", true]] as const) {
      as(user, admin);
      const run = await open();
      expect(run.steps[1].outputJson).toEqual({ teammate: "Salary Coach", answer: ANSWER });
      expect(run.steps[2].outputJson).toEqual({ body: ANSWER });
    }
  });
});
