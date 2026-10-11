// POST /api/settings/members/bulk: each person goes through the drawer's
// planner, and a refusal is reported for that person, with the planner's code
// (docs-found fixes batch 2: someone with reports is never made an Agent, and
// the report says why, so the page can tell it from a permission refusal).

import { describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: { id: "u-admin", organizationId: "org1" } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/activity", () => ({ logActivity: async () => undefined }));
vi.mock("@/lib/access/workspace-admin", () => ({
  sessionIsWorkspaceAdmin: () => true,
  freshWorkspaceActor: async () => ({ ok: true, admin: true, owner: true }),
}));
vi.mock("@/lib/access/membership", () => ({
  applyRoleChange: vi.fn(async (_db: unknown, input: { targetId: string }) =>
    input.targetId === "mona"
      ? { ok: false, status: 409, error: "An Agent can't be anyone's manager, and 2 people report to them. Move their reports to someone else first.", code: "agent_has_reports" }
      : { ok: true, changed: true, targetName: "Rex", before: { level: "EMPLOYEE", role: "MEMBER" }, after: { level: "AGENT", role: "MEMBER" }, bumped: true },
  ),
  roleChangeSentence: () => "",
}));

import { POST } from "./route";

describe("bulk role change to Agent", () => {
  it("refuses the person with reports, by name and code, and still changes the rest", async () => {
    const res = await POST(new Request("https://app.test/api/settings/members/bulk", { method: "POST", body: JSON.stringify({ ids: ["mona", "rex"], role: "MEMBER", tier: "AGENT" }) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([
      { id: "mona", ok: false, error: "An Agent can't be anyone's manager, and 2 people report to them. Move their reports to someone else first.", code: "agent_has_reports" },
      { id: "rex", ok: true, changed: true },
    ]);
    expect(body).toMatchObject({ changed: 1, refused: 1 });
  });
});
