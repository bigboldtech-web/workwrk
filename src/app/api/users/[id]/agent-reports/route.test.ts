// /api/users/[id]/agent-reports (docs-found fixes batch 3): the Members
// drawer's way to move the reports still listed under an Agent. Only the
// people who write Reports to may use it, and a move is logged.

import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  ctx: { userId: "admin", organizationId: "org", isAdmin: true, peopleTeam: false } as Record<string, unknown> | null,
  person: { id: "sam", firstName: "Sam", lastName: "Agent" } as Record<string, unknown> | null,
  moved: null as null | { changed: true } | { moved: number; dottedRemoved: number; rehomed: { to: string | null; toId: string | null; count: number }[] },
  moveInput: null as null | Record<string, unknown>,
  busy: false,
  logs: [] as Array<{ type: string; description: string }>,
  calls: [] as string[],
  personWhere: null as unknown,
}));

vi.mock("@/lib/prisma", () => ({ prisma: { user: { findFirst: async (a: { where: unknown }) => { st.personWhere = a.where; return st.person; } } } }));
vi.mock("@/lib/activity", () => ({ logActivity: async (row: { type: string; description: string }) => { st.logs.push(row); } }));
vi.mock("@/lib/people/person-access.server", () => ({
  peopleCtx: async () => st.ctx,
  isPeopleAdmin: (c: { isAdmin: boolean; peopleTeam: boolean }) => c.isAdmin || c.peopleTeam,
}));
vi.mock("@/lib/people/handover.server", () => ({
  previewAgentReports: async () => { st.calls.push("preview"); return { agent: true, solid: 2, dotted: 1, rehomed: [{ to: "Dana Lee", toId: "mona", count: 2 }] }; },
  moveAgentReports: async (input: Record<string, unknown>) => {
    st.calls.push("move");
    st.moveInput = input;
    if (st.busy) throw Object.assign(new Error("busy"), { name: "OrgRolesBusy" });
    return st.moved;
  },
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
  st.moveInput = null;
  st.busy = false;
});

describe("agent-reports", () => {
  // Docs-found fixes batch 5: an Agent who works here through a membership
  // (anchored in another workspace since they last switched) was "Not found",
  // so the drawer could never move the people still listed under them here.
  it("finds the Agent wherever they are anchored, as long as they work here", async () => {
    await GET(req("GET"), params);
    expect(st.personWhere).toEqual({ id: "sam", deletedAt: null, OR: [{ organizationId: "org" }, { organizationMemberships: { some: { organizationId: "org" } } }] });
  });

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

// Docs-found fixes batch 4: the move runs only the plan the drawer showed,
// and a busy role lock is a plain 503.
describe("agent-reports, batch 4", () => {
  const post = (body: unknown) => POST(new Request("https://app.test/api/users/sam/agent-reports", { method: "POST", body: JSON.stringify(body) }) as never, params);

  it("passes the plan shown to the move, and answers 409 plan_changed when it no longer holds", async () => {
    const shown = { agent: true, solid: 2, dotted: 1, rehomed: [{ to: "Dana Lee", toId: "mona", count: 2 }] };
    st.moved = { changed: true };
    const res = await post({ expect: shown });
    expect(st.moveInput?.expect).toEqual({ solid: 2, dotted: 1, rehomed: [{ to: null, toId: "mona", count: 2 }] });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("plan_changed");
    expect(st.logs).toEqual([]);
  });

  it("answers 503 roles_busy when the role lock is busy", async () => {
    st.busy = true;
    const res = await post({});
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("roles_busy");
  });
});
