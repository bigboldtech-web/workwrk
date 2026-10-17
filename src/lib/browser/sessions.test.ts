// The computer's sessions (src/lib/browser/sessions.ts), the database an
// in-memory double that answers the raw statements as Postgres would and
// asserts their meaning: every refusal of computerAccess in its order, the
// caps counted under the start lock (each its own reason, the reserve the
// minutes left), one session per person, a failed start ended, one winner
// per end (one line, one audit row, one release), only this session's cards
// cancelled, every sweep part, the reaper by its tag, the steps' retention,
// the switch and the lists one change at a time, and the guard's rules
// replaced the moment a list changes.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  lines: [] as Array<{ sessionId: string | null; line: Record<string, unknown>; opts?: unknown }>,
  published: [] as Array<{ userId: string; event: Record<string, unknown> }>,
  created: [] as Array<{ rowId: string; timeoutSeconds: number }>,
  createAnswer: { ok: true, data: { providerSessionId: "pv-new", connectUrl: "ws://127.0.0.1:9/devtools/browser/x" } } as unknown,
  released: [] as string[],
  releaseAnswer: "released" as "released" | "already" | "failed",
  /** A provider whose release never answers (review round 1 of Phase 4). */
  releaseHangs: false,
  /** What each release and list was asked to wait at most (follow-up to review round 1 of Phase 4). */
  releaseOpts: [] as unknown[],
  listOpts: [] as unknown[],
  /** The real provider client (browserbase.ts) over a stubbed fetch, in place of the double (follow-up to review round 1 of Phase 4). */
  realProvider: false,
  running: [] as Array<{ providerSessionId: string; tag: string | null; rowId: string | null }>,
  attachThrows: false,
  hooks: null as unknown,
  closes: 0,
  acting: new Map<string, { ok: boolean; reason?: string }>(),
  /** The rows whose browser was told to leave its page (handle.blank). */
  blanks: [] as string[],
  /** Run just before the provider is asked for a browser (review round 4 of Phase 4: a Stop that lands while a start waits on it). */
  beforeCreate: null as null | (() => Promise<void>),
  /** Run just before the guard is attached (review round 5 of Phase 4: a Stop that lands while the guard is put in place). */
  beforeAttach: null as null | (() => Promise<void>),
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/browser/browser-test-db")).browserDb }));
vi.mock("@/lib/agents/actions", () => ({
  writeEventLine: vi.fn(async (sessionId: string | null, line: Record<string, unknown>, opts?: unknown) => {
    st.lines.push({ sessionId, line, opts });
    // The chat's row too (last polish of Phase 4): a browser's card is drawn in place of its browser_started line (sessions.ts drewCard).
    if (sessionId) {
      const { bdb } = await import("@/lib/browser/browser-test-db");
      const meta = { event: line.event, ...(line.agentId ? { agentId: line.agentId } : {}), ...(line.browserSessionId ? { browserSessionId: line.browserSessionId } : {}) };
      bdb.t.messages.push({ id: `cm-${bdb.t.messages.length + 1}`, sessionId, role: "SYSTEM", kind: "EVENT", content: line.text, meta, createdAt: new Date() });
    }
    return null;
  }),
  actionHref: (slug: string, id: string) => `/agents?chat=${slug}&action=${id}`,
}));
vi.mock("@/lib/realtime-bus", () => ({ publishToUser: (userId: string, event: Record<string, unknown>) => st.published.push({ userId, event }) }));
vi.mock("@/lib/agents/acting", () => ({
  actorLabelFor: (a: { name: string }, p: { name: string }) => `${a.name} for ${p.name}`,
  resolveActingPerson: async (_org: string, userId: string) => {
    const r = st.acting.get(userId) ?? { ok: true };
    return r.ok ? { ok: true, person: { userId } } : { ok: false, reason: r.reason };
  },
  // The browser tools' own read of the person (review round 4 of Phase 4: the tools over this real module).
  actingPersonFor: async (ctx: { orgId: string; userId: string }) => {
    const r = st.acting.get(ctx.userId) ?? { ok: true };
    return r.ok ? { userId: ctx.userId, organizationId: ctx.orgId, firstName: "Max", name: "Max Chen", email: "max@proof.test" } : null;
  },
}));
vi.mock("./browserbase", async (importOriginal) => {
  const real = await importOriginal<typeof import("./browserbase")>();
  return {
    createProviderSession: async (_cfg: unknown, a: { rowId: string; timeoutSeconds: number }) => {
      st.created.push(a);
      if (st.beforeCreate) await st.beforeCreate();
      return st.createAnswer;
    },
    releaseProviderSession: async (cfg: Parameters<typeof real.releaseProviderSession>[0], id: string, o?: { timeoutMs?: number }) => {
      st.released.push(id);
      st.releaseOpts.push(o);
      if (st.realProvider) return real.releaseProviderSession(cfg, id, o);
      if (st.releaseHangs) return new Promise(() => undefined);
      return st.releaseAnswer;
    },
    listRunningProviderSessions: async (cfg: Parameters<typeof real.listRunningProviderSessions>[0], o?: { timeoutMs?: number }) => {
      st.listOpts.push(o);
      if (st.realProvider) return real.listRunningProviderSessions(cfg, o);
      return { ok: true, data: st.running };
    },
    liveViewUrl: async () => ({ ok: true, data: "http://127.0.0.1:8789/live/x?t=1" }),
  };
});
vi.mock("./cdp-driver", () => ({
  // The driver's lost-connection error (review round 5 of Phase 4: page-calls.ts reads it).
  BrowserLost: class BrowserLost extends Error {
    constructor() {
      super("The browser connection is gone");
      this.name = "BrowserLost";
    }
  },
  attachBrowser: async (_url: string, hooks: unknown) => {
    st.hooks = hooks;
    if (st.beforeAttach) await st.beforeAttach();
    if (st.attachThrows) throw new Error("no guard");
    // navigate: a page opened on a browser just started (review round 4 of Phase 4).
    return { close: async () => void (st.closes += 1), currentUrl: () => "about:blank", navigate: async (u: string) => ({ ok: true, url: u, site: new URL(u).hostname }) };
  },
}));

import { bdb, browserDb, resetBrowserDb, seedAgent, seedCardLine, seedOrg, seedPolicy, seedSession, seedSkill, seedStep, seedUser } from "./browser-test-db";
import { BOOT_ID, installRules, liveBrowser, nextRulesVersion, putLiveBrowser, resetLiveRegistryForTests, rulesVersionNow, takeEvents, withBrowserLock } from "./live";
import { finishTakeOver, startTakeOver } from "./take-over";
import {
  cancelCardsIfEnded,
  changePolicySite,
  changeTeammateSite,
  computerAccess,
  endBrowserSession,
  endWorkspaceBrowserSessions,
  GUARD_GONE_ONLY,
  openBrowserSession,
  PROVIDER_GRACE_MS,
  recordStep,
  refreshLiveRules,
  releaseWaiting,
  RETRY_MAX,
  runEnds,
  runEndsLookbackMs,
  RUN_ENDS_RUNS_MAX,
  browserPolicyView,
  sessionViewFor,
  setComputerEnabled,
  setCurrentSite,
  setSkillsEnabled,
  windowTimes,
  stepsUsedUp,
  waitingCardOf,
  waitingWindowMs,
  START_LOCK_CLASS,
  STOP_RETRY_MS,
  sweepBrowserSessions,
  SWEEP_RELEASE_MS,
  SYSTEM_END,
  touchAfterTurn,
  useBrowserSession,
  workspaceComputer,
  type ComputerAccess,
} from "./sessions";
import { BrowserLost, type GuardHooks } from "./cdp-driver";
import { fingerprintOf } from "./snapshot";
import type { RawElement } from "./types";
import type { ActingPerson } from "@/lib/agents/acting";
import type { ComputerAgent } from "@/lib/agents/browser-access";
import { prepareBrowser } from "@/lib/agents/browser-previews";
import { BROWSER_TOOLS_DEFS } from "@/lib/agents/browser-tools";
import type { PrepareContext } from "@/lib/agents/previews";
import { BROWSER_COPY, BROWSER_ROUTE_ERRORS } from "@/lib/agents/teammate-copy";
import { OUTCOMES_PER_TURN } from "@/lib/agents/tool-policy";

const ENV = {
  BROWSER_OFFERED: "1",
  BROWSER_PROVIDER: "stand-in",
  BROWSERBASE_API_KEY: "stand-in",
  BROWSERBASE_PROJECT_ID: "stand-in",
  BROWSERBASE_BASE_URL: "http://127.0.0.1:8789",
  BROWSER_REGION: "us-east-1",
  BROWSER_SHOTS_DIR: "/tmp/wk-sessions-test-shots-none",
  SECRETS_ENCRYPTION_KEY: "5".repeat(64),
};
const saved: Record<string, string | undefined> = {};

const MAX: ActingPerson = { userId: "u-max", organizationId: "org1", name: "Max Chen", firstName: "Max", email: "max@proof.test" } as ActingPerson;
const SHOPPER: ComputerAgent = { id: "a-shop", name: "Shopper", status: "ENABLED", browserSites: ["docs.proof.test"], browserTools: true };

