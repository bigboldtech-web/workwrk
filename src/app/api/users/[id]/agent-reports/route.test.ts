// /api/users/[id]/agent-reports (docs-found fixes batch 3): the Members
// drawer's way to move the reports still listed under an Agent. Only the
// people who write Reports to may use it, and a move is logged.

import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  ctx: { userId: "admin", organizationId: "org", isAdmin: true, peopleTeam: false } as Record<string, unknown> | null,
  person: { id: "sam", firstName: "Sam", lastName: "Agent" } as Record<string, unknown> | null,
  moved: null as null | { moved: number; dottedRemoved: number; rehomed: { to: string | null; toId: string | null; count: number }[] },
  logs: [] as Array<{ type: string; description: string }>,
  calls: [] as string[],
}));

vi.mock("@/lib/prisma", () => ({ prisma: { user: { findFirst: async () => st.person } } }));
vi.mock("@/lib/activity", () => ({ logActivity: async (row: { type: string; description: string }) => { st.logs.push(row); } }));
vi.mock("@/lib/people/person-access.server", () => ({
  peopleCtx: async () => st.ctx,
  isPeopleAdmin: (c: { isAdmin: boolean; peopleTeam: boolean }) => c.isAdmin || c.peopleTeam,
}));
vi.mock("@/lib/people/handover.server", () => ({
  previewAgentReports: async () => { st.calls.push("preview"); return { agent: true, solid: 2, dotted: 1, rehomed: [{ to: "Dana Lee", toId: "mona", count: 2 }] }; },
  moveAgentReports: async () => { st.calls.push("move"); return st.moved; },
}));

import { GET, POST } from "./route";

const params = { params: Promise.resolve({ id: "sam" }) };
const req = (method: string) => new Request("https://app.test/api/users/sam/agent-reports", { method }) as never;

beforeEach(() => {
  st.ctx = { userId: "admin", organizationId: "org", isAdmin: true, peopleTeam: false };
  st.person = { id: "sam", firstName: "Sam", lastName: "Agent" };
  st.moved = { moved: 2, dottedRemoved: 1, rehomed: [{ to: "Dana Lee", toId: "mona", count: 2 }] };
  st.logs = [];
  st.calls = [];
});

describe("agent-reports", () => {
  it("previews for an Admin", async () => {
    const res = await GET(req("GET"), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ agent: true, solid: 2, dotted: 1, rehomed: [{ to: "Dana Lee", toId: "mona", count: 2 }] });
  });

  it("refuses anyone who does not write Reports to, and moves nothing", async () => {
    st.ctx = { userId: "mona", organizationId: "org", isAdmin: false, peopleTeam: false };
    expect((await POST(req("POST"), params)).status).toBe(403);
    expect((await GET(req("GET"), params)).status).toBe(403);
    expect(st.calls).toEqual([]);
  });

  it("moves the reports and logs it", async () => {
    const res = await POST(req("POST"), params);
    expect(res.status).toBe(200);
    expect(st.logs).toEqual([expect.objectContaining({
      type: "reporting_line_changed",
      description: "Moved the reports listed under Sam Agent, who is on the Agent tier: 2 direct reports (2 to Dana Lee), and 1 dotted line taken off",
    })]);
  });

  it("answers 409 for someone who is no Agent, and logs nothing", async () => {
    st.moved = null;
    const res = await POST(req("POST"), params);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("not_agent");
    expect(st.logs).toEqual([]);
  });
});
