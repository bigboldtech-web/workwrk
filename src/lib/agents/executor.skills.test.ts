// use_skill and the start page through the executor
// (docs/plans/ai-teammates-phase5.md step 4, Decisions 15 to 17), with the
// real use_skill and open_page handlers and every module around them mocked
// at its boundary (the person, the teammate, skills' availability, the
// person's skills, the sessions), the process's browser registry real and
// the driver a fake. Never a hand-built context: each call goes through
// executeToolCall, so the browser context the executor builds for a skill
// call, and the turn's shared counters, are what is tested.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  /** The person's skills with the teammate (store.ts skillsOfViewer), and the runs counted. */
  skills: [] as Row[],
  skillReads: 0,
  runs: [] as unknown[][],
  /** What useBrowserSession answers. */
  use: { ok: false, reason: "none" } as Row,
  opens: [] as Row[],
  pins: [] as unknown[][],
  /** Whether a skill read again at its version is still ready (follow.ts readFollowedSkill). */
  ready: true,
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./test-fixtures")).prismaFake }));
vi.mock("./acting", async () => {
  const f = await import("./test-fixtures");
  return { ...f.actingFake, actingPersonFor: async () => f.PERSON };
});
vi.mock("./previews", async () => ({ prepareCall: (await import("./test-fixtures")).fakePrepareCall }));
vi.mock("./tools", async () => {
  const fake = (await import("./test-fixtures")).fakeTools();
  const { SKILL_TOOLS_DEFS } = await import("./skill-tools");
  const { BROWSER_TOOLS_DEFS } = await import("./browser-tools");
  // The two handlers under test are the real ones; every other tool the fixtures' fake.
  return { TOOLS: { ...fake, use_skill: SKILL_TOOLS_DEFS.use_skill, open_page: BROWSER_TOOLS_DEFS.open_page } };
});
vi.mock("@/lib/activity", async () => ({ logActivity: (await import("./test-fixtures")).fakeLogActivity }));
vi.mock("@/lib/entitlements", async () => ({ isModuleActive: (await import("./test-fixtures")).fakeIsModuleActive }));
vi.mock("@/lib/rate-limit-memory", () => ({ rateLimit: () => ({ ok: true, retryAfter: 0 }), ipFromRequest: () => "unknown" }));
vi.mock("./browser-access", () => ({
  computerAgentById: async () => ({ id: "a1", name: "Clerk", status: "ENABLED", browserSites: ["shop.proof.test"], browserTools: true, learns: true }),
}));
vi.mock("@/lib/skills/recorder", async () => {
  const { FIXTURE_SUFFIX } = await import("@/lib/browser/sites");
  const rules = { allow: ["shop.proof.test"], block: [], appHosts: [], schemes: ["https:", "http:"], fixtureSuffix: FIXTURE_SUFFIX };
  return { skillsAccess: async () => ({ ok: true, access: { cfg: { standIn: true }, rules, sites: ["shop.proof.test"] }, policy: { skillsEnabled: true } }) };
});
vi.mock("@/lib/skills/store", () => ({
  skillsOfViewer: async () => {
    h.skillReads += 1;
    return h.skills;
  },
  recordSkillRun: async (...a: unknown[]) => {
    h.runs.push(a);
  },
}));
vi.mock("@/lib/skills/follow", async (orig) => {
  const real = await orig<typeof import("@/lib/skills/follow")>();
  return { ...real, readFollowedSkill: async (o: { id: string; version?: number }) => (h.ready ? real.followedFrom(h.skills.find((s) => s.id === o.id) as never) : null) };
});
vi.mock("@/lib/browser/sessions", async () => {
  const { FIXTURE_SUFFIX } = await import("@/lib/browser/sites");
  const rules = { allow: ["shop.proof.test"], block: [], appHosts: [], schemes: ["https:", "http:"], fixtureSuffix: FIXTURE_SUFFIX };
  return {
    computerAccess: async () => ({ ok: true, rules, sites: ["shop.proof.test"], cfg: {}, caps: {}, policy: {}, rulesVersion: 0 }),
    useBrowserSession: async () => h.use,
    openBrowserSession: async (a: Row) => {
      h.opens.push(a);
      return { ok: true, rowId: "bs1" };
    },
    setSessionSkill: async (...a: unknown[]) => {
      h.pins.push(a);
      return true;
    },
    waitingCardOf: async () => null,
    stepsUsedUp: async () => false,
    recordStep: async () => true,
    setCurrentSite: async () => undefined,
    sessionNow: async () => ({ status: "live", endReason: null, lastRunId: "run1", endsBy: new Date(Date.now() + 600_000), reservedMinutes: 15 }),
    endBrowserSession: async () => true,
    SYSTEM_END: { id: null, type: "system" },
    GUARD_GONE_ONLY: { status: { in: ["live", "waiting", "handed_over"] } },
  };
});

