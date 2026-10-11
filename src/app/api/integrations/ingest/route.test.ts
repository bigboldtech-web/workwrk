// /api/integrations/ingest. Docs-found fixes batch 3: its kpi.record action
// wrote a reading for any user id it was sent, another workspace's people
// included, took any period, and answered "Ingest failed" (500) on a second
// reading for the same month; its task.create action failed the same way on
// a date that was not one. kpi.record now follows POST /api/v1/kpi-records
// (src/lib/kpi-integration.server.ts), and task.create reads its date and
// slaHours as POST /api/v1/tasks does.

import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { currentKpiPeriod } from "@/lib/kpi-period";

const st = vi.hoisted(() => ({
  records: [] as Array<{ kpiId: string; userId: string; period: string; actualValue: number; notes: string | null }>,
  tasks: [] as Array<{ dueAt: Date; legacy: { slaHours: number | null } }>,
}));

vi.mock("@/services/webhookDispatcher", () => ({ dispatchEvent: async () => undefined }));
vi.mock("@/services/performanceScoreService", () => ({ triggerRecalculation: () => undefined }));
vi.mock("@/lib/kudos-give", () => ({ kudosAftermath: async () => undefined }));
vi.mock("@/lib/work/personal-task", () => ({
  createPersonalTask: async (input: { dueAt: Date; legacy: { slaHours: number | null }; title: string }) => {
    st.tasks.push(input);
    return { id: "t1", title: input.title, dueAt: input.dueAt };
  },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    integration: { findFirst: async () => ({ id: "i1", config: { ingestSecret: "s3cret" } }) },
    kPI: { findFirst: async (a: { where: { id: string; organizationId: string } }) => (a.where.organizationId === "org" ? { id: a.where.id, targetValue: 10 } : null) },
    // Only u1 is in org; u-other is another workspace's person.
    user: { findFirst: async (a: { where: { id: string; organizationId: string } }) => (a.where.id === "u1" && a.where.organizationId === "org" ? { id: "u1" } : null) },
    kPIRecord: {
      findUnique: async (a: { where: { kpiId_userId_period: { kpiId: string; userId: string; period: string } } }) => {
        const k = a.where.kpiId_userId_period;
        const r = st.records.find((x) => x.kpiId === k.kpiId && x.userId === k.userId && x.period === k.period);
        return r ? { id: "r1", targetValue: 10, score: 50, createdAt: new Date(), ...r } : null;
      },
      create: async (a: { data: { kpiId: string; userId: string; period: string; actualValue: number; notes: string | null } }) => {
        st.records.push(a.data);
        return { id: "r1", targetValue: 10, score: 50, createdAt: new Date(), ...a.data };
      },
      update: async () => { throw new Error("not expected"); },
    },
  },
}));

import { POST } from "./route";

function ingest(action: string, data: Record<string, unknown>) {
  const raw = JSON.stringify({ action, data });
  const sig = `sha256=${createHmac("sha256", "s3cret").update(raw).digest("hex")}`;
  return POST(new Request("https://app.test/api/integrations/ingest", {
    method: "POST",
    headers: { "x-workwrk-organization": "org", "x-workwrk-signature": sig },
    body: raw,
  }) as never);
}

beforeEach(() => { st.records = []; st.tasks = []; });

describe("kpi.record", () => {
  it("never writes a reading for someone outside the workspace", async () => {
    const res = await ingest("kpi.record", { kpiId: "k1", userId: "u-other", period: currentKpiPeriod(), actualValue: 5 });
    expect(res.status).toBe(404);
    expect(st.records).toEqual([]);
  });

  it("takes a month key only, and answers a second reading instead of failing", async () => {
    expect((await ingest("kpi.record", { kpiId: "k1", userId: "u1", period: "2026-Q1", actualValue: 5 })).status).toBe(400);
    const first = await ingest("kpi.record", { kpiId: "k1", userId: "u1", period: currentKpiPeriod(), actualValue: 5 });
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ ok: true, record: { id: "r1", score: 50, actualValue: 5 } });
    expect(st.records[0].notes).toBe("Via /api/integrations/ingest");
    const again = await ingest("kpi.record", { kpiId: "k1", userId: "u1", period: currentKpiPeriod(), actualValue: 5 });
    expect(again.status).toBe(200);
    expect(st.records).toHaveLength(1);
  });
});

describe("task.create", () => {
  it("answers 400 for a date or slaHours that is not one, and makes nothing", async () => {
    expect((await ingest("task.create", { title: "T", assigneeId: "u1", date: "next tuesday-ish" })).status).toBe(400);
    expect((await ingest("task.create", { title: "T", assigneeId: "u1", slaHours: "soon" })).status).toBe(400);
    expect(st.tasks).toEqual([]);
  });

  it("reads a real date, and slaHours as a number", async () => {
    const res = await ingest("task.create", { title: "T", assigneeId: "u1", date: "2026-10-20T09:00:00Z", slaHours: "4" });
    expect(res.status).toBe(201);
    expect(st.tasks[0].dueAt.toISOString()).toBe("2026-10-20T09:00:00.000Z");
    expect(st.tasks[0].legacy.slaHours).toBe(4);
  });
});
