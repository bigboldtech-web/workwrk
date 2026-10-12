// "An Agent is never anyone's manager" for lines stored before rule 6
// (docs-found fixes batch 3, src/lib/access/manager-lines.ts). Rule 6 stops a
// manager becoming an Agent while anyone reports to them, but an Agent made
// before it kept every report and dotted line, and every read that grants
// reach followed them: the report trees (the engine's viewer, peopleCtx's
// chain and chain-view, hasReports and the manager app floors), the direct
// reports, and the manager a review, a timesheet or a weekly review names.
// Nothing stored is rewritten; the reads say what the sentence says.
//
// The workspace, in memory:
//
//   vp                      (VP)
//   └ mona                  (Manager)
//     ├ sam                 (Agent, made before rule 6)
//     │ ├ ida               (Member)  └ kim (Member)
//     │ └ ace               (Agent)   └ lou (Member)
//     └ max                 (Member)
//   orphan > gone (removed) ; gone2 > rex (Agent) > tia
//   dotted lines: dee > sam, dee > mona

import { beforeEach, describe, expect, it, vi } from "vitest";

type U = { id: string; organizationId: string; managerId: string | null; accessLevel: string; status: string; deletedAt: Date | null; firstName: string; lastName: string };
type M = { userId: string; organizationId: string; role: string };
const st = vi.hoisted(() => ({ users: new Map<string, U>(), dotted: [] as Array<{ userId: string; managerId: string }>, memberships: [] as M[] }));

type Where = Record<string, unknown>;
function matches(row: Record<string, unknown>, where: Where | undefined): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === "user" || k === "manager") {
      const id = row[k === "user" ? "userId" : "managerId"] as string;
      const u = st.users.get(id);
      if (!u || !matches(u, v as Where)) return false;
      continue;
    }
    const val = row[k];
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const o = v as { in?: unknown[]; not?: unknown };
      if (o.in && !o.in.includes(val)) return false;
      if ("not" in o && val === o.not) return false;
      continue;
    }
    if (v === null ? val != null : val !== v) return false;
  }
  return true;
}
const users = () => [...st.users.values()];

vi.mock("@/lib/prisma", () => {
  const user = {
    findUnique: async (a: { where: { id: string } }) => st.users.get(a.where.id) ?? null,
    findFirst: async (a: { where: Where }) => users().find((u) => matches(u, a.where)) ?? null,
    findMany: async (a: { where: Where }) => users().filter((u) => matches(u, a.where)),
    count: async (a: { where: Where }) => users().filter((u) => matches(u, a.where)).length,
    groupBy: async (a: { where: Where }) => {
      const by = new Map<string, number>();
      for (const u of users().filter((x) => matches(x, a.where))) if (u.managerId) by.set(u.managerId, (by.get(u.managerId) ?? 0) + 1);
      return [...by].map(([managerId, n]) => ({ managerId, _count: { _all: n } }));
    },
  };
  const userDottedLine = {
    findMany: async (a: { where: Where }) =>
      st.dotted.filter((d) => matches(d, a.where)).map((d) => ({ ...d, manager: { accessLevel: st.users.get(d.managerId)?.accessLevel ?? null } })),
    count: async (a: { where: Where }) => st.dotted.filter((d) => matches(d, a.where)).length,
    groupBy: async (a: { where: Where }) => {
      const by = new Map<string, number>();
      for (const d of st.dotted.filter((x) => matches(x, a.where))) by.set(d.managerId, (by.get(d.managerId) ?? 0) + 1);
      return [...by].map(([managerId, n]) => ({ managerId, _count: { _all: n } }));
    },
  };
  // The two recursive walks (team.ts, reporting-line.ts), answered over the
  // same rows: everyone below the root through stored lines, removed people
  // ending the walk, the root first.
  const $queryRaw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const root = values[0] as string;
    const r = st.users.get(root);
    if (!r || r.deletedAt) return [];
    const out = [{ id: root, depth: 0 }];
    const seen = new Set([root]);
    for (let i = 0; i < out.length; i += 1) {
      for (const u of users()) {
        if (u.managerId === out[i].id && !u.deletedAt && !seen.has(u.id)) {
          seen.add(u.id);
          out.push({ id: u.id, depth: out[i].depth + 1 });
        }
      }
    }
    void strings;
    return out;
  };
  // A person's second workspaces (acting-workspace.ts levelHeldIn).
  const organizationMembership = {
    findUnique: async (a: { where: { userId_organizationId: { userId: string; organizationId: string } } }) =>
      st.memberships.find((m) => m.userId === a.where.userId_organizationId.userId && m.organizationId === a.where.userId_organizationId.organizationId) ?? null,
    findMany: async (a: { where: { organizationId: string; userId: { in: string[] } } }) =>
      st.memberships.filter((m) => m.organizationId === a.where.organizationId && a.where.userId.in.includes(m.userId)),
  };
  return { prisma: { user, userDottedLine, organizationMembership, $queryRaw } };
});
vi.mock("server-only", () => ({}));

