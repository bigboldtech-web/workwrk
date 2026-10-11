// POST /api/v1/tasks. Docs-found fixes batch 2: an unknown priority threw
// inside createBoardItem and answered 500, and any source was stored as sent.
// Both answer 400 now, naming the real values; any case of a real value is
// still taken, as a lower-case priority always was.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskSource } from "@/generated/prisma";
import { PRIORITY_OPTIONS } from "@/lib/board-items-shared";

const st = vi.hoisted(() => ({ made: [] as Array<{ priority?: string | null; legacy?: Record<string, unknown> }>, events: 0 }));

vi.mock("@/lib/api-auth", () => ({
  authenticate: async () => ({ ctx: { organizationId: "org", scopes: ["WRITE"], via: "api_key", apiKeyId: "k1" }, error: null }),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findFirst: async () => ({ id: "u1" }) } } }));
vi.mock("@/services/webhookDispatcher", () => ({ dispatchEvent: async () => { st.events += 1; } }));
vi.mock("@/lib/work/personal-task", () => ({
  createPersonalTask: async (input: { priority?: string | null; legacy?: Record<string, unknown>; title: string }) => {
    st.made.push(input);
    return { id: "t1", boardId: "b1", title: input.title, status: "TO_DO", dueAt: new Date(), priority: input.priority ?? null, assigneeId: "u1" };
  },
}));

import { POST } from "./route";

const post = (body: unknown) => POST(new Request("https://app.test/api/v1/tasks", { method: "POST", body: JSON.stringify(body) }) as never);

beforeEach(() => { st.made = []; st.events = 0; });

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