beforeEach(() => {
  resetBrowserDb();
  resetLiveRegistryForTests();
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  st.lines = [];
  st.published = [];
  st.created = [];
  st.createAnswer = { ok: true, data: { providerSessionId: "pv-new", connectUrl: "ws://127.0.0.1:9/devtools/browser/x" } };
  st.released = [];
  st.releaseAnswer = "released";
  st.releaseHangs = false;
  st.releaseOpts = [];
  st.listOpts = [];
  st.realProvider = false;
  st.running = [];
  st.attachThrows = false;
  st.hooks = null;
  st.closes = 0;
  st.acting = new Map();
  st.blanks = [];
  st.beforeCreate = null;
  st.beforeAttach = null;
  seedOrg();
  seedPolicy();
  seedAgent();
  seedAgent({ id: "a-res", slug: "researcher", name: "Researcher" });
  seedUser();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function access(): Promise<Extract<ComputerAccess, { ok: true }>> {
  const a = await computerAccess({ organizationId: "org1", agent: SHOPPER });
  if (!a.ok) throw new Error(`no access: ${a.reason}`);
  return a;
}

const open = async () => openBrowserSession({ person: MAX, agent: SHOPPER, chatSessionId: "chat-1", runId: "run-1", access: await access() });

/** A live session this process holds, as a started one is, its tab at `url`. */
function liveHere(o: Record<string, unknown> = {}, url = "about:blank") {
  const row = seedSession({ bootId: BOOT_ID, ...o });
  let at = url;
  putLiveBrowser({
    rowId: String(row.id),
    organizationId: String(row.organizationId),
    userId: String(row.userId),
    agentId: String(row.agentId),
    handle: {
      close: async () => void (st.closes += 1),
      currentUrl: () => at,
      blank: async () => {
        st.blanks.push(String(row.id));
        at = "about:blank";
      },
    } as never,
    rules: { allow: ["docs.proof.test"], block: [], appHosts: [], schemes: ["https:", "http:"], fixtureSuffix: ".proof.test" },
    rulesVersion: 0,
    links: new Set(),
    refs: new Map(),
    refsUrl: null,
    seq: 0,
    lost: false,
    events: [],
  });
  return row;
}

describe("computerAccess", () => {
  it("walks every refusal in its order, each its own reason", async () => {
    expect(await computerAccess({ organizationId: "org1", agent: SHOPPER })).toMatchObject({ ok: true, sites: ["docs.proof.test"] });

    bdb.t.agents[0].browserSites = [];
    expect(await computerAccess({ organizationId: "org1", agent: { ...SHOPPER, browserSites: [] } })).toEqual({ ok: false, reason: "no_sites" });
    bdb.t.policies[0].enabled = false;
    expect(await computerAccess({ organizationId: "org1", agent: SHOPPER })).toEqual({ ok: false, reason: "workspace_off" });
    bdb.t.policies = [];
    expect(await computerAccess({ organizationId: "org1", agent: SHOPPER })).toEqual({ ok: false, reason: "workspace_off" });
    bdb.t.orgs[0].plan = "STARTER";
    expect(await computerAccess({ organizationId: "org1", agent: SHOPPER })).toEqual({ ok: false, reason: "plan" });
    bdb.t.orgs[0].status = "SUSPENDED";
    expect(await computerAccess({ organizationId: "org1", agent: SHOPPER })).toEqual({ ok: false, reason: "workspace_closed" });
    bdb.t.orgs[0].status = "CANCELLED";
    expect(await computerAccess({ organizationId: "org1", agent: SHOPPER })).toEqual({ ok: false, reason: "workspace_closed" });
    delete process.env.BROWSER_OFFERED;
    expect(await computerAccess({ organizationId: "org1", agent: SHOPPER })).toEqual({ ok: false, reason: "not_configured" });
  });

  it("answers a TRIAL GROWTH workspace trial, before its plan", async () => {
    bdb.t.orgs[0].status = "TRIAL";
    expect(await computerAccess({ organizationId: "org1", agent: SHOPPER })).toEqual({ ok: false, reason: "trial" });
    bdb.t.orgs[0].plan = "STARTER";
    expect(await computerAccess({ organizationId: "org1", agent: SHOPPER })).toEqual({ ok: false, reason: "trial" });
  });

  it("carries the rules version its read began at (review of Phase 4 step 3)", async () => {
    const before = nextRulesVersion();
    const a = await computerAccess({ organizationId: "org1", agent: SHOPPER });
    expect(a).toMatchObject({ ok: true, rulesVersion: before });
  });

  it("gives the teammate's sites within the workspace list, less what is blocked, and the rules the guard obeys", async () => {
    bdb.t.policies[0].allowSites = ["docs.proof.test", "shop.proof.test", "*.example.com"];
    bdb.t.policies[0].blockSites = ["shop.proof.test"];
    const a = await computerAccess({ organizationId: "org1", agent: { ...SHOPPER, browserSites: ["docs.proof.test", "shop.proof.test", "inject.proof.test", "*.example.com"] } });
    expect(a).toMatchObject({ ok: true, sites: ["*.example.com", "docs.proof.test"] });
    if (a.ok) expect(a.rules).toMatchObject({ allow: ["*.example.com", "docs.proof.test"], block: ["shop.proof.test"], fixtureSuffix: ".proof.test" });
  });

  it("says whether the workspace's computer is available, the switch included", async () => {
    expect(await workspaceComputer("org1")).toMatchObject({ available: true, reason: null, plan: "GROWTH" });
    bdb.t.policies[0].enabled = false;
    expect(await workspaceComputer("org1")).toMatchObject({ available: false, reason: "workspace_off" });
  });
});

describe("openBrowserSession", () => {
  it("takes the start lock before any count, then starts, guards and audits a live session", async () => {
    const out = await open();
    expect(out).toMatchObject({ ok: true });
    const lockAt = bdb.events.findIndex((e) => e.op === "lock");
    const countAt = bdb.events.findIndex((e) => e.op.startsWith("count."));
    expect(lockAt).toBeGreaterThan(-1);
    expect(lockAt).toBeLessThan(countAt);
    expect(bdb.locks[0]).toEqual({ cls: START_LOCK_CLASS, key: 0, inTx: true });
    const row = bdb.t.sessions[0];
    expect(row).toMatchObject({ status: "live", reservedMinutes: 15, bootId: BOOT_ID, providerSessionId: "pv-new", region: "us-east-1", lastRunId: "run-1", chatSessionId: "chat-1" });
    // The provider's own limit: the reserve plus a minute.
    expect(st.created).toEqual([{ rowId: row.id, timeoutSeconds: 15 * 60 + 60 }]);
    expect(liveBrowser(String(row.id))).not.toBeNull();
    expect(bdb.t.activity.find((a) => a.type === "teammate_browser.session_started")).toMatchObject({ actorType: "agent", actingForId: "u-max", metadata: { browserSessionId: row.id, reservedMinutes: 15, region: "us-east-1" } });
    // The chat line only while the turn's run is open.
    expect(st.lines[0]).toMatchObject({ sessionId: "chat-1", line: { event: "browser_started", browserSessionId: row.id }, opts: { whileOpen: { runId: "run-1", personId: "u-max" } } });
  });

  it("reserves the minutes left when fewer than a session's", async () => {
    seedSession({ status: "ended", userId: "u-other", reservedMinutes: 15, billedMinutes: 990, startedAt: new Date() });
    expect(await open()).toMatchObject({ ok: true });
    expect(bdb.t.sessions.find((s) => s.userId === "u-max")).toMatchObject({ reservedMinutes: 10 });
  });

  it("refuses each cap with its own reason, and starts nothing", async () => {
    const now = new Date();
    // The month used up.
    seedSession({ status: "ended", userId: "u-other", billedMinutes: 1000, startedAt: now });
    expect(await open()).toEqual({ ok: false, reason: "month_used" });
    resetBrowserDb();
    seedOrg();
    seedPolicy();
    seedAgent();
    seedUser();
    // The workspace's two at once (GROWTH), ending ones included.
    seedSession({ userId: "u-a", status: "live" });
    seedSession({ userId: "u-b", status: "ending" });
    expect(await open()).toEqual({ ok: false, reason: "workspace_at_once", atOnce: 2 });
    // The deployment's own cap.
    bdb.t.sessions = [];
    process.env.BROWSER_MAX_AT_ONCE = "1";
    seedSession({ organizationId: "org9", userId: "u-z", status: "live" });
    expect(await open()).toEqual({ ok: false, reason: "platform_at_once" });
    delete process.env.BROWSER_MAX_AT_ONCE;
    // The person's twenty a day.
    bdb.t.sessions = [];
    for (let i = 0; i < 20; i++) seedSession({ status: "ended", billedMinutes: 1, startedAt: now });
    expect(await open()).toEqual({ ok: false, reason: "person_today" });
    // The workspace's sessions a day.
    bdb.t.sessions = [];
    bdb.t.orgs[0].plan = "GROWTH";
    for (let i = 0; i < 100; i++) seedSession({ status: "ended", userId: `u-${i}`, billedMinutes: 0, startedAt: now });
    expect(await open()).toEqual({ ok: false, reason: "workspace_today" });
    expect(st.created).toEqual([]);
  });

  it("counts toward the day's caps only the starts that reached a browser (review of Phase 4 step 2)", async () => {
    const now = new Date();
    // Twenty starts the provider never answered: no browser, no minute.
    for (let i = 0; i < 20; i++) seedSession({ status: "ended", endReason: "start_failed", providerSessionId: null, billedMinutes: 0, reservedMinutes: 0, startedAt: now });
    // A hundred more across the workspace, the GROWTH day's worth.
    for (let i = 0; i < 100; i++) seedSession({ userId: `u-f${i}`, status: "ended", endReason: "start_failed", providerSessionId: null, billedMinutes: 0, reservedMinutes: 0, startedAt: now });
    expect(await open()).toMatchObject({ ok: true });
    // A start that reached the provider still counts, as before.
    bdb.t.sessions = [];
    for (let i = 0; i < 20; i++) seedSession({ status: "ended", endReason: "start_failed", providerSessionId: `pv-f${i}`, billedMinutes: 1, startedAt: now });
    expect(await open()).toEqual({ ok: false, reason: "person_today" });
  });

  it("refuses another teammate's live browser by its name, and its own as busy", async () => {
    seedSession({ agentId: "a-res", status: "live" });
    expect(await open()).toEqual({ ok: false, reason: "other_teammate", otherName: "Researcher" });
    bdb.t.sessions[0].agentId = "a-shop";
    expect(await open()).toEqual({ ok: false, reason: "busy" });
  });

  it("ends the row start_failed when the provider fails, and says busy with its wait when it is rate limited", async () => {
    st.createAnswer = { ok: false, failure: "rate_limited", retryAfter: 9 };
    // It asked the provider: the answer's one start (review of Phase 4 step 3).
    expect(await open()).toEqual({ ok: false, reason: "provider_busy", retryAfter: 9, reachedProvider: true });
    expect(bdb.t.sessions[0]).toMatchObject({ status: "ended", endReason: "start_failed", billedMinutes: 0 });
    // Nothing started at the provider: nothing to release.
    expect(st.released).toEqual([]);
    st.createAnswer = { ok: false, failure: "unknown_outcome" };
    expect(await open()).toEqual({ ok: false, reason: "provider_unavailable", reachedProvider: true });
  });

  it("says a start the caps refused never reached the provider (review of Phase 4 step 3)", async () => {
    for (let i = 0; i < 20; i++) seedSession({ status: "ended", endReason: "idle", providerSessionId: `pv-d${i}`, billedMinutes: 1, startedAt: new Date() });
    const out = await open();
    expect(out).toEqual({ ok: false, reason: "person_today" });
  });

  it("releases the provider's browser and ends start_failed when the guard cannot be attached", async () => {
    st.attachThrows = true;
    expect(await open()).toEqual({ ok: false, reason: "start_failed", reachedProvider: true });
    expect(bdb.t.sessions[0]).toMatchObject({ status: "ended", endReason: "start_failed" });
    expect(st.released).toEqual(["pv-new"]);
  });
});

describe("useBrowserSession", () => {
  it("answers none, another teammate's, the person's, another turn's, and moves to this turn otherwise", async () => {
    expect(await useBrowserSession({ person: MAX, agentId: "a-shop", runId: "run-1", purpose: "model" })).toEqual({ ok: false, reason: "none" });
    const row = liveHere({ agentId: "a-res" });
    expect(await useBrowserSession({ person: MAX, agentId: "a-shop", runId: "run-1", purpose: "model" })).toEqual({ ok: false, reason: "other_teammate", otherName: "Researcher" });
    row.agentId = "a-shop";
    row.status = "handed_over";
    expect(await useBrowserSession({ person: MAX, agentId: "a-shop", runId: "run-1", purpose: "model" })).toEqual({ ok: false, reason: "person_has_it" });
    row.status = "live";
    row.lastRunId = "run-0";
    bdb.t.runs.push({ id: "run-0", status: "RUNNING", startedAt: new Date(), endedAt: null });
    expect(await useBrowserSession({ person: MAX, agentId: "a-shop", runId: "run-1", purpose: "model" })).toEqual({ ok: false, reason: "other_turn" });
    bdb.t.runs[0].endedAt = new Date();
    const used = await useBrowserSession({ person: MAX, agentId: "a-shop", runId: "run-1", purpose: "model" });
    expect(used).toMatchObject({ ok: true });
    expect(row.lastRunId).toBe("run-1");
  });

  it("ends a session whose guard is another process's, or past its time, with that reason", async () => {
    const elsewhere = seedSession({ bootId: "another-boot" });
    expect(await useBrowserSession({ person: MAX, agentId: "a-shop", runId: "run-1", purpose: "model" })).toEqual({ ok: false, reason: "restarted" });
    expect(elsewhere).toMatchObject({ status: "ended", endReason: "restarted" });
    const late = liveHere({ endsBy: new Date(Date.now() - 1000) });
    // Its reserved minutes ride with it, for the sentence that says so (step 3).
    expect(await useBrowserSession({ person: MAX, agentId: "a-shop", runId: "run-1", purpose: "model" })).toEqual({ ok: false, reason: "time_cap", minutes: late.reservedMinutes });
    expect(late).toMatchObject({ status: "ended", endReason: "time_cap" });
  });

  it("reads an approval's own session, refusing it while the person has it, and lets a take over at it", async () => {
    const row = liveHere({ status: "handed_over" });
    const id = String(row.id);
    expect(await useBrowserSession({ person: MAX, agentId: "a-shop", browserSessionId: id, runId: null, purpose: "approval" })).toEqual({ ok: false, reason: "person_has_it" });
    expect(await useBrowserSession({ person: MAX, agentId: "a-shop", browserSessionId: id, runId: null, purpose: "take_over" })).toMatchObject({ ok: true });
    // Another person's id is none of theirs.
    expect(await useBrowserSession({ person: { ...MAX, userId: "u-olivia" }, agentId: "a-shop", browserSessionId: id, runId: null, purpose: "approval" })).toEqual({ ok: false, reason: "none" });
    row.status = "ended";
    expect(await useBrowserSession({ person: MAX, agentId: "a-shop", browserSessionId: id, runId: null, purpose: "approval" })).toEqual({ ok: false, reason: "ended" });
  });
});

describe("endBrowserSession", () => {
  it("has one winner of two at once: one release, one line, one audit row", async () => {
    const row = liveHere();
    const [a, b] = await Promise.all([endBrowserSession(String(row.id), "stopped", { id: "u-max", type: "person" }), endBrowserSession(String(row.id), "idle", SYSTEM_END)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(st.released).toHaveLength(1);
    expect(st.lines.filter((l) => l.line.event === "browser_ended")).toHaveLength(1);
    expect(bdb.t.activity.filter((x) => x.type === "teammate_browser.session_ended")).toHaveLength(1);
    expect(row).toMatchObject({ status: "ended", endReason: "stopped", currentSite: null });
    expect(liveBrowser(String(row.id))).toBeNull();
    expect(st.closes).toBe(1);
  });

  it("cancels only this session's waiting cards, a take over in progress included, and marks their Inbox rows read", async () => {
    const row = liveHere();
    const id = String(row.id);
    bdb.t.actions.push(
      { id: "c-click", sessionId: "chat-1", toolName: "click", status: "PENDING", actingForId: "u-max", input: { browserSessionId: id } },
      { id: "c-take", sessionId: "chat-1", toolName: "ask_to_take_over", status: "RUNNING", actingForId: "u-max", input: { browserSessionId: id } },
      { id: "c-other", sessionId: "chat-1", toolName: "click", status: "PENDING", actingForId: "u-max", input: { browserSessionId: "another" } },
      { id: "c-running-click", sessionId: "chat-1", toolName: "click", status: "RUNNING", actingForId: "u-max", input: { browserSessionId: id } },
      { id: "c-task", sessionId: "chat-1", toolName: "create_task", status: "PENDING", actingForId: "u-max", input: { browserSessionId: id } },
    );
    bdb.t.notifications.push({ id: "n1", userId: "u-max", link: "/agents?chat=shopper&action=c-click", read: false }, { id: "n2", userId: "u-max", link: "/agents?chat=shopper&action=c-other", read: false });
    await endBrowserSession(id, "waited_too_long", SYSTEM_END);
    const status = Object.fromEntries(bdb.t.actions.map((a) => [a.id, a.status]));
    expect(status).toEqual({ "c-click": "CANCELLED", "c-take": "CANCELLED", "c-other": "PENDING", "c-running-click": "RUNNING", "c-task": "PENDING" });
    expect(bdb.t.actions[0]).toMatchObject({ decidedVia: "system", error: "Cancelled: the browser closed before you decided, so nothing was done. Closed after waiting 10 minutes for you." });
    expect(bdb.t.notifications.map((n) => n.read)).toEqual([true, false]);
  });

  // Phase 5 step 1 (BROWSER_CARD_TOOLS): a waiting fill card or request to be shown goes with its browser too.
  it("cancels a waiting fill card and a waiting request to be shown when their browser ends (Phase 5 step 1)", async () => {
    const row = liveHere();
    const id = String(row.id);
    bdb.t.actions.push(
      { id: "c-fill", sessionId: "chat-1", toolName: "fill_fields", status: "PENDING", actingForId: "u-max", input: { browserSessionId: id } },
      { id: "c-show", sessionId: "chat-1", toolName: "ask_to_show_me", status: "PENDING", actingForId: "u-max", input: { browserSessionId: id } },
      { id: "c-fill-other", sessionId: "chat-1", toolName: "fill_fields", status: "PENDING", actingForId: "u-max", input: { browserSessionId: "another" } },
    );
    await endBrowserSession(id, "stopped", { id: "u-max", type: "person" });
    // Before: neither was a browser card, so both waited on a browser that was gone.
    expect(Object.fromEntries(bdb.t.actions.map((x) => [x.id, x.status]))).toEqual({ "c-fill": "CANCELLED", "c-show": "CANCELLED", "c-fill-other": "PENDING" });
  });

  it("writes the end step and one audit row with each host's reads and acts, never a path", async () => {
    const row = liveHere({ currentSite: "shop.proof.test" });
    const id = String(row.id);
    seedStep({ browserSessionId: id, userId: "u-max", seq: 1, kind: "open", site: "docs.proof.test" });
    seedStep({ browserSessionId: id, userId: "u-max", seq: 2, kind: "read", site: "docs.proof.test" });
    seedStep({ browserSessionId: id, userId: "u-max", seq: 3, kind: "click", site: "shop.proof.test" });
    seedStep({ browserSessionId: id, userId: "u-max", seq: 4, kind: "open", site: "blocked.proof.test", outcome: "refused", code: "blocked" });
    await endBrowserSession(id, "closed_by_teammate", { id: "u-max", type: "agent" });
    expect(bdb.t.steps.at(-1)).toMatchObject({ kind: "end", seq: 5, site: "shop.proof.test", code: "closed_by_teammate" });
    const audit = bdb.t.activity.find((a) => a.type === "teammate_browser.session_ended")!;
    expect(audit).toMatchObject({ actorType: "agent", actorLabel: "Shopper for Max Chen", actingForId: "u-max" });
    expect((audit.metadata as Record<string, unknown>).sites).toEqual([
      { site: "docs.proof.test", reads: 2, acts: 0 },
      { site: "shop.proof.test", reads: 0, acts: 1 },
      { site: "blocked.proof.test", reads: 0, acts: 0 },
    ]);
    expect(JSON.stringify(audit)).not.toMatch(/\/[a-z-]+\?|\/cart|checkout/);
  });

  it("leaves a release the provider did not confirm for the sweep, which ends it, or gives up after eight tries", async () => {
    st.releaseAnswer = "failed";
    const row = liveHere();
    await endBrowserSession(String(row.id), "stopped", { id: "u-max", type: "person" });
    expect(row).toMatchObject({ status: "ending", stopAttempts: 1 });
    // Not due yet.
    expect((await sweepBrowserSessions(new Date(), { limit: 10, budgetMs: 10_000 })).retried).toBe(0);
    st.releaseAnswer = "already";
    expect((await sweepBrowserSessions(new Date(Date.now() + 3 * 60_000), { limit: 10, budgetMs: 10_000 })).retried).toBe(1);
    expect(row.status).toBe("ended");

    st.releaseAnswer = "failed";
    const stuck = seedSession({ status: "ending", stopAttempts: 7, nextStopAt: new Date(Date.now() - 1000), reservedMinutes: 15 });
    await sweepBrowserSessions(new Date(), { limit: 10, budgetMs: 10_000 });
    expect(stuck).toMatchObject({ status: "ended", billedMinutes: 15 });
  });

  it("ends a row whose guard was found gone only when it had one, never one still starting (review of Phase 4 step 2)", async () => {
    const starting = seedSession({ status: "starting", bootId: BOOT_ID, providerSessionId: null });
    expect(await endBrowserSession(String(starting.id), "restarted", SYSTEM_END, { only: GUARD_GONE_ONLY })).toBe(false);
    expect(starting).toMatchObject({ status: "starting", endReason: null });
    const elsewhere = seedSession({ userId: "u-2", bootId: "old-boot" });
    expect(await endBrowserSession(String(elsewhere.id), "restarted", SYSTEM_END, { only: GUARD_GONE_ONLY })).toBe(true);
    expect(elsewhere).toMatchObject({ status: "ended", endReason: "restarted" });
  });

  it("writes no chat line for a person whose account is erased", async () => {
    bdb.t.users[0].deletedAt = new Date();
    const row = liveHere();
    await endBrowserSession(String(row.id), "left", SYSTEM_END);
    expect(st.lines).toEqual([]);
    // Nor any step.
    expect(bdb.t.steps).toEqual([]);
  });
});

describe("recordStep", () => {
  it("numbers steps in order under the session's lock, at most 300, the end always written", async () => {
    const row = liveHere();
    const id = String(row.id);
    for (let i = 0; i < 300; i++) seedStep({ browserSessionId: id, userId: "u-max", seq: i + 1, kind: "read", site: "docs.proof.test" });
    expect(await recordStep(id, "u-max", { kind: "read", site: "docs.proof.test", outcome: "ok" })).toBe(false);
    expect(await recordStep(id, "u-max", { kind: "end", site: null, outcome: "ok", code: "idle" })).toBe(true);
    expect(bdb.t.steps.at(-1)).toMatchObject({ seq: 301, kind: "end" });
    expect(bdb.rowLocks.filter((l) => l.what === "step-session").every((l) => l.inTx)).toBe(true);
  });

  it("writes a turn's step only while its run is open", async () => {
    const row = liveHere();
    bdb.t.runs.push({ id: "run-1", status: "FAILED", startedAt: new Date(), endedAt: new Date() });
    expect(await recordStep(String(row.id), "u-max", { kind: "open", site: "docs.proof.test", outcome: "ok" }, { whileOpen: { runId: "run-1", personId: "u-max" } })).toBe(false);
    bdb.t.runs[0].status = "RUNNING";
    expect(await recordStep(String(row.id), "u-max", { kind: "open", site: "docs.proof.test", outcome: "ok" }, { whileOpen: { runId: "run-1", personId: "u-max" } })).toBe(true);
    // Another person's session takes no step of theirs.
    expect(await recordStep(String(row.id), "u-olivia", { kind: "open", site: "docs.proof.test", outcome: "ok" })).toBe(false);
  });
});

// Step 3: what the tools and the cards read and write of a session beside its steps.
describe("a session's waiting, steps and host (Phase 4 step 3)", () => {
  const card = (o: Record<string, unknown> = {}) => {
    const row = { id: `act${bdb.t.actions.length + 1}`, sessionId: "chat-1", toolName: "click", status: "PENDING", input: { browserSessionId: "bs-x" }, createdAt: new Date(), ...o };
    bdb.t.actions.push(row);
    return row;
  };

  it("finds the one step a session waits on, by its session in its chat", async () => {
    const row = liveHere({ chatSessionId: "chat-1", status: "waiting" });
    const id = String(row.id);
    expect(await waitingCardOf(id, "chat-1")).toBeNull();
    card({ input: { browserSessionId: "another" } });
    card({ status: "DENIED", input: { browserSessionId: id } });
    card({ toolName: "create_task", input: { browserSessionId: id } });
    expect(await waitingCardOf(id, "chat-1")).toBeNull();
    const waits = card({ toolName: "ask_to_take_over", input: { browserSessionId: id } });
    expect(await waitingCardOf(id, "chat-1")).toMatchObject({ id: waits.id, toolName: "ask_to_take_over" });
  });

  it("releases a session from waiting once its card was decided, and only then", async () => {
    const row = liveHere({ chatSessionId: "chat-1", status: "waiting", waitingSince: new Date() });
    const id = String(row.id);
    const pending = card({ input: { browserSessionId: id } });
    await releaseWaiting(id);
    // A card still waits: the session waits on it.
    expect(row).toMatchObject({ status: "waiting" });
    pending.status = "EXECUTED";
    await releaseWaiting(id);
    expect(row).toMatchObject({ status: "live", waitingSince: null });
    // A session handed over, or ended, is no waiting one to release.
    const held = liveHere({ status: "handed_over" });
    await releaseWaiting(String(held.id));
    expect(held.status).toBe("handed_over");
    await releaseWaiting(42);
  });

  it("says when a session has taken its 300 steps", async () => {
    const row = liveHere();
    const id = String(row.id);
    for (let i = 0; i < 299; i++) seedStep({ browserSessionId: id, userId: "u-max", seq: i + 1, kind: "read" });
    expect(await stepsUsedUp(id)).toBe(false);
    seedStep({ browserSessionId: id, userId: "u-max", seq: 300, kind: "read" });
    expect(await stepsUsedUp(id)).toBe(true);
  });

  it("records the host a live session is on, never a path, and none for an ended one", async () => {
    const row = liveHere();
    await setCurrentSite(String(row.id), "docs.proof.test");
    expect(row.currentSite).toBe("docs.proof.test");
    await setCurrentSite(String(row.id), null);
    expect(row.currentSite).toBeNull();
    const ended = seedSession({ status: "ended", currentSite: null });
    await setCurrentSite(String(ended.id), "docs.proof.test");
    expect(ended.currentSite).toBeNull();
  });

  it("waits a card as long as the session waits: ten minutes, or the stand-in's own seconds", () => {
    expect(waitingWindowMs(null)).toBe(600_000);
    expect(waitingWindowMs({ standIn: false, testTimes: { sessionSeconds: null, idleSeconds: null, waitSeconds: 30, takeOverSeconds: null } })).toBe(600_000);
    expect(waitingWindowMs({ standIn: true, testTimes: { sessionSeconds: null, idleSeconds: null, waitSeconds: 30, takeOverSeconds: null } })).toBe(30_000);
  });
});

describe("the switch and the lists", () => {
  it("turns off under the policy's lock and ends every browser in the workspace", async () => {
    const row = liveHere();
    const out = await setComputerEnabled("org1", false, "u-olivia");
    expect(out).toEqual({ before: true, after: false, ended: 1 });
    expect(row).toMatchObject({ status: "ended", endReason: "turned_off" });
    expect(bdb.locks[0]).toMatchObject({ cls: 73_032, key: "org1", inTx: true });
    expect((await setComputerEnabled("org1", true, "u-olivia"))).toEqual({ before: false, after: true, ended: 0 });
  });

  it("adds a site once, refuses a list at its most, and removes it, one change at a time", async () => {
    expect(await changePolicySite("org1", "allow", { add: "shop.proof.test" }, "u-olivia")).toEqual({ changed: true, sites: ["docs.proof.test", "shop.proof.test"] });
    expect(await changePolicySite("org1", "allow", { add: "shop.proof.test" }, "u-olivia")).toEqual({ changed: false, sites: ["docs.proof.test", "shop.proof.test"] });
    expect(await changePolicySite("org1", "block", { add: "blocked.proof.test" }, "u-olivia")).toEqual({ changed: true, sites: ["blocked.proof.test"] });
    expect(await changePolicySite("org1", "allow", { remove: "docs.proof.test" }, "u-olivia")).toEqual({ changed: true, sites: ["shop.proof.test"] });
    expect(await changePolicySite("org1", "allow", { remove: "nope.proof.test" }, "u-olivia")).toEqual({ changed: false, sites: ["shop.proof.test"] });
    bdb.t.policies[0].allowSites = Array.from({ length: 200 }, (_, i) => `s${i}.example.com`);
    expect(await changePolicySite("org1", "allow", { add: "one-more.example.com" }, "u-olivia")).toMatchObject({ changed: false, tooMany: true });
    expect(bdb.rowLocks.filter((l) => l.what === "policy").every((l) => l.inTx)).toBe(true);
  });

  it("changes a teammate's sites under a lock on its row, one change at a time", async () => {
    expect(await changeTeammateSite("a-shop", "org1", { add: "shop.proof.test" })).toEqual({ changed: true, sites: ["docs.proof.test", "shop.proof.test"] });
    expect(await changeTeammateSite("a-shop", "org1", { add: "shop.proof.test" })).toEqual({ changed: false, sites: ["docs.proof.test", "shop.proof.test"] });
    expect(await changeTeammateSite("a-shop", "org2", { add: "x.proof.test" })).toBeNull();
    expect(bdb.rowLocks.filter((l) => l.what === "agent")).toEqual([
      { what: "agent", inTx: true },
      { what: "agent", inTx: true },
      { what: "agent", inTx: true },
    ]);
  });

  it("gives this process's browsers the rules as they are now the moment a list changes, and ends one that may no longer browse", async () => {
    const row = liveHere();
    bdb.t.policies[0].allowSites = ["docs.proof.test", "shop.proof.test"];
    bdb.t.agents[0].browserSites = ["docs.proof.test", "shop.proof.test"];
    await refreshLiveRules({ organizationId: "org1" });
    expect(liveBrowser(String(row.id))?.rules.allow).toEqual(["docs.proof.test", "shop.proof.test"]);
    // An Admin blocks one: the guard holds it at the next hop, a take over's clicks included.
    await changePolicySite("org1", "block", { add: "shop.proof.test" }, "u-olivia");
    expect(liveBrowser(String(row.id))?.rules.block).toEqual(["shop.proof.test"]);
    expect(liveBrowser(String(row.id))?.rules.allow).toEqual(["docs.proof.test"]);
    // The last site taken away: the browser closes.
    await changePolicySite("org1", "allow", { remove: "docs.proof.test" }, "u-olivia");
    expect(row).toMatchObject({ status: "ended", endReason: "teammate_off" });
  });

  it("begins a new rules version with each refresh, so a call that read its rules before it cannot put them back (review of Phase 4 step 3)", async () => {
    const row = liveHere();
    bdb.t.policies[0].allowSites = ["docs.proof.test", "shop.proof.test"];
    bdb.t.agents[0].browserSites = ["docs.proof.test", "shop.proof.test"];
    // A call reads its access, then a list changes before it takes the lock.
    const call = await access();
    const before = rulesVersionNow();
    await changePolicySite("org1", "block", { add: "shop.proof.test" }, "u-olivia");
    const lb = liveBrowser(String(row.id))!;
    expect(rulesVersionNow()).toBeGreaterThan(before);
    expect(lb.rulesVersion).toBeGreaterThan(call.rulesVersion);
    expect(installRules(lb, call.rules, call.rulesVersion)).toBe(false);
    expect(lb.rules.block).toEqual(["shop.proof.test"]);
  });
});

describe("refreshLiveRules leaves a page the new rules refuse (review of Phase 4 step 2)", () => {
  const fp = { tag: "button", role: "button", name: "Checkout", kind: "none" as const, type: null, formHost: "shop.proof.test", href: null, twin: 0, twins: 1, anchor: "", at: 0 };

  it("moves that browser to about:blank, forgets its refs, their page and its host, writes a refused step and a note, and leaves the others", async () => {
    bdb.t.policies[0].allowSites = ["docs.proof.test", "shop.proof.test"];
    bdb.t.agents[0].browserSites = ["docs.proof.test", "shop.proof.test"];
    const onShop = liveHere({ currentSite: "shop.proof.test" }, "http://shop.proof.test/cart");
    const onDocs = liveHere({ userId: "u-2", currentSite: "docs.proof.test" }, "http://docs.proof.test/");
    const shop = liveBrowser(String(onShop.id))!;
    shop.refs.set("e1", fp);
    shop.refsUrl = "http://shop.proof.test/cart";
    await changePolicySite("org1", "block", { add: "shop.proof.test" }, "u-olivia");
    expect(st.blanks).toEqual([onShop.id]);
    expect(shop.handle.currentUrl()).toBe("about:blank");
    expect([shop.refs.size, shop.refsUrl]).toEqual([0, null]);
    expect(onShop).toMatchObject({ status: "live", currentSite: null });
    expect(onDocs).toMatchObject({ status: "live", currentSite: "docs.proof.test" });
    expect(bdb.t.steps.filter((s) => s.browserSessionId === onShop.id)).toEqual([expect.objectContaining({ kind: "open", site: "shop.proof.test", outcome: "refused", code: "blocked" })]);
    expect(bdb.t.steps.some((s) => s.browserSessionId === onDocs.id)).toBe(false);
    expect(shop.events).toEqual(["shop.proof.test isn't allowed any more, so the browser left that page."]);
    // A teammate's own site taken away moves its browser too, with that verdict's code.
    st.blanks = [];
    bdb.t.policies[0].allowSites = ["docs.proof.test", "shop.proof.test", "inject.proof.test"];
    await changeTeammateSite("a-shop", "org1", { add: "inject.proof.test" });
    expect(st.blanks).toEqual([]);
    await changeTeammateSite("a-shop", "org1", { remove: "docs.proof.test" });
    expect(onDocs.status).toBe("live");
    expect(st.blanks).toEqual([onDocs.id]);
    expect(bdb.t.steps.filter((s) => s.browserSessionId === onDocs.id)).toEqual([expect.objectContaining({ site: "docs.proof.test", outcome: "refused", code: "not_allowed" })]);
  });

  it("waits for a step in flight before it leaves the page, the guard's rules changed at once", async () => {
    bdb.t.policies[0].allowSites = ["docs.proof.test", "shop.proof.test"];
    bdb.t.agents[0].browserSites = ["docs.proof.test", "shop.proof.test"];
    const row = liveHere({ currentSite: "shop.proof.test" }, "http://shop.proof.test/cart");
    const id = String(row.id);
    let release!: () => void;
    const step = withBrowserLock(id, 1000, () => new Promise<void>((r) => (release = r)));
    const changing = changePolicySite("org1", "block", { add: "shop.proof.test" }, "u-olivia");
    await vi.waitFor(() => expect(liveBrowser(id)?.rules.block).toEqual(["shop.proof.test"]));
    await new Promise((r) => setTimeout(r, 20));
    expect(st.blanks).toEqual([]);
    release();
    await step;
    await changing;
    expect(st.blanks).toEqual([id]);
  });
});

describe("the guard's hooks", () => {
  it("decide by the session's current rules, the frame rule for frames, and end the session when the connection goes", async () => {
    await open();
    const hooks = st.hooks as GuardHooks;
    expect(hooks.verdict("http://docs.proof.test/", true)).toMatchObject({ ok: true });
    expect(hooks.verdict("http://exfil.proof.test/", true)).toMatchObject({ ok: false, code: "not_allowed" });
    expect(hooks.verdict("http://exfil.proof.test/frame", false)).toEqual({ ok: true, frame: true });
    expect(hooks.verdict("http://169.254.169.254/latest", false)).toMatchObject({ ok: false, code: "never" });
    const row = bdb.t.sessions[0];
    hooks.onPopup("http://exfil.proof.test/p");
    hooks.onRefused("blocked.proof.test", "not_allowed", true);
    hooks.onRefused("ads.example.net", "never", false);
    expect(liveBrowser(String(row.id))?.events).toEqual([
      "The page tried to open a new tab on exfil.proof.test. It was closed; open it here if it's a link you read.",
      "That page sent the browser on to blocked.proof.test, which isn't allowed, so it stopped there.",
    ]);
    hooks.onLost();
    await vi.waitFor(() => expect(row).toMatchObject({ status: "ended", endReason: "provider_ended" }));
  });
});

describe("sweepBrowserSessions", () => {
  it("ends a start that never finished, a guard lost to a restart, a session past its time, held too long or waiting too long", async () => {
    const now = new Date();
    const starting = seedSession({ status: "starting", startedAt: new Date(now.getTime() - 2 * 60_000) });
    const elsewhere = seedSession({ userId: "u-2", bootId: "old-boot" });
    const orphan = seedSession({ userId: "u-3", bootId: BOOT_ID });
    const late = liveHere({ userId: "u-4", endsBy: new Date(now.getTime() - 1000) });
    const held = liveHere({ userId: "u-5", status: "handed_over", handedOverAt: new Date(now.getTime() - 11 * 60_000) });
    const waiting = liveHere({ userId: "u-6", status: "waiting", waitingSince: new Date(now.getTime() - 11 * 60_000) });
    const fine = liveHere({ userId: "u-7" });
    const c = await sweepBrowserSessions(now, { limit: 50, budgetMs: 10_000 });
    expect(c).toMatchObject({ failed: 0, startFailed: 1, restarted: 2, timeCap: 1, takeOver: 1, waited: 1, idle: 0 });
    expect([starting, elsewhere, orphan, late, held, waiting].map((r) => r.endReason)).toEqual(["start_failed", "restarted", "restarted", "time_cap", "take_over_too_long", "waited_too_long"]);
    expect(fine.status).toBe("live");
  });

  it("ends an idle session only once its run has ended", async () => {
    const now = new Date();
    const row = liveHere({ lastActiveAt: new Date(now.getTime() - 6 * 60_000), lastRunId: "run-9" });
    bdb.t.runs.push({ id: "run-9", status: "RUNNING", startedAt: new Date(now.getTime() - 60_000), endedAt: null });
    expect((await sweepBrowserSessions(now, { limit: 50, budgetMs: 10_000 })).idle).toBe(0);
    expect(row.status).toBe("live");
    bdb.t.runs[0].endedAt = now;
    expect((await sweepBrowserSessions(now, { limit: 50, budgetMs: 10_000 })).idle).toBe(1);
    expect(row.endReason).toBe("idle");
  });

  describe("the time-based ends never act on a stale read (review of Phase 4 step 2)", () => {
    /** Between the part's read and its end, `then` runs: a change that lands in that moment. */
    function afterRead(match: (where: Record<string, unknown>) => boolean, then: () => void) {
      const model = browserDb.teammateBrowserSession as { findMany: (a?: { where?: Record<string, unknown> }) => Promise<unknown> };
      const real = model.findMany.bind(model);
      vi.spyOn(model, "findMany").mockImplementation(async (a) => {
        const out = await real(a);
        if (match(a?.where ?? {})) then();
        return out;
      });
    }
    const old = (min: number) => new Date(Date.now() - min * 60_000);

    it("keeps an idle session a turn touched after the read", async () => {
      const row = liveHere({ lastActiveAt: old(6) });
      afterRead((w) => w.status === "live" && "lastActiveAt" in w, () => void (row.lastActiveAt = new Date()));
      expect((await sweepBrowserSessions(new Date(), { limit: 50, budgetMs: 10_000 })).idle).toBe(0);
      expect(row.status).toBe("live");
    });

    it("keeps a waiting session the person answered after the read", async () => {
      const row = liveHere({ status: "waiting", waitingSince: old(11) });
      afterRead((w) => w.status === "waiting" && "waitingSince" in w, () => Object.assign(row, { status: "live", waitingSince: null, lastActiveAt: new Date() }));
      expect((await sweepBrowserSessions(new Date(), { limit: 50, budgetMs: 10_000 })).waited).toBe(0);
      expect(row.status).toBe("live");
    });

    it("keeps a take over the person handed back after the read", async () => {
      const row = liveHere({ status: "handed_over", handedOverAt: old(11) });
      afterRead((w) => w.status === "handed_over" && "handedOverAt" in w, () => Object.assign(row, { status: "live", handedOverAt: null, lastActiveAt: new Date() }));
      expect((await sweepBrowserSessions(new Date(), { limit: 50, budgetMs: 10_000 })).takeOver).toBe(0);
      expect(row.status).toBe("live");
    });

    it("skips an idle, waiting or taken over session while a step holds its browser, and ends it once the step is done", async () => {
      const idle = liveHere({ lastActiveAt: old(6) });
      const waiting = liveHere({ userId: "u-2", status: "waiting", waitingSince: old(11) });
      const held = liveHere({ userId: "u-3", status: "handed_over", handedOverAt: old(11) });
      const releases: Array<() => void> = [];
      const steps = [idle, waiting, held].map((r) => withBrowserLock(String(r.id), 1000, () => new Promise<void>((done) => releases.push(done))));
      const c = await sweepBrowserSessions(new Date(), { limit: 50, budgetMs: 10_000 });
      expect([c.idle, c.waited, c.takeOver]).toEqual([0, 0, 0]);
      expect([idle.status, waiting.status, held.status]).toEqual(["live", "waiting", "handed_over"]);
      for (const done of releases) done();
      await Promise.all(steps);
      const after = await sweepBrowserSessions(new Date(), { limit: 50, budgetMs: 10_000 });
      expect([after.idle, after.waited, after.takeOver]).toEqual([1, 1, 1]);
      expect([idle.endReason, waiting.endReason, held.endReason]).toEqual(["idle", "waited_too_long", "take_over_too_long"]);
    });

    it("still ends a session past its hard cap at once, a step in flight or not", async () => {
      const row = liveHere({ endsBy: new Date(Date.now() - 1000) });
      let release!: () => void;
      const step = withBrowserLock(String(row.id), 1000, () => new Promise<void>((r) => (release = r)));
      expect((await sweepBrowserSessions(new Date(), { limit: 50, budgetMs: 10_000 })).timeCap).toBe(1);
      expect(row).toMatchObject({ status: "ended", endReason: "time_cap" });
      release();
      await step;
    });
  });

  it("ends a leaver's, a turned-off workspace's, a plan's and a paused teammate's browsers with their reasons", async () => {
    const left = liveHere({ userId: "u-gone" });
    st.acting.set("u-gone", { ok: false, reason: "gone" });
    const guest = liveHere({ userId: "u-guest" });
    st.acting.set("u-guest", { ok: false, reason: "guest" });
    const paused = liveHere({ userId: "u-p", agentId: "a-res" });
    bdb.t.agents[1].status = "DISABLED";
    const fine = liveHere({ userId: "u-fine" });
    const c = await sweepBrowserSessions(new Date(), { limit: 50, budgetMs: 10_000 });
    expect(c.noAccess).toBe(3);
    expect([left.endReason, guest.endReason, paused.endReason]).toEqual(["left", "no_access", "teammate_off"]);
    expect(fine.status).toBe("live");
    bdb.t.orgs[0].plan = "STARTER";
    await sweepBrowserSessions(new Date(), { limit: 50, budgetMs: 10_000 });
    expect(fine).toMatchObject({ status: "ended", endReason: "plan" });
  });

  it("releases a tagged provider session no live row names, and leaves an untagged one and another deployment's", async () => {
    liveHere({ providerSessionId: "pv-live" });
    seedSession({ userId: "u-s", status: "starting", providerSessionId: null, id: "row-starting", bootId: BOOT_ID, startedAt: new Date() });
    seedSession({ userId: "u-e", status: "ended", providerSessionId: "pv-ended" });
    st.running = [
      { providerSessionId: "pv-orphan", tag: "workwrk", rowId: "row-gone" },
      { providerSessionId: "pv-live", tag: "workwrk", rowId: "x" },
      { providerSessionId: "pv-ended", tag: "workwrk", rowId: "y" },
      { providerSessionId: "pv-starting", tag: "workwrk", rowId: "row-starting" },
      { providerSessionId: "pv-untagged", tag: null, rowId: null },
      { providerSessionId: "pv-prod", tag: "workwrk-prod", rowId: "z" },
    ];
    const c = await sweepBrowserSessions(new Date(), { limit: 50, budgetMs: 10_000 });
    expect(c.reaped).toBe(2);
    expect(st.released.sort()).toEqual(["pv-ended", "pv-orphan"]);
  });

  it("deletes steps older than 30 days by the database's UTC clock", async () => {
    const row = seedSession({ status: "ended" });
    seedStep({ browserSessionId: row.id, userId: "u-max", seq: 1, kind: "read", at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) });
    seedStep({ browserSessionId: row.id, userId: "u-max", seq: 2, kind: "read", at: new Date() });
    const c = await sweepBrowserSessions(new Date(), { limit: 50, budgetMs: 10_000 });
    expect(c.stepsDeleted).toBe(1);
    expect(bdb.raw.find((s) => s.startsWith('DELETE FROM "TeammateBrowserStep"'))).toContain("(now() AT TIME ZONE 'UTC') - interval '30 days'");
    expect(bdb.t.steps.map((s) => s.seq)).toEqual([2]);
  });
});

describe("the workspace hooks", () => {
  it("end every live browser of a workspace, and only that workspace's", async () => {
    const mine = liveHere();
    const theirs = liveHere({ organizationId: "org2", userId: "u-other" });
    expect(await endWorkspaceBrowserSessions("org1", "admin_stopped", "u-olivia")).toBe(1);
    expect(mine).toMatchObject({ status: "ended", endReason: "admin_stopped" });
    expect(theirs.status).toBe("live");
    // The admin is the audit row's actor.
    expect(bdb.t.activity.find((a) => a.type === "teammate_browser.session_ended")).toMatchObject({ actorId: "u-olivia" });
  });
});

// ── Review round 1 of Phase 4 ───────────────────────────────────────

describe("the windows end in the process that holds the browser (review round 1 of Phase 4)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const MIN = 60_000;
  /** Fake minutes pass, and whatever the timer started settles. */
  async function pass(ms: number) {
    await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
  }

  it("ends a browser idle 5 minutes after its turn ended, with no sweep", async () => {
    const row = liveHere({ lastActiveAt: new Date() });
    await touchAfterTurn("org1", "u-max", "a-shop");
    await pass(4 * MIN);
    expect(row.status).toBe("live");
    await pass(MIN + 1000);
    // Before: live until a sweep, every 10 minutes after the routines.
    await vi.waitFor(() => expect(row).toMatchObject({ status: "ended", endReason: "idle" }));
    expect(liveBrowser(String(row.id))).toBeNull();
  });

  it("waits while its turn still runs, and ends it once that turn is over", async () => {
    const row = liveHere({ lastActiveAt: new Date(), lastRunId: "run-9" });
    bdb.t.runs.push({ id: "run-9", status: "RUNNING", startedAt: new Date(), endedAt: null });
    await touchAfterTurn("org1", "u-max", "a-shop");
    await pass(5 * MIN + 1000);
    expect(row.status).toBe("live");
    bdb.t.runs[0].endedAt = new Date();
    await pass(MIN + 1000);
    await vi.waitFor(() => expect(row).toMatchObject({ status: "ended", endReason: "idle" }));
  });

  it("ends a browser 10 minutes after its card was asked, the idle timer armed before the card reading the row again", async () => {
    const row = liveHere({ lastActiveAt: new Date() });
    expect(await useBrowserSession({ person: MAX, agentId: "a-shop", runId: "run-1", purpose: "model" })).toMatchObject({ ok: true });
    // The card's own swap (executor.ts askBrowserCard) moves the window later and arms nothing.
    Object.assign(row, { status: "waiting", waitingSince: new Date() });
    await pass(5 * MIN + 1000);
    expect(row.status).toBe("waiting");
    await pass(5 * MIN);
    await vi.waitFor(() => expect(row).toMatchObject({ status: "ended", endReason: "waited_too_long" }));
  });

  it("ends a take over at its 10 minutes, and arms the idle window again from Done", async () => {
    const held = liveHere({ lastActiveAt: new Date() });
    expect(await startTakeOver(MAX, String(held.id), null)).toMatchObject({ ok: true });
    await pass(10 * MIN + 1000);
    await vi.waitFor(() => expect(held).toMatchObject({ status: "ended", endReason: "take_over_too_long" }));

    const back = liveHere({ userId: "u-max", lastActiveAt: new Date(), endsBy: new Date(Date.now() + 60 * MIN) });
    expect(await startTakeOver(MAX, String(back.id), null)).toMatchObject({ ok: true });
    await pass(9 * MIN);
    expect(await finishTakeOver(MAX, String(back.id), true)).toMatchObject({ ok: true });
    await pass(4 * MIN);
    expect(back.status).toBe("live");
    await pass(MIN + 1000);
    await vi.waitFor(() => expect(back).toMatchObject({ status: "ended", endReason: "idle" }));
  });

  it("arms the idle window when a decided card releases the waiting", async () => {
    const row = liveHere({ status: "waiting", waitingSince: new Date(Date.now() - 9 * MIN), lastActiveAt: new Date(Date.now() - 9 * MIN) });
    await releaseWaiting(String(row.id));
    expect(row.status).toBe("live");
    await pass(5 * MIN + 1000);
    await vi.waitFor(() => expect(row).toMatchObject({ status: "ended", endReason: "idle" }));
  });

  it("ends a browser at its time cap from the timer, and leaves a step in flight to finish before an idle end", async () => {
    const capped = liveHere({ lastActiveAt: new Date(), endsBy: new Date(Date.now() + 2 * MIN) });
    await useBrowserSession({ person: MAX, agentId: "a-shop", runId: "run-1", purpose: "model" });
    await pass(2 * MIN + 1000);
    await vi.waitFor(() => expect(capped).toMatchObject({ status: "ended", endReason: "time_cap" }));

    const busy = liveHere({ userId: "u-2", lastActiveAt: new Date() });
    await touchAfterTurn("org1", "u-2", "a-shop");
    let release!: () => void;
    const step = withBrowserLock(String(busy.id), 1000, () => new Promise<void>((r) => (release = r)));
    await pass(5 * MIN + 1000);
    expect(busy.status).toBe("live");
    release();
    await step;
    await pass(16_000);
    await vi.waitFor(() => expect(busy).toMatchObject({ status: "ended", endReason: "idle" }));
  });

  it("clears the timer when the session ends", async () => {
    const row = liveHere({ lastActiveAt: new Date() });
    await touchAfterTurn("org1", "u-max", "a-shop");
    const lb = liveBrowser(String(row.id))!;
    expect(lb.windowTimer).not.toBeNull();
    await endBrowserSession(String(row.id), "stopped", { id: "u-max", type: "person" });
    expect(lb.windowTimer).toBeNull();
  });
});

describe("a start read again once it is on record (review round 1 of Phase 4)", () => {
  it("ends the row and asks the provider for nothing when the switch went off after the call read it", async () => {
    const before = await access();
    bdb.t.policies[0].enabled = false;
    const out = await openBrowserSession({ person: MAX, agent: SHOPPER, chatSessionId: "chat-1", runId: "run-1", access: before });
    // Before: a browser was started and a page opened after the switch was off.
    expect(out).toEqual({ ok: false, reason: "workspace_off" });
    expect(st.created).toEqual([]);
    expect(bdb.t.sessions[0]).toMatchObject({ status: "ended", endReason: "turned_off", billedMinutes: 0 });
    expect(liveBrowser(String(bdb.t.sessions[0].id))).toBeNull();
  });

  it("does the same for a person who left, and a teammate paused, meanwhile", async () => {
    const before = await access();
    st.acting.set("u-max", { ok: false, reason: "gone" });
    expect(await openBrowserSession({ person: MAX, agent: SHOPPER, chatSessionId: "chat-1", runId: "run-1", access: before })).toEqual({ ok: false, reason: "person_cant" });
    expect(bdb.t.sessions[0]).toMatchObject({ status: "ended", endReason: "left" });
    st.acting = new Map();
    bdb.t.agents[0].status = "DISABLED";
    // Review round 4 of Phase 4: in run-1 the end above holds, and the start says so before anything; another message's run reads again.
    // Last polish of Phase 4: that row ended while it was starting, so it drew no card (noCard).
    expect(await openBrowserSession({ person: MAX, agent: SHOPPER, chatSessionId: "chat-1", runId: "run-1", access: before })).toEqual({ ok: false, reason: "closed_in_answer", endReason: "left", noCard: true });
    expect(bdb.t.sessions).toHaveLength(1);
    expect(await openBrowserSession({ person: MAX, agent: SHOPPER, chatSessionId: "chat-1", runId: "run-2", access: before })).toEqual({ ok: false, reason: "teammate_off" });
    expect(bdb.t.sessions[1]).toMatchObject({ status: "ended", endReason: "teammate_off" });
    expect(st.created).toEqual([]);
  });

  it("guards the browser with the rules read again, not the caller's", async () => {
    const before = await access();
    bdb.t.policies[0].blockSites = ["blocked.proof.test"];
    expect(await openBrowserSession({ person: MAX, agent: SHOPPER, chatSessionId: "chat-1", runId: "run-1", access: before })).toMatchObject({ ok: true });
    expect(liveBrowser(String(bdb.t.sessions[0].id))?.rules.block).toEqual(["blocked.proof.test"]);
  });

  it("begins a new rules version when the switch changes, so a call that read it on reads it again under the lock", async () => {
    const read = rulesVersionNow();
    await setComputerEnabled("org1", false, "u-olivia");
    // Before: the same version, so a call holding the switch on acted on it.
    expect(rulesVersionNow()).toBeGreaterThan(read);
  });
});

describe("the session read again (review round 1 of Phase 4)", () => {
  it("refuses a call while the person has the browser by its flag, before the row says so", async () => {
    const row = liveHere();
    liveBrowser(String(row.id))!.handedOver = true;
    expect(await useBrowserSession({ person: MAX, agentId: "a-shop", runId: "run-1", purpose: "model" })).toEqual({ ok: false, reason: "person_has_it" });
    expect(await useBrowserSession({ person: MAX, agentId: "a-shop", browserSessionId: String(row.id), runId: null, purpose: "approval" })).toEqual({ ok: false, reason: "person_has_it" });
  });

  it("says a browser ended meanwhile by its own reason, never restarted, and ends only a row that had a guard", async () => {
    const row = seedSession({ bootId: "another-boot" });
    const model = browserDb.teammateBrowserSession as { findFirst: (a?: unknown) => Promise<unknown> };
    const real = model.findFirst.bind(model);
    vi.spyOn(model, "findFirst").mockImplementationOnce(async (a) => {
      const out = await real(a);
      // Stop lands between the read and the end.
      Object.assign(row, { status: "ending", endReason: "stopped" });
      return out;
    });
    expect(await useBrowserSession({ person: MAX, agentId: "a-shop", runId: "run-1", purpose: "model" })).toEqual({ ok: false, reason: "ended", endReason: "stopped" });
    expect(row).toMatchObject({ status: "ending", endReason: "stopped" });
  });
});

describe("the guard keeps no note while the person has the browser (review round 1 of Phase 4)", () => {
  it("empties the notes at Take over, drops a refused hop and a popup meanwhile, empties them again at Done, and keeps the next", async () => {
    await open();
    const hooks = st.hooks as GuardHooks;
    const row = bdb.t.sessions[0];
    const lb = liveBrowser(String(row.id))!;
    hooks.onDialog("alert");
    expect(await startTakeOver(MAX, String(row.id), null)).toMatchObject({ ok: true });
    expect([lb.handedOver, lb.events]).toEqual([true, []]);
    // The person's own steps while they have it.
    hooks.onRefused("bank-lookalike.proof.test", "not_allowed", true);
    hooks.onPopup("https://accounts.google.com/o/oauth2");
    hooks.onDownload();
    expect(lb.events).toEqual([]);
    expect(await finishTakeOver(MAX, String(row.id), true)).toMatchObject({ ok: true });
    expect(lb.handedOver).toBe(false);
    // The next read's note (page-calls.ts withNotes takes them): nothing of the take over.
    expect(takeEvents(lb)).toEqual([]);
    hooks.onDialog("alert");
    expect(lb.events).toEqual(["The page showed a message box, which was closed without answering it."]);
  });
});

describe("the sweep (review round 1 of Phase 4)", () => {
  it("deletes old steps and pictures first, whatever a provider that hangs does to the releases", async () => {
    st.releaseHangs = true;
    const old = seedSession({ status: "ended", userId: "u-old" });
    seedStep({ browserSessionId: old.id, userId: "u-old", seq: 1, kind: "read", at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) });
    bdb.t.shots.push({ id: `sh${"c".repeat(32)}`, browserSessionId: old.id, organizationId: "org1", userId: "u-old", kind: "page", bytes: 10, createdAt: new Date(Date.now() - 25 * 3600_000), expiresAt: new Date(Date.now() - 3600_000) });
    for (let i = 0; i < 40; i++) seedSession({ userId: `u-end${i}`, status: "ending", nextStopAt: new Date(Date.now() - 1000), stopAttempts: 1 });
    const started = Date.now();
    // Before: the first hanging release held the sweep, and retention never ran.
    const c = await sweepBrowserSessions(new Date(), { limit: 200, budgetMs: 2_000, releaseMs: 20 });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect([c.stepsDeleted, c.shotsDeleted]).toEqual([1, 1]);
    // RETRY_MAX a tick, each counted as one more try.
    expect(st.released.length).toBeLessThanOrEqual(RETRY_MAX);
    expect(bdb.t.sessions.filter((r) => r.status === "ending" && r.stopAttempts === 2)).toHaveLength(st.released.length);
  });

  it("ends a session with a hanging release on time and leaves its release to the next try", async () => {
    st.releaseHangs = true;
    const row = liveHere({ endsBy: new Date(Date.now() - 1000) });
    const c = await sweepBrowserSessions(new Date(), { limit: 50, budgetMs: 2_000, releaseMs: 20 });
    expect(c.timeCap).toBe(1);
    expect(row).toMatchObject({ status: "ending", stopAttempts: 1, endReason: "time_cap" });
  });

  it("ends an ending row past the provider's own limit whatever its tries say, so it holds no slot of the caps", async () => {
    const now = Date.now();
    const over = seedSession({ userId: "u-a", status: "ending", endsBy: new Date(now - PROVIDER_GRACE_MS - 1000), stopAttempts: 1, nextStopAt: new Date(now + 60_000), reservedMinutes: 15 });
    const notYet = seedSession({ userId: "u-b", status: "ending", endsBy: new Date(now + 60_000), stopAttempts: 1, nextStopAt: new Date(now + 60_000) });
    const c = await sweepBrowserSessions(new Date(), { limit: 50, budgetMs: 10_000 });
    // Before: kept "ending" until its eighth try, about 70 minutes at the cron's pace.
    expect(c.overdue).toBe(1);
    expect(over).toMatchObject({ status: "ended", billedMinutes: 15 });
    expect(notYet.status).toBe("ending");
    // A start now counts only the one still ending (GROWTH: two at once).
    expect(await open()).toMatchObject({ ok: true });
  });

  it("ends at once a session whose release fails after the provider's own limit", async () => {
    st.releaseAnswer = "failed";
    const row = liveHere({ endsBy: new Date(Date.now() - PROVIDER_GRACE_MS - 1000) });
    await endBrowserSession(String(row.id), "time_cap", SYSTEM_END);
    expect(row).toMatchObject({ status: "ended", billedMinutes: 15 });
  });
});

describe("a release that times out (follow-up to review round 1 of Phase 4)", () => {
  /** A provider that never answers: each request ends only when its signal aborts, as fetch's does. */
  const signals: AbortSignal[] = [];
  function neverAnswers() {
    signals.length = 0;
    st.realProvider = true;
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
      if (init.signal) signals.push(init.signal);
      return new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
    }));
  }

  it("asks every release and the list to wait no longer than the sweep does", async () => {
    liveHere({ providerSessionId: "pv-capped", endsBy: new Date(Date.now() - 1000) });
    seedSession({ userId: "u-r", status: "ending", providerSessionId: "pv-retry", nextStopAt: new Date(Date.now() - 1000), stopAttempts: 1 });
    st.running = [{ providerSessionId: "pv-orphan", tag: "workwrk", rowId: "row-gone" }];
    await sweepBrowserSessions(new Date(), { limit: 50, budgetMs: 10_000 });
    expect(st.released.sort()).toEqual(["pv-capped", "pv-orphan", "pv-retry"]);
    // Before: each was asked with no wait of its own, so it ran on to the request's 10 seconds.
    expect(st.releaseOpts).toEqual([{ timeoutMs: SWEEP_RELEASE_MS }, { timeoutMs: SWEEP_RELEASE_MS }, { timeoutMs: SWEEP_RELEASE_MS }]);
    expect(st.listOpts).toHaveLength(1);
    const listWait = (st.listOpts[0] as { timeoutMs?: number } | undefined)?.timeoutMs ?? 0;
    expect(listWait > 0 && listWait <= 10_000).toBe(true);
  });

  it("aborts a release that never answers at the sweep's wait, tries it again, and ends the row past endsBy plus the provider's grace", async () => {
    neverAnswers();
    const row = liveHere({ endsBy: new Date(Date.now() - 1000) });
    await sweepBrowserSessions(new Date(), { limit: 50, budgetMs: 400, releaseMs: 30 });
    expect(row).toMatchObject({ status: "ending", stopAttempts: 1, endReason: "time_cap" });
    // Before: the sweep stopped waiting, and the request itself ran on.
    expect(signals.length).toBeGreaterThanOrEqual(2);
    expect(signals.every((x) => x.aborted)).toBe(true);
    // The next tick tries it again, as any failed release.
    row.nextStopAt = new Date(Date.now() - 1000);
    signals.length = 0;
    await sweepBrowserSessions(new Date(), { limit: 50, budgetMs: 400, releaseMs: 30 });
    expect(row).toMatchObject({ status: "ending", stopAttempts: 2 });
    expect(signals.length > 0 && signals.every((x) => x.aborted)).toBe(true);
    // Past the provider's own limit it is ended at its reserved minutes, whatever its tries say.
    row.endsBy = new Date(Date.now() - PROVIDER_GRACE_MS - 1000);
    const c = await sweepBrowserSessions(new Date(), { limit: 50, budgetMs: 400, releaseMs: 30 });
    expect(c.overdue).toBe(1);
    expect(row).toMatchObject({ status: "ended", billedMinutes: 15 });
  });

  it("ends at once a row whose timed out release comes after the provider's own limit", async () => {
    neverAnswers();
    const row = liveHere({ endsBy: new Date(Date.now() - PROVIDER_GRACE_MS - 1000) });
    await endBrowserSession(String(row.id), "time_cap", SYSTEM_END, { releaseMs: 30 });
    expect(row).toMatchObject({ status: "ended", billedMinutes: 15 });
    expect(signals.length === 1 && signals[0].aborted).toBe(true);
  });
});

