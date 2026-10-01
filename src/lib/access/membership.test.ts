import { describe, expect, it } from "vitest";
import { memberRoleOf, planRoleChange, type RoleChangeInput } from "./membership";

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
