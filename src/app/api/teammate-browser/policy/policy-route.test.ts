// The workspace switch for the computer for AI teammates, its lists and
// Stop every browser (src/app/api/teammate-browser/policy/**,
// docs/plans/ai-teammates-phase4.md step 2): Owners and Admins only, read
// fresh; turning on refused with its real reason below Growth, on a trial
// and when this WorkwrK does not offer it; turning off ending every browser;
// a site parsed, refused with its problem, and one change per request that
// audits only what it changed.

import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  viewer: { userId: "u-olivia", organizationId: "org1", orgRole: "OWNER", isAgent: false } as { userId: string; organizationId: string; orgRole: string; isAgent: boolean },
  fresh: { ok: true, level: "SUPER_ADMIN", admin: true, owner: true } as unknown,
  released: [] as string[],
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/browser/browser-test-db")).browserDb }));
vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: { id: st.viewer.userId, organizationId: st.viewer.organizationId } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/access/workspace-admin", () => ({ freshWorkspaceActor: vi.fn(async () => st.fresh) }));
vi.mock("@/lib/app-gate", () => ({
  requireManageApps: vi.fn(async () =>
    st.viewer.orgRole === "OWNER" || st.viewer.orgRole === "ADMIN" ? { viewer: st.viewer } : { error: NextResponse.json({ error: "no_access", page: "apps" }, { status: 403 }) },
  ),
  requireApp: vi.fn(async () => ({ viewer: st.viewer })),
}));
vi.mock("@/lib/agents/actions", () => ({ writeEventLine: async () => null, actionHref: (s: string, id: string) => `/agents?chat=${s}&action=${id}` }));
vi.mock("@/lib/realtime-bus", () => ({ publishToUser: () => undefined }));
vi.mock("@/lib/agents/acting", () => ({ actorLabelFor: (a: { name: string }, p: { name: string }) => `${a.name} for ${p.name}`, resolveActingPerson: async () => ({ ok: true }) }));
vi.mock("@/lib/browser/browserbase", () => ({
  releaseProviderSession: async (_c: unknown, id: string) => (st.released.push(id), "released"),
  createProviderSession: async () => ({ ok: false, failure: "unavailable" }),
  listRunningProviderSessions: async () => ({ ok: true, data: [] }),
  liveViewUrl: async () => ({ ok: false, failure: "unavailable" }),
}));
vi.mock("@/lib/browser/cdp-driver", () => ({ attachBrowser: async () => Promise.reject(new Error("no browser in this test")) }));

import { bdb, resetBrowserDb, seedOrg, seedSession, seedUser } from "@/lib/browser/browser-test-db";
import { resetLiveRegistryForTests } from "@/lib/browser/live";
import { GET, PUT } from "./route";
import { POST as SITES } from "./sites/route";
import { POST as STOP_ALL } from "./stop-all/route";

const ENV = {
  NODE_ENV: "test",
  BROWSER_OFFERED: "1",
  BROWSER_PROVIDER: "stand-in",
  BROWSERBASE_API_KEY: "stand-in",
  BROWSERBASE_PROJECT_ID: "stand-in",
  BROWSERBASE_BASE_URL: "http://127.0.0.1:8789",
  BROWSER_REGION: "eu-central-1",
  BROWSER_SHOTS_DIR: "/tmp/wk-policy-route-test-shots",
  SECRETS_ENCRYPTION_KEY: "3".repeat(64),
};
const saved: Record<string, string | undefined> = {};

