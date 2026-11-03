// Kept seats (docs/plans/workspace-status.md, step 1 review M2). A person
// deactivated in this workspace through their membership is still on its
// lines, as one deactivated while anchored here is: counted under their
// manager (reportCountOf, rule 6), in the handover's line facts as inactive
// (lineFactsAround), among a manager's reports (effectiveDirectReportIds,
// liveHereAmong), on the Agent tier (agentIdsIn) and on the loop walk
// (lineAbove). The one-time SQL step made every deactivated account's
// memberships INACTIVE, so without kept seats all of these lost those people
// on the deploy. A removed membership stays out, as a removed account does,
// and every decision about the person's own access keeps live seats.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type U = { id: string; organizationId: string; managerId: string | null; accessLevel: string; status: string; deletedAt: Date | null };
type M = { userId: string; organizationId: string; role: string; status: string; removedAt: Date | null };
const st = vi.hoisted(() => ({ users: new Map<string, U>(), memberships: [] as M[], dotted: [] as Array<{ userId: string; managerId: string }> }));

vi.mock("@/lib/prisma", () => {
  type W = Record<string, unknown>;
  const eq = (v: unknown, c: unknown) => (c && typeof c === "object" && "in" in (c as W) ? (c as { in: unknown[] }).in.includes(v) : v === c);
  const userOk = (u: U, w: W): boolean => {
    for (const [k, c] of Object.entries(w)) {
      if (k === "deletedAt") {
        if (c !== null) throw new Error(`fake: deletedAt ${JSON.stringify(c)}`);
        if (u.deletedAt) return false;
      } else if (k === "id" || k === "managerId" || k === "organizationId") {
        if (!eq(u[k], c)) return false;
      } else throw new Error(`fake: unknown user field ${k}`);
    }
    return true;
  };
  const users = () => [...st.users.values()];
  return {
    prisma: {
      user: {
        findMany: async (a: { where: W }) => users().filter((u) => userOk(u, a.where)).map((u) => ({ ...u })),
        findFirst: async (a: { where: W }) => users().find((u) => userOk(u, a.where)) ?? null,
        findUnique: async (a: { where: { id: string } }) => st.users.get(a.where.id) ?? null,
      },
      userDottedLine: {
        findMany: async (a: { where: { managerId: string; user?: { deletedAt: null } } }) =>
          st.dotted.filter((d) => d.managerId === a.where.managerId && !(a.where.user && st.users.get(d.userId)?.deletedAt)),
      },
      organizationMembership: {
        findUnique: async (a: { where: { userId_organizationId: { userId: string; organizationId: string } } }) =>
          st.memberships.find((m) => m.userId === a.where.userId_organizationId.userId && m.organizationId === a.where.userId_organizationId.organizationId) ?? null,
        findMany: async (a: { where: { organizationId: string; userId: { in: string[] } } }) =>
          st.memberships.filter((m) => m.organizationId === a.where.organizationId && a.where.userId.in.includes(m.userId)),
      },
    },
  };
});

import { prisma } from "@/lib/prisma";
import { levelHeldIn, levelsHeldFor, levelsHeldIn, seatsHeldFor } from "./acting-workspace";
import { reportCountOf } from "./membership";
import { effectiveDirectReportIds, lineFactsAround, liveHereAmong } from "./manager-lines";
import { agentIdsIn, lineAbove, wouldLoopIn } from "./manager-candidate";

const person = (id: string, organizationId: string, extra: Partial<U> = {}) =>
  st.users.set(id, { id, organizationId, managerId: null, accessLevel: "EMPLOYEE", status: "ACTIVE", deletedAt: null, ...extra });
const seat = (userId: string, organizationId: string, extra: Partial<M> = {}) =>
  st.memberships.push({ userId, organizationId, role: "EMPLOYEE", status: "ACTIVE", removedAt: null, ...extra });

beforeEach(() => {
  st.users.clear();
  st.memberships.length = 0;
  st.dotted.length = 0;
  // Max manages, in workspace B: Lia (anchored in A, live in B), Rita
  // (anchored and live in A, deactivated in B), Ron (anchored in A, removed
  // from B) and Dan (anchored in B, deactivated).
  person("max", "B", { accessLevel: "MANAGER" });
  person("lia", "A", { managerId: "max" });
  seat("lia", "B");
  person("rita", "A", { managerId: "max" });
  seat("rita", "B", { status: "INACTIVE" });
  person("ron", "A", { managerId: "max" });
  seat("ron", "B", { status: "INACTIVE", removedAt: new Date("2026-10-01") });
  person("dan", "B", { managerId: "max", status: "INACTIVE" });
});