describe("whose browser an end row is about (review round 1 of Phase 4)", () => {
  it("names the session's person on every end row, whoever ended it", async () => {
    const stopped = liveHere();
    await endBrowserSession(String(stopped.id), "stopped", { id: "u-max", type: "person" });
    const byAdmin = liveHere({ userId: "u-2" });
    await endBrowserSession(String(byAdmin.id), "admin_stopped", { id: "u-olivia", type: "person" });
    const rows = bdb.t.activity.filter((a) => a.type === "teammate_browser.session_ended");
    // Before: a person's or an admin's end named nobody it was for.
    expect(rows.map((r) => [r.actorId, r.actingForId])).toEqual([
      ["u-max", "u-max"],
      ["u-olivia", "u-2"],
    ]);
  });
});

// ── Review round 4 of Phase 4: a Stop holds for the rest of its answer ──
//
// Before, a model call read only the person's live row: once a browser
// ended, every later call of the answer heard "No page is open. Open one
// with open_page first", and open_page started a new paid browser right
// after the person pressed Stop. The flows below run the real browser tools
// and the card's preparation over this real module.

const PERSON_STOP = { id: "u-max", type: "person" } as const;
/** Words that invite the model to open a new browser. */
const INVITES = /Open a page|open_page first|start a new one/;
const STOPPED = 'The browser closed before this step, and the browser card says why: "You stopped it."';
/** open_page refused after an end that holds, word for word (BROWSER_COPY.closedForAnswer), `why` the card's ended line. */
const held = (why: string) => `The browser closed in this answer, and the browser card says why: "${why}" A teammate doesn't open another one in the same answer. If the person wants one, they can ask in a new message.`;
const heldStop = () => held("You stopped it.");