const req = (path: string, method: string, body: Record<string, unknown>) =>
  new Request(`https://app.test/api/teammate-browser/${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ organizationId: "org1", ...body }) });
const put = (body: Record<string, unknown>) => PUT(req("policy", "PUT", body));
const sites = (body: Record<string, unknown>) => SITES(req("policy/sites", "POST", body));

beforeEach(() => {
  resetBrowserDb();
  resetLiveRegistryForTests();
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  st.viewer = { userId: "u-olivia", organizationId: "org1", orgRole: "OWNER", isAgent: false };
  st.fresh = { ok: true, level: "SUPER_ADMIN", admin: true, owner: true };
  st.released = [];
  seedOrg();
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

describe("the switch", () => {
  it("answers a Member with the Apps page's own refusal, and writes nothing", async () => {
    st.viewer = { ...st.viewer, userId: "u-max", orgRole: "MEMBER" };
    expect((await GET()).status).toBe(403);
    const res = await put({ enabled: true });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "no_access" });
    expect(bdb.t.policies).toEqual([]);
  });

  it("shows the region, off by default, and usage as numbers only", async () => {
    seedSession({ status: "live", userId: "u-max" });
    const body = await (await GET()).json();
    expect(body).toMatchObject({ available: true, reason: null, plan: "GROWTH", region: "eu-central-1", enabled: false, allowSites: [], blockSites: [], usage: { minutesCap: 1000, atOnce: 1, atOnceCap: 2, sessionsTodayCap: 100, costCents: null } });
    expect(JSON.stringify(body)).not.toContain("u-max");
  });

  it("turns on with a warning audit row, and refuses an Admin the database no longer holds as one", async () => {
    st.fresh = { ok: false, status: 403, error: "Your access changed a moment ago.", code: "stale_session" };
    expect((await put({ enabled: true })).status).toBe(403);
    expect(bdb.t.policies).toEqual([]);
    st.fresh = { ok: true, admin: true, owner: true };
    const res = await put({ enabled: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ enabled: true, ended: 0 });
    expect(bdb.t.activity.find((a) => a.type === "teammate_browser.changed")).toMatchObject({
      actorId: "u-olivia",
      description: "Turned on the computer for AI teammates",
      oldValue: { enabled: false },
      newValue: { enabled: true },
      severity: "warning",
    });
  });

  it("refuses turning on with its real reason: the plan, a trial, a closed workspace, this WorkwrK not offering it", async () => {
    bdb.t.orgs[0].plan = "STARTER";
    expect(await (await put({ enabled: true })).json()).toMatchObject({ code: "plan" });
    bdb.t.orgs[0].plan = "GROWTH";
    bdb.t.orgs[0].status = "TRIAL";
    const trial = await put({ enabled: true });
    expect([trial.status, (await trial.json()).code]).toEqual([403, "trial"]);
    bdb.t.orgs[0].status = "SUSPENDED";
    const closed = await put({ enabled: true });
    expect([closed.status, (await closed.json()).code]).toEqual([409, "workspace_closed"]);
    bdb.t.orgs[0].status = "ACTIVE";
    delete process.env.BROWSER_OFFERED;
    const off = await put({ enabled: true });
    expect([off.status, (await off.json()).code]).toEqual([503, "not_configured"]);
    expect(bdb.t.policies).toEqual([]);
  });

  it("answers a page that names no workspace, or another, with workspace_changed and changes nothing", async () => {
    const none = await PUT(new Request("https://app.test/api/teammate-browser/policy", { method: "PUT", body: JSON.stringify({ enabled: true }) }));
    expect([none.status, (await none.json()).code]).toEqual([409, "workspace_changed"]);
    const other = await put({ enabled: true, organizationId: "org2" });
    expect(other.status).toBe(409);
    expect(bdb.t.policies).toEqual([]);
  });

  it("turns off ending every browser in the workspace, and answers how many", async () => {
    await put({ enabled: true });
    const a = seedSession({ status: "live", userId: "u-max" });
    const b = seedSession({ status: "waiting", userId: "u-mia" });
    const elsewhere = seedSession({ status: "live", userId: "u-z", organizationId: "org2" });
    const res = await put({ enabled: false });
    expect(await res.json()).toMatchObject({ enabled: false, ended: 2 });
    expect([a.endReason, b.endReason, elsewhere.status]).toEqual(["turned_off", "turned_off", "live"]);
    expect(st.released.length).toBe(2);
    // Off even when this WorkwrK no longer offers the computer.
    delete process.env.BROWSER_OFFERED;
    expect((await put({ enabled: false })).status).toBe(200);
  });
});

describe("the lists", () => {
  it("refuses a site made of numbers, a private name or WorkwrK's own, each with its problem", async () => {
    for (const [site, problem] of [
      ["127.0.0.1", "ip"],
      ["169.254.169.254", "ip"],
      ["localhost", "internal"],
      ["metadata.google.internal", "internal"],
      ["localhost:3016", "port"],
      ["app.workwrk.com", "app"],
      ["*.com", "wildcard"],
    ]) {
      const res = await sites({ list: "allow", add: site });
      expect(res.status, site).toBe(400);
      expect(await res.json(), site).toMatchObject({ code: "bad_site", problem });
    }
    const words = await (await sites({ list: "allow", add: "127.0.0.1" })).json();
    expect(words.error).toBe("Addresses made of numbers aren't allowed. Use the site's name.");
    expect(bdb.t.policies).toEqual([]);
  });

  it("adds a pasted address as its host once, audits only that change, and removes it", async () => {
    const first = await (await sites({ list: "allow", add: "https://Docs.proof.test/guide?x=1" })).json();
    expect(first).toMatchObject({ changed: true, allowSites: ["docs.proof.test"] });
    const again = await (await sites({ list: "allow", add: "docs.proof.test" })).json();
    expect(again).toMatchObject({ changed: false, allowSites: ["docs.proof.test"] });
    expect(bdb.t.activity.filter((a) => a.type === "teammate_browser.site_changed").map((a) => a.description)).toEqual(["Added docs.proof.test to the sites teammates may open"]);
    await sites({ list: "block", add: "blocked.proof.test" });
    const removed = await (await sites({ list: "allow", remove: "docs.proof.test" })).json();
    expect(removed).toMatchObject({ changed: true, allowSites: [], blockSites: ["blocked.proof.test"] });
    expect(bdb.t.activity.filter((a) => a.type === "teammate_browser.site_changed").map((a) => a.description)).toEqual([
      "Added docs.proof.test to the sites teammates may open",
      "Added blocked.proof.test to the blocked sites",
      "Removed docs.proof.test from the sites teammates may open",
    ]);
  });

  it("takes exactly one change, refuses a list at its most, and lets a stored entry no rule takes now be removed", async () => {
    expect((await sites({ list: "allow", add: "a.proof.test", remove: "b.proof.test" })).status).toBe(400);
    expect((await sites({ list: "allow" })).status).toBe(400);
    bdb.t.policies.push({ organizationId: "org1", enabled: false, allowSites: [...Array.from({ length: 200 }, (_, i) => `s${i}.example.com`)], blockSites: ["*.co.uk"] });
    const full = await sites({ list: "allow", add: "one-more.example.com" });
    expect([full.status, (await full.json()).code]).toEqual([409, "too_many"]);
    expect(await (await sites({ list: "block", remove: "*.co.uk" })).json()).toMatchObject({ changed: true, blockSites: [] });
  });

  it("allows 60 changes a minute per person", async () => {
    for (let i = 0; i < 60; i++) await sites({ list: "block", add: `s${i}.example.com` });
    const res = await sites({ list: "block", add: "one-more.example.com" });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "rate_limited" });
    expect(res.headers.get("retry-after")).toBeTruthy();
  });
});

describe("stop every browser", () => {
  it("needs the confirmation and the workspace, and ends every browser here with one admin row", async () => {
    expect(await (await STOP_ALL(req("policy/stop-all", "POST", {}))).json()).toMatchObject({ code: "confirm_needed" });
    expect((await STOP_ALL(req("policy/stop-all", "POST", { confirm: "stop", organizationId: "org2" }))).status).toBe(409);
    const a = seedSession({ status: "live", userId: "u-max" });
    const b = seedSession({ status: "handed_over", userId: "u-mia" });
    const res = await STOP_ALL(req("policy/stop-all", "POST", { confirm: "stop" }));
    expect(await res.json()).toEqual({ ended: 2 });
    expect([a.endReason, b.endReason]).toEqual(["admin_stopped", "admin_stopped"]);
    expect(bdb.t.activity.filter((x) => x.type === "teammate_browser.stopped_all")).toMatchObject([{ actorId: "u-olivia", metadata: { count: 2, finished: true } }]);
    expect(bdb.t.activity.filter((x) => x.type === "teammate_browser.session_ended")).toHaveLength(2);
  });
});

// Phase 5 step 2 (docs/plans/ai-teammates-phase5.md Decision 2): the switch
// for teaching teammates by showing, under the computer's, one switch a request.
describe("teaching by showing (Phase 5 step 2)", () => {
  beforeEach(() => {
    process.env.BROWSER_SKILLS_OFFERED = "1";
  });
  afterEach(() => {
    delete process.env.BROWSER_SKILLS_OFFERED;
  });

  it("takes exactly one switch a request: both or neither is invalid", async () => {
    // Before: skillsEnabled was refused as an unknown field, and only enabled was read.
    for (const body of [{ enabled: true, skillsEnabled: true }, {}]) {
      const res = await put(body);
      expect([res.status, (await res.json()).code]).toEqual([400, "invalid"]);
    }
    expect(bdb.t.policies).toEqual([]);
  });

  it("turns on with one audit row, the computer's own switch staying as it was, and shows it with the counts", async () => {
    const res = await put({ skillsEnabled: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ skillsEnabled: true, skillsOffered: true, enabled: false, skills: { kept: 0, people: 0 } });
    expect(bdb.t.policies[0]).toMatchObject({ skillsEnabled: true, enabled: false });
    expect(bdb.t.activity.filter((a) => a.type === "teammate_browser.skills_changed")).toEqual([expect.objectContaining({ actorId: "u-olivia", description: "Turned on teaching teammates by showing" })]);
    // The same again changes nothing and writes no row.
    await put({ skillsEnabled: true });
    expect(bdb.t.activity.filter((a) => a.type === "teammate_browser.skills_changed")).toHaveLength(1);
  });

  it("turning it off stops every recording in the workspace as a draft and writes one audit row", async () => {
    await put({ skillsEnabled: true });
    const row = seedSession({ status: "handed_over", handedOverAt: new Date() });
    bdb.t.skills.push({ id: "sk-rec", organizationId: "org1", userId: "u-max", agentId: "a-shop", name: "Showing", status: "recording", steps: [{ id: "s1", kind: "start", title: "Start on login.proof.test", site: "login.proof.test", page: "login.proof.test", shotId: null, address: "http://login.proof.test/" }, { id: "s2", kind: "gap", title: "Something may be missing here", site: "login.proof.test", page: "login.proof.test", shotId: null }], stepCount: 2, sites: ["login.proof.test"], recordingSessionId: row.id });
    row.recordingSkillId = "sk-rec";
    const res = await put({ skillsEnabled: false });
    expect(await res.json()).toMatchObject({ skillsEnabled: false, stopped: 1 });
    expect(bdb.t.skills[0]).toMatchObject({ status: "draft", recordingEndReason: "skills_off" });
    expect(row).toMatchObject({ status: "handed_over", recordingSkillId: null });
    expect(bdb.t.activity.filter((a) => a.type === "teammate_browser.skills_changed").map((a) => a.description)).toEqual(["Turned on teaching teammates by showing", "Turned off teaching teammates by showing"]);
  });

  it("refuses turning on where it is not offered or the computer is not available, each its real reason, and a Member the gate's refusal", async () => {
    delete process.env.BROWSER_SKILLS_OFFERED;
    let res = await put({ skillsEnabled: true });
    expect([res.status, (await res.json()).code]).toEqual([503, "not_offered"]);
    process.env.BROWSER_SKILLS_OFFERED = "1";
    bdb.t.orgs[0].status = "TRIAL";
    res = await put({ skillsEnabled: true });
    expect([res.status, (await res.json()).code]).toEqual([403, "trial"]);
    bdb.t.orgs[0].status = "ACTIVE";
    bdb.t.orgs[0].plan = "STARTER";
    res = await put({ skillsEnabled: true });
    expect([res.status, (await res.json()).code]).toEqual([403, "plan"]);
    expect(bdb.t.policies).toEqual([]);
    st.viewer = { userId: "u-max", organizationId: "org1", orgRole: "MEMBER", isAgent: false };
    res = await put({ skillsEnabled: false });
    expect(res.status).toBe(403);
    expect(bdb.t.activity).toEqual([]);
  });
});