describe("the level helpers, live by default and kept on request", () => {
  it("live seats leave out a deactivated membership; kept seats keep it, never a removed one", async () => {
    const ids = ["lia", "rita", "ron", "dan"];
    expect([...(await levelsHeldIn("B", ids)).keys()].sort()).toEqual(["dan", "lia"]);
    expect([...(await levelsHeldIn("B", ids, undefined, { keptSeats: true })).keys()].sort()).toEqual(["dan", "lia", "rita"]);
    const rows = ids.map((id) => st.users.get(id)!) as never[];
    expect([...(await levelsHeldFor("B", rows, undefined, { keptSeats: true })).keys()].sort()).toEqual(["dan", "lia", "rita"]);
    expect(await levelHeldIn("rita", "B")).toBeNull();
    expect(await levelHeldIn("rita", "B", undefined, undefined, { keptSeats: true })).toBe("EMPLOYEE");
    expect(await levelHeldIn("ron", "B", undefined, undefined, { keptSeats: true })).toBeNull();
  });

  it("seatsHeldFor says who is deactivated HERE: the membership's status, not the account's", async () => {
    const held = await seatsHeldFor("B", ["lia", "rita", "ron", "dan"].map((id) => st.users.get(id)!) as never[]);
    expect(Object.fromEntries(held)).toEqual({
      lia: { level: "EMPLOYEE", deactivated: false },
      // Live in A (her account is ACTIVE), deactivated in B.
      rita: { level: "EMPLOYEE", deactivated: true },
      dan: { level: "EMPLOYEE", deactivated: true },
    });
  });
});

describe("the reads that keep deactivated people on this workspace's lines", () => {
  it("reportCountOf counts a report deactivated here through a membership, as one deactivated while anchored here", async () => {
    // Before (step 1): 2, so Max could be made an Agent with Rita under him.
    expect(await reportCountOf(prisma as never, "B", "max")).toBe(3);
  });

  it("lineFactsAround has her, inactive here though her account is live", async () => {
    const facts = await lineFactsAround("B", "max", []);
    expect(facts.get("rita")).toEqual({ managerId: "max", agent: false, inactive: true });
    expect(facts.get("lia")).toEqual({ managerId: "max", agent: false, inactive: false });
    expect(facts.get("dan")).toMatchObject({ inactive: true });
    expect(facts.has("ron")).toBe(false);
  });

  it("effectiveDirectReportIds and liveHereAmong keep her, and leave out the removed one", async () => {
    expect((await effectiveDirectReportIds("B", "max")).sort()).toEqual(["dan", "lia", "rita"]);
    expect([...(await liveHereAmong("B", ["lia", "rita", "ron", "dan"]))].sort()).toEqual(["dan", "lia", "rita"]);
  });

  it("agentIdsIn keeps the Agent tier of someone deactivated here, as of an Agent anchored here", async () => {
    person("ava", "A");
    seat("ava", "B", { role: "AGENT", status: "INACTIVE" });
    person("ace", "B", { accessLevel: "AGENT", status: "INACTIVE" });
    expect([...(await agentIdsIn("B", ["ava", "ace", "lia"]))].sort()).toEqual(["ace", "ava"]);
  });

  it("the loop walk goes on through someone deactivated here, so a loop through her is still refused", async () => {
    person("xia", "B", { managerId: "rita" });
    expect([...(await lineAbove("B", "xia"))].sort()).toEqual(["max", "rita", "xia"]);
    // Max reporting to Xia would close Max, Rita, Xia.
    expect(await wouldLoopIn("B", "max", "xia")).toBe(true);
  });
});