import {
  agentStoredReports,
  agentsWithStoredReports,
  countedDottedManagerIds,
  countedDottedReportIds,
  effectiveDirectReportIds,
  effectiveManagerOf,
  effectiveManagersOf,
  managesNobody,
  reportsThroughAgents,
} from "./manager-lines";
import { agentIdsIn } from "./manager-candidate";
import { getAllDirectReports, getEffectiveReportTree, getSolidReportTree, isInReportTree } from "@/lib/reporting-line";
import { getTeamUserIds } from "@/lib/team";
import { hasReports } from "./resolve";
import type { Viewer } from "./types";

const ORG = "org";
const add = (id: string, managerId: string | null, accessLevel = "EMPLOYEE", extra: Partial<U> = {}) =>
  st.users.set(id, { id, organizationId: ORG, managerId, accessLevel, status: "ACTIVE", deletedAt: null, firstName: id, lastName: "", ...extra });

beforeEach(() => {
  st.users.clear();
  st.memberships = [];
  add("vp", null, "VP");
  add("mona", "vp", "MANAGER");
  add("sam", "mona", "AGENT");
  add("ida", "sam");
  add("kim", "ida");
  add("ace", "sam", "AGENT");
  add("lou", "ace");
  add("max", "mona");
  add("orphan", null);
  add("gone", "orphan", "MANAGER", { deletedAt: new Date("2026-01-01") });
  add("gone2", null, "MANAGER", { deletedAt: new Date("2026-01-01") });
  add("rex", "gone2", "AGENT");
  add("tia", "rex");
  add("dee", null);
  st.dotted = [{ userId: "dee", managerId: "sam" }, { userId: "dee", managerId: "mona" }];
});

describe("an Agent's own reach", () => {
  it("is nobody: no team, no tree, no direct or dotted reports", async () => {
    expect(await managesNobody("sam", ORG)).toBe(true);
    expect(await managesNobody("mona", ORG)).toBe(false);
    expect(await getTeamUserIds(ORG, "sam")).toEqual(["sam"]);
    expect(await getEffectiveReportTree("sam", { organizationId: ORG })).toEqual(["sam"]);
    expect(await getSolidReportTree("sam", { organizationId: ORG }, { includeRoot: false })).toEqual([]);
    expect(await isInReportTree("sam", "ida", { organizationId: ORG })).toBe(false);
    expect(await getAllDirectReports("sam", ORG)).toEqual([]);
    expect(await effectiveDirectReportIds(ORG, "sam")).toEqual([]);
    expect(await countedDottedReportIds(ORG, "sam")).toEqual([]);
  });

  it("hasReports is false for an Agent whatever tree a caller built", () => {
    const viewer = { userId: "sam", organizationId: ORG, orgRole: "MEMBER", isAgent: true, adminScopes: [], reportTree: new Set(["ida"]) } as unknown as Viewer;
    expect(hasReports(viewer)).toBe(false);
    expect(hasReports({ ...viewer, isAgent: false })).toBe(true);
  });
});

