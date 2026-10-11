import { describe, expect, it } from "vitest";
import { applyRoleChange, memberRoleOf, planRoleChange, type RoleChangeInput } from "./membership";

const t0 = new Date("2026-01-01T00:00:00Z");
const t1 = new Date("2026-02-01T00:00:00Z");
const t2 = new Date("2026-03-01T00:00:00Z");

function input(over: Partial<RoleChangeInput>): RoleChangeInput {
  return {
    actorId: "owner",
    actorIsOwner: true,
    actorIsAdmin: true,
    target: { id: "m1", level: "EMPLOYEE", isOwner: false, createdAt: t2 },
    admins: [
      { id: "owner", level: "COMPANY_ADMIN", createdAt: t0 },
      { id: "admin2", level: "COMPANY_ADMIN", createdAt: t1 },
    ],
    next: { role: "ADMIN" },
    ...over,
  };
}

describe("memberRoleOf", () => {
  it("maps the stored level and Owner status", () => {
    expect(memberRoleOf("SUPER_ADMIN", false)).toBe("OWNER");
    expect(memberRoleOf("COMPANY_ADMIN", true)).toBe("OWNER");
    expect(memberRoleOf("COMPANY_ADMIN", false)).toBe("ADMIN");
    expect(memberRoleOf("MANAGER", false)).toBe("MEMBER");
  });
});

describe("planRoleChange", () => {
  it("refuses anyone below Admin", () => {
    const p = planRoleChange(input({ actorIsAdmin: false, actorIsOwner: false }));
    expect(p).toMatchObject({ ok: false, status: 403 });
  });

  it("lets an Admin promote a Member to Admin without a sign-out", () => {
    const p = planRoleChange(input({ actorId: "admin2", actorIsOwner: false }));
    expect(p).toMatchObject({ ok: true, level: "COMPANY_ADMIN", changed: true, bump: false, afterRole: "ADMIN" });
  });

  it("never lets an Admin make an Owner", () => {
    const p = planRoleChange(input({ actorId: "admin2", actorIsOwner: false, next: { role: "OWNER" } }));
    expect(p).toMatchObject({ ok: false, status: 403 });
  });

  it("never lets an Admin change an Owner's role", () => {
    const p = planRoleChange(input({ actorId: "admin2", actorIsOwner: false, target: { id: "owner", level: "COMPANY_ADMIN", isOwner: true, createdAt: t0 }, next: { role: "MEMBER" } }));
    expect(p).toMatchObject({ ok: false, status: 403 });
  });

  it("refuses to leave the workspace with no Owner", () => {
    const p = planRoleChange(
      input({
        target: { id: "owner", level: "SUPER_ADMIN", isOwner: true, createdAt: t0 },
        admins: [{ id: "owner", level: "SUPER_ADMIN", createdAt: t0 }],
        next: { role: "MEMBER" },
      }),
    );
    expect(p).toMatchObject({ ok: false, status: 409 });
  });

  it("bumps the token on any lowering, including between member tiers", () => {
    const down = planRoleChange(input({ target: { id: "a", level: "COMPANY_ADMIN", isOwner: false, createdAt: t1 }, admins: [{ id: "owner", level: "SUPER_ADMIN", createdAt: t0 }, { id: "a", level: "COMPANY_ADMIN", createdAt: t1 }], next: { role: "MEMBER", tier: "EMPLOYEE" } }));
    expect(down).toMatchObject({ ok: true, bump: true });
    const sideways = planRoleChange(input({ target: { id: "m1", level: "MANAGER", isOwner: false, createdAt: t2 }, next: { role: "MEMBER", tier: "HR" } }));
    expect(sideways).toMatchObject({ ok: true, level: "HR", bump: true });
  });

  it("never offers SUPER_ADMIN as a member tier", () => {
    const p = planRoleChange(input({ next: { role: "MEMBER", tier: "SUPER_ADMIN" } }));
    expect(p).toMatchObject({ ok: false, status: 400 });
  });

  it("keeps a Member's tier when only the role is sent", () => {
    const p = planRoleChange(input({ target: { id: "m1", level: "MANAGER", isOwner: false, createdAt: t2 }, next: { role: "MEMBER" } }));
    expect(p).toMatchObject({ ok: true, changed: false });
  });

  it("refuses an Admin promoting someone who would become an Owner by seniority", () => {
    const p = planRoleChange(
      input({
        actorId: "admin2",
        actorIsOwner: false,
        target: { id: "old", level: "EMPLOYEE", isOwner: false, createdAt: new Date("2025-01-01T00:00:00Z") },
      }),
    );
    expect(p).toMatchObject({ ok: false, status: 403 });
  });
});