import { executeToolCall, type ExecuteArgs } from "./executor";
import { SKILL_COPY, SKILL_PANEL_COPY } from "./teammate-copy";
import { AGENT_SLUG, PERSON, fx, resetFixtures } from "./test-fixtures";
import { putLiveBrowser, resetLiveRegistryForTests } from "@/lib/browser/live";
import { FIXTURE_SUFFIX, siteOf } from "@/lib/browser/sites";
import type { BrowserHandle } from "@/lib/browser/types";
import type { TeammateStreamEvent } from "./teammate-thread";

const navigated: string[] = [];
let at = "about:blank";
const handle: BrowserHandle = {
  navigate: async (u) => {
    navigated.push(u);
    at = u;
    return { ok: true, url: u, site: siteOf(u) ?? "" };
  },
  snapshot: async () => ({ url: at, title: "", contentType: "text/html", blocks: [], elements: [], links: [] }),
  find: async () => ({ matches: [] }),
  scroll: async () => ({ atEnd: true }),
  screenshot: async () => ({ jpeg: new Uint8Array([0xff, 0xd8, 0xff]), width: 10, height: 10 }),
  options: async () => ({ ok: true, options: [], total: 0 }),
  click: async () => ({ ok: true, settled: true, url: at, site: siteOf(at) ?? "" }),
  type: async () => ({ ok: true, settled: true, url: at, site: siteOf(at) ?? "" }),
  select: async () => ({ ok: true, settled: true, url: at, site: siteOf(at) ?? "" }),
  currentUrl: () => at,
  documentId: () => "doc.1",
  blank: async () => undefined,
  watch: async () => undefined,
  drainEvents: async () => ({ events: [], pages: [] }),
  close: async () => undefined,
};

const base = { title: "x", site: "shop.proof.test", page: "shop.proof.test/new", shotId: null };
const SKILL_ROW = {
  id: "sk1",
  organizationId: "org",
  userId: "me",
  agentId: "a1",
  name: "Weekly expenses",
  description: "Every Friday, my travel",
  status: "ready",
  version: 2,
  startUrl: "http://shop.proof.test/new",
  steps: [
    { ...base, id: "s1", kind: "start", address: "http://shop.proof.test/new" },
    { ...base, id: "s2", kind: "type", name: "Amount", fieldKind: "text", pressEnter: false, value: { ask: true } },
  ],
};

let events: TeammateStreamEvent[] = [];
const ENABLED = ["use_skill", "open_page", "read_page", "create_task", "click", "type_text", "select_option", "fill_fields"];

function call(name: string, input: Record<string, unknown>, counters: ExecuteArgs["counters"], o: Partial<ExecuteArgs> = {}) {
  return executeToolCall({
    name,
    input,
    person: PERSON as never,
    agent: { id: "a1", slug: AGENT_SLUG, name: "Clerk" },
    turn: { sessionId: "s1", routineId: null, trigger: "CHAT", runId: "run1" },
    enabled: ENABLED,
    agentRules: {},
    personRules: {},
    practice: false,
    counters,
    browserHeld: ["open_page", "read_page", "click", "type_text", "select_option"],
    emit: (e) => events.push(e),
    ...o,
  });
}

function dataOf(content: string): Record<string, unknown> {
  const m = /^<tool_data tool="[A-Za-z0-9_]+">([\s\S]*)<\/tool_data>$/.exec(content);
  if (!m) throw new Error(`not a tool_data block: ${content.slice(0, 80)}`);
  return JSON.parse(m[1]);
}

beforeEach(() => {
  resetFixtures();
  resetLiveRegistryForTests();
  h.skills = [structuredClone(SKILL_ROW)];
  h.skillReads = 0;
  h.runs = [];
  h.use = { ok: false, reason: "none" };
  h.opens = [];
  h.pins = [];
  h.ready = true;
  navigated.length = 0;
  at = "about:blank";
  events = [];
  // The browser openBrowserSession starts (the mock answers its row).
  putLiveBrowser({ rowId: "bs1", organizationId: "org", userId: "me", agentId: "a1", handle, rules: { allow: ["shop.proof.test"], block: [], appHosts: [], schemes: ["https:", "http:"], fixtureSuffix: FIXTURE_SUFFIX }, rulesVersion: 0, links: new Set(), refs: new Map(), refsUrl: null, seq: 0, lost: false, events: [] });
});