/** A run of the person's, open, started `ago` ms before now. */
function runOf(id: string, ago = 60_000): void {
  bdb.t.runs.push({ id, status: "RUNNING", startedAt: new Date(Date.now() - ago), endedAt: null });
}

/** An earlier answer's run, over: it holds no browser now. */
function earlierRun(id: string): void {
  bdb.t.runs.push({ id, status: "COMPLETED", startedAt: new Date(Date.now() - 10 * 60_000), endedAt: new Date(Date.now() - 5 * 60_000) });
}

/** A browser call of `runId`'s answer as the executor hands it (executor.ts), and what the call told the turn. */
function turnCtx(runId: string) {
  const told = { starts: 0, webReads: 0 };
  const ctx = {
    orgId: "org1",
    userId: "u-max",
    teammate: {
      agentId: "a-shop",
      agentName: "Shopper",
      sessionId: "chat-1",
      routineId: null,
      trigger: "CHAT" as const,
      timezone: "UTC",
      runId,
      browser: { tainted: false, mayStart: true, onStart: () => void (told.starts += 1), onWebRead: () => void (told.webReads += 1) },
    },
  };
  return { ctx, told };
}

const callTool = async (name: keyof typeof BROWSER_TOOLS_DEFS, input: Record<string, unknown>, ctx: unknown) => (await BROWSER_TOOLS_DEFS[name].handler(ctx as never, input)) as Record<string, unknown>;

