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
  sweepStaleRuns: vi.fn(),
  sweepConnections: vi.fn(),
  finishErasures: vi.fn(),
}));

vi.mock("@/lib/email", () => ({ queueEmail: async () => {} }));
vi.mock("@/lib/cron-auth", () => ({ cronRefusal: () => null }));
vi.mock("@/lib/prisma", () => ({ prisma: { emailLog: { findFirst: async () => null } } }));
vi.mock("@/lib/agents/actions", () => ({ sweepActions: st.sweepActions }));
vi.mock("@/lib/agents/budget", () => ({ sweepStaleRuns: st.sweepStaleRuns }));
vi.mock("@/lib/agents/routines-server", () => ({ processDueRoutines: st.processDueRoutines }));
vi.mock("@/lib/agents/legacy-schedules", () => ({ convertLegacySchedules: st.convertLegacySchedules }));
vi.mock("@/lib/connectors/connections", () => ({ sweepConnections: st.sweepConnections }));
vi.mock("@/lib/agents/erasure-sweep", () => ({ finishErasures: st.finishErasures }));

import * as autonomous from "@/lib/agents/autonomous";
import { POST } from "./route";

const run = async () => {
  const res = await POST(new Request("https://app.example.test/api/cron/run-due-agents", { method: "POST" }) as never);
  return { status: res.status, body: await res.json() };
};

