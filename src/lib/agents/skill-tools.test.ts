// use_skill's handler (src/lib/agents/skill-tools.ts,
// docs/plans/ai-teammates-phase5.md step 4), with the person, the teammate,
// skills' availability, the person's skills and the sessions mocked at their
// module boundaries and the process's browser registry real: a draft and a
// skill it has none of refuse in their own words; a host not allowed now
// refuses, naming it, and nothing is pinned; the answer is the steps as data,
// never a picture's id; a browser already open is pinned under its lock.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  person: { userId: "me", organizationId: "org", firstName: "Max", name: "Max Pine" } as Row | null,
  agent: { id: "a1", name: "Clerk", status: "ENABLED", browserSites: ["expenses.proof.test"], browserTools: true, learns: true } as Row | null,
  learn: null as Row | null,
  skills: [] as Row[],
  use: { ok: false, reason: "none" } as Row,
  pins: [] as unknown[][],
}));

vi.mock("./acting", () => ({ actingPersonFor: async () => h.person }));
vi.mock("./browser-access", () => ({ computerAgentById: async () => h.agent }));
vi.mock("@/lib/skills/recorder", () => ({ skillsAccess: async () => h.learn }));
vi.mock("@/lib/skills/store", () => ({ skillsOfViewer: async () => h.skills }));
vi.mock("@/lib/browser/sessions", () => ({
  useBrowserSession: async () => h.use,
  setSessionSkill: async (...a: unknown[]) => {
    h.pins.push(a);
    return true;
  },
  sessionNow: async () => null,
  endBrowserSession: async () => false,
  SYSTEM_END: { id: null, type: "system" },
  GUARD_GONE_ONLY: { status: { in: ["live", "waiting", "handed_over"] } },
}));

import { SKILL_RECORD_ERROR, SKILL_TOOLS_DEFS } from "./skill-tools";
import { BROWSER_COPY, SKILL_COPY, SKILL_ROUTE_ERRORS, TEAMMATE_TOOL_ERRORS } from "./teammate-copy";
import type { TeammateBrowserContext, ToolContext } from "./tools";
import { putLiveBrowser, resetLiveRegistryForTests, type LiveBrowser } from "@/lib/browser/live";
import { FIXTURE_SUFFIX, type SiteRules } from "@/lib/browser/sites";
import type { BrowserHandle } from "@/lib/browser/types";

const RULES: SiteRules = { allow: ["expenses.proof.test"], block: [], appHosts: [], schemes: ["https:", "http:"], fixtureSuffix: FIXTURE_SUFFIX };
const SHOT = "sh0123456789abcdef0123456789abcdef";
const at = (site: string, page: string) => ({ title: "x", site, page, shotId: SHOT });
const SKILL = {
  id: "sk1",
  organizationId: "org",
  userId: "me",
  agentId: "a1",
  name: "Weekly expenses",
  description: "Every Friday",
  status: "ready",
  version: 3,
  startUrl: "http://expenses.proof.test/",
  steps: [
    { ...at("expenses.proof.test", "expenses.proof.test"), id: "s1", kind: "start", address: "http://expenses.proof.test/" },
    { ...at("expenses.proof.test", "expenses.proof.test"), id: "s2", kind: "yourself", reason: "sign_in" },
    { ...at("expenses.proof.test", "expenses.proof.test/new"), id: "s3", kind: "choose", via: "list", name: "Category", value: { fixed: "Travel" } },
    { ...at("expenses.proof.test", "expenses.proof.test/new"), id: "s4", kind: "click", role: "button", name: "submit", tag: "button", type: "submit", formHost: "expenses.proof.test", warnings: ["submits"] },
  ],
};

let calls: { skills: unknown[]; reads: number };

function ctx(o: Partial<TeammateBrowserContext> = {}): ToolContext {
  return {
    orgId: "org",
    userId: "me",
    teammate: {
      agentId: "a1",
      agentName: "Clerk",
      sessionId: "chat1",
      routineId: null,
      trigger: "CHAT",
      timezone: "UTC",
      runId: "run1",
      browser: {
        tainted: false,
        mayStart: true,
        onStart: () => undefined,
        onWebRead: () => {
          calls.reads += 1;
        },
        onSkill: (s) => {
          calls.skills.push(s);
        },
        skillStarts: 0,
        ...o,
      },
    },
  };
}

const run = (input: Row, c: ToolContext = ctx()) => SKILL_TOOLS_DEFS.use_skill.handler(c, input) as Promise<Row>;

const handle = { currentUrl: () => "about:blank", close: async () => undefined } as unknown as BrowserHandle;

beforeEach(() => {
  resetLiveRegistryForTests();
  h.person = { userId: "me", organizationId: "org", firstName: "Max", name: "Max Pine" };
  h.agent = { id: "a1", name: "Clerk", status: "ENABLED", browserSites: ["expenses.proof.test"], browserTools: true, learns: true };
  h.learn = { ok: true, access: { cfg: { standIn: true }, rules: RULES, sites: ["expenses.proof.test"] }, policy: { skillsEnabled: true } };
  h.skills = [structuredClone(SKILL)];
  h.use = { ok: false, reason: "none" };
  h.pins = [];
  calls = { skills: [], reads: 0 };
});