// Every call of the level helpers outside acting-workspace.ts, and whether it
// asks for kept seats. A new call fails this test until it is listed with its
// reason.
describe("every caller of the level helpers says which seats it means", () => {
  type Choice = { live?: number; kept?: number; seats?: number };
  /**
   * live: a decision about the person's own access or reach, or whose a line
   *       is (a seat ended here is no one here).
   * kept: a count, a line fact or a name of people not removed, the Agent
   *       tier, the loop walk (deactivated people kept, as anchored ones).
   * seats: seatsHeldFor, kept seats with which are deactivated here.
   */
  const CALLERS: Record<string, Choice> = {
    "src/app/api/boot/route.ts": { live: 1 }, // the viewer's own level
    // who the record names, for someone anchored here and (the final review,
    // product M3) for a membership person's manager and reports here
    "src/app/api/users/[id]/route.ts": { kept: 2 },
    // My team's level here for each member (the final review, security L3):
    // a deactivated report stays listed, as the walk keeps them
    "src/app/api/my-team/route.ts": { kept: 1 },
    "src/app/api/users/[id]/dotted-lines/route.ts": { kept: 1 }, // the dotted lines listed (PUT deletes what is left out)
    "src/lib/access/profile-here.ts": { kept: 1 }, // a manager is named only while they hold a seat here (D18; Members, the Directory, the chart, the exports, v1 and /api/users)
    // reportCountOf; unattendedRecipient (who takes work: step 4 walks past a
    // manager deactivated here, through a membership too, as one anchored here)
    "src/lib/access/membership.ts": { kept: 1, seats: 1 },
    // check-in-access.server.ts no longer asks a level: reading someone's
    // check-ins asks for their seat here in any state (personSeatIn), as the
    // list reads every row written here (step 4).
    "src/lib/access/manager-candidate.ts": { live: 2, kept: 2 }, // managerCandidateIn and staleLinesOf; agentIdsIn and lineAbove
    "src/lib/oauth/eligibility.ts": { live: 2 }, // an AI app's access
    "src/lib/access/viewer.ts": { live: 1 }, // the viewer's own level
    "src/lib/access/self-facts.ts": { live: 1 },
    "src/lib/access/acting-person.ts": { live: 1 },
    "src/lib/agents/acting.ts": { live: 1, kept: 1 }, // the person a teammate acts for; kept only to say why not (deactivated here, or gone)
    "src/lib/agents/tools.ts": { live: 2 }, // a teammate's reads as the person
    "src/lib/people/person-access.server.ts": { live: 1 }, // the viewer's own level
    "src/lib/access/digest-recipients.ts": { live: 1 }, // who gets a manager's digest
    "src/lib/people/handover.server.ts": { kept: 1 }, // who another workspace's record names
    // managesNobody, effectiveManagersOf (reach, twice), countedDottedManagerIds
    // (reach), othersDottedLines, managerLineIsOthers and recordLinesOfOthers
    // (whose a line is) live; liveHereAmong kept; factsHere seats.
    "src/lib/access/manager-lines.ts": { live: 7, kept: 1, seats: 1 },
  };

  function sources(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (name === "generated" || name.startsWith(".")) continue;
      if (statSync(p).isDirectory()) sources(p, out);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !name.endsWith("-test-db.ts")) out.push(p);
    }
    return out;
  }

  /** The text of each call, from its name to its closing parenthesis, comments removed. */
  function callsIn(src: string): Array<{ fn: string; text: string }> {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const out: Array<{ fn: string; text: string }> = [];
    for (const m of code.matchAll(/\b(levelsHeldFor|levelsHeldIn|levelHeldIn|seatsHeldFor)\(/g)) {
      if (/function\s+$/.test(code.slice(Math.max(0, m.index! - 9), m.index))) continue;
      let depth = 0;
      let i = m.index! + m[0].length - 1;
      for (; i < code.length; i += 1) {
        if (code[i] === "(") depth += 1;
        else if (code[i] === ")" && --depth === 0) break;
      }
      out.push({ fn: m[1], text: code.slice(m.index!, i + 1) });
    }
    return out;
  }

  it("lists each one, with its choice", () => {
    const ROOT = process.cwd();
    const found: Record<string, Choice> = {};
    for (const file of sources(path.join(ROOT, "src"))) {
      const rel = path.relative(ROOT, file).split(path.sep).join("/");
      if (rel === "src/lib/access/acting-workspace.ts") continue;
      const calls = callsIn(readFileSync(file, "utf8"));
      if (calls.length === 0) continue;
      const c: Choice = {};
      for (const call of calls) {
        const kind = call.fn === "seatsHeldFor" ? "seats" : /keptSeats:\s*true/.test(call.text) ? "kept" : "live";
        c[kind] = (c[kind] ?? 0) + 1;
      }
      found[rel] = c;
    }
    expect(found).toEqual(CALLERS);
  });
});
