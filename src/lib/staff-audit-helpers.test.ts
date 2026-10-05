import { describe, expect, it } from "vitest";
import {
  DENIAL_WINDOW_MS,
  STAFF_ACTIONS,
  STAFF_ACTOR_LABEL,
  escapeHtml,
  isWithinDenialWindow,
  planLabel,
  requestIp,
  staffActorFromSession,
  statusLabel,
  tenantEventFor,
} from "./staff-audit-helpers";

describe("action keys", () => {
  it("is the spec's eleven keys plus the staff-only trial end, each once", () => {
    expect(STAFF_ACTIONS).toHaveLength(12);
    expect(new Set(STAFF_ACTIONS).size).toBe(12);
    expect(STAFF_ACTIONS).toContain("admin.access.denied");
    expect(STAFF_ACTIONS).toContain("admin.org.owner_set");
    expect(STAFF_ACTIONS).toContain("admin.org.trial_end_changed");
  });
  it("never tells the customer about a trial end, which only staff see", () => {
    expect(tenantEventFor("admin.org.trial_end_changed", { trialEndsAt: null }, { trialEndsAt: "2026-10-19T12:00:00.000Z" })).toBeNull();
  });
});

describe("labels", () => {
  it("reads enum values as words and leaves unknowns alone", () => {
    expect(planLabel("GROWTH")).toBe("Growth");
    expect(planLabel(undefined)).toBe("None");
    expect(planLabel("MYSTERY")).toBe("MYSTERY");
    expect(statusLabel("CANCELLED")).toBe("Cancelled");
    expect(statusLabel(null)).toBe("None");
  });
});

describe("requestIp", () => {
  it("takes x-real-ip, then the last x-forwarded-for hop (the one our proxy added), else null", () => {
    // A client-forged first hop is never the answer.
    expect(requestIp(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(requestIp(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9", "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(requestIp(new Headers({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(requestIp(new Headers())).toBeNull();
    expect(requestIp(null)).toBeNull();
    expect(requestIp(new Request("http://x/", { headers: { "x-forwarded-for": " 192.0.2.1 " } }))).toBe("192.0.2.1");
    expect(requestIp(new Headers({ "x-forwarded-for": "1.1.1.1, " }))).toBeNull();
  });
});

describe("staffActorFromSession", () => {
  it("lower-cases the email and keeps the id", () => {
    expect(staffActorFromSession({ user: { id: "u1", email: "Maya@WorkwrK.com" } })).toEqual({
      userId: "u1",
      email: "maya@workwrk.com",
    });
  });
  it("never produces an empty email or a fake id", () => {
    expect(staffActorFromSession(null)).toEqual({ userId: null, email: "unknown" });
    expect(staffActorFromSession({ user: { email: "  " } })).toEqual({ userId: null, email: "unknown" });
  });
});

describe("isWithinDenialWindow", () => {
  const t0 = new Date("2026-09-27T10:00:00Z");
  it("is measured from the row, not a clock bucket", () => {
    expect(isWithinDenialWindow(t0, new Date(t0.getTime() + 1))).toBe(true);
    expect(isWithinDenialWindow(t0, new Date(t0.getTime() + DENIAL_WINDOW_MS - 1))).toBe(true);
    expect(isWithinDenialWindow(t0, new Date(t0.getTime() + DENIAL_WINDOW_MS))).toBe(false);
  });
  it("never counts a row from the future", () => {
    expect(isWithinDenialWindow(t0, new Date(t0.getTime() - 1))).toBe(false);
  });
});

describe("tenantEventFor: the customer's sentence names WorkwrK Support, never a person", () => {
  it("plan", () => {
    const e = tenantEventFor("admin.org.plan_changed", { plan: "GROWTH" }, { plan: "SCALE" });
    expect(e).toEqual({
      type: "staff.plan.changed",
      description: "WorkwrK Support changed the plan from Growth to Scale",
      severity: "info",
    });
  });
  it("status: suspended is a warning, cancelled is critical, active and trial are named", () => {
    expect(tenantEventFor("admin.org.status_changed", { status: "ACTIVE" }, { status: "SUSPENDED" })).toMatchObject({
      type: "staff.status.changed",
      description: "WorkwrK Support suspended this workspace",
      severity: "warning",
    });
    expect(tenantEventFor("admin.org.status_changed", { status: "ACTIVE" }, { status: "CANCELLED" })).toMatchObject({
      description: "WorkwrK Support closed this workspace",
      severity: "critical",
    });
    expect(tenantEventFor("admin.org.status_changed", { status: "SUSPENDED" }, { status: "ACTIVE" })?.description).toBe(
      "WorkwrK Support set this workspace to Active",
    );
    expect(tenantEventFor("admin.org.status_changed", {}, { status: "TRIAL" })?.description).toBe(
      "WorkwrK Support moved this workspace to a trial",
    );
  });
  it("seats: empty means unlimited", () => {
    expect(tenantEventFor("admin.org.seats_changed", { seats: 25 }, { seats: 50 })?.description).toBe(
      "WorkwrK Support changed seats from 25 to 50",
    );
    expect(tenantEventFor("admin.org.seats_changed", { seats: null }, { seats: 10 })?.description).toBe(
      "WorkwrK Support changed seats from unlimited to 10",
    );
  });
  it("module and add-on", () => {
    expect(tenantEventFor("admin.org.module_changed", null, { label: "Talk", enabled: true })?.description).toBe(
      "WorkwrK Support turned Talk on",
    );
    expect(tenantEventFor("admin.org.feature_changed", null, { label: "White label", enabled: false })?.description).toBe(
      "WorkwrK Support turned White label off",
    );
  });
  it("owner lands in Access as a warning, with the workspace's own org_role.changed beside it", () => {
    expect(tenantEventFor("admin.org.owner_set", { role: "COMPANY_ADMIN" }, { name: "Maya", userId: "u1" })).toEqual({
      type: "staff.owner.set",
      description: "WorkwrK Support gave Maya Owner access",
      severity: "warning",
      companion: {
        type: "org_role.changed",
        description: "WorkwrK Support changed Maya's role from Admin to Owner",
        severity: "warning",
        targetType: "User",
        targetId: "u1",
        metadata: { from: "Admin", to: "Owner" },
      },
    });
    expect(tenantEventFor("admin.org.owner_set", { role: "EMPLOYEE" }, { name: "Sam" })?.companion?.description).toBe(
      "WorkwrK Support changed Sam's role from Member to Owner",
    );
  });
  it("the staff list, imports, refunds and denials have no customer half", () => {
    for (const a of ["admin.staff.added", "admin.staff.removed", "admin.codes.imported", "admin.code.refunded", "admin.access.denied"] as const) {
      expect(tenantEventFor(a, null, null)).toBeNull();
    }
  });
  it("every sentence starts with the fixed label", () => {
    for (const a of STAFF_ACTIONS) {
      const e = tenantEventFor(a, { plan: "STARTER", status: "ACTIVE", seats: 1 }, { plan: "GROWTH", status: "TRIAL", seats: 2, label: "X", enabled: true, name: "Y" });
      if (e) expect(e.description.startsWith(STAFF_ACTOR_LABEL)).toBe(true);
    }
  });
});

describe("escapeHtml", () => {
  it("never lets a staff name or email become markup", () => {
    expect(escapeHtml(`<img/src=x>@a.b "x" & 'y'`)).toBe("&lt;img/src=x&gt;@a.b &quot;x&quot; &amp; &#39;y&#39;");
    expect(escapeHtml("plain@workwrk.com")).toBe("plain@workwrk.com");
  });
});
