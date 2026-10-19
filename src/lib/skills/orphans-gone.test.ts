// The orphan checks' light read (src/lib/skills/orphans.ts personGoneNow,
// final races review, M2) held to the rule it replaces: for every kind of
// person, it answers "gone" exactly when the real resolveActingPerson
// (src/lib/agents/acting.ts) answers "gone" or "inactive" in that workspace.
// Both run here over one in-memory table of people and memberships, the
// real levelHeldIn under resolveActingPerson; its viewer, AI app and time
// zone reads are answered as their own modules would, since the rule never
// reads them.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ users: [] as Row[], memberships: [] as Row[], aiAllowed: new Set<string>(), reads: 0 }));

vi.mock("@/lib/prisma", () => {
  const pick = (r: Row, select?: Record<string, unknown>) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, r[k] ?? null])) : { ...r });
  return {
    prisma: {
      user: {
        findFirst: async (a: { where: { id: string }; select?: Record<string, unknown> }) => {
          db.reads += 1;
          const r = db.users.find((u) => u.id === a.where.id);
          return r ? pick(r, a.select) : null;
        },
        findUnique: async (a: { where: { id: string }; select?: Record<string, unknown> }) => {
          db.reads += 1;
          const r = db.users.find((u) => u.id === a.where.id);
          return r ? pick(r, a.select) : null;
        },
      },
      organizationMembership: {
        findUnique: async (a: { where: { userId_organizationId: { userId: string; organizationId: string } }; select?: Record<string, unknown> }) => {
          db.reads += 1;
          const k = a.where.userId_organizationId;
          const r = db.memberships.find((m) => m.userId === k.userId && m.organizationId === k.organizationId);
          return r ? pick(r, a.select) : null;
        },
      },
      agent: { findFirst: async () => null },
    },
  };
});
// The viewer at the level held here, as viewerHeldIn builds it (null only with no id or workspace), its role by the level and the stored Guest mark.
vi.mock("@/lib/access/viewer", async () => {
  const { orgRoleOf, isAgentOf } = await import("@/lib/access/org-role");
  return {
    viewerHeldIn: async (organizationId: string, userId: string, level: string) => {
      if (!userId || !organizationId) return null;
      const row = db.users.find((u) => u.id === userId);
      const role = orgRoleOf(legacyLevelRow(level));
      return { userId, organizationId, orgRole: role === "MEMBER" && row?.orgRole === "GUEST" ? "GUEST" : role, isAgent: isAgentOf(level), adminScopes: [] };
    },
  };
});
vi.mock("@/lib/access", () => ({ can: async (v: { userId: string }) => ({ allowed: db.aiAllowed.has(v.userId) }) }));
vi.mock("@/lib/preferences", () => ({ getEffectivePreferences: async () => ({ home: { locale: { timezone: "Europe/London" } } }) }));
vi.mock("@/lib/work-schedule-server", () => ({ readOrgWorkSchedule: async () => ({ timezone: "Europe/London" }) }));

import { resolveActingPerson } from "@/lib/agents/acting";
import { personGoneNow } from "./orphans";

const person = (o: Row): Row => ({ organizationId: "org1", ...legacyLevelRow("EMPLOYEE"), status: "ACTIVE", deletedAt: null, firstName: "P", lastName: "S", email: "p@proof.test", ...o });

beforeEach(() => {
  db.users = [];
  db.memberships = [];
  db.aiAllowed = new Set();
  db.reads = 0;
});

describe("personGoneNow, against resolveActingPerson", () => {
  it("answers gone exactly where the acting person is gone or inactive, for every kind of person", async () => {
    db.users = [
      person({ id: "u-here" }),
      person({ id: "u-admin", ...legacyLevelRow("COMPANY_ADMIN") }),
      person({ id: "u-deleted", deletedAt: new Date() }),
      person({ id: "u-inactive", status: "INACTIVE" }),
      person({ id: "u-inactive-deleted", status: "INACTIVE", deletedAt: new Date() }),
      person({ id: "u-inactive-elsewhere", status: "INACTIVE", organizationId: "org2" }),
      person({ id: "u-left", organizationId: "org2" }),
      person({ id: "u-member", organizationId: "org2" }),
      person({ id: "u-member-deleted", organizationId: "org2", deletedAt: new Date() }),
      person({ id: "u-guest", orgRole: "GUEST" }),
      person({ id: "u-agent", ...legacyLevelRow("AGENT") }),
      person({ id: "u-ai-off" }),
      person({ id: "u-invited", status: "INVITED" }),
    ];
    db.memberships = [
      { userId: "u-member", organizationId: "org1", role: "MANAGER" },
      { userId: "u-member-deleted", organizationId: "org1", role: "MANAGER" },
      { userId: "u-inactive-elsewhere", organizationId: "org1", role: "EMPLOYEE" },
    ];
    for (const u of db.users) if (u.id !== "u-ai-off") db.aiAllowed.add(String(u.id));
    const ids = [...db.users.map((u) => String(u.id)), "u-missing", ""];
    const rows: Array<[string, string, boolean, boolean]> = [];
    for (const org of ["org1", "org2", "org3"]) {
      for (const id of ids) {
        const r = await resolveActingPerson(org, id);
        const old = !r.ok && (r.reason === "gone" || r.reason === "inactive");
        rows.push([org, id, old, await personGoneNow(org, id)]);
      }
    }
    // The same answer everywhere.
    expect(rows.filter(([, , old, now]) => old !== now)).toEqual([]);
    // And the table is not trivial: both answers occur, for the reasons the rule names.
    const gone = rows.filter(([org, , , now]) => org === "org1" && now).map(([, id]) => id);
    expect(gone.sort()).toEqual(["", "u-deleted", "u-inactive", "u-inactive-deleted", "u-inactive-elsewhere", "u-left", "u-member-deleted", "u-missing"].sort());
    // A Guest, an agent account and AI off are not acted for, but their skills are not orphans.
    expect((await resolveActingPerson("org1", "u-guest")).ok).toBe(false);
    expect(await personGoneNow("org1", "u-guest")).toBe(false);
  });

  it("makes one read for a person anchored here and two for one working here through a membership", async () => {
    db.users = [person({ id: "u-here" }), person({ id: "u-member", organizationId: "org2" })];
    db.memberships = [{ userId: "u-member", organizationId: "org1", role: "MANAGER" }];
    await personGoneNow("org1", "u-here");
    expect(db.reads).toBe(1);
    db.reads = 0;
    await personGoneNow("org1", "u-member");
    expect(db.reads).toBe(2);
  });
});