const prepCtx = (runId: string): PrepareContext =>
  ({ person: MAX, teammate: { agentId: "a-shop", agentName: "Shopper", trigger: "CHAT" }, tainted: true, taintedBy: "web", turn: { runId, sessionId: "chat-1" } }) as unknown as PrepareContext;

const DOCS_PAGE = { url: "https://docs.proof.test/guide", title: "Guide", contentType: "text/html", blocks: ["The guide"], elements: [], links: [] };

/** A live browser this process holds on a docs page, which reads and opens as a real one does; `navigate` replaced when given. */
function docsBrowser(o: Record<string, unknown>, navigate?: (u: string) => Promise<unknown>) {
  const row = liveHere(o, "https://docs.proof.test/guide");
  Object.assign(liveBrowser(String(row.id))!.handle, {
    snapshot: async () => DOCS_PAGE,
    navigate: navigate ?? (async (u: string) => ({ ok: true, url: u, site: new URL(u).hostname })),
    documentId: () => "doc.1",
  });
  return row;
}

describe("useBrowserSession reads this run's ended browser once none is live (review round 4 of Phase 4)", () => {
  const use = (runId: string | null = "run-A", agentId = "a-shop") => useBrowserSession({ person: MAX, agentId, runId, purpose: "model" });

  it("answers a browser this run used by its end's own reason, and none only when this run never had one", async () => {
    expect(await use()).toEqual({ ok: false, reason: "none" });
    const row = seedSession({ status: "ended", endReason: "stopped", lastRunId: "run-A", endedAt: new Date() });
    // Before: none, and the model was told to open a page.
    expect(await use()).toEqual({ ok: false, reason: "ended", endReason: "stopped" });
    row.endReason = "idle";
    expect(await use()).toEqual({ ok: false, reason: "ended", endReason: "idle" });
    row.endReason = "time_cap";
    expect(await use()).toEqual({ ok: false, reason: "ended", endReason: "time_cap", minutes: 15 });
    // Still ending (its release not confirmed): the same.
    row.status = "ending";
    row.endedAt = null;
    row.endReason = "admin_stopped";
    expect(await use()).toEqual({ ok: false, reason: "ended", endReason: "admin_stopped" });
    // Another run's (that never began here), another teammate's, or no run at all: none.
    expect(await use("run-B")).toEqual({ ok: false, reason: "none" });
    expect(await use("run-A", "a-res")).toEqual({ ok: false, reason: "none" });
    expect(await use(null)).toEqual({ ok: false, reason: "none" });
  });

  it("answers a browser a person ended while this run answered, though an earlier answer used it last; a system end of it, or a Stop before the run began, is none", async () => {
    runOf("run-A", 60_000);
    const row = seedSession({ status: "ended", endReason: "stopped", lastRunId: "run-P", endedAt: new Date() });
    expect(await use()).toEqual({ ok: false, reason: "ended", endReason: "stopped" });
    // No person chose it: this run never had it.
    row.endReason = "idle";
    expect(await use()).toEqual({ ok: false, reason: "none" });
    // Before the run began: a later message is never held by it.
    row.endReason = "stopped";
    row.endedAt = new Date(Date.now() - 2 * 60_000);
    expect(await use()).toEqual({ ok: false, reason: "none" });
  });

  it("names an end that holds before a newer one of the same run that does not", async () => {
    seedSession({ status: "ended", endReason: "stopped", lastRunId: "run-A", startedAt: new Date(Date.now() - 5 * 60_000), endedAt: new Date() });
    seedSession({ status: "ended", endReason: "idle", lastRunId: "run-A", startedAt: new Date(Date.now() - 60_000), endedAt: new Date() });
    expect(await use()).toEqual({ ok: false, reason: "ended", endReason: "stopped" });
  });
});

describe("runEnds (review round 4 of Phase 4)", () => {
  const ask = (now = new Date()) => runEnds(browserDb as never, { organizationId: "org1", userId: "u-max", agentId: "a-shop", runId: "run-A" }, now);

  it("reads only the person's rows of this teammate of the last few hours, at most 25, newest first", async () => {
    const m = browserDb.teammateBrowserSession as { findMany: (a: unknown) => Promise<unknown> };
    const spy = vi.spyOn(m, "findMany");
    const now = new Date();
    await ask(now);
    const arg = spy.mock.calls[0][0] as { where: Record<string, unknown>; take: number; orderBy: unknown };
    expect(arg.where).toMatchObject({ userId: "u-max", organizationId: "org1", agentId: "a-shop", status: { in: ["ending", "ended"] }, startedAt: { gte: new Date(now.getTime() - runEndsLookbackMs()) } });
    expect(arg).toMatchObject({ take: 25, orderBy: { startedAt: "desc" } });
    // A run's longest life, a session's longest and the provider's grace.
    expect(runEndsLookbackMs()).toBe(2 * 60 * 60_000 + 30 * 60_000 + 60_000);
    // A row started before that is never read, though this run's id is on it.
    seedSession({ status: "ended", endReason: "stopped", lastRunId: "run-A", startedAt: new Date(now.getTime() - runEndsLookbackMs() - 1000), endedAt: now });
    expect(await ask(now)).toEqual({ last: null, held: null });
  });

  it("reads an end's moment as the earlier of endedAt and its end step, and an end with neither on record as now", async () => {
    const t0 = Date.now();
    runOf("run-A", 60_000);
    // Stopped before run-A began; its release was confirmed later, so endedAt is late and the end step says when.
    const early = seedSession({ status: "ended", endReason: "stopped", lastRunId: "run-P", startedAt: new Date(t0 - 10 * 60_000), endedAt: new Date(t0 - 1000) });
    seedStep({ browserSessionId: early.id, userId: "u-max", seq: 1, kind: "end", at: new Date(t0 - 2 * 60_000) });
    expect(await ask()).toEqual({ last: null, held: null });
    // Stopped while run-A ran, its release still being tried: its end step.
    const ending = seedSession({ status: "ending", endReason: "stopped", lastRunId: "run-P", startedAt: new Date(t0 - 5 * 60_000), endedAt: null });
    seedStep({ browserSessionId: ending.id, userId: "u-max", seq: 1, kind: "end", at: new Date(t0 - 10_000) });
    expect(await ask()).toEqual({ last: { rowId: ending.id, endReason: "stopped", reservedMinutes: 15 }, held: { rowId: ending.id, endReason: "stopped", reservedMinutes: 15 } });
    // An end still being written (no endedAt, no step yet) is happening now.
    bdb.t.steps = bdb.t.steps.filter((x) => x.browserSessionId !== ending.id);
    expect((await ask()).held).toMatchObject({ rowId: ending.id });
  });
});

describe("openBrowserSession holds a Stop for the rest of its answer (review round 4 of Phase 4)", () => {
  it("refuses a start in the run whose browser a person ended, read under the start lock, asking the provider for nothing", async () => {
    seedSession({ status: "ended", endReason: "stopped", lastRunId: "run-1", endedAt: new Date() });
    const m = browserDb.teammateBrowserSession as { findMany: (a: unknown) => Promise<unknown> };
    const orig = m.findMany;
    const seen: Array<{ locks: number; inTx: number }> = [];
    vi.spyOn(m, "findMany").mockImplementation(async (a: unknown) => {
      seen.push({ locks: bdb.locks.length, inTx: bdb.inTx });
      return orig(a);
    });
    // Before: a new browser started.
    expect(await open()).toEqual({ ok: false, reason: "closed_in_answer", endReason: "stopped" });
    expect(seen[0]).toEqual({ locks: 1, inTx: 1 });
    expect(bdb.locks[0]).toMatchObject({ cls: START_LOCK_CLASS, inTx: true });
    expect(st.created).toEqual([]);
    expect(bdb.t.sessions).toHaveLength(1);
  });

  it("starts in the same run after an end no person chose, and in a later run after a Stop", async () => {
    seedSession({ status: "ended", endReason: "idle", lastRunId: "run-1", endedAt: new Date() });
    expect(await open()).toMatchObject({ ok: true });
    resetBrowserDb();
    resetLiveRegistryForTests();
    seedOrg();
    seedPolicy();
    seedAgent();
    seedUser();
    seedSession({ status: "ended", endReason: "stopped", lastRunId: "run-0", endedAt: new Date(Date.now() - 60_000) });
    runOf("run-1", 1000);
    expect(await open()).toMatchObject({ ok: true });
  });

  it("says a Stop that landed while the browser started, never that it may try again", async () => {
    st.beforeCreate = async () => {
      const r = bdb.t.sessions.find((x) => x.status === "starting");
      await endBrowserSession(String(r!.id), "stopped", PERSON_STOP);
    };
    // Before: start_failed, "The browser didn't start. Try again in a moment." Last polish of Phase 4: it never went live, so it drew no card.
    expect(await open()).toEqual({ ok: false, reason: "closed_in_answer", endReason: "stopped", reachedProvider: true, noCard: true });
    expect(st.released).toEqual(["pv-new"]);
    st.beforeCreate = null;
  });
});

