import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { profileEditable, refusedSave, retrySave, saveGroup, undoFor, withoutKeys, type FailedSave } from "./member-drawer";
import type { MemberRow } from "./members-shared";

// Members > drawer: a failed field save keeps what it sent, and the row's
// Retry resends exactly that. These are the pure pieces the drawer's patch()
// and errFor() are built from.

const row: MemberRow = {
  id: "u1",
  name: "Ana Lee",
  email: "ana@example.test",
  avatar: null,
  role: "MEMBER",
  tier: "EMPLOYEE",
  tierLabel: "Member",
  isAgent: false,
  jobTitle: null,
  department: { id: "d1", name: "Ops" },
  office: null,
  manager: null,
  peopleTeam: false,
  status: "ACTIVE",
  lastSignInAt: null,
  joinedAt: "2026-01-01T00:00:00.000Z",
  weeklyCapacityHours: 40,
};

describe("member drawer Retry", () => {
  it("resends the failed Role save, body and shown value", () => {
    const failed: Record<string, FailedSave> = {
      role: { memberId: "u1", body: { orgRole: "ADMIN", memberTier: null }, optimistic: { role: "ADMIN", tier: null } },
    };
    expect(retrySave(failed, "role", "u1")).toEqual(failed.role);
  });

  it("resends a failed placement save (Department) on its own row", () => {
    const failed: Record<string, FailedSave> = {
      departmentId: { memberId: "u1", body: { departmentId: "d2" }, optimistic: { department: { id: "d2", name: "Sales" } } },
    };
    expect(retrySave(failed, "departmentId", "u1")?.body).toEqual({ departmentId: "d2" });
    expect(retrySave(failed, "role", "u1")).toBeNull();
  });

  it("never resends a failure recorded for someone else", () => {
    const failed: Record<string, FailedSave> = {
      role: { memberId: "u2", body: { orgRole: "ADMIN" }, optimistic: { role: "ADMIN" } },
    };
    expect(retrySave(failed, "role", "u1")).toBeNull();
  });

  it("Role and Tier write the same fields, so a newer attempt on one retires the other's failure", () => {
    expect(saveGroup("tier")).toEqual(["role", "tier"]);
    expect(saveGroup("role")).toEqual(["role", "tier"]);
    expect(saveGroup("cap")).toEqual(["cap"]);
    const failed: Record<string, FailedSave> = {
      tier: { memberId: "u1", body: { orgRole: "MEMBER", memberTier: "MANAGER" }, optimistic: { tier: "MANAGER" } },
      cap: { memberId: "u1", body: { weeklyCapacityHours: 30 }, optimistic: { weeklyCapacityHours: 30 } },
    };
    const after = withoutKeys(failed, saveGroup("role"));
    expect(Object.keys(after)).toEqual(["cap"]);
    expect(Object.keys(failed)).toEqual(["tier", "cap"]); // not mutated
  });

  it("a failed save puts back only the fields it changed", () => {
    const undo = undoFor(row, { department: { id: "d2", name: "Sales" } });
    expect(undo).toEqual({ department: { id: "d1", name: "Ops" } });
    // A Role that saved while the Department was in flight stays.
    const current: MemberRow = { ...row, role: "ADMIN", department: { id: "d2", name: "Sales" } };
    expect({ ...current, ...undo }.role).toBe("ADMIN");
    expect(undoFor(row, { weeklyCapacityHours: null })).toEqual({ weeklyCapacityHours: 40 });
  });
});

// Docs-found fixes batch 7: a Reports to another workspace counts is asked
// about (409 manager_elsewhere), and the row's Retry is the confirmation.
describe("member drawer: a Reports to another workspace counts", () => {
  it("keeps the change with the confirmation for Retry, and says so", () => {
    const error = "Max Chen reports to someone in another workspace they work in, and that workspace still counts the line. Changing who they report to here changes it there too.";
    expect(refusedSave({ managerId: "sam" }, { error, code: "manager_elsewhere" })).toEqual({
      body: { managerId: "sam", replaceOtherWorkspaceLine: true },
      message: `${error} Retry to change it anyway.`,
    });
  });

  it("leaves every other refusal as it was", () => {
    expect(refusedSave({ managerId: "sam" }, { error: "An Agent can't be anyone's manager", code: "agent_cannot_manage" })).toEqual({ body: { managerId: "sam" }, message: "An Agent can't be anyone's manager" });
  });
});

// docs/plans/workspace-status.md step 3 (D11): someone who works here
// through a membership keeps their profile in the workspace their account
// belongs to, so the drawer shows it as text; their role and status still work.
describe("profileEditable", () => {
  it("is the People team's and Admins' right, only for someone whose profile this workspace keeps", () => {
    expect(profileEditable({ profileHere: true }, true)).toBe(true);
    expect(profileEditable({}, true)).toBe(true);
    expect(profileEditable({ profileHere: false }, true)).toBe(false);
    expect(profileEditable({ profileHere: true }, false)).toBe(false);
  });

  it("the drawer reads it for every profile row, says why once, and hides the Admin scopes for them", () => {
    const src = readFileSync(path.join(process.cwd(), "src/app/(dashboard)/settings/members/member-drawer.tsx"), "utf8");
    expect(src.match(/readOnlyValue=\{canEditProfile \? undefined/g)?.length).toBe(5);
    expect(src).not.toMatch(/readOnlyValue=\{canEditPeople \?/);
    expect(src).toContain('{m.profileHere === false ? <p className="mt-3 text-sm text-ink-2">{PROFILE_ELSEWHERE}</p> : null}');
    expect(src).toContain('m.role === "ADMIN" && viewerIsOwner && m.profileHere !== false');
  });
});
