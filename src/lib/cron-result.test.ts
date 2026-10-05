import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A cron run that failed answers non-2xx (curl -fsS in the crontab logs it as
// a failure) and alerts ops at most once per job in six hours.
const state = vi.hoisted(() => ({ recent: false, queued: [] as Array<{ to: string; subject: string }>, html: [] as string[] }));

vi.mock("@/lib/prisma", () => ({
  prisma: { emailLog: { findFirst: async () => (state.recent ? { id: "x" } : null) } },
}));
vi.mock("@/lib/email", () => ({
  queueEmail: async (p: { to: string; subject: string; html: string }) => { state.queued.push({ to: p.to, subject: p.subject }); state.html.push(p.html); },
}));

import { cronJob, cronResult } from "./cron-result";

describe("cronResult", () => {
  beforeEach(() => {
    state.recent = false;
    state.queued.length = 0;
    state.html.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("OPS_ALERT_EMAIL", "ops@example.test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("answers 200 and alerts nobody when nothing failed", async () => {
    const res = await cronResult("reminders", { fired: 3 }, 0);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ fired: 3 });
    expect(state.queued).toHaveLength(0);
  });

  it("answers 500 with the body, and queues one alert", async () => {
    const res = await cronResult("org-hard-delete", { failures: [{ id: "o1", error: "x" }] }, 1);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ failures: [{ id: "o1", error: "x" }] });
    expect(state.queued).toEqual([{ to: "ops@example.test", subject: "WorkwrK: the org-hard-delete job failed" }]);
  });

  it("points the alert at the log that names the job (pm2's), not the crontab's", async () => {
    await cronResult("org-hard-delete", {}, 1);
    expect(state.html[0]).toContain('pm2 logs workwrk --nostream --lines 2000 | grep -F "[cron-failure] org-hard-delete"');
    expect(state.html[0]).not.toContain("workwrk-cron.log");
  });

  it("answers a run that THROWS as a failed run: 500, a [cron-failure] line and the alert (cronJob)", async () => {
    const thrower = cronJob("review-cycles", async () => {
      throw new Error("connection terminated");
    });
    const res = await thrower(new Request("https://app.example.test/api/cron/review-cycles", { method: "POST" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ran: false });
    expect(vi.mocked(console.error).mock.calls.some((c) => String(c[0]).startsWith("[cron-failure] review-cycles"))).toBe(true);
    expect(state.queued).toEqual([{ to: "ops@example.test", subject: "WorkwrK: the review-cycles job failed" }]);
    const fine = cronJob("kpi-reminders", async () => Response.json({ ran: true }));
    expect((await fine(new Request("https://app.example.test/api/cron/kpi-reminders", { method: "POST" }))).status).toBe(200);
  });

  it("does not alert again within six hours, or with no address set", async () => {
    state.recent = true;
    expect((await cronResult("email-queue", {}, 2)).status).toBe(500);
    state.recent = false;
    vi.stubEnv("OPS_ALERT_EMAIL", "");
    expect((await cronResult("email-queue", {}, 2, 503)).status).toBe(503);
    expect(state.queued).toHaveLength(0);
  });
});