describe("a Stop holds for the rest of its answer, through the tools (review round 4 of Phase 4)", () => {
  afterEach(() => {
    st.beforeCreate = null;
  });

  it("a Stop during open_page: the call says so, and open_page later in the same answer starts nothing, never inviting one", async () => {
    earlierRun("run-P");
    runOf("run-A");
    // Started in an earlier answer, so this answer may still start one (mayStart).
    const row = docsBrowser({ lastRunId: "run-P" }, async () => {
      // The person presses Stop while the page loads: the end closes the connection and the command in flight fails.
      await endBrowserSession(String(row.id), "stopped", PERSON_STOP);
      throw new Error("The browser connection is gone");
    });
    const { ctx, told } = turnCtx("run-A");
    const said: Array<Record<string, unknown>> = [];
    said.push(await callTool("open_page", { url: "https://docs.proof.test/next" }, ctx));
    // Before: "The browser closed. Open a page to start a new one."
    expect(said[0]).toEqual({ error: STOPPED });
    expect(row).toMatchObject({ status: "ended", endReason: "stopped" });
    said.push(await callTool("open_page", { url: "https://docs.proof.test/" }, ctx));
    expect(said[1]).toEqual({ error: heldStop() });
    said.push(await callTool("read_page", {}, ctx));
    expect(said[2]).toEqual({ error: STOPPED });
    // Nothing started: no new row, the provider never asked, the answer's one start unused.
    expect(bdb.t.sessions).toHaveLength(1);
    expect(st.created).toEqual([]);
    expect(told.starts).toBe(0);
    for (const s of said) expect(INVITES.test(JSON.stringify(s)), JSON.stringify(s)).toBe(false);
  });

  it("a Stop between calls: read_page says the person stopped it, never that no page is open, and open_page starts nothing", async () => {
    earlierRun("run-P");
    runOf("run-A");
    const row = docsBrowser({ lastRunId: "run-P" });
    const { ctx, told } = turnCtx("run-A");
    expect(await callTool("read_page", {}, ctx)).toMatchObject({ site: "docs.proof.test" });
    await endBrowserSession(String(row.id), "stopped", PERSON_STOP);
    // Before: "No page is open. Open one with open_page first."
    expect(await callTool("read_page", {}, ctx)).toEqual({ error: STOPPED });
    expect(await callTool("find_on_page", { text: "guide" }, ctx)).toEqual({ error: STOPPED });
    expect(await callTool("open_page", { url: "https://docs.proof.test/" }, ctx)).toEqual({ error: heldStop() });
    expect(bdb.t.sessions).toHaveLength(1);
    expect(st.created).toEqual([]);
    expect(told.starts).toBe(0);
  });

  it("a card's first preparation after a Stop says the person stopped it", async () => {
    earlierRun("run-P");
    runOf("run-A");
    const row = docsBrowser({ lastRunId: "run-P" });
    const { ctx } = turnCtx("run-A");
    expect(await callTool("read_page", {}, ctx)).toMatchObject({ site: "docs.proof.test" });
    await endBrowserSession(String(row.id), "stopped", PERSON_STOP);
    // Before: "No page is open. Open one with open_page first."
    expect(await prepareBrowser("click", { element: "e1" }, prepCtx("run-A"))).toEqual({ error: STOPPED });
    expect(await prepareBrowser("ask_to_take_over", { reason: "sign_in" }, prepCtx("run-A"))).toEqual({ error: STOPPED });
  });

  it("an idle end in the same answer: the next call names it, and open_page starts a new browser", async () => {
    earlierRun("run-P");
    runOf("run-A");
    const row = docsBrowser({ lastRunId: "run-P" });
    const { ctx, told } = turnCtx("run-A");
    // This answer used the browser without meeting a page (a refused address), so it may still start one.
    expect(await callTool("open_page", { url: "https://exfil.proof.test/" }, ctx)).toEqual({ error: BROWSER_COPY.notAllowedSite("exfil.proof.test") });
    expect(row.lastRunId).toBe("run-A");
    await endBrowserSession(String(row.id), "idle", SYSTEM_END);
    // Before: "No page is open. Open one with open_page first."
    expect(await callTool("read_page", {}, ctx)).toEqual({ error: 'The browser closed before this step, and the browser card says why: "Closed after 5 idle minutes."' });
    expect(await callTool("open_page", { url: "https://docs.proof.test/" }, ctx)).toEqual({ ok: true, site: "docs.proof.test", note: BROWSER_COPY.openedNote });
    expect(st.created).toHaveLength(1);
    expect(told.starts).toBe(1);
    expect(bdb.t.sessions.filter((x) => x.status === "live")).toHaveLength(1);
  });

  it("a Stop holds only for its own answer: the person's next message may start a new browser", async () => {
    runOf("run-P", 10 * 60_000);
    const row = docsBrowser({ lastRunId: "run-P" });
    await endBrowserSession(String(row.id), "stopped", PERSON_STOP);
    // In the answer it landed in, nothing starts. Before: a new browser started.
    expect(await callTool("open_page", { url: "https://docs.proof.test/" }, turnCtx("run-P").ctx)).toEqual({ error: heldStop() });
    expect(st.created).toEqual([]);
    // The person's next message, after the Stop.
    await new Promise((r) => setTimeout(r, 5));
    runOf("run-A", 0);
    const later = turnCtx("run-A");
    expect(await callTool("read_page", {}, later.ctx)).toEqual({ error: BROWSER_COPY.noBrowserYet });
    expect(await callTool("open_page", { url: "https://docs.proof.test/" }, later.ctx)).toEqual({ ok: true, site: "docs.proof.test", note: BROWSER_COPY.openedNote });
    expect(st.created).toHaveLength(1);
    expect(later.told.starts).toBe(1);
  });

  it("holds a Stop that lands while an answer runs, before that answer used the browser", async () => {
    earlierRun("run-P");
    runOf("run-A", 60_000);
    const row = docsBrowser({ lastRunId: "run-P" });
    await endBrowserSession(String(row.id), "stopped", PERSON_STOP);
    const { ctx, told } = turnCtx("run-A");
    expect(await callTool("read_page", {}, ctx)).toEqual({ error: STOPPED });
    expect(await callTool("open_page", { url: "https://docs.proof.test/" }, ctx)).toEqual({ error: heldStop() });
    expect(st.created).toEqual([]);
    expect(told.starts).toBe(0);
  });

  it("lets a fresh refusal of the computer win over the held sentence", async () => {
    runOf("run-A");
    const row = docsBrowser({ lastRunId: "run-A" });
    await endWorkspaceBrowserSessions("org1", "turned_off", "u-olivia");
    expect(row).toMatchObject({ status: "ended", endReason: "turned_off" });
    bdb.t.policies[0].enabled = false;
    const { ctx } = turnCtx("run-A");
    expect(await callTool("open_page", { url: "https://docs.proof.test/" }, ctx)).toEqual({ error: BROWSER_COPY.workspaceOff });
    // Switched on again in the same answer: the end still holds for it.
    bdb.t.policies[0].enabled = true;
    expect(await callTool("open_page", { url: "https://docs.proof.test/" }, ctx)).toEqual({ error: held("Closed: the computer was turned off in this workspace.") });
    expect(st.created).toEqual([]);
  });
});

// ── Review round 5 of Phase 4 ───────────────────────────────────────
//
// Round 4 made a Stop hold for the rest of its answer. Round 5 closed what
// still told the person or the model something untrue: an approved step
// held on a browser a Stop closed, a continue after a Stop, a Stop during a
// failing start, a run held by a slow release, the provider's end named as
// a restart, and an answer that can start no browser invited to open one.

const NEXT_BUTTON: RawElement = { tag: "button", role: "button", name: "Next", kind: "none", type: "button", formHost: null, href: null, twin: 0, twins: 1, anchor: "b1b1b1b1", at: 0, disabled: false, filled: false, inMainFrame: true };

/** An approved click's own call (executor.ts runApprovedAction): no run, the card's id. */
function approvalCtx(actionId = "act-1") {
  return { orgId: "org1", userId: "u-max", teammate: { agentId: "a-shop", agentName: "Shopper", sessionId: "chat-1", routineId: null, trigger: "APPROVAL" as const, timezone: "UTC", actionId } };
}

/** The click card's stored input, on the docs page `docsBrowser` shows. */
const clickInput = (rowId: string) => ({ browserSessionId: rowId, site: "docs.proof.test", pageUrl: "https://docs.proof.test/guide", documentId: "doc.1", page: "docs.proof.test/guide", element: "e1", target: fingerprintOf(NEXT_BUTTON), role: "button", name: "Next", shotId: null, shot: null });

/** A continue's browser call (engine.ts runTurn): tainted, as one told of a browser card is, carrying on `continues`. */
function resumeCtx(runId: string, continues: string[], o: { tainted?: boolean } = {}) {
  const t = turnCtx(runId);
  Object.assign(t.ctx.teammate, { trigger: "RESUME" });
  Object.assign(t.ctx.teammate.browser, { tainted: o.tainted ?? true, continues });
  return t;
}

/** A tainted answer's browser call: it read a page, so it can start no browser (Decision 11). */
function taintedCtx(runId: string) {
  const t = turnCtx(runId);
  Object.assign(t.ctx.teammate.browser, { tainted: true });
  return t;
}

describe("an approved step held on a browser a Stop closed fails, never waits (review round 5 of Phase 4, medium 1)", () => {
  it("a Stop during an approved click's read of the page: the card is left for its approval to answer, and the click answers the Stop, held no more", async () => {
    const row = docsBrowser({ lastRunId: "run-P" });
    const rowId = String(row.id);
    bdb.t.actions.push({ id: "act-1", sessionId: "chat-1", toolName: "click", status: "RUNNING", actingForId: "u-max", agentId: "a-shop", input: clickInput(rowId) });
    Object.assign(liveBrowser(rowId)!.handle, {
      // The person presses Stop while the step reads the page: the end closes the connection, and the read fails.
      snapshot: async () => {
        await endBrowserSession(rowId, "stopped", PERSON_STOP);
        throw new BrowserLost();
      },
      click: async () => {
        throw new Error("never sent");
      },
    });
    const out = await callTool("click", clickInput(rowId), approvalCtx());
    // Before: { error: "The browser service didn't answer. Try again in a moment.", held: "retry_later" }, and the card went back to waiting.
    // Polish after review round 6 of Phase 4: the person reads their own words beside the teammate's.
    expect(out).toEqual({ error: STOPPED, forPerson: "The browser closed before the step could run, so nothing was done. You stopped it." });
    expect(row).toMatchObject({ status: "ended", endReason: "stopped" });
    // The end's cancel skipped the RUNNING card: its approval fails it (executor.ts), never back to PENDING.
    expect(bdb.t.actions[0]).toMatchObject({ status: "RUNNING" });
    expect(bdb.t.steps.filter((x) => x.kind === "click")).toEqual([]);
  });

  it("an approved click that met no end still waits when the browser lost its read (Decision 14)", async () => {
    const row = docsBrowser({ lastRunId: "run-P" });
    const rowId = String(row.id);
    Object.assign(liveBrowser(rowId)!.handle, {
      snapshot: async () => {
        throw new BrowserLost();
      },
    });
    expect(await callTool("click", clickInput(rowId), approvalCtx())).toEqual({ error: BROWSER_COPY.providerUnavailable, held: "retry_later" });
    expect(row).toMatchObject({ status: "live" });
  });

  it("cancelCardsIfEnded: a card waiting again on an ended browser is cancelled as its end cancels one, its Inbox row read; an open browser's is left", async () => {
    const ended = seedSession({ status: "ended", endReason: "stopped", endedAt: new Date() });
    const open = seedSession({ status: "live", chatSessionId: "chat-2" });
    bdb.t.actions.push(
      { id: "act-1", sessionId: "chat-1", toolName: "click", status: "PENDING", actingForId: "u-max", agentId: "a-shop", input: { browserSessionId: ended.id } },
      { id: "act-2", sessionId: "chat-2", toolName: "click", status: "PENDING", actingForId: "u-max", agentId: "a-shop", input: { browserSessionId: open.id } },
    );
    bdb.t.notifications.push({ id: "n1", userId: "u-max", link: "/agents?chat=shopper&action=act-1", read: false }, { id: "n2", userId: "u-max", link: "/agents?chat=shopper&action=act-2", read: false });
    expect(await cancelCardsIfEnded(ended.id)).toBe(true);
    expect(bdb.t.actions[0]).toMatchObject({ status: "CANCELLED", decidedVia: "system", error: BROWSER_COPY.cancelledClosed("You stopped it.") });
    expect(bdb.t.notifications[0]).toMatchObject({ read: true });
    expect(await cancelCardsIfEnded(open.id)).toBe(false);
    expect(await cancelCardsIfEnded("nope")).toBe(false);
    expect(await cancelCardsIfEnded(42)).toBe(false);
    expect(bdb.t.actions[1]).toMatchObject({ status: "PENDING" });
    expect(bdb.t.notifications[1]).toMatchObject({ read: false });
  });
});

describe("a continue counts the answer it carries on (review round 5 of Phase 4, medium 2)", () => {
  it("a Stop during the settle of an approved click: the continue hears the Stop, and starts nothing", async () => {
    // CHAT run-1 asked for a click and ended; the person approved it and pressed Stop while it settled.
    runOf("run-1", 5 * 60_000);
    const row = docsBrowser({ lastRunId: "run-1" });
    await endBrowserSession(String(row.id), "stopped", PERSON_STOP);
    // The continue's own run is claimed after the Stop.
    await new Promise((r) => setTimeout(r, 5));
    runOf("run-2", 0);
    const { ctx, told } = resumeCtx("run-2", ["run-1"]);
    // Before: "No page is open. Open one with open_page first.", and open_page said linkOnly (no page could open).
    expect(await callTool("read_page", {}, ctx)).toEqual({ error: STOPPED });
    expect(await callTool("open_page", { url: "https://docs.proof.test/" }, ctx)).toEqual({ error: heldStop() });
    // Untainted, it still starts nothing (before: a new browser started).
    const clean = resumeCtx("run-2", ["run-1"], { tainted: false });
    expect(await callTool("open_page", { url: "https://docs.proof.test/" }, clean.ctx)).toEqual({ error: heldStop() });
    expect(st.created).toEqual([]);
    expect(told.starts + clean.told.starts).toBe(0);
  });

  it("a Stop between a decision and the continue's start, of a browser an earlier answer used last, holds the continue", async () => {
    earlierRun("run-0");
    // run-1 answered without touching the browser (a Google card, say); the person decided it, then pressed Stop.
    runOf("run-1", 2 * 60_000);
    const row = docsBrowser({ lastRunId: "run-0" });
    await endBrowserSession(String(row.id), "stopped", PERSON_STOP);
    await new Promise((r) => setTimeout(r, 5));
    runOf("run-2", 0);
    const use = (continues?: string[]) => useBrowserSession({ person: MAX, agentId: "a-shop", runId: "run-2", purpose: "model", ...(continues ? { continues } : {}) });
    // Before: none (the end was before the continue's own start).
    expect(await use(["run-1"])).toEqual({ ok: false, reason: "ended", endReason: "stopped" });
    // A new message after the Stop is never held by it.
    expect(await use()).toEqual({ ok: false, reason: "none" });
  });

  it("refuses a continue's start under the start lock after a Stop in the answer it carries on, asking the provider for nothing", async () => {
    runOf("run-1", 5 * 60_000);
    seedSession({ status: "ended", endReason: "stopped", lastRunId: "run-1", endedAt: new Date(Date.now() - 1000) });
    runOf("run-2", 0);
    const opened = await openBrowserSession({ person: MAX, agent: SHOPPER, chatSessionId: "chat-1", runId: "run-2", access: await access(), continues: ["run-1"] });
    // Before: a new browser started.
    expect(opened).toEqual({ ok: false, reason: "closed_in_answer", endReason: "stopped" });
    expect(st.created).toEqual([]);
    // The person's new message starts one.
    expect(await openBrowserSession({ person: MAX, agent: SHOPPER, chatSessionId: "chat-1", runId: "run-3", access: await access() })).toMatchObject({ ok: true });
  });

  it("runEnds counts a continued answer's rows as its own, once each, and ignores ids that are not one", async () => {
    runOf("run-1", 5 * 60_000);
    runOf("run-2", 0);
    seedSession({ status: "ended", endReason: "idle", lastRunId: "run-1", endedAt: new Date(Date.now() - 60_000) });
    const m = browserDb.teammateBrowserSession as { findMany: (a: unknown) => Promise<unknown> };
    const spy = vi.spyOn(m, "findMany");
    const out = await runEnds(browserDb as never, { organizationId: "org1", userId: "u-max", agentId: "a-shop", runId: "run-2", continues: ["run-1", "run-1", "", "x".repeat(65), "run-2"] }, new Date());
    expect(out).toMatchObject({ last: { endReason: "idle" }, held: null });
    const arg = spy.mock.calls[0][0] as { where: { OR: unknown[] } };
    expect(arg.where.OR[0]).toEqual({ lastRunId: { in: ["run-2", "run-1"] } });
    // Room for the run and every outcome a continue is told, each of its own run.
    expect(RUN_ENDS_RUNS_MAX).toBe(1 + OUTCOMES_PER_TURN);
  });
});

