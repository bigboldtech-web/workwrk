// Sub-teams (/team/rollup) and the Agent tier (docs-found fixes batch 4).
// An Agent is nobody's manager, so an Agent is no sub-team lead, and the
// people listed under an Agent count where the line reads them:
//   the org view   (the People team and Admin read the top of the org) an
//                  Agent with no manager and stored reports showed as a
//                  sub-team lead over them; now the Agent is a direct IC and
//                  the people under them stand at the top themselves
//   a sub-team     a direct's sub-team left out the people listed under an
//                  Agent below that direct; now they count in it

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/weekly-review", () => ({ weekStartFor: () => new Date("2026-10-05T00:00:00.000Z") }));
vi.mock("@/lib/person-alignment", () => ({ currentPeriodKey: () => "2026-10" }));

type U = { id: string; organizationId: string; managerId: string | null; accessLevel: string; deletedAt: Date | null; firstName: string; lastName: string; email: string; avatar: null };
const users = vi.hoisted(() => new Map<string, unknown>());

vi.mock("@/lib/prisma", () => {
  type W = { id?: string | { in: string[] }; organizationId?: string; managerId?: string | { in: string[] }; deletedAt?: null };
  const ok = (u: U, w: W) =>
    (w.id === undefined || (typeof w.id === "string" ? u.id === w.id : w.id.in.includes(u.id))) &&
    (w.organizationId === undefined || u.organizationId === w.organizationId) &&
    (w.managerId === undefined || (typeof w.managerId === "string" ? u.managerId === w.managerId : !!u.managerId && w.managerId.in.includes(u.managerId))) &&
    (!("deletedAt" in w) || !u.deletedAt);
  const all = () => [...users.values()] as U[];
  return {
    prisma: {
      user: {
        findMany: async (a: { where: W }) => all().filter((u) => ok(u, a.where)),
        findUnique: async (a: { where: { id: string } }) => users.get(a.where.id) ?? null,
      },
      organizationMembership: { findMany: async () => [], findUnique: async () => null },
      userDottedLine: { findMany: async () => [] },
      kRAAssignment: { groupBy: async () => [] },
      kPIRecord: { findMany: async () => [] },
      sOPAssignment: { findMany: async () => [] },
      weeklyReview: { findMany: async () => [] },
    },
  };
});

import { getDirectorRollup } from "./team-rollup";

const add = (id: string, managerId: string | null, level = "EMPLOYEE") =>
  users.set(id, { id, organizationId: "org", managerId, ...legacyLevelRow(level), deletedAt: null, firstName: id, lastName: "", email: `${id}@x`, avatar: null });

beforeEach(() => {
  users.clear();
  // vp > mona > sam (Agent, made before rule 6) > ida ; mona > max
  // rex (Agent, no manager) > tia, tom
  add("vp", null, "VP");
  add("mona", "vp", "MANAGER");
  add("sam", "mona", "AGENT");
  add("ida", "sam");
  add("max", "mona");
  add("rex", null, "AGENT");
  add("tia", "rex");
  add("tom", "rex");
});

describe("the org view (the People team and Admin)", () => {
  it("shows no Agent as a sub-team lead, and the people under an Agent at the top", async () => {
    const r = await getDirectorRollup({ directorId: "admin", organizationId: "org", rootIds: ["vp", "rex"] });
    expect(r.subTeams.map((t) => t.manager.id)).toEqual(["vp"]);
    expect(r.directIcs.map((d) => d.id).sort()).toEqual(["rex", "tia", "tom"]);
  });
});

describe("a director's sub-teams", () => {
  it("count the people listed under an Agent below a direct in that direct's sub-team", async () => {
    const r = await getDirectorRollup({ directorId: "vp", organizationId: "org" });
    const mona = r.subTeams.find((t) => t.manager.id === "mona");
    expect(mona?.metrics.reportCount).toBe(3);
  });
});