const COUNTS = { due: 3, succeeded: 2, failed: 0, skipped: 0, missed: 1, paused: 0, taken: 0, deferred: 0 };
const MOVED = { found: 3, moved: 1, stopped: 2, taken: 0, failed: 0 };
const SWEPT = { statesExpired: 2, leavers: 1, revoked: 3, kept: 1, dropped: 0 };
const ERASED = { found: 2, blanked: 1500, finished: 1, waiting: 1, failed: 0, overdue: 0, bridged: 0 };

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-06T09:00:00Z"), toFake: ["Date"] });
  st.order = [];
  st.sweepActions.mockReset().mockImplementation(async () => {
    st.order.push("sweep");
    return { expired: 2, stuck: 1 };
  });
  st.sweepStaleRuns.mockReset().mockImplementation(async () => {
    st.order.push("stale");
    return 1;
  });
  st.processDueRoutines.mockReset().mockImplementation(async () => {
    st.order.push("routines");
    return COUNTS;
  });
  st.convertLegacySchedules.mockReset().mockImplementation(async () => {
    st.order.push("legacy");
    return MOVED;
  });
  st.sweepConnections.mockReset().mockImplementation(async () => {
    st.order.push("connectors");
    return SWEPT;
  });
  st.finishErasures.mockReset().mockImplementation(async () => {
    st.order.push("erasures");
    return ERASED;
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
    expect(st.order).toEqual(["sweep", "stale", "routines", "legacy", "connectors", "erasures"]);
    const now = st.sweepActions.mock.calls[0][0] as Date;
    expect(now.toISOString()).toBe("2026-10-06T09:00:00.000Z");
    expect(st.processDueRoutines).toHaveBeenCalledWith(now, { limit: 200, budgetMs: 120_000, concurrency: 10 });
    expect(st.convertLegacySchedules).toHaveBeenCalledWith(now, { limit: 100 });
    // Step 4 (docs/plans/ai-teammates-phase3.md step 2): within its own budget,
    // 500 revokes a tick (review round 1 of Phase 3: 50 left a large queue for hours).
    expect(st.sweepConnections).toHaveBeenCalledWith(now, { leaversLimit: 500, revokeLimit: 500, budgetMs: 20_000 });
    // Step 5 (review round 5 of Phase 3): the erasures' words, within their own budget.
    expect(st.finishErasures).toHaveBeenCalledWith(now, { limit: 50, budgetMs: 20_000 });
  });

  it("answers in counts only, naming nobody", async () => {
    const { body } = await run();
    expect(body).toMatchObject({ actions: { expired: 2, stuck: 1 }, staleRuns: 1, routines: COUNTS, legacySchedules: MOVED, connectors: SWEPT, erasures: ERASED });
    for (const v of [...Object.values(body.actions), ...Object.values(body.routines), ...Object.values(body.legacySchedules), ...Object.values(body.connectors), ...Object.values(body.erasures)]) expect(typeof v).toBe("number");
    expect(body).not.toHaveProperty("runs");
  });

  it("still runs every later step when one throws, and fails the tick", async () => {
    st.sweepActions.mockRejectedValueOnce(new Error("sweep down"));
    st.sweepStaleRuns.mockRejectedValueOnce(new Error("stale down"));
    st.processDueRoutines.mockRejectedValueOnce(new Error("routines down"));
    const out = await run();
    expect(st.order).toEqual(["legacy", "connectors", "erasures"]);
    expect(out.status).toBe(500);
    expect(out.body).toMatchObject({ actions: null, staleRuns: null, routines: null, legacySchedules: MOVED, connectors: SWEPT });
  });

  it("fails the tick when the connector sweep throws, after every other step ran", async () => {
    st.sweepConnections.mockRejectedValueOnce(new Error("sweep down"));
    const out = await run();
    expect(st.order).toEqual(["sweep", "stale", "routines", "legacy", "erasures"]);
    expect(out.status).toBe(500);
    expect(out.body).toMatchObject({ routines: COUNTS, legacySchedules: MOVED, connectors: null, erasures: ERASED });
  });

  it("fails the tick when a schedule did not move, so someone is told (review of step 2)", async () => {
    st.convertLegacySchedules.mockResolvedValueOnce({ found: 2, moved: 1, stopped: 0, taken: 0, failed: 1 });
    const out = await run();
    expect(out.status).toBe(500);
    expect(out.body.legacySchedules).toMatchObject({ failed: 1 });
  });

  // Review round 4 of Phase 3: a queued revoke no key opens was dropped in
  // silence; now it is kept, and the tick fails so the ops alert goes out
  // before the seven days after which it is dropped.
  it("fails the tick when queued revokes could not be opened with the sealing key", async () => {
    st.sweepConnections.mockResolvedValueOnce({ ...SWEPT, kept: 4, unopenable: 3 });
    const out = await run();
    // Before: 200, nobody told.
    expect(out.status).toBe(500);
    expect(out.body.connectors).toMatchObject({ unopenable: 3 });
    expect((await run()).status).toBe(200);
  });

  // Review round 5 of Phase 3: the erasure's words are blanked after its
  // transaction commits, and this step finishes what it left.
  it("finishes the account erasures last, with its count in the body, and fails the tick when it throws or a pass failed", async () => {
    const ok = await run();
    expect(ok.status).toBe(200);
    // Before: no erasure step, so words the erasure's own pass left stayed for good.
    expect(ok.body.erasures).toEqual(ERASED);
    st.finishErasures.mockRejectedValueOnce(new Error("sweep down"));
    const threw = await run();
    expect(threw.status).toBe(500);
    expect(threw.body).toMatchObject({ connectors: SWEPT, erasures: null });
    st.finishErasures.mockResolvedValueOnce({ ...ERASED, failed: 1 });
    const failed = await run();
    expect(failed.status).toBe(500);
    expect(failed.body.erasures).toMatchObject({ failed: 1 });
  });

  // Review round 6 of Phase 3: an erasure that could never finish stayed
  // unfinished with no alert (and was dropped after 30 days). One still not
  // finished three days after it was asked now fails the tick, so ops is told.
  it("fails the tick when an account erasure is overdue, with nothing else failed", async () => {
    st.finishErasures.mockResolvedValueOnce({ ...ERASED, failed: 0, overdue: 1 });
    const overdue = await run();
    // Before: 200, nobody told.
    expect(overdue.status).toBe(500);
    expect(overdue.body.erasures).toMatchObject({ failed: 0, overdue: 1 });
    expect((await run()).status).toBe(200);
  });

  it("fails the tick when the move throws, after the routines ran", async () => {
    st.convertLegacySchedules.mockRejectedValueOnce(new Error("move down"));
    const out = await run();
    expect(st.order).toEqual(["sweep", "stale", "routines", "connectors", "erasures"]);
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
