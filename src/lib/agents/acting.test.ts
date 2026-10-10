// Who an AI teammate acts as (src/lib/agents/acting.ts): a live member of
// this workspace who is not a Guest, not an agent account, and has AI, read
// fresh; the person a tool context carries is used without a second read;
// and the audit label names both.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelOf, legacyLevelRow } from "@/lib/access/test-fixtures";

const db = vi.hoisted(() => ({
  row: null as null | Record<string, unknown>,
  viewer: null as null | Record<string, unknown>,
  aiAllowed: true,
  level: "EMPLOYEE" as string | null,
  zone: null as string | null,
  orgZone: null as string | null,
  reads: 0,
  where: null as unknown,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findFirst: async (a: { where: unknown }) => {
        db.reads += 1;
        db.where = a.where;
        return db.row;
      },
    },
  },
}));
vi.mock("@/lib/access/viewer", () => ({ viewerHeldIn: async () => db.viewer }));
vi.mock("@/lib/access", () => ({ can: async () => ({ allowed: db.aiAllowed }) }));
vi.mock("@/lib/access/acting-workspace", () => ({ levelHeldIn: async () => db.level }));
vi.mock("@/lib/preferences", () => ({ getEffectivePreferences: async () => ({ home: { locale: { timezone: db.zone } } }) }));
vi.mock("@/lib/work-schedule-server", () => ({ readOrgWorkSchedule: async () => ({ timezone: db.orgZone }) }));

import { actingPersonFor, actorLabelFor, itemCtxFor, resolveActingPerson, toolCtxFor } from "./acting";

beforeEach(() => {
  db.row = { id: "me", organizationId: "org", ...legacyLevelRow("EMPLOYEE"), status: "ACTIVE", deletedAt: null, firstName: "Priya", lastName: "Shah", email: "priya@x.com" };
  db.viewer = { userId: "me", organizationId: "org", orgRole: "MEMBER", isAgent: false, adminScopes: [] };
  db.aiAllowed = true;
  db.level = "EMPLOYEE";
  db.zone = "Asia/Kolkata";
  db.orgZone = "Europe/London";
  db.reads = 0;
});

describe("resolveActingPerson", () => {
  it("refuses anyone a teammate may not act for, naming why", async () => {
    db.row = null;
    expect(await resolveActingPerson("org", "me")).toEqual({ ok: false, reason: "gone" });
    db.row = { id: "me", organizationId: "org", status: "ACTIVE", deletedAt: new Date(), firstName: "P", lastName: "S", email: "p@x.com" };
    expect(await resolveActingPerson("org", "me")).toEqual({ ok: false, reason: "gone" });
    db.row = { id: "me", organizationId: "org", status: "INACTIVE", deletedAt: null, firstName: "P", lastName: "S", email: "p@x.com" };
    expect(await resolveActingPerson("org", "me")).toEqual({ ok: false, reason: "inactive" });
  });

  it("refuses a Guest, an agent account, a person without AI, and a person with no level here", async () => {
    db.viewer = null;
    expect(await resolveActingPerson("org", "me")).toEqual({ ok: false, reason: "gone" });
    db.viewer = { userId: "me", organizationId: "org", orgRole: "GUEST", isAgent: false, adminScopes: [] };
    expect(await resolveActingPerson("org", "me")).toEqual({ ok: false, reason: "guest" });
    db.viewer = { userId: "me", organizationId: "org", orgRole: "MEMBER", isAgent: true, adminScopes: [] };
    expect(await resolveActingPerson("org", "me")).toEqual({ ok: false, reason: "agent_account" });
    db.viewer = { userId: "me", organizationId: "org", orgRole: "MEMBER", isAgent: false, adminScopes: [] };
    db.aiAllowed = false;
    expect(await resolveActingPerson("org", "me")).toEqual({ ok: false, reason: "ai_off" });
    db.aiAllowed = true;
    db.level = null;
    expect(await resolveActingPerson("org", "me")).toEqual({ ok: false, reason: "gone" });
  });

  it("acts for a person working here through a second membership at that membership's level", async () => {
    // Anchored in another workspace (they last switched there); a Manager here.
    db.row = { id: "me", organizationId: "home", ...legacyLevelRow("ADMIN"), status: "ACTIVE", deletedAt: null, firstName: "Priya", lastName: "Shah", email: "priya@x.com" };
    db.level = "MANAGER";
    const r = await resolveActingPerson("org", "me");
    if (!r.ok) throw new Error("expected a person");
    expect(r.person).toMatchObject({ userId: "me", organizationId: "org" });
    expect(legacyLevelOf({ user: r.person })).toBe("MANAGER");
    // Read by id, never by the anchored workspace.
    expect(db.where).toEqual({ id: "me" });
  });

  it("answers the person, their names and their own zone, else the workspace's, else UTC", async () => {
    const r = await resolveActingPerson("org", "me");
    expect(r).toMatchObject({ ok: true, person: { userId: "me", organizationId: "org", orgRole: "MEMBER", name: "Priya Shah", firstName: "Priya", email: "priya@x.com", timezone: "Asia/Kolkata" } });
    db.zone = "Mars/Base";
    expect(await resolveActingPerson("org", "me")).toMatchObject({ person: { timezone: "Europe/London" } });
    db.orgZone = null;
    expect(await resolveActingPerson("org", "me")).toMatchObject({ person: { timezone: "UTC" } });
  });

  it("says whether the person chose their zone, so the calendar tools never take the workspace's for theirs (review of step 4)", async () => {
    expect(await resolveActingPerson("org", "me")).toMatchObject({ person: { timezone: "Asia/Kolkata", savedTimezone: "Asia/Kolkata" } });
    // Never picked one: dates still read in the workspace's, but nothing says it is theirs.
    db.zone = null;
    expect(await resolveActingPerson("org", "me")).toMatchObject({ person: { timezone: "Europe/London", savedTimezone: null } });
  });
});

describe("the tool context", () => {
  it("carries the person it was built for, so a call does not read them again", async () => {
    const r = await resolveActingPerson("org", "me");
    if (!r.ok) throw new Error("expected a person");
    const ctx = toolCtxFor(r.person, { agentId: "a1", agentName: "Chief of Staff", sessionId: "s1", routineId: null, trigger: "CHAT" });
    expect(ctx).toEqual({ orgId: "org", userId: "me", teammate: { agentId: "a1", agentName: "Chief of Staff", sessionId: "s1", routineId: null, trigger: "CHAT", timezone: "Asia/Kolkata" } });
    const before = db.reads;
    expect(await actingPersonFor(ctx)).toBe(r.person);
    expect(db.reads).toBe(before);
    // A context the caller built itself is read fresh, by the same rules.
    db.viewer = { userId: "me", organizationId: "org", orgRole: "GUEST", isAgent: false, adminScopes: [] };
    expect(await actingPersonFor({ orgId: "org", userId: "me" })).toBeNull();
  });

  it("gives the item routes the person as a signed-in caller, and the audit row both names", async () => {
    const r = await resolveActingPerson("org", "me");
    if (!r.ok) throw new Error("expected a person");
    const c = itemCtxFor(r.person);
    expect(c).toMatchObject({ userId: "me", organizationId: "org", userName: "Priya Shah" });
    expect(legacyLevelOf({ user: c })).toBe("EMPLOYEE");
    expect(actorLabelFor({ name: "Chief of Staff" }, r.person)).toBe("Chief of Staff for Priya Shah");
  });
});