describe("use_skill", () => {
  it("answers the skill's steps inside its data as the person did them, its start, and no picture's id", async () => {
    const out = await run({ skill: "Weekly expenses" });
    // Before: "This skill tool isn't ready yet."
    expect(out).toEqual({
      skill: {
        name: "Weekly expenses",
        whatItIsFor: "Every Friday",
        steps: [
          "1. Start at http://expenses.proof.test/",
          "2. Max does this themselves on expenses.proof.test: sign in (use ask_to_take_over)",
          '3. Choose in "Category" on expenses.proof.test/new: "Travel"',
          '4. Click the button with "submit" in its words on expenses.proof.test/new',
        ],
      },
      startAddress: "http://expenses.proof.test/",
      note: SKILL_COPY.skillNote,
    });
    expect(JSON.stringify(out)).not.toContain(SHOT);
    expect(calls.skills).toEqual([{ id: "sk1", version: 3, name: "Weekly expenses", startUrl: "http://expenses.proof.test/" }]);
    expect(calls.reads).toBe(1);
    // No browser open: the turn keeps the skill for its start, and nothing is pinned yet.
    expect(h.pins).toEqual([]);
  });

  it("refuses a draft or a recording, and a name it has none of, each in its own words", async () => {
    // The model reads the whole sentence; the call's record keeps one with no skill's name (review of step 4).
    h.skills[0].status = "draft";
    expect(await run({ skill: "Weekly expenses" })).toEqual({ error: SKILL_COPY.skillDraft("Max", "Weekly expenses"), [SKILL_RECORD_ERROR]: SKILL_COPY.skillDraftStored("Max") });
    h.skills[0].status = "recording";
    expect(await run({ skill: "Weekly expenses" })).toEqual({ error: SKILL_COPY.skillDraft("Max", "Weekly expenses"), [SKILL_RECORD_ERROR]: SKILL_COPY.skillDraftStored("Max") });
    expect(await run({ skill: "Payroll" })).toEqual({ error: SKILL_COPY.skillNotFound("Max", "Payroll"), [SKILL_RECORD_ERROR]: SKILL_COPY.skillNotFoundStored("Max") });
    expect([calls.skills, calls.reads]).toEqual([[], 0]);
  });

  it("says truly why a tainted turn starts no skill: read in this answer, or only started tainted (review of step 4)", async () => {
    // Before: "before you read anything in this answer" when the answer had read nothing.
    expect(await run({ skill: "Weekly expenses" }, ctx({ tainted: true }))).toEqual({ error: SKILL_COPY.skillAfterStart });
    expect(await run({ skill: "Weekly expenses" }, ctx({ tainted: true, readHere: true }))).toEqual({ error: SKILL_COPY.skillAfterRead });
    // Asked for another skill: the same two.
    expect(await run({ skill: "Weekly expenses" }, ctx({ tainted: true, skillAsked: "sk-other" }))).toEqual({ error: SKILL_COPY.skillAfterStart });
    expect(await run({ skill: "Weekly expenses" }, ctx({ tainted: true, readHere: true, skillAsked: "sk-other" }))).toEqual({ error: SKILL_COPY.skillAfterRead });
  });

  it("refuses a skill with a step on a host not allowed now, naming it, and pins nothing", async () => {
    (h.skills[0].steps as unknown[]).push({ ...at("pay.proof.test", "pay.proof.test"), id: "s5", kind: "yourself", reason: "payment" });
    h.use = { ok: true, row: { id: "bs1" } };
    expect(await run({ skill: "Weekly expenses" })).toEqual({ error: SKILL_COPY.skillSiteOff("pay.proof.test") });
    expect([h.pins, calls.skills, calls.reads]).toEqual([[], [], 0]);
  });

  it("pins the skill on the browser already open, under its lock, and keeps its start among the session's shown links", async () => {
    const lb: LiveBrowser = { rowId: "bs1", organizationId: "org", userId: "me", agentId: "a1", handle, rules: RULES, rulesVersion: 0, links: new Set(), refs: new Map(), refsUrl: null, seq: 0, lost: false, events: [] };
    putLiveBrowser(lb);
    h.use = { ok: true, row: { id: "bs1" } };
    expect(await run({ skill: "Weekly expenses" })).toMatchObject({ startAddress: "http://expenses.proof.test/" });
    expect(h.pins).toEqual([["bs1", "sk1", 3]]);
    expect([...lb.links]).toEqual(["http://expenses.proof.test/"]);
    // The person holding the browser: refused, nothing pinned.
    h.pins = [];
    lb.handedOver = true;
    expect(await run({ skill: "Weekly expenses" })).toEqual({ error: BROWSER_COPY.personHasIt("Max") });
    expect(h.pins).toEqual([]);
  });

  it("says why when skills may not be used, the teammate can't, or the browser is another teammate's", async () => {
    h.learn = { ok: false, reason: "skills_off" };
    expect(await run({ skill: "Weekly expenses" })).toEqual({ error: SKILL_COPY.skillsOff });
    h.learn = { ok: false, reason: "cant_learn" };
    expect(await run({ skill: "Weekly expenses" })).toEqual({ error: SKILL_ROUTE_ERRORS.cantLearn("Clerk") });
    h.learn = { ok: false, reason: "plan" };
    expect(await run({ skill: "Weekly expenses" })).toEqual({ error: BROWSER_COPY.plan });
    h.learn = { ok: true, access: { cfg: { standIn: true }, rules: RULES, sites: ["expenses.proof.test"] }, policy: { skillsEnabled: true } };
    h.use = { ok: false, reason: "other_teammate", otherName: "Researcher" };
    expect(await run({ skill: "Weekly expenses" })).toEqual({ error: BROWSER_COPY.otherTeammate("Researcher") });
    h.agent = null;
    expect(await run({ skill: "Weekly expenses" })).toEqual({ error: BROWSER_COPY.teammateOff });
    expect(await SKILL_TOOLS_DEFS.use_skill.handler({ orgId: "org", userId: "me" }, { skill: "x" })).toEqual({ error: TEAMMATE_TOOL_ERRORS.teammateOnly });
  });
});
