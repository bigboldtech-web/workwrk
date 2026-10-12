// placementOnAccept (docs-found fixes batch 6, from the batch 5 review).
// sendInvitation checks the department, job title and office it stores now
// (batch 5), but an invitation sent before that kept whatever it was sent,
// and its acceptance wrote those ids onto the new person, so they could land
// in another workspace's department, job title or office.

import { describe, expect, it, vi } from "vitest";

const { rows, table } = vi.hoisted(() => {
  const rows = {
    department: [{ id: "d-own", organizationId: "org" }, { id: "d-other", organizationId: "other" }],
    role: [{ id: "r-own", organizationId: "org" }, { id: "r-other", organizationId: "other" }],
    office: [{ id: "o-own", organizationId: "org" }, { id: "o-other", organizationId: "other" }],
  };
  const table = (list: Array<{ id: string; organizationId: string }>) => ({
    findFirst: async (a: { where: { id: string; organizationId: string } }) => list.find((r) => r.id === a.where.id && r.organizationId === a.where.organizationId) ?? null,
  });
  return { rows, table };
});

vi.mock("@/lib/prisma", () => ({ prisma: { department: table(rows.department), role: table(rows.role), office: table(rows.office) } }));
vi.mock("@/lib/access/manager-candidate", () => ({ managerCandidateIn: async () => "ok" }));

import { placementOnAccept } from "./invite-facts.server";

describe("placementOnAccept", () => {
  it("keeps the invited workspace's own department, job title and office", async () => {
    expect(await placementOnAccept({ organizationId: "org", departmentId: "d-own", roleId: "r-own", officeId: "o-own" })).toEqual({ departmentId: "d-own", roleId: "r-own", officeId: "o-own" });
  });

  it("leaves blank any that belongs to another workspace, or is not there at all", async () => {
    expect(await placementOnAccept({ organizationId: "org", departmentId: "d-other", roleId: "r-other", officeId: "gone" })).toEqual({ departmentId: null, roleId: null, officeId: null });
    expect(await placementOnAccept({ organizationId: "org", departmentId: null, roleId: null, officeId: null })).toEqual({ departmentId: null, roleId: null, officeId: null });
  });
});
