// /api/cron/run-due-agents, each tick (docs/plans/ai-teammates.md 3.9 and
// docs/plans/ai-teammates-phase2.md step 2): the approval sweep first, then
// the due AI teammate routines with their own budget, then the move of the
// old Workspace agents schedules onto routines. A step that throws fails the
// tick but never stops the steps after it, and the body is counts only. The
// old autonomous loop is gone: no agent runs here except through a routine.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  order: [] as string[],
  sweepActions: vi.fn(),
  processDueRoutines: vi.fn(),
  convertLegacySchedules: vi.fn(),
}));

vi.mock("@/lib/email", () => ({ queueEmail: async () => {} }));
vi.mock("@/lib/cron-auth", () => ({ cronRefusal: () => null }));
vi.mock("@/lib/prisma", () => ({ prisma: { emailLog: { findFirst: async () => null } } }));
vi.mock("@/lib/agents/actions", () => ({ sweepActions: st.sweepActions }));
vi.mock("@/lib/agents/routines-server", () => ({ processDueRoutines: st.processDueRoutines }));
vi.mock("@/lib/agents/legacy-schedules", () => ({ convertLegacySchedules: st.convertLegacySchedules }));

import * as autonomous from "@/lib/agents/autonomous";
import { POST } from "./route";

const run = async () => {
  const res = await POST(new Request("https://app.example.test/api/cron/run-due-agents", { method: "POST" }) as never);
  return { status: res.status, body: await res.json() };
};

const COUNTS = { due: 3, succeeded: 2, failed: 0, skipped: 0, missed: 1, paused: 0, taken: 0, deferred: 0 };
const MOVED = { found: 3, moved: 1, stopped: 2, taken: 0, failed: 0 };

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-06T09:00:00Z"), toFake: ["Date"] });
  st.order = [];
  st.sweepActions.mockReset().mockImplementation(async () => {
    st.order.push("sweep");
    return { expired: 2, stuck: 1 };
  });
  st.processDueRoutines.mockReset().mockImplementation(async () => {
    st.order.push("routines");
    return COUNTS;
  });
  st.convertLegacySchedules.mockReset().mockImplementation(async () => {
    st.order.push("legacy");
    return MOVED;
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("one tick", () => {
  it("sweeps first, then runs the routines with their own budget, then moves the old schedules", async () => {
    const out = await run();
    expect(out.status).toBe(200);
    expect(st.order).toEqual(["sweep", "routines", "legacy"]);
    const now = st.sweepActions.mock.calls[0][0] as Date;
    expect(now.toISOString()).toBe("2026-10-06T09:00:00.000Z");
    expect(st.processDueRoutines).toHaveBeenCalledWith(now, { limit: 20, budgetMs: 180_000, concurrency: 4 });
    expect(st.convertLegacySchedules).toHaveBeenCalledWith(now, { limit: 100 });
  });

  it("answers in counts only, naming nobody", async () => {
    const { body } = await run();
    expect(body).toMatchObject({ actions: { expired: 2, stuck: 1 }, routines: COUNTS, legacySchedules: MOVED });
    for (const v of [...Object.values(body.actions), ...Object.values(body.routines), ...Object.values(body.legacySchedules)]) expect(typeof v).toBe("number");
    expect(body).not.toHaveProperty("runs");
  });

  it("still runs every later step when one throws, and fails the tick", async () => {
    st.sweepActions.mockRejectedValueOnce(new Error("sweep down"));
    st.processDueRoutines.mockRejectedValueOnce(new Error("routines down"));
    const out = await run();
    expect(st.order).toEqual(["legacy"]);
    expect(out.status).toBe(500);
    expect(out.body).toMatchObject({ actions: null, routines: null, legacySchedules: MOVED });
  });

  it("fails the tick when the move throws, after the routines ran", async () => {
    st.convertLegacySchedules.mockRejectedValueOnce(new Error("move down"));
    const out = await run();
    expect(st.order).toEqual(["sweep", "routines"]);
    expect(out.status).toBe(500);
    expect(out.body).toMatchObject({ routines: COUNTS, legacySchedules: null });
  });
});

describe("the old autonomous loop", () => {
  it("is gone: the module keeps only the next-run reader (Phase 2)", () => {
    const m = autonomous as unknown as Record<string, unknown>;
    expect(m.runAgentAutonomously).toBeUndefined();
    expect(Object.keys(m).filter((k) => typeof m[k] === "function")).toEqual(["computeNextRunAt"]);
  });
});
