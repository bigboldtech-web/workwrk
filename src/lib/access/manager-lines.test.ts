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
const st = vi.hoisted(() => ({ users: new Map<string, U>(), dotted: [] as Array<{ userId: string; managerId: string }> }));

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
  return { prisma: { user, userDottedLine, $queryRaw } };
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
import { getAllDirectReports, getEffectiveReportTree, getSolidReportTree, isInReportTree } from "@/lib/reporting-line";
import { getTeamUserIds } from "@/lib/team";
import { hasReports } from "./resolve";
import type { Viewer } from "./types";

const ORG = "org";
const add = (id: string, managerId: string | null, accessLevel = "EMPLOYEE", extra: Partial<U> = {}) =>
  st.users.set(id, { id, organizationId: ORG, managerId, accessLevel, status: "ACTIVE", deletedAt: null, firstName: id, lastName: "", ...extra });

beforeEach(() => {
  st.users.clear();
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
    expect(await managesNobody("sam")).toBe(true);
    expect(await managesNobody("mona")).toBe(false);
    expect(await getTeamUserIds(ORG, "sam")).toEqual(["sam"]);
    expect(await getEffectiveReportTree("sam")).toEqual(["sam"]);
    expect(await getSolidReportTree("sam", { includeRoot: false })).toEqual([]);
    expect(await isInReportTree("sam", "ida")).toBe(false);
    expect(await getAllDirectReports("sam")).toEqual([]);
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
    expect(await isInReportTree("mona", "lou")).toBe(true);
  });

  it("has them as direct reports: the people listed under an Agent report to the manager above", async () => {
    expect(new Set(await effectiveDirectReportIds(ORG, "mona"))).toEqual(new Set(["sam", "max", "ida", "ace", "lou"]));
    expect(new Set(await getAllDirectReports("mona"))).toEqual(new Set(["sam", "max", "ida", "ace", "lou", "dee"]));
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
    expect(await getEffectiveReportTree("vp")).not.toContain("dee");
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
