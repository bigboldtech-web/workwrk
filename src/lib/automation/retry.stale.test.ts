// failStaleRuns (src/lib/automation/retry.ts): a run whose process stopped
// part way stays RUNNING and reads "Running" in Logs for good; each tick of
// the automation-retry cron closes one past the window as not finished
// (review round 5). An AI teammate step can keep a run going for minutes.

import { describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ updates: [] as Array<Record<string, unknown>>, sql: [] as string[], reads: 0 }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    automationRun: {
      updateMany: async (a: Record<string, unknown>) => (st.updates.push(a), { count: 2 }),
      findMany: async () => (st.reads++, []),
    },
    $queryRaw: async (strings: TemplateStringsArray) => (st.sql.push(strings.join("?")), []),
  },
}));

import { RUN_STALE_MS, STALE_RUN_MESSAGE, failStaleRuns, processAutomationRetries } from "./retry";

describe("processAutomationRetries' scan (review round 8)", () => {
  it("reads only runs that still hold retry state, so failures that can't be retried never fill its places", async () => {
    expect(await processAutomationRetries()).toEqual({ scanned: 0, retried: 0, recovered: 0 });
    expect(st.sql[0]).toContain(`"triggerPayload" ? '__retryState'`);
    expect(st.sql[0]).toContain("LIMIT 100");
    // Nothing due: no run is loaded.
    expect(st.reads).toBe(0);
  });
});

describe("failStaleRuns", () => {
  it("fails only RUNNING runs started before the window, saying they didn't finish", async () => {
    const now = new Date("2026-10-08T10:00:00Z");
    expect(await failStaleRuns(now)).toBe(2);
    expect(st.updates).toEqual([
      {
        where: { status: "RUNNING", startedAt: { lt: new Date(now.getTime() - RUN_STALE_MS) } },
        data: { status: "FAILED", completedAt: now, errorMessage: STALE_RUN_MESSAGE },
      },
    ]);
    expect(RUN_STALE_MS).toBe(2 * 60 * 60 * 1000);
    expect(STALE_RUN_MESSAGE).not.toMatch(/—|--/);
  });
});
