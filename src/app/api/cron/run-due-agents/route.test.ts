// /api/cron/run-due-agents, each tick (docs/plans/ai-teammates.md 3.9): the
// approval sweep first, then the due AI teammate routines with their own
// budget, then the autonomous agents with what is left of a 260-second
// deadline. A teammate step that throws fails the tick but never stops the
// agents, and the body adds counts only for teammates.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  order: [] as string[],
  agents: [] as Array<Record<string, unknown>>,
  sweepActions: vi.fn(),
  processDueRoutines: vi.fn(),
  runAgentAutonomously: vi.fn(),
}));

vi.mock("@/lib/email", () => ({ queueEmail: async () => {} }));
vi.mock("@/lib/cron-auth", () => ({ cronRefusal: () => null }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    agent: {
      findMany: async () => {
        st.order.push("agents");
        return st.agents;
      },
      update: async () => ({}),
    },
    emailLog: { findFirst: async () => null },
  },
}));
vi.mock("@/lib/agents/actions", () => ({ sweepActions: st.sweepActions }));
vi.mock("@/lib/agents/routines-server", () => ({ processDueRoutines: st.processDueRoutines }));
vi.mock("@/lib/agents/autonomous", () => ({
  computeNextRunAt: () => new Date("2026-10-06T10:00:00Z"),
  runAgentAutonomously: st.runAgentAutonomously,
}));

import { POST } from "./route";

const run = async () => {
  const res = await POST(new Request("https://app.example.test/api/cron/run-due-agents", { method: "POST" }) as never);
  return { status: res.status, body: await res.json() };
};

const COUNTS = { due: 3, succeeded: 2, failed: 0, skipped: 0, missed: 1, paused: 0, taken: 0, deferred: 0 };

function legacyAgent(slug: string) {
  return { id: `a-${slug}`, slug, name: slug, organizationId: "org1", scheduleCron: "0 9 * * *", organization: { settings: {} } };
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-06T09:00:00Z"), toFake: ["Date"] });
  st.order = [];
  st.agents = [legacyAgent("deal-desk")];
  st.sweepActions.mockReset().mockImplementation(async () => {
    st.order.push("sweep");
    return { expired: 2, stuck: 1 };
  });
  st.processDueRoutines.mockReset().mockImplementation(async () => {
    st.order.push("routines");
    return COUNTS;
  });
  st.runAgentAutonomously.mockReset().mockImplementation(async (a: { agentId: string }) => {
    st.order.push(`run:${a.agentId}`);
    return { status: "SUCCEEDED", runId: "run1", errorText: undefined, keySource: "shared" };
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("one tick", () => {
  it("sweeps first, then runs the routines with their own budget, then the agents", async () => {
    const out = await run();
    expect(out.status).toBe(200);
    expect(st.order).toEqual(["sweep", "routines", "agents", "run:a-deal-desk"]);
    const now = st.sweepActions.mock.calls[0][0] as Date;
    expect(now.toISOString()).toBe("2026-10-06T09:00:00.000Z");
    expect(st.processDueRoutines).toHaveBeenCalledWith(now, { limit: 20, budgetMs: 180_000, concurrency: 4 });
  });

  it("adds the teammates' counts to the body and names nobody in them", async () => {
    const { body } = await run();
    expect(body).toMatchObject({ firedCount: 1, skippedAiOff: [], deferred: 0, actions: { expired: 2, stuck: 1 }, routines: COUNTS });
    for (const v of [...Object.values(body.actions), ...Object.values(body.routines)]) expect(typeof v).toBe("number");
  });

  it("still runs the agents when a teammate step throws, and fails the tick", async () => {
    st.sweepActions.mockRejectedValueOnce(new Error("sweep down"));
    st.processDueRoutines.mockRejectedValueOnce(new Error("routines down"));
    const out = await run();
    expect(st.order).toEqual(["agents", "run:a-deal-desk"]);
    expect(out.status).toBe(500);
    expect(out.body).toMatchObject({ firedCount: 1, actions: null, routines: null });
  });

  it("gives the agents only what is left of the tick's 260 seconds", async () => {
    st.agents = [legacyAgent("deal-desk"), legacyAgent("status-check")];
    st.processDueRoutines.mockImplementationOnce(async () => {
      st.order.push("routines");
      // The routines used the tick: 261 seconds have passed.
      vi.setSystemTime(new Date("2026-10-06T09:04:21Z"));
      return COUNTS;
    });
    const out = await run();
    expect(st.runAgentAutonomously).not.toHaveBeenCalled();
    expect(out.body).toMatchObject({ firedCount: 0, deferred: 2 });
    expect(out.status).toBe(200);
  });
});