// Rule 6 (docs-found fixes batch 2): nobody becomes an Agent while people
// report to them. AGENT_TIER_BLURB promises an Agent is never anyone's
// manager, and a role change was the one door that never counted the team.
describe("rule 6: never an Agent with reports", () => {
  it("refuses making someone with reports an Agent, with a plain 409 that says what to do", () => {
    const p = planRoleChange(input({ target: { id: "m1", level: "MANAGER", isOwner: false, createdAt: t2, reports: 3 }, next: { role: "MEMBER", tier: "AGENT" } }));
    expect(p).toMatchObject({ ok: false, status: 409, code: "agent_has_reports" });
    expect(p.ok ? "" : p.error).toBe("An Agent can't be anyone's manager, and 3 people report to them. Move their reports to someone else first.");
    const one = planRoleChange(input({ target: { id: "m1", level: "MANAGER", isOwner: false, createdAt: t2, reports: 1 }, next: { role: "MEMBER", tier: "AGENT" } }));
    expect(one.ok ? "" : one.error).toContain("1 person reports to them");
  });

  it("lets someone with no reports become an Agent, and leaves other tier changes alone", () => {
    expect(planRoleChange(input({ target: { id: "m1", level: "EMPLOYEE", isOwner: false, createdAt: t2, reports: 0 }, next: { role: "MEMBER", tier: "AGENT" } }))).toMatchObject({ ok: true, level: "AGENT" });
    expect(planRoleChange(input({ target: { id: "m1", level: "MANAGER", isOwner: false, createdAt: t2, reports: 4 }, next: { role: "MEMBER", tier: "DIRECTOR" } }))).toMatchObject({ ok: true, level: "DIRECTOR" });
    // Someone already an Agent is not moved by a save that changes nothing.
    expect(planRoleChange(input({ target: { id: "m1", level: "AGENT", isOwner: false, createdAt: t2, reports: 2 }, next: { role: "MEMBER", tier: "AGENT" } }))).toMatchObject({ ok: true, changed: false });
  });

  it("names the last-Owner refusal too, so the route's code is the planner's own", () => {
    const p = planRoleChange(input({ target: { id: "owner", level: "SUPER_ADMIN", isOwner: true, createdAt: t0 }, admins: [{ id: "owner", level: "SUPER_ADMIN", createdAt: t0 }], next: { role: "MEMBER" } }));
    expect(p).toMatchObject({ ok: false, status: 409, code: "last_owner" });
  });
});

describe("applyRoleChange counts the team under the role lock", () => {
  const admin = { id: "owner", accessLevel: "SUPER_ADMIN", createdAt: t0, firstName: "Olga", lastName: "Owner" };
  function fakeDb(o: { solid?: string[]; dotted?: string[] }) {
    const calls = { updates: [] as unknown[], dottedReads: 0 };
    const db = {
      $executeRaw: async () => 0,
      user: {
        findFirst: async () => ({ id: "mona", accessLevel: "MANAGER", createdAt: t2, firstName: "Mona", lastName: "Lee", email: "mona@x.test" }),
        findMany: async (a: { where: Record<string, unknown> }) => {
          if ("accessLevel" in a.where) return [admin];
          if (a.where.managerId === "mona") return (o.solid ?? []).map((id) => ({ id }));
          return [];
        },
        update: async (a: unknown) => { calls.updates.push(a); return {}; },
      },
      organizationMembership: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
      userDottedLine: { findMany: async () => { calls.dottedReads += 1; return (o.dotted ?? []).map((userId) => ({ userId })); } },
    };
    return { db: db as unknown as Parameters<typeof applyRoleChange>[0], calls };
  }
  const toAgent = { organizationId: "org", actorId: "owner", actorIsOwner: true, actorIsAdmin: true, targetId: "mona", next: { role: "MEMBER" as const, tier: "AGENT" } };

  it("refuses with solid reports, and writes nothing", async () => {
    const { db, calls } = fakeDb({ solid: ["r1", "r2"] });
    const r = await applyRoleChange(db, toAgent);
    expect(r).toMatchObject({ ok: false, status: 409, code: "agent_has_reports" });
    expect(calls.updates).toEqual([]);
  });

  it("counts a dotted-line report, and a person on both lines once", async () => {
    const dottedOnly = fakeDb({ dotted: ["d1"] });
    const r1 = await applyRoleChange(dottedOnly.db, toAgent);
    expect(r1.ok ? "" : r1.error).toContain("1 person reports to them");
    const both = fakeDb({ solid: ["r1"], dotted: ["r1", "d2"] });
    const r2 = await applyRoleChange(both.db, toAgent);
    expect(r2.ok ? "" : r2.error).toContain("2 people report to them");
  });

  it("makes someone with no reports an Agent, and reads no team for other changes", async () => {
    const empty = fakeDb({});
    expect(await applyRoleChange(empty.db, toAgent)).toMatchObject({ ok: true, changed: true, after: { level: "AGENT" } });
    expect(empty.calls.updates).toHaveLength(1);
    const director = fakeDb({ solid: ["r1"] });
    expect(await applyRoleChange(director.db, { ...toAgent, next: { role: "MEMBER", tier: "DIRECTOR" } })).toMatchObject({ ok: true, changed: true });
    expect(director.calls.dottedReads).toBe(0);
  });
});
