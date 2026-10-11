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
  running: [] as Array<{ providerSessionId: string; tag: string | null; rowId: string | null }>,
  attachThrows: false,
  hooks: null as unknown,
  closes: 0,
  acting: new Map<string, { ok: boolean; reason?: string }>(),
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/browser/browser-test-db")).browserDb }));
vi.mock("@/lib/agents/actions", () => ({
  writeEventLine: vi.fn(async (sessionId: string | null, line: Record<string, unknown>, opts?: unknown) => {
    st.lines.push({ sessionId, line, opts });
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
}));
vi.mock("./browserbase", () => ({
  createProviderSession: async (_cfg: unknown, a: { rowId: string; timeoutSeconds: number }) => {
    st.created.push(a);
    return st.createAnswer;
  },
  releaseProviderSession: async (_cfg: unknown, id: string) => {
    st.released.push(id);
    return st.releaseAnswer;
  },
  listRunningProviderSessions: async () => ({ ok: true, data: st.running }),
  liveViewUrl: async () => ({ ok: true, data: "http://127.0.0.1:8789/live/x?t=1" }),
}));
vi.mock("./cdp-driver", () => ({
  attachBrowser: async (_url: string, hooks: unknown) => {
    st.hooks = hooks;
    if (st.attachThrows) throw new Error("no guard");
    return { close: async () => void (st.closes += 1), currentUrl: () => "about:blank" };
  },
}));

import { bdb, resetBrowserDb, seedAgent, seedOrg, seedPolicy, seedSession, seedStep, seedUser } from "./browser-test-db";
import { BOOT_ID, liveBrowser, putLiveBrowser, resetLiveRegistryForTests } from "./live";
import {
  changePolicySite,
  changeTeammateSite,
  computerAccess,
  endBrowserSession,
  endWorkspaceBrowserSessions,
  openBrowserSession,
  recordStep,
  refreshLiveRules,
  setComputerEnabled,
  START_LOCK_CLASS,
  sweepBrowserSessions,
  SYSTEM_END,
  useBrowserSession,
  workspaceComputer,
  type ComputerAccess,
} from "./sessions";
import type { GuardHooks } from "./cdp-driver";
import type { ActingPerson } from "@/lib/agents/acting";
import type { ComputerAgent } from "@/lib/agents/browser-access";

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
  st.running = [];
  st.attachThrows = false;
  st.hooks = null;
  st.closes = 0;
  st.acting = new Map();
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
});

async function access(): Promise<Extract<ComputerAccess, { ok: true }>> {
  const a = await computerAccess({ organizationId: "org1", agent: SHOPPER });
  if (!a.ok) throw new Error(`no access: ${a.reason}`);
  return a;
}

const open = async () => openBrowserSession({ person: MAX, agent: SHOPPER, chatSessionId: "chat-1", runId: "run-1", access: await access() });

/** A live session this process holds, as a started one is. */
function liveHere(o: Record<string, unknown> = {}) {
  const row = seedSession({ bootId: BOOT_ID, ...o });
  putLiveBrowser({
    rowId: String(row.id),
    organizationId: String(row.organizationId),
    userId: String(row.userId),
    agentId: String(row.agentId),
    handle: { close: async () => void (st.closes += 1) } as never,
    rules: { allow: ["docs.proof.test"], block: [], appHosts: [], schemes: ["https:", "http:"], fixtureSuffix: ".proof.test" },
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

  it("refuses another teammate's live browser by its name, and its own as busy", async () => {
    seedSession({ agentId: "a-res", status: "live" });
    expect(await open()).toEqual({ ok: false, reason: "other_teammate", otherName: "Researcher" });
    bdb.t.sessions[0].agentId = "a-shop";
    expect(await open()).toEqual({ ok: false, reason: "busy" });
  });

  it("ends the row start_failed when the provider fails, and says busy with its wait when it is rate limited", async () => {
    st.createAnswer = { ok: false, failure: "rate_limited", retryAfter: 9 };
    expect(await open()).toEqual({ ok: false, reason: "provider_busy", retryAfter: 9 });
    expect(bdb.t.sessions[0]).toMatchObject({ status: "ended", endReason: "start_failed", billedMinutes: 0 });
    // Nothing started at the provider: nothing to release.
    expect(st.released).toEqual([]);
    st.createAnswer = { ok: false, failure: "unknown_outcome" };
    expect(await open()).toEqual({ ok: false, reason: "provider_unavailable" });
  });

  it("releases the provider's browser and ends start_failed when the guard cannot be attached", async () => {
    st.attachThrows = true;
    expect(await open()).toEqual({ ok: false, reason: "start_failed" });
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
    expect(await useBrowserSession({ person: MAX, agentId: "a-shop", runId: "run-1", purpose: "model" })).toEqual({ ok: false, reason: "time_cap" });
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