describe("the manager above an Agent", () => {
  it("still reaches everyone listed under the Agent through the tree, as before", async () => {
    expect(new Set(await getTeamUserIds(ORG, "mona"))).toEqual(new Set(["mona", "sam", "ida", "kim", "ace", "lou", "max"]));
    expect(await isInReportTree("mona", "lou", { organizationId: ORG })).toBe(true);
  });

  it("has them as direct reports: the people listed under an Agent report to the manager above", async () => {
    expect(new Set(await effectiveDirectReportIds(ORG, "mona"))).toEqual(new Set(["sam", "max", "ida", "ace", "lou"]));
    expect(new Set(await getAllDirectReports("mona", ORG))).toEqual(new Set(["sam", "max", "ida", "ace", "lou", "dee"]));
    expect(new Set(await reportsThroughAgents(ORG, "mona"))).toEqual(new Set(["ida", "ace", "lou"]));
    // A manager with no Agent below has only their own.
    expect(await effectiveDirectReportIds(ORG, "ida")).toEqual(["kim"]);
  });
});

describe("effectiveManagersOf", () => {
  it("answers the next manager up who is no Agent, through any number of Agents", async () => {
    const m = await effectiveManagersOf(ORG, ["ida", "lou", "sam", "max", "kim"]);
    expect(Object.fromEntries(m)).toEqual({ ida: "mona", lou: "mona", sam: "mona", max: "mona", kim: "ida" });
    expect(await effectiveManagerOf(ORG, "lou")).toBe("mona");
  });

  it("answers nobody when the line past an Agent reaches a removed person, and keeps a stored manager who is no Agent as stored", async () => {
    expect(await effectiveManagerOf(ORG, "tia")).toBeNull();
    // gone is removed but no Agent: the stored answer stands, as before.
    add("pat", "gone");
    expect(await effectiveManagerOf(ORG, "pat")).toBe("gone");
  });

  it("answers nobody for a loop of Agents, and never hangs", async () => {
    add("a1", "a2", "AGENT");
    add("a2", "a1", "AGENT");
    add("p1", "a1");
    expect(await effectiveManagerOf(ORG, "p1")).toBeNull();
  });
});

describe("dotted lines", () => {
  it("to an Agent count for nobody, and are never handed up the line", async () => {
    expect(await countedDottedManagerIds(ORG, "dee")).toEqual(["mona"]);
    expect(await countedDottedReportIds(ORG, "mona")).toEqual(["dee"]);
    // The vp above sam gets nothing from sam's dotted line.
    expect(await getEffectiveReportTree("vp", { organizationId: ORG })).not.toContain("dee");
  });
});

describe("what an Admin is shown", () => {
  it("counts an Agent's stored reports by kind, and nothing for anyone else", async () => {
    expect(await agentStoredReports(ORG, "sam")).toEqual({ solid: 2, dotted: 1 });
    expect(await agentStoredReports(ORG, "mona")).toEqual({ solid: 0, dotted: 0 });
    const many = await agentsWithStoredReports(ORG, ["sam", "ace", "mona", "rex"]);
    expect(Object.fromEntries(many)).toEqual({ sam: { solid: 2, dotted: 1 }, ace: { solid: 1, dotted: 0 }, rex: { solid: 1, dotted: 0 } });
  });
});

