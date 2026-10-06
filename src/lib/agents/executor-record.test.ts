// An approved action that ran always leaves its record (src/lib/agents/
// executor.ts runApprovedAction): the audit row is written before the
// action's own row, and a result the database will not store falls back to
// the sentence alone, so the card never asks to run it again (review round 1).

import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ steps: [] as string[], failFirstUpdate: false, updates: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    agentAction: {
      updateMany: async (a: { data: Record<string, unknown> }) => {
        st.steps.push(`update ${String(a.data.status)}`);
        if (st.failFirstUpdate) {
          st.failFirstUpdate = false;
          throw new Error("Unicode low surrogate must follow a high surrogate");
        }
        st.updates.push(a.data);
        return { count: 1 };
      },
    },
  },
}));
vi.mock("@/lib/activity", () => ({ logActivity: async () => { st.steps.push("audit"); } }));
vi.mock("./actions", () => ({ proposeAction: vi.fn(), waitingCount: vi.fn(), writeEventLine: vi.fn() }));
vi.mock("./tools", () => ({
  TOOLS: {
    create_task: {
      name: "create_task",
      description: "",
      input_schema: { type: "object", properties: { title: { type: "string" } } },
      handler: async () => {
        st.steps.push("handler");
        return { ok: true, task: { id: "t1", title: "Call Acme" } };
      },
    },
  },
}));

import { legacyLevelRow } from "@/lib/access/test-fixtures";
import { runApprovedAction } from "./executor";

const person = { userId: "u1", organizationId: "org", name: "Ola Owner", firstName: "Ola", ...legacyLevelRow("EMPLOYEE"), orgRole: "MEMBER", email: "o@x.test", timezone: "UTC", viewer: {} } as never;
const run = () =>
  runApprovedAction({
    action: { id: "act1", toolName: "create_task", risk: "OUTWARD", runId: "run1", sessionId: "s1", routineId: null, preview: { title: "Create task \"Call Acme\"" } },
    input: { title: "Call Acme" },
    person,
    agent: { id: "a1", slug: "pm", name: "PM" },
    trigger: "APPROVAL",
    decidedVia: "person",
  } as never);

beforeEach(() => {
  st.steps = [];
  st.updates = [];
  st.failFirstUpdate = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("runApprovedAction's record", () => {
  it("writes the audit row before the action's own row", async () => {
    const out = await run();
    expect(out.status).toBe("EXECUTED");
    expect(st.steps).toEqual(["handler", "audit", "update EXECUTED"]);
  });

  it("still records the action as run when its full result will not store", async () => {
    st.failFirstUpdate = true;
    const out = await run();
    expect(out.status).toBe("EXECUTED");
    expect(st.steps).toEqual(["handler", "audit", "update EXECUTED", "update EXECUTED"]);
    expect(st.updates[0]).toMatchObject({ status: "EXECUTED", result: { text: expect.stringContaining("Call Acme") } });
    expect((st.updates[0].result as Record<string, unknown>).data).toBeUndefined();
  });
});