describe("a Stop while the browser starts, when the start fails too (review round 5 of Phase 4, medium 3)", () => {
  const stopTheStart = async () => {
    const r = bdb.t.sessions.find((x) => x.status === "starting");
    await endBrowserSession(String(r!.id), "stopped", PERSON_STOP);
  };

  it("says the Stop when the provider's call fails, never that it may try again", async () => {
    st.beforeCreate = stopTheStart;
    st.createAnswer = { ok: false, failure: "unavailable" };
    // Before: provider_unavailable, "The browser service didn't answer. Try again in a moment." Last polish of Phase 4: no card was drawn (noCard).
    expect(await open()).toEqual({ ok: false, reason: "closed_in_answer", endReason: "stopped", reachedProvider: true, noCard: true });
    resetBrowserDb();
    seedOrg();
    seedPolicy();
    seedAgent();
    seedUser();
    st.createAnswer = { ok: false, failure: "rate_limited", retryAfter: 30 };
    // Before: provider_busy, "Try again in 30 seconds."
    expect(await open()).toEqual({ ok: false, reason: "closed_in_answer", endReason: "stopped", reachedProvider: true, noCard: true });
  });

  it("says the Stop when the guard's attach fails, never start_failed", async () => {
    st.beforeAttach = stopTheStart;
    st.attachThrows = true;
    // Before: start_failed, "The browser didn't start. Try again in a moment."
    expect(await open()).toEqual({ ok: false, reason: "closed_in_answer", endReason: "stopped", reachedProvider: true, noCard: true });
    expect(bdb.t.sessions[0]).toMatchObject({ status: "ended", endReason: "stopped" });
  });

  it("keeps each failure's own reason when nothing else ended the start", async () => {
    st.createAnswer = { ok: false, failure: "unavailable" };
    expect(await open()).toEqual({ ok: false, reason: "provider_unavailable", reachedProvider: true });
    st.createAnswer = { ok: false, failure: "rate_limited", retryAfter: 30 };
    expect(await open()).toEqual({ ok: false, reason: "provider_busy", retryAfter: 30, reachedProvider: true });
    st.createAnswer = { ok: true, data: { providerSessionId: "pv-new", connectUrl: "ws://127.0.0.1:9/devtools/browser/x" } };
    st.attachThrows = true;
    expect(await open()).toEqual({ ok: false, reason: "start_failed", reachedProvider: true });
    // An end no person chose (the sweep's start check) while the provider answered: the provider's own reason.
    st.attachThrows = false;
    st.beforeCreate = async () => {
      const r = bdb.t.sessions.find((x) => x.status === "starting");
      await endBrowserSession(String(r!.id), "start_failed", SYSTEM_END);
    };
    st.createAnswer = { ok: false, failure: "unavailable" };
    expect(await open()).toEqual({ ok: false, reason: "provider_unavailable", reachedProvider: true });
  });

  it("through open_page: the Stop's sentence, never 'Try again in a moment'", async () => {
    earlierRun("run-P");
    runOf("run-A");
    st.beforeCreate = stopTheStart;
    st.createAnswer = { ok: false, failure: "unavailable" };
    const { ctx, told } = turnCtx("run-A");
    // Before: "The browser service didn't answer. Try again in a moment." Last polish of Phase 4: it closed while starting, so the chat's line, never the card's.
    expect(await callTool("open_page", { url: "https://docs.proof.test/" }, ctx)).toEqual({ error: BROWSER_COPY.closedForAnswerNoCard("You stopped it.") });
    expect(told.starts).toBe(1);
  });
});

describe("the end's moment is on record at the swap (review round 5 of Phase 4, low 4)", () => {
  it("a run that starts while a Stop's release still waits is not held; one that ran when it landed is", async () => {
    runOf("run-A", 60_000);
    const row = docsBrowser({ lastRunId: "run-P" });
    st.releaseHangs = true;
    // The Stop's release never answers: no end step, and (before) no endedAt.
    void endBrowserSession(String(row.id), "stopped", PERSON_STOP);
    await new Promise((r) => setTimeout(r, 5));
    expect(row).toMatchObject({ status: "ending", endReason: "stopped" });
    expect(row.endedAt).toBeInstanceOf(Date);
    expect(bdb.t.steps.filter((x) => x.kind === "end")).toEqual([]);
    await new Promise((r) => setTimeout(r, 5));
    runOf("run-B", 0);
    const use = (runId: string) => useBrowserSession({ person: MAX, agentId: "a-shop", runId, purpose: "model" });
    // The answer the Stop landed in is held.
    expect(await use("run-A")).toEqual({ ok: false, reason: "ended", endReason: "stopped" });
    // Before: held for its whole life, "now" standing in for the end's moment.
    expect(await use("run-B")).toEqual({ ok: false, reason: "none" });
    expect(await callTool("open_page", { url: "https://docs.proof.test/" }, turnCtx("run-B").ctx)).toEqual({ ok: true, site: "docs.proof.test", note: BROWSER_COPY.openedNote });
    expect(st.created).toHaveLength(1);
  });

  it("keeps the swap's moment when the sweep confirms the release later, so a later run stays free", async () => {
    const row = docsBrowser({ lastRunId: "run-P" });
    st.releaseAnswer = "failed";
    await endBrowserSession(String(row.id), "stopped", PERSON_STOP);
    const swapped = row.endedAt as Date;
    // Before: null until the release was confirmed.
    expect(swapped).toBeInstanceOf(Date);
    expect(row).toMatchObject({ status: "ending" });
    await new Promise((r) => setTimeout(r, 5));
    runOf("run-B", 0);
    st.releaseAnswer = "released";
    const later = new Date(Date.now() + STOP_RETRY_MS + 1000);
    await sweepBrowserSessions(later, { limit: 50, budgetMs: 10_000 });
    expect(row).toMatchObject({ status: "ended" });
    // Before: the sweep's own time, after run-B began.
    expect(row.endedAt).toEqual(swapped);
    expect(await useBrowserSession({ person: MAX, agentId: "a-shop", runId: "run-B", purpose: "model" })).toEqual({ ok: false, reason: "none" });
  });
});

describe("a lost connection found by useBrowserSession is named as such (review round 5 of Phase 4, low 5)", () => {
  it("answers the reason it wrote, provider_ended, never that WorkwrK restarted", async () => {
    runOf("run-A");
    const row = docsBrowser({ lastRunId: "run-A" });
    liveBrowser(String(row.id))!.lost = true;
    // Before: { ok: false, reason: "restarted" }.
    expect(await useBrowserSession({ person: MAX, agentId: "a-shop", runId: "run-A", purpose: "model" })).toEqual({ ok: false, reason: "ended", endReason: "provider_ended" });
    expect(row).toMatchObject({ status: "ended", endReason: "provider_ended" });
  });

  it("through read_page: the browser card's words, never 'WorkwrK restarted'", async () => {
    runOf("run-A");
    const row = docsBrowser({ lastRunId: "run-A" });
    liveBrowser(String(row.id))!.lost = true;
    // Before: "The browser closed because WorkwrK restarted. Open the page again to start a new one."
    expect(await callTool("read_page", {}, turnCtx("run-A").ctx)).toEqual({ error: BROWSER_COPY.closedBecause("Closed by the browser service.") });
  });
});

describe("an answer that can start no browser is never told to open one (review round 5 of Phase 4, low 6)", () => {
  it("open_page after this answer's browser closed idle, in an answer that read a page: the card's words, nothing started", async () => {
    runOf("run-A");
    const row = docsBrowser({ lastRunId: "run-A" });
    await endBrowserSession(String(row.id), "idle", SYSTEM_END);
    const { ctx, told } = taintedCtx("run-A");
    expect(await callTool("read_page", {}, ctx)).toEqual({ error: BROWSER_COPY.closedBecause("Closed after 5 idle minutes.") });
    // Before: linkOnly, "...or the same page again", which no closed browser opens.
    expect(await callTool("open_page", { url: "https://docs.proof.test/guide" }, ctx)).toEqual({ error: held("Closed after 5 idle minutes.") });
    expect(st.created).toEqual([]);
    expect(told.starts).toBe(0);
  });

  it("a guard gone, in an answer that read a page: WorkwrK restarted, and this answer can't open another", async () => {
    runOf("run-A");
    seedSession({ lastRunId: "run-A", bootId: "another-process" });
    const { ctx } = taintedCtx("run-A");
    // Before: "The browser closed because WorkwrK restarted. Open the page again to start a new one."
    expect(await callTool("read_page", {}, ctx)).toEqual({ error: BROWSER_COPY.restartedNoOther });
    expect(await callTool("open_page", { url: "https://docs.proof.test/guide" }, ctx)).toEqual({ error: held("Closed: WorkwrK restarted.") });
    expect(st.created).toEqual([]);
  });
});

// Polish after review round 6 of Phase 4: a start that failed drew no
// browser card, so a later call of the same answer never names one.
describe("a retry after a failed start, over this module (polish after review round 6 of Phase 4)", () => {
  /** A browser call of `runId`'s answer whose one start is used once it reached the provider, as the executor's counters say it. */
  function counted(runId: string) {
    const told = { starts: 0, webReads: 0 };
    const ctx = {
      orgId: "org1",
      userId: "u-max",
      teammate: {
        agentId: "a-shop",
        agentName: "Shopper",
        sessionId: "chat-1",
        routineId: null,
        trigger: "CHAT" as const,
        timezone: "UTC",
        runId,
        browser: {
          tainted: false,
          get mayStart() {
            return told.starts === 0;
          },
          onStart: () => void (told.starts += 1),
          onWebRead: () => void (told.webReads += 1),
        },
      },
    };
    return { ctx, told };
  }

  it("answers the retry and every other call by the start's own reason, never the browser card, never try again, and starts nothing more", async () => {
    runOf("run-A");
    st.createAnswer = { ok: false, failure: "unavailable" };
    const { ctx, told } = counted("run-A");
    // Last polish of Phase 4: the start used the answer's one, so never "Try again in a moment".
    expect(await callTool("open_page", { url: "https://docs.proof.test/" }, ctx)).toEqual({ error: BROWSER_COPY.providerUnavailableNoOther });
    expect(told.starts).toBe(1);
    expect(bdb.t.sessions[0]).toMatchObject({ status: "ended", endReason: "start_failed", lastRunId: "run-A" });
    // No browser card: its started line is written only once a start went live.
    expect(st.lines.filter((l) => l.line.event === "browser_started")).toEqual([]);
    st.createAnswer = { ok: true, data: { providerSessionId: "pv-new", connectUrl: "ws://127.0.0.1:9/devtools/browser/x" } };
    const retry = await callTool("open_page", { url: "https://docs.proof.test/" }, ctx);
    // Before: 'The browser closed in this answer, and the browser card says why: "It didn't start." A teammate doesn't open another one ...'
    expect(retry).toEqual({ error: BROWSER_COPY.startFailedNoOther });
    expect(String(retry.error)).not.toMatch(/browser card|Try again|closed/);
    // Before: 'The browser closed before this step, and the browser card says why: "It didn't start."'
    expect(await callTool("read_page", {}, ctx)).toEqual({ error: BROWSER_COPY.startFailedNoOther });
    expect(st.created).toHaveLength(1);
    // A new message is a new answer: it may start one.
    runOf("run-B");
    const later = counted("run-B");
    expect(await callTool("open_page", { url: "https://docs.proof.test/" }, later.ctx)).toEqual({ ok: true, site: "docs.proof.test", note: BROWSER_COPY.openedNote });
    expect(st.created).toHaveLength(2);
  });
});

// Last polish of Phase 4, over this real module: a browser that closed while
// it was starting drew no card (its chat has no browser_started line), so no
// sentence says "the browser card says why"; and the time cap's own end that
// lost to a Stop says the Stop.
describe("a browser that closed while it was starting drew no card (last polish of Phase 4, item 4)", () => {
  const ask = () => runEnds(browserDb as never, { organizationId: "org1", userId: "u-max", agentId: "a-shop", runId: "run-A" }, new Date());

  it("runEnds names a row with no browser_started line in its chat noCard, and one with its line as before", async () => {
    const never = seedSession({ status: "ended", endReason: "stopped", lastRunId: "run-A", endedAt: new Date(), drewCard: false });
    // Before: { rowId, endReason, reservedMinutes } alone, so every sentence said "the browser card says why".
    expect(await ask()).toEqual({ last: { rowId: never.id, endReason: "stopped", reservedMinutes: 15, noCard: true }, held: { rowId: never.id, endReason: "stopped", reservedMinutes: 15, noCard: true } });
    // A line in another chat, or another browser's line, is not its card.
    seedCardLine(never, { sessionId: "chat-2" });
    seedCardLine({ ...never, id: "bs-other" });
    expect((await ask()).last).toMatchObject({ noCard: true });
    // Its own line in its own chat: it drew its card.
    seedCardLine(never);
    expect(await ask()).toEqual({ last: { rowId: never.id, endReason: "stopped", reservedMinutes: 15 }, held: { rowId: never.id, endReason: "stopped", reservedMinutes: 15 } });
  });

  it("reads the line by the row's chat, its own id and its start, at most once for each row it names, and keeps the card's words when the read fails", async () => {
    const row = seedSession({ status: "ended", endReason: "stopped", lastRunId: "run-A", endedAt: new Date(), drewCard: false });
    const m = browserDb.chatMessage as { findFirst: (a: unknown) => Promise<unknown> };
    const spy = vi.spyOn(m, "findFirst");
    await ask();
    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(arg.where).toMatchObject({
      sessionId: "chat-1",
      kind: "EVENT",
      AND: [{ meta: { path: ["event"], equals: "browser_started" } }, { meta: { path: ["browserSessionId"], equals: row.id } }],
    });
    expect((arg.where.createdAt as { gte: Date }).gte.getTime()).toBeLessThan((row.startedAt as Date).getTime());
    spy.mockRejectedValueOnce(new Error("The database didn't answer"));
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // Unread: the sentence as it was before (the card's), never a guess either way that starts anything.
    expect((await ask()).last).toEqual({ rowId: row.id, endReason: "stopped", reservedMinutes: 15 });
    err.mockRestore();
    // A row with no chat has no card.
    row.chatSessionId = null;
    expect((await ask()).last).toMatchObject({ noCard: true });
  });

  it("the start lock refuses in an answer whose browser closed while it was starting, saying so", async () => {
    seedSession({ status: "ended", endReason: "stopped", lastRunId: "run-1", endedAt: new Date(), drewCard: false });
    expect(await open()).toEqual({ ok: false, reason: "closed_in_answer", endReason: "stopped", noCard: true });
    expect(st.created).toEqual([]);
  });

  it("through the tools: a Stop while the browser starts is told by the chat's line in every later call; a Stop of a live one by its card's", async () => {
    earlierRun("run-P");
    runOf("run-A");
    st.beforeCreate = async () => {
      const r = bdb.t.sessions.find((x) => x.status === "starting");
      await endBrowserSession(String(r!.id), "stopped", PERSON_STOP);
    };
    const { ctx } = turnCtx("run-A");
    const said: Array<Record<string, unknown>> = [];
    said.push(await callTool("open_page", { url: "https://docs.proof.test/" }, ctx));
    st.beforeCreate = null;
    said.push(await callTool("open_page", { url: "https://docs.proof.test/" }, ctx));
    said.push(await callTool("read_page", {}, ctx));
    said.push((await prepareBrowser("click", { element: "e1" }, prepCtx("run-A"))) as Record<string, unknown>);
    // No card was drawn: no browser_started line, only the end's own line.
    expect(st.lines.map((l) => l.line.event)).toEqual(["browser_ended"]);
    // Before: "...and the browser card says why: "You stopped it."" in each.
    expect(said).toEqual([
      { error: BROWSER_COPY.closedForAnswerNoCard("You stopped it.") },
      { error: BROWSER_COPY.closedForAnswerNoCard("You stopped it.") },
      { error: BROWSER_COPY.closedNoCard("You stopped it.") },
      { error: BROWSER_COPY.closedNoCard("You stopped it.") },
    ]);
    for (const x of said) expect(JSON.stringify(x)).not.toContain("browser card");
    expect(st.created).toHaveLength(1);

    // The person's next message starts a browser that goes live and draws its card; a Stop of it is told by the card's words.
    await new Promise((r) => setTimeout(r, 5));
    runOf("run-B", 0);
    const later = turnCtx("run-B");
    expect(await callTool("open_page", { url: "https://docs.proof.test/" }, later.ctx)).toMatchObject({ ok: true });
    expect(st.lines.map((l) => l.line.event)).toEqual(["browser_ended", "browser_started"]);
    const live = bdb.t.sessions.find((x) => x.status === "live")!;
    await endBrowserSession(String(live.id), "stopped", PERSON_STOP);
    expect(await callTool("read_page", {}, later.ctx)).toEqual({ error: STOPPED });
    expect(await callTool("open_page", { url: "https://docs.proof.test/" }, later.ctx)).toEqual({ error: heldStop() });
  });
});

