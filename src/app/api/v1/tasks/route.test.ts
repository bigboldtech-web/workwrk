// POST /api/v1/tasks. Docs-found fixes batch 2: an unknown priority threw
// inside createBoardItem and answered 500, and any source was stored as sent.
// Both answer 400 now, naming the real values; any case of a real value is
// still taken, as a lower-case priority always was.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskSource } from "@/generated/prisma";
import { PRIORITY_OPTIONS } from "@/lib/board-items-shared";

const st = vi.hoisted(() => ({ made: [] as Array<{ priority?: string | null; dueAt?: Date; legacy?: Record<string, unknown> }>, events: 0, reads: [] as unknown[] }));

vi.mock("@/lib/api-auth", () => ({
  authenticate: async () => ({ ctx: { organizationId: "org", scopes: ["WRITE"], via: "api_key", apiKeyId: "k1" }, error: null }),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findFirst: async () => ({ id: "u1" }) }, item: { findMany: async (a: unknown) => { st.reads.push(a); return []; } } } }));
vi.mock("@/services/webhookDispatcher", () => ({ dispatchEvent: async () => { st.events += 1; } }));
vi.mock("@/lib/work/personal-task", () => ({
  createPersonalTask: async (input: { priority?: string | null; legacy?: Record<string, unknown>; title: string }) => {
    st.made.push(input);
    return { id: "t1", boardId: "b1", title: input.title, status: "TO_DO", dueAt: new Date(), priority: input.priority ?? null, assigneeId: "u1" };
  },
}));

import { GET, POST } from "./route";

const post = (body: unknown) => POST(new Request("https://app.test/api/v1/tasks", { method: "POST", body: JSON.stringify(body) }) as never);

beforeEach(() => { st.made = []; st.events = 0; st.reads = []; });

describe("POST /api/v1/tasks priority and source", () => {
  it("answers 400 for a priority or a source outside the real lists, and makes nothing", async () => {
    const p = await post({ title: "Call back", assigneeId: "u1", priority: "CRITICAL" });
    expect(p.status).toBe(400);
    expect(await p.json()).toEqual({ error: `priority must be one of ${PRIORITY_OPTIONS.map((o) => o.value).join(", ")}` });
    const s = await post({ title: "Call back", assigneeId: "u1", source: "ZAPIER" });
    expect(s.status).toBe(400);
    expect(await s.json()).toEqual({ error: `source must be one of ${Object.values(TaskSource).join(", ")}` });
    expect((await post({ title: "x", assigneeId: "u1", priority: 3 })).status).toBe(400);
    expect(st.made).toEqual([]);
    expect(st.events).toBe(0);
  });

  it("takes a real value in any case, stored in capitals, and defaults when absent", async () => {
    const res = await post({ title: "Call back", assigneeId: "u1", priority: "high", source: "ai" });
    expect(res.status).toBe(201);
    expect(st.made[0]).toMatchObject({ priority: "HIGH", legacy: { source: "AI" } });
    expect(await res.json()).toMatchObject({ source: "AI", priority: "HIGH" });
    await post({ title: "Plain", assigneeId: "u1" });
    expect(st.made[1]).toMatchObject({ priority: "NORMAL", legacy: { source: "MANUAL" } });
  });
});

// Docs-found fixes batch 3: a date that is not one became an Invalid Date
// that failed inside the create (500), and a numeric string slaHours was
// stored as text and read back as null.
describe("POST /api/v1/tasks date and slaHours", () => {
  it("answers 400 for a date that is not one, or an slaHours that is not a number, and makes nothing", async () => {
    const d = await post({ title: "Call back", assigneeId: "u1", date: "next tuesday-ish" });
    expect(d.status).toBe(400);
    expect(await d.json()).toEqual({ error: "date must be a date and time, such as 2026-10-12T09:00:00Z" });
    expect((await post({ title: "Call back", assigneeId: "u1", date: { when: "soon" } })).status).toBe(400);
    expect((await post({ title: "Call back", assigneeId: "u1", slaHours: "soon" })).status).toBe(400);
    expect(st.made).toEqual([]);
    expect(st.events).toBe(0);
  });

  it("takes a real date, no date as now, and slaHours as a number, as before", async () => {
    const res = await post({ title: "Dated", assigneeId: "u1", date: "2026-10-20T09:00:00Z", slaHours: "4" });
    expect(res.status).toBe(201);
    expect(st.made[0].dueAt?.toISOString()).toBe("2026-10-20T09:00:00.000Z");
    expect(st.made[0].legacy).toMatchObject({ slaHours: 4 });
    expect(await res.json()).toMatchObject({ slaHours: 4 });
    await post({ title: "Undated", assigneeId: "u1", date: "", slaHours: 0 });
    expect(Math.abs((st.made[1].dueAt?.getTime() ?? 0) - Date.now())).toBeLessThan(5000);
    expect(st.made[1].legacy).toMatchObject({ slaHours: null });
  });
});

describe("GET /api/v1/tasks from and to", () => {
  const get = (q: string) => GET(new Request(`https://app.test/api/v1/tasks?${q}`) as never);
  it("answers 400 for a from or to that is not a date, and reads nothing", async () => {
    expect((await get("from=yesterday")).status).toBe(400);
    expect((await get("to=2026-99-99")).status).toBe(400);
    expect(st.reads).toEqual([]);
    expect((await get("from=2026-10-01T00:00:00Z")).status).toBe(200);
    expect(st.reads).toHaveLength(1);
  });
});
