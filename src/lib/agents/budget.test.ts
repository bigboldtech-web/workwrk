// An AI teammate's AI questions (src/lib/agents/budget.ts): its own monthly
// limit is checked under its row's lock BEFORE the plan's question is
// claimed, so at the limit nothing is claimed at all; a plan refusal is
// ai_limit with the plan's own sentence; a turn records its AgentRun with the
// question it holds; a turn given back deletes its question and stops
// counting; and the month is the UTC month on the database's clock. The
// plan's claim is the real claimAiQuestionIn over a mocked transaction.

import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  agent: { name: "Status Reporter", cap: 40 as number | null } as null | { name: string; cap: number | null },
  /** AgentRun rows of the teammate holding a question this month. */
  used: 0,
  /** The month's first day, as the database answers it. */
  month: "2026-10-01",
  plan: "GROWTH",
  /** AIQuery rows of the workspace. */
  orgUsed: 0,
  sql: [] as string[],
  values: [] as unknown[][],
  questions: [] as Array<Record<string, unknown>>,
  runs: [] as Array<Record<string, unknown>>,
  deleted: [] as string[],
  runUpdates: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
  /** The automation's row, and its runs holding a question today (Phase 2 step 7). */
  workflow: true,
  wfUsed: 0,
}));

vi.mock("@/lib/prisma", () => {
  const queryRaw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?");
    db.sql.push(sql);
    db.values.push(values);
    if (sql.includes('FROM "Agent"')) return db.agent ? [db.agent] : [];
    if (sql.includes('FROM "AutomationWorkflow"')) return db.workflow ? [{ id: values[0] }] : [];
    if (sql.includes('"automationWorkflowId"')) return [{ used: db.wfUsed }];
    if (sql.includes('FROM "AgentRun"')) return [{ used: db.used, month: db.month }];
    if (sql.includes('FROM "Organization"')) return [{ plan: db.plan, createdAt: null }];
    if (sql.includes('INSERT INTO "AiFreeDay"')) return [{ day: "2026-10-06" }];
    if (sql.includes('DELETE FROM "AIQuery"')) {
      db.deleted.push(String(values[0]));
      return [{ freeDay: null }];
    }
    return [];
  };
  const tx = {
    $queryRaw: queryRaw,
    $executeRaw: async () => 1,
    aIQuery: {
      count: async (a?: { where?: { userId?: string } }) => (a?.where?.userId ? 0 : db.orgUsed),
      create: async (a: { data: Record<string, unknown> }) => {
        db.questions.push(a.data);
        return { id: `q${db.questions.length}` };
      },
    },
    agentRun: {
      create: async (a: { data: Record<string, unknown> }) => {
        db.runs.push(a.data);
        return { id: `run${db.runs.length}` };
      },
    },
  };
  return {
    prisma: {
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
      $queryRaw: queryRaw,
      agentRun: {
        updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          db.runUpdates.push(a);
          return { count: 1 };
        },
      },
    },
  };
});

import { AI_ACTIONS_PER_MINUTE } from "@/lib/ai-allowance";
import { agentMonthUsage, claimTeammateTurn, giveBackTurn } from "./budget";
import { AUTOMATION_TEAMMATE_COPY } from "./teammate-copy";

let n = 0;

/** A chat message's turn; each test is its own person, so the per-minute limit never leaks between tests. */
function turn(o: Partial<Parameters<typeof claimTeammateTurn>[0]> = {}) {
  n += 1;
  return claimTeammateTurn({
    organizationId: "org",
    agentId: "a1",
    userId: `person-${n}`,
    what: "AI teammate message",
    trigger: "CHAT",
    sessionId: "s1",
    routineId: null,
    practice: false,
    rateLimit: false,
    ...o,
  });
}

const lockOf = (table: string) => db.sql.findIndex((s) => s.includes(`FROM "${table}"`) && /FOR (NO KEY )?UPDATE/.test(s));

beforeEach(() => {
  db.agent = { name: "Status Reporter", cap: 40 };
  db.used = 0;
  db.month = "2026-10-01";
  db.plan = "GROWTH";
  db.orgUsed = 0;
  db.sql = [];
  db.values = [];
  db.questions = [];
  db.runs = [];
  db.deleted = [];
  db.runUpdates = [];
  db.workflow = true;
  db.wfUsed = 0;
});

