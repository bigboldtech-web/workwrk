// Contract test for DELETE /api/departments/[id] and the Delete confirm's copy.
//
// Two ways a department delete went wrong. A removed person still pointing at
// the department blocked it for good (the product has no way to edit a
// removed record, so only Restore, move, Remove again got through). And a
// department with no people but with goals naming it deleted straight away,
// silently taking itself off every one of those goals. The database is
// mocked: the test reads what the route counted, what it refused and what it
// wrote.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Dept = { id: string; current: number; subs: number };
let dept: Dept | null;
let goalIds: string[];
const writes: string[] = [];
const userUpdateMany = vi.fn();
const deptDelete = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    department: {
      // The route asks for CURRENT members only; a mock that ignored the
      // where would hide a regression back to counting removed people.
      findFirst: async (args: { include: { _count: { select: { members: { where?: { deletedAt: null } } } } } }) => {
        if (!dept) return null;
        const members = args.include._count.select.members;
        if (typeof members !== "object" || members.where?.deletedAt !== null) throw new Error("members must be counted with deletedAt: null");
        return { id: dept.id, _count: { members: dept.current, subDepartments: dept.subs } };
      },
      delete: (args: unknown) => { writes.push("department.delete"); deptDelete(args); return "department.delete"; },
    },
    user: {
      updateMany: (args: unknown) => { writes.push("user.updateMany"); userUpdateMany(args); return "user.updateMany"; },
    },
    oKR: {
      findMany: async () => goalIds.map((id) => ({ id, title: id, level: "DEPARTMENT", ownerId: null, departmentId: dept?.id ?? null })),
    },
    $transaction: async (ops: unknown[]) => { writes.push("transaction"); return ops; },
  },
}));

vi.mock("@/lib/api-helpers", () => ({
  getSessionOrFail: async () => ({ error: null, session: { user: { accessLevel: "COMPANY_ADMIN" } } }),
  getOrgId: () => "org-1",
}));
vi.mock("@/lib/people/department-access.server", () => ({ mayWriteDepartments: async () => true }));
vi.mock("@/lib/goal-audience", () => ({ canSeeGoal: async () => true }));

import { DELETE } from "./route";
import { deleteConsequences } from "@/components/people/departments-manager";

async function del(query = "") {
  const res = await DELETE(new Request(`http://x/api/departments/d-1${query}`, { method: "DELETE" }) as never, { params: Promise.resolve({ id: "d-1" }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  dept = { id: "d-1", current: 0, subs: 0 };
  goalIds = [];
  writes.length = 0;
  userUpdateMany.mockClear();
  deptDelete.mockClear();
});

describe("DELETE /api/departments/[id]", () => {
  it("deletes a department whose only people are removed, taking them out in the same transaction", async () => {
    const r = await del();
    expect(r.status).toBe(200);
    expect(writes).toEqual(["user.updateMany", "department.delete", "transaction"]);
    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", departmentId: "d-1", deletedAt: { not: null } },
      data: { departmentId: null },
    });
  });

  it("still refuses a department with current people or sub-departments, and never mentions removed people", async () => {
    dept = { id: "d-1", current: 2, subs: 1 };
    const r = await del();
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: "not_empty", error: "Move 2 people and 1 sub-department out of this department first." });
    expect(writes).toEqual([]);
  });

  it("refuses to take a department off goals nobody was told about", async () => {
    goalIds = ["g-1", "g-2"];
    const r = await del();
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: "has_goals", goals: 2 });
    expect(writes).toEqual([]);
  });

  it("refuses when the goal count agreed to is stale (a goal was added since the drawer loaded)", async () => {
    goalIds = ["g-1", "g-2"];
    const r = await del("?detachGoals=1");
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: "has_goals", goals: 2 });
    expect(writes).toEqual([]);
  });

  it("deletes once the caller confirms the exact goal count it showed", async () => {
    goalIds = ["g-1", "g-2"];
    const r = await del("?detachGoals=2");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ detachedGoals: 2 });
    expect(deptDelete).toHaveBeenCalledWith({ where: { id: "d-1" } });
  });

  it("is a 404 for a department outside the org", async () => {
    dept = null;
    expect((await del()).status).toBe(404);
  });
});

describe("deleteConsequences (the Delete confirm)", () => {
  it("names the goals, job titles and removed people that go with the department", () => {
    expect(deleteConsequences({ goals: 2, jobTitles: 1, removed: 1 })).toBe(
      "2 goals lose this department as their audience or department. The goals themselves are kept. 1 job title loses its department. 1 removed person is taken out of it. This can't be undone.",
    );
  });

  it("says only that it can't be undone when nothing else changes", () => {
    expect(deleteConsequences({ goals: 0, jobTitles: 0, removed: 0 })).toBe("This can't be undone.");
  });
});