describe("use_skill in a turn (Phase 5 step 4)", () => {
  it("refuses in a turn that starts tainted unless the person's own message asked for that very skill", async () => {
    const tainted = (): ExecuteArgs["counters"] => ({ calls: 0, proposals: 0, delegations: 0, tainted: true, readWeb: true });
    const no = await call("use_skill", { skill: "Weekly expenses" }, tainted());
    // Before: the browser context was not built for a skill call, so nothing knew the turn was tainted.
    expect(dataOf(no.modelContent)).toEqual({ error: SKILL_COPY.skillAfterRead });
    expect(h.skillReads).toBe(0);
    const other = await call("use_skill", { skill: "Weekly expenses" }, tainted(), { turn: { sessionId: "s1", routineId: null, trigger: "CHAT", runId: "run1", skillAsked: "sk-other" } });
    expect(dataOf(other.modelContent)).toEqual({ error: SKILL_COPY.skillAfterRead });
    const counters = tainted();
    const yes = await call("use_skill", { skill: "weekly  EXPENSES" }, counters, { turn: { sessionId: "s1", routineId: null, trigger: "CHAT", runId: "run1", skillAsked: "sk1" } });
    expect(yes.record.state).toBe("ran");
    expect(counters.skill).toEqual({ id: "sk1", version: 2, name: "Weekly expenses", startUrl: "http://shop.proof.test/new" });
  });

  it("answers the skill's steps as data, keeps nothing of them in its record, marks the turn read at once, and says so in the chat", async () => {
    const counters: ExecuteArgs["counters"] = { calls: 0, proposals: 0, delegations: 0 };
    const r = await call("use_skill", { skill: "Weekly expenses" }, counters);
    const data = dataOf(r.modelContent);
    expect(data).toEqual({
      skill: { name: "Weekly expenses", whatItIsFor: "Every Friday, my travel", steps: ["1. Start at http://shop.proof.test/new", '2. Type in "Amount" on shop.proof.test/new: asked each time'] },
      startAddress: "http://shop.proof.test/new",
      note: SKILL_COPY.skillNote,
    });
    expect(r.record.input).toEqual({});
    expect(r.record.result).toEqual({ ok: true, steps: 2 });
    // An outside read: the run marked before the answer returns, and every later write asks first.
    expect(fx.runMarks).toEqual(["web:run1"]);
    expect(counters).toMatchObject({ tainted: true, readWeb: true, skillStarts: 1 });
    fx.cards.create_task = { title: 'Create task "Pay the cab"' };
    expect((await call("create_task", { title: "Pay the cab" }, counters)).record.state).toBe("waiting");
    // The skill's run counted, and the chat's line, while the run is open.
    expect(h.runs).toEqual([["sk1", PERSON]]);
    expect(fx.messages).toEqual([expect.objectContaining({ kind: "EVENT", content: SKILL_PANEL_COPY.startedLine("Weekly expenses"), meta: { event: "skill_started", agentId: "a1", skillId: "sk1" } })]);
    expect(events.filter((e) => e.type === "event")).toHaveLength(1);
    // One skill an answer.
    expect(dataOf((await call("use_skill", { skill: "Weekly expenses" }, counters)).modelContent)).toEqual({ error: SKILL_COPY.skillOneAnswer });
  });

  it("then opens its start address in the same tainted answer and starts the browser for it, pinned to the skill", async () => {
    const counters: ExecuteArgs["counters"] = { calls: 0, proposals: 0, delegations: 0 };
    await call("use_skill", { skill: "Weekly expenses" }, counters);
    const opened = await call("open_page", { url: "http://shop.proof.test/new" }, counters);
    // Before: onSkill's skill never reached the next call, so the tainted answer could open nothing.
    expect(dataOf(opened.modelContent)).toMatchObject({ ok: true, site: "shop.proof.test" });
    expect(h.opens).toEqual([expect.objectContaining({ skill: { id: "sk1", version: 2 } })]);
    expect(navigated).toEqual(["http://shop.proof.test/new"]);
    // Any other address is still only a link a read showed (Decision 11).
    expect(dataOf((await call("open_page", { url: "http://shop.proof.test/list" }, counters)).modelContent)).toMatchObject({ error: expect.stringContaining("only a link a page showed") });
  });

  it("pins the skill on a browser already open, under its lock, and counts nothing in practice", async () => {
    h.use = { ok: true, row: { id: "bs1" } };
    const counters: ExecuteArgs["counters"] = { calls: 0, proposals: 0, delegations: 0 };
    const r = await call("use_skill", { skill: "Weekly expenses" }, counters, { practice: true });
    expect(r.record.state).toBe("ran");
    expect(h.pins).toEqual([["bs1", "sk1", 2]]);
    expect([h.runs, fx.messages]).toEqual([[], []]);
  });

  it("refuses a draft, and a skill it has none of, each in its own words", async () => {
    h.skills[0].status = "draft";
    expect(dataOf((await call("use_skill", { skill: "Weekly expenses" }, { calls: 0, proposals: 0, delegations: 0 })).modelContent)).toEqual({ error: SKILL_COPY.skillDraft("Priya", "Weekly expenses") });
    expect(dataOf((await call("use_skill", { skill: "Payroll" }, { calls: 0, proposals: 0, delegations: 0 })).modelContent)).toEqual({ error: SKILL_COPY.skillNotFound("Priya", "Payroll") });
    expect(fx.runMarks).toEqual([]);
  });
});