describe("claimTeammateTurn for an automation (Phase 2 step 7)", () => {
  const WORKFLOW = { id: "wf1", runId: "arun1", dailyCap: 20 };

  it("records the automation and its run on the turn's run", async () => {
    db.wfUsed = 19;
    const r = await turn({ trigger: "AUTOMATION", what: "AI teammate in an automation", workflow: WORKFLOW });
    expect(r).toMatchObject({ ok: true });
    expect(db.runs.at(-1)).toMatchObject({ automationWorkflowId: "wf1", automationRunId: "arun1", input: { trigger: "AUTOMATION" } });
  });

  it("refuses the 21st ask of one automation in a UTC day, with no question claimed", async () => {
    db.wfUsed = 20;
    const r = await turn({ trigger: "AUTOMATION", workflow: WORKFLOW });
    expect(r).toMatchObject({ ok: false, code: "workflow_cap", message: AUTOMATION_TEAMMATE_COPY.dailyCap(20) });
    expect(db.questions).toEqual([]);
    expect(db.runs).toEqual([]);
    const count = db.sql.find((x) => x.includes('"automationWorkflowId"')) ?? "";
    expect(count).toContain('"questionId" IS NOT NULL');
    expect(count).toContain("date_trunc('day', now() AT TIME ZONE 'UTC')");
  });

  it("takes the teammate's and the automation's rows FOR NO KEY UPDATE, so a key check never waits on them (review round 3)", async () => {
    await turn({ trigger: "AUTOMATION", workflow: WORKFLOW });
    expect(db.sql[lockOf("Agent")]).toContain("FOR NO KEY UPDATE");
    expect(db.sql[lockOf("AutomationWorkflow")]).toContain("FOR NO KEY UPDATE");
  });

  it("locks the automation's row after the teammate's, before the plan's", async () => {
    await turn({ trigger: "AUTOMATION", workflow: WORKFLOW });
    const agent = lockOf("Agent");
    const wf = lockOf("AutomationWorkflow");
    const org = db.sql.findIndex((x) => x.includes('FROM "Organization"'));
    expect(agent).toBeGreaterThanOrEqual(0);
    expect(wf).toBeGreaterThan(agent);
    expect(org).toBeGreaterThan(wf);
  });

  it("checks nothing of the kind for a turn no automation asked for", async () => {
    await turn({ trigger: "CHAT" });
    expect(db.sql.some((x) => x.includes("AutomationWorkflow"))).toBe(false);
  });
});