describe("the time cap's own end that lost to a Stop says the Stop (last polish of Phase 4, beside item 5)", () => {
  // Not a React hook, whatever its name says (browser-previews.ts reads it the same way).
  const sessionFor = useBrowserSession;
  /** A browser past its time, whose time cap's own swap a person's Stop beats, read by useBrowserSession for `purpose`. */
  const afterStop = async (purpose: "model" | "approval") => {
    resetBrowserDb();
    resetLiveRegistryForTests();
    seedOrg();
    seedPolicy();
    seedAgent();
    seedUser();
    const row = liveHere({ lastRunId: "run-A", endsBy: new Date(Date.now() - 1000) });
    const m = browserDb.teammateBrowserSession as { updateMany: (a: unknown) => Promise<unknown> };
    const orig = m.updateMany.bind(m);
    // The person's Stop lands between the read and the time cap's own swap.
    const spy = vi.spyOn(m, "updateMany").mockImplementationOnce(async (a: unknown) => {
      await endBrowserSession(String(row.id), "stopped", PERSON_STOP);
      return orig(a);
    });
    const out = await sessionFor({ person: MAX, agentId: "a-shop", runId: purpose === "model" ? "run-A" : null, purpose, ...(purpose === "approval" ? { browserSessionId: String(row.id) } : {}) });
    spy.mockRestore();
    return { out, row };
  };

  it("useBrowserSession answers the end that won, for a turn and for an approval", async () => {
    const turn = await afterStop("model");
    // Before: { reason: "time_cap", minutes: 15 }, "it reached its time limit" after the person stopped it.
    expect(turn.out).toEqual({ ok: false, reason: "ended", endReason: "stopped" });
    expect(turn.row).toMatchObject({ status: "ended", endReason: "stopped" });
    const approval = await afterStop("approval");
    expect(approval.out).toEqual({ ok: false, reason: "ended", endReason: "stopped" });
    expect(approval.row).toMatchObject({ status: "ended", endReason: "stopped" });
  });

  it("still answers the time cap when its own end won", async () => {
    liveHere({ lastRunId: "run-A", endsBy: new Date(Date.now() - 1000) });
    expect(await useBrowserSession({ person: MAX, agentId: "a-shop", runId: "run-A", purpose: "model" })).toEqual({ ok: false, reason: "time_cap", minutes: 15 });
  });
});

// After the last polish of Phase 4 (its reviewer's lows), over the real module.
describe("after the last polish of Phase 4", () => {
  it("reads whether a held browser drew its card after the start lock's transaction, never in it, and only for the held row", async () => {
    seedSession({ status: "ended", endReason: "stopped", lastRunId: "run-1", endedAt: new Date(), drewCard: false });
    const m = browserDb.chatMessage as { findFirst: (a: unknown) => Promise<unknown> };
    const inTx: boolean[] = [];
    const orig = m.findFirst.bind(m);
    const spy = vi.spyOn(m, "findFirst").mockImplementation(async (a: unknown) => {
      inTx.push(bdb.inTx > 0);
      return orig(a);
    });
    expect(await open()).toEqual({ ok: false, reason: "closed_in_answer", endReason: "stopped", noCard: true });
    spy.mockRestore();
    // Before: two reads (the last row and the held one, the same row here read once), both inside the platform-wide start lock.
    expect(inTx).toEqual([false]);
    expect(st.created).toEqual([]);
  });

  it("a card read that fails after the lock keeps the card's words, and the start answers its refusal, not a generic failure", async () => {
    seedSession({ status: "ended", endReason: "stopped", lastRunId: "run-1", endedAt: new Date(), drewCard: false });
    const m = browserDb.chatMessage as { findFirst: (a: unknown) => Promise<unknown> };
    const spy = vi.spyOn(m, "findFirst").mockRejectedValue(Object.assign(new Error("current transaction is aborted"), { code: "25P02" }));
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await open()).toEqual({ ok: false, reason: "closed_in_answer", endReason: "stopped" });
    spy.mockRestore();
    err.mockRestore();
  });

  it("useBrowserSession says not_reached when the row can't be read after its time cap's own end lost, for a turn and an approval", async () => {
    // Not a React hook, whatever its name says.
    const sessionFor = useBrowserSession;
    for (const purpose of ["model", "approval"] as const) {
      resetBrowserDb();
      resetLiveRegistryForTests();
      seedOrg();
      seedPolicy();
      seedAgent();
      seedUser();
      const row = liveHere({ lastRunId: "run-A", endsBy: new Date(Date.now() - 1000) });
      const sessions = browserDb.teammateBrowserSession as { updateMany: (a: unknown) => Promise<unknown>; findUnique: (a: unknown) => Promise<unknown> };
      // The time cap's own swap loses (another end won), and the read after it fails.
      const lost = vi.spyOn(sessions, "updateMany").mockResolvedValueOnce({ count: 0 });
      const unread = vi.spyOn(sessions, "findUnique").mockRejectedValueOnce(new Error("The database didn't answer"));
      const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
      // Before: the read's error was thrown, and an approval failed generically.
      const out = await sessionFor({ person: MAX, agentId: "a-shop", runId: purpose === "model" ? "run-A" : null, purpose, ...(purpose === "approval" ? { browserSessionId: String(row.id) } : {}) });
      expect(out, purpose).toEqual({ ok: false, reason: "not_reached" });
      lost.mockRestore();
      unread.mockRestore();
      err.mockRestore();
    }
  });

  it("Take over on such a browser says it couldn't be reached, never that it is closed", async () => {
    const row = liveHere({ userId: "u-max", lastRunId: "run-A", endsBy: new Date(Date.now() - 1000) });
    const sessions = browserDb.teammateBrowserSession as { updateMany: (a: unknown) => Promise<unknown>; findUnique: (a: unknown) => Promise<unknown> };
    const lost = vi.spyOn(sessions, "updateMany").mockResolvedValueOnce({ count: 0 });
    const unread = vi.spyOn(sessions, "findUnique").mockRejectedValueOnce(new Error("The database didn't answer"));
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // Before: the read's error was thrown.
    expect(await startTakeOver(MAX, String(row.id), null)).toEqual({ ok: false, status: 503, code: "not_reached", error: BROWSER_ROUTE_ERRORS.notReached });
    lost.mockRestore();
    unread.mockRestore();
    err.mockRestore();
  });
});

// Phase 5 step 2 (docs/plans/ai-teammates-phase5.md): a recording is a take
// over with the recorder on, kept as a draft when its browser ends, its card
// closed; the take over's window the stand-in's own; Show how offered only
// where it may start; the switch; the sweep's part.
describe("learning by showing (Phase 5 step 2)", () => {
  const SUBMIT = { tag: "button", role: "button", name: "Submit expense", type: null, formHost: "docs.proof.test", formKey: 0, group: null, choice: false, opener: false, inRow: null, inNav: false, suggestion: false, wordsChanged: false, href: null, hints: { tag: "button", type: null, autocomplete: null, inputmode: null, name: null, id: null, label: null, maxLength: null }, formFields: [] };
  const calls: string[] = [];
  /** A live browser that records: its handle's calls in order. */
  function recordingHere(o: Record<string, unknown> = {}) {
    const row = liveHere({ status: "handed_over", handedOverAt: new Date(), ...o });
    const skill = seedSkill({ status: "recording", recordingSessionId: row.id, steps: [], stepCount: 0 });
    row.recordingSkillId = skill.id;
    const lb = liveBrowser(String(row.id))!;
    lb.handedOver = true;
    Object.assign(lb.handle, {
      watch: async (on: boolean) => void calls.push(`watch:${on}`),
      drainEvents: async () => (calls.push("drain"), { events: [{ type: "click", control: SUBMIT, at: Date.now(), page: "http://docs.proof.test/guide" }], pages: [] }),
      close: async () => void calls.push("close"),
      screenshot: async () => ({ jpeg: new Uint8Array([0xff, 0xd8, 0xff]), width: 10, height: 10 }),
    });
    lb.recording = { skillId: String(skill.id), events: [], startUrl: "http://docs.proof.test/", pageShots: new Map(), full: false, timer: null };
    return { row, skill };
  }
  beforeEach(() => {
    calls.length = 0;
    process.env.BROWSER_SKILLS_OFFERED = "1";
    bdb.t.policies[0].skillsEnabled = true;
    bdb.t.agents[0].toolNames = ["open_page", "read_page", "click", "use_skill", "ask_to_show_me"];
  });
  afterEach(() => {
    delete process.env.BROWSER_SKILLS_OFFERED;
  });

  it("keeps a recording as a draft when its browser ends, its last input drained while the browser is still held", async () => {
    const { row, skill } = recordingHere();
    expect(await endBrowserSession(String(row.id), "take_over_too_long", SYSTEM_END)).toBe(true);
    // Before: the browser went with the recording's last steps, and the row stayed "recording".
    expect(calls).toEqual(["drain", "watch:false", "close"]);
    expect(skill).toMatchObject({ status: "draft", recordingEndReason: "time", stepCount: 2 });
    expect(row).toMatchObject({ status: "ended", recordingSkillId: null });
  });

  it("ends within its two seconds when a step holds the browser's lock", async () => {
    const { row, skill } = recordingHere();
    let release!: () => void;
    const held = withBrowserLock(String(row.id), 0, () => new Promise<void>((r) => (release = r)));
    const at = Date.now();
    expect(await endBrowserSession(String(row.id), "stopped", { id: "u-max", type: "person" })).toBe(true);
    expect(Date.now() - at).toBeLessThan(3_500);
    release();
    await held;
    // Its last drain skipped and nothing handed over at the stop: kept as a
    // draft that says something may be missing (review of Phase 5 step 2,
    // low 1). Before: deleted as if the person had done nothing.
    expect(calls).toEqual(["watch:false", "close"]);
    expect(skill).toMatchObject({ status: "draft", recordingEndReason: "ended" });
    expect((skill.steps as Array<{ kind: string }>).map((s) => s.kind)).toEqual(["start", "gap"]);
  });

  it("logs a code when a recording of an ending browser is not kept, never the words of the error (review of Phase 5 step 2, low 6)", async () => {
    const { row } = recordingHere();
    const failing = vi.spyOn(browserDb.teammateSkill as { findFirst: (a: unknown) => Promise<unknown> }, "findFirst").mockRejectedValue(new Error('Invalid `prisma.teammateSkill.findFirst()` invocation:\n\n  name: "Submit leave for Jane Doe"'));
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await endBrowserSession(String(row.id), "stopped", { id: "u-max", type: "person" })).toBe(true);
    const logged = err.mock.calls.map((c) => c.map(String).join(" "));
    failing.mockRestore();
    err.mockRestore();
    expect(logged).toContain("[browser] a recording of an ended browser was not kept: Error");
    // Before: the error's last line, the skill's name in it.
    expect(logged.join("\n")).not.toContain("Jane Doe");
  });

  it("closes a request to be shown how that a recording holds RUNNING when its browser ends", async () => {
    const { row } = recordingHere();
    const id = String(row.id);
    bdb.t.actions.push({ id: "c-show", sessionId: "chat-1", toolName: "ask_to_show_me", status: "RUNNING", actingForId: "u-max", input: { browserSessionId: id } });
    await endBrowserSession(id, "stopped", { id: "u-max", type: "person" });
    // Before: left RUNNING, reading "You have it" for good.
    expect(bdb.t.actions[0]).toMatchObject({ status: "CANCELLED", decidedVia: "system", error: BROWSER_COPY.cancelledClosed("You stopped it.") });
  });

  it("reads the stand-in's take over seconds for the take over's window, and only under the stand-in", () => {
    const testTimes = { sessionSeconds: null, idleSeconds: null, waitSeconds: null, takeOverSeconds: 90 };
    // Before: always ten minutes, so a recording's proof could not wait past it.
    expect(windowTimes({ standIn: true, testTimes } as never).takeOverMs).toBe(90_000);
    expect(windowTimes({ standIn: false, testTimes } as never).takeOverMs).toBe(600_000);
    expect(windowTimes(null).takeOverMs).toBe(600_000);
  });

  it("offers Show how only where it may start: skills on here, the teammate holding use_skill, live or waiting, 3 minutes or more left, no recording of this person", async () => {
    const row = liveHere({ endsBy: new Date(Date.now() + 10 * 60_000) });
    const id = String(row.id);
    const view = async () => (await sessionViewFor({ userId: "u-max", organizationId: "org1" }, id))!;
    expect(await view()).toMatchObject({ canRecord: true, recording: null });
    row.status = "handed_over";
    expect((await view()).canRecord).toBe(false);
    row.status = "waiting";
    expect((await view()).canRecord).toBe(true);
    row.endsBy = new Date(Date.now() + 2 * 60_000);
    expect((await view()).canRecord).toBe(false);
    row.endsBy = new Date(Date.now() + 10 * 60_000);
    bdb.t.policies[0].skillsEnabled = false;
    expect((await view()).canRecord).toBe(false);
    bdb.t.policies[0].skillsEnabled = true;
    bdb.t.agents[0].toolNames = ["open_page", "ask_to_show_me"];
    expect((await view()).canRecord).toBe(false);
    bdb.t.agents[0].toolNames = ["open_page", "use_skill"];
    seedSkill({ status: "recording", name: "Elsewhere" });
    expect((await view()).canRecord).toBe(false);
    delete process.env.BROWSER_SKILLS_OFFERED;
    bdb.t.skills = [];
    expect((await view()).canRecord).toBe(false);
  });

  it("names the recording in its session's view by the person's own skill, with its steps so far", async () => {
    const { row, skill } = recordingHere();
    Object.assign(skill, { name: "Submit an expense", stepCount: 4, recordingFull: false });
    const v = await sessionViewFor({ userId: "u-max", organizationId: "org1" }, String(row.id));
    expect(v).toMatchObject({ status: "handed_over", canRecord: false, recording: { skillId: skill.id, name: "Submit an expense", steps: 4, full: false } });
  });

  it("names a waiting request to be shown how as its own kind, which the browser card's Take over never answers", async () => {
    const row = liveHere({ status: "waiting", waitingSince: new Date() });
    bdb.t.actions.push({ id: "c-show", sessionId: "chat-1", toolName: "ask_to_show_me", status: "PENDING", actingForId: "u-max", input: { browserSessionId: row.id } });
    expect((await sessionViewFor({ userId: "u-max", organizationId: "org1" }, String(row.id)))?.waiting).toEqual({ actionId: "c-show", kind: "show_me" });
  });

  it("finishes a recording whose browser ended without finishing it, in the sweep, and leaves a live one", async () => {
    const gone = seedSession({ id: "bs-gone", status: "ended", endReason: "restarted" });
    const lost = seedSkill({ status: "recording", recordingSessionId: gone.id, steps: [{ id: "s1", kind: "start", title: "Start on docs.proof.test", site: "docs.proof.test", page: "docs.proof.test", shotId: null, address: "http://docs.proof.test/" }, { id: "s2", kind: "gap", title: "Something may be missing here", site: "docs.proof.test", page: "docs.proof.test", shotId: null }], stepCount: 2, name: "Lost" });
    const { skill: live } = recordingHere({ userId: "u-7" });
    live.userId = "u-7";
    const c = await sweepBrowserSessions(new Date(), { limit: 50, budgetMs: 10_000 });
    expect(c.recordingsClosed).toBe(1);
    expect(lost).toMatchObject({ status: "draft", recordingEndReason: "ended" });
    expect(live.status).toBe("recording");
  });

  it("turns teaching by showing on and off under the policy's lock, one audit row a change, and off stops every recording as a draft", async () => {
    const { row, skill } = recordingHere();
    bdb.t.policies[0].skillsEnabled = true;
    expect(await setSkillsEnabled("org1", true, "u-olivia")).toEqual({ before: true, after: true, stopped: 0 });
    expect(bdb.t.activity.filter((a) => a.type === "teammate_browser.skills_changed")).toEqual([]);
    const off = await setSkillsEnabled("org1", false, "u-olivia");
    expect(off).toEqual({ before: true, after: false, stopped: 1 });
    expect(bdb.locks.at(-1)).toMatchObject({ cls: 73_032, key: "org1", inTx: true });
    expect(bdb.rowLocks.some((r) => r.what === "policy" && r.inTx)).toBe(true);
    const audit = bdb.t.activity.filter((a) => a.type === "teammate_browser.skills_changed");
    expect(audit).toEqual([expect.objectContaining({ actorId: "u-olivia", description: "Turned off teaching teammates by showing", oldValue: { skillsEnabled: true }, newValue: { skillsEnabled: false } })]);
    // The take over goes on as a plain one; the recording is a draft.
    expect(skill).toMatchObject({ status: "draft", recordingEndReason: "skills_off" });
    expect(row).toMatchObject({ status: "handed_over", recordingSkillId: null });
    expect(bdb.t.policies[0].enabled).toBe(true);
  });

  it("tells Owners and Admins the switch and how many skills are kept by how many people, numbers only", async () => {
    seedSkill({ status: "ready", name: "One" });
    seedSkill({ status: "draft", name: "Two" });
    seedSkill({ status: "ready", userId: "u-lee", name: "Three" });
    const v = await browserPolicyView("org1");
    expect(v).toMatchObject({ skillsEnabled: true, skillsOffered: true, skills: { kept: 3, people: 2 } });
    expect(JSON.stringify(v)).not.toMatch(/One|Two|Three/);
    delete process.env.BROWSER_SKILLS_OFFERED;
    expect(await browserPolicyView("org1")).toMatchObject({ skillsOffered: false, skills: null });
  });
});