// Docs-found fixes batch 4: the tier that counts is the one held in the
// workspace whose lines are read. A person who switched workspaces, or
// accepted an invitation while signed in, is anchored elsewhere: their row's
// level is that workspace's, while their reports and a session on another
// device stay here, at the role their membership holds here.
describe("the tier held in this workspace", () => {
  it("a Manager here who is an Agent where they are anchored keeps their team here", async () => {
    // dana manages kai and lin here, then accepted an invitation to "client" as an Agent.
    add("dana", "mona", "AGENT", { organizationId: "client" });
    st.memberships.push({ userId: "dana", organizationId: ORG, role: "MANAGER" });
    add("kai", "dana");
    add("lin", "dana");
    expect(await managesNobody("dana", ORG)).toBe(false);
    expect(await managesNobody("dana", "client")).toBe(true);
    expect(new Set(await getTeamUserIds(ORG, "dana"))).toEqual(new Set(["dana", "kai", "lin"]));
    expect(new Set(await getEffectiveReportTree("dana", { organizationId: ORG }))).toEqual(new Set(["dana", "kai", "lin"]));
    expect(new Set(await effectiveDirectReportIds(ORG, "dana"))).toEqual(new Set(["kai", "lin"]));
    expect(await isInReportTree("dana", "kai", { organizationId: ORG })).toBe(true);
    expect(await effectiveManagerOf(ORG, "kai")).toBe("dana");
  });

  it("an Agent here who is a Manager where they are anchored manages nobody here", async () => {
    // ava holds the Agent tier here through a membership, and still has stored reports here.
    add("ava", "mona", "MANAGER", { organizationId: "client" });
    st.memberships.push({ userId: "ava", organizationId: ORG, role: "AGENT" });
    add("noa", "ava");
    st.dotted.push({ userId: "max", managerId: "ava" });
    expect(await managesNobody("ava", ORG)).toBe(true);
    expect(await getTeamUserIds(ORG, "ava")).toEqual(["ava"]);
    expect(await getEffectiveReportTree("ava", { organizationId: ORG })).toEqual(["ava"]);
    expect(await effectiveDirectReportIds(ORG, "ava")).toEqual([]);
    expect(await countedDottedReportIds(ORG, "ava")).toEqual([]);
    // noa reports, in effect, to the manager above ava here.
    expect(await effectiveManagerOf(ORG, "noa")).toBe("mona");
    expect(await countedDottedManagerIds(ORG, "max")).toEqual([]);
    expect((await agentIdsIn(ORG, ["ava"])).has("ava")).toBe(true);
  });

  it("a stored manager who holds no level in this workspace is nobody's manager here", async () => {
    // joe joined here from "client" while signed in: his row kept olga, client's manager.
    add("olga", null, "MANAGER", { organizationId: "client" });
    add("joe", "olga");
    expect(await effectiveManagerOf(ORG, "joe")).toBeNull();
    // With a membership here, she manages him here.
    st.memberships.push({ userId: "olga", organizationId: ORG, role: "MANAGER" });
    expect(await effectiveManagerOf(ORG, "joe")).toBe("olga");
  });

  it("a dotted-line manager who works here through a membership still counts, at the tier held here", async () => {
    add("pam", null, "MANAGER", { organizationId: "client" });
    st.memberships.push({ userId: "pam", organizationId: ORG, role: "MANAGER" });
    st.dotted.push({ userId: "max", managerId: "pam" });
    expect(await countedDottedManagerIds(ORG, "max")).toEqual(["pam"]);
  });
});

describe("nobody is their own manager", () => {
  it("a stored loop through an Agent back to the person names nobody", async () => {
    // pia > axe (Agent) > pia: the walk past axe lands on pia herself.
    add("axe", "pia", "AGENT");
    add("pia", "axe");
    expect(await effectiveManagerOf(ORG, "pia")).toBeNull();
    // A stored self-line too.
    add("sol", "sol");
    expect(await effectiveManagerOf(ORG, "sol")).toBeNull();
  });
});

describe("many managers at once (the Sub-teams page)", () => {
  it("each direct's reports read past an Agent, and an Agent leads nobody", async () => {
    const { effectiveReportsOfMany, listedUnderAgents } = await import("./manager-lines");
    const many = await effectiveReportsOfMany(ORG, ["mona", "sam", "ida"]);
    expect(new Set(many.get("mona"))).toEqual(new Set(["sam", "max", "ida", "ace", "lou"]));
    expect(many.get("sam")).toEqual([]);
    expect(many.get("ida")).toEqual(["kim"]);
    // The people under an Agent at the top of the org (rex has no manager above).
    expect(await listedUnderAgents(ORG, ["rex"])).toEqual(["tia"]);
  });
});