describe("claimTeammateTurn", () => {
  it("records the caller's run on a delegated turn (Phase 2 step 5)", async () => {
    db.used = 0;
    const r = await turn({ trigger: "DELEGATED", parentRunId: "caller-run", what: "AI teammate delegation" });
    expect(r).toMatchObject({ ok: true });
    expect(db.runs.at(-1)).toMatchObject({ parentRunId: "caller-run", input: { trigger: "DELEGATED", practice: false, routineId: null, parentRunId: "caller-run" } });
  });

  it("refuses a delegate at its own monthly limit before any question is claimed", async () => {
    db.used = 40;
    const r = await turn({ trigger: "DELEGATED", parentRunId: "caller-run" });
    expect(r).toMatchObject({ ok: false, code: "agent_cap" });
    expect(db.questions).toEqual([]);
  });

  it("under the teammate's limit, claims one question and records the turn's run with it", async () => {
    db.used = 39;
    const r = await turn({ userId: "priya", trigger: "ROUTINE", routineId: "r1", practice: true, what: "AI teammate routine" });
    expect(r).toEqual({ ok: true, runId: "run1", questionId: "q1" });
    expect(db.questions).toEqual([{ query: "AI teammate routine", userId: "priya", organizationId: "org", freeTier: false }]);
    expect(db.runs).toEqual([
      {
        agentId: "a1",
        triggeredBy: "priya",
        actingForId: "priya",
        sessionId: "s1",
        routineId: "r1",
        questionId: "q1",
        status: "PENDING",
        input: { trigger: "ROUTINE", practice: true, routineId: "r1" },
      },
    ]);
    // The teammate's row is locked first, then the workspace's.
    expect(lockOf("Agent")).toBeGreaterThanOrEqual(0);
    expect(lockOf("Agent")).toBeLessThan(lockOf("Organization"));
  });

  it("at the teammate's limit claims nothing at all, and says when it can answer again", async () => {
    db.used = 40;
    const r = await turn();
    expect(r).toEqual({
      ok: false,
      code: "agent_cap",
      message: "Status Reporter has used its 40 AI questions for October. It can answer again on November 1 (UTC), or whoever manages it can raise the limit in its settings.",
    });
    expect(db.questions).toEqual([]);
    expect(db.runs).toEqual([]);
    // The plan was never asked: the workspace's row was not even locked.
    expect(lockOf("Organization")).toBe(-1);
  });

  it("with no limit of its own, only the plan's allowance applies", async () => {
    db.agent = { name: "Status Reporter", cap: null };
    db.used = 100_000;
    expect((await turn()).ok).toBe(true);
    expect(db.sql.some((s) => s.includes('FROM "AgentRun"'))).toBe(false);
  });

  it("answers the plan's refusal as ai_limit with the plan's own sentence, and records no run", async () => {
    db.plan = "STARTER";
    db.orgUsed = 50;
    const r = await turn();
    expect(r).toEqual({
      ok: false,
      code: "ai_limit",
      message: "This workspace has used all 50 AI questions on the Starter plan. An Owner or Admin can change the plan in Settings, Plan & billing.",
      refusedBy: "plan",
    });
    expect(db.questions).toEqual([]);
    expect(db.runs).toEqual([]);
  });

  it("counts only kept questions, in the UTC month on the database's clock", async () => {
    db.used = 3;
    await turn();
    const count = db.sql.find((s) => s.includes('FROM "AgentRun"')) ?? "";
    expect(count).toContain('"questionId" IS NOT NULL');
    expect(count).toContain("date_trunc('month', now() AT TIME ZONE 'UTC')");
    expect(db.values[db.sql.indexOf(count)]).toEqual(["a1"]);
  });

  it("names the month the database counted: a limit reached on 1 November UTC waits for 1 December", async () => {
    db.month = "2026-11-01";
    db.used = 40;
    const r = await turn();
    expect(r.ok === false && r.message).toBe(
      "Status Reporter has used its 40 AI questions for November. It can answer again on December 1 (UTC), or whoever manages it can raise the limit in its settings.",
    );
    expect(await agentMonthUsage("a1")).toEqual({ used: 40, monthStart: new Date("2026-11-01T00:00:00Z") });
  });

  it("holds the person to Ask AI's per-minute limit when asked to, before anything is claimed", async () => {
    for (let i = 0; i < AI_ACTIONS_PER_MINUTE; i += 1) expect((await turn({ userId: "busy", rateLimit: true })).ok).toBe(true);
    const before = db.questions.length;
    const r = await turn({ userId: "busy", rateLimit: true });
    expect(r).toMatchObject({ ok: false, code: "rate_limited", message: expect.stringMatching(/^Too many AI requests at once\. Try again in \d+ seconds\.$/) });
    expect(r.ok === false && typeof r.retryAfter).toBe("number");
    expect(db.questions.length).toBe(before);
    // A routine's run is not held to it.
    expect((await turn({ userId: "busy", rateLimit: false, trigger: "ROUTINE" })).ok).toBe(true);
  });

  it("claims nothing for a teammate whose row is gone", async () => {
    db.agent = null;
    expect(await turn()).toMatchObject({ ok: false, code: "not_found" });
    expect(db.questions).toEqual([]);
  });
});

describe("giveBackTurn", () => {
  it("deletes the question and stops the run counting toward the month", async () => {
    await giveBackTurn("run7", "q7");
    expect(db.deleted).toEqual(["q7"]);
    expect(db.runUpdates).toEqual([{ where: { id: "run7", questionId: "q7" }, data: { questionId: null } }]);
  });
});
