// A teammate's own allowed sites (src/app/api/teammate-browser/teammates/[slug]/sites,
// Decision 9): anyone who may use it reads them, only its managers change
// them, only from the workspace's list and never one it blocks, one change
// per request under a lock on the Agent row, audited by what it changed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  viewer: { userId: "u-olivia", organizationId: "org1", orgRole: "OWNER", isAgent: false } as Record<string, unknown>,
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/browser/browser-test-db")).browserDb }));
vi.mock("@/lib/app-gate", () => ({ requireApp: vi.fn(async () => ({ viewer: st.viewer })), requireManageApps: vi.fn(async () => ({ viewer: st.viewer })) }));
vi.mock("@/lib/agents/actions", () => ({ writeEventLine: async () => null, actionHref: (s: string, id: string) => `/agents?chat=${s}&action=${id}`, actionViews: async () => ({}) }));
vi.mock("@/lib/realtime-bus", () => ({ publishToUser: () => undefined }));
vi.mock("@/lib/browser/browserbase", () => ({
  releaseProviderSession: async () => "released",
  createProviderSession: async () => ({ ok: false, failure: "unavailable" }),
  listRunningProviderSessions: async () => ({ ok: true, data: [] }),
  liveViewUrl: async () => ({ ok: false, failure: "unavailable" }),
}));
vi.mock("@/lib/browser/cdp-driver", () => ({ attachBrowser: async () => Promise.reject(new Error("no browser in this test")) }));

import { bdb, resetBrowserDb, seedAgent, seedOrg, seedPolicy } from "@/lib/browser/browser-test-db";
import { GET, PUT } from "./sites/route";

const ENV = {
  BROWSER_OFFERED: "1",
  BROWSER_PROVIDER: "stand-in",
  BROWSERBASE_API_KEY: "stand-in",
  BROWSERBASE_PROJECT_ID: "stand-in",
  BROWSERBASE_BASE_URL: "http://127.0.0.1:8789",
  BROWSER_REGION: "us-east-1",
  BROWSER_SHOTS_DIR: "/tmp/wk-sites-route-test-shots",
  SECRETS_ENCRYPTION_KEY: "4".repeat(64),
};
const saved: Record<string, string | undefined> = {};

const params = { params: Promise.resolve({ slug: "shopper" }) };
const put = (body: Record<string, unknown>) =>
  PUT(new Request("https://app.test/api/teammate-browser/teammates/shopper/sites", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ organizationId: "org1", ...body }) }), params);

beforeEach(() => {
  resetBrowserDb();
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  st.viewer = { userId: "u-olivia", organizationId: "org1", orgRole: "OWNER", isAgent: false };
  seedOrg();
  seedPolicy({ allowSites: ["docs.proof.test", "shop.proof.test", "*.example.com"], blockSites: ["evil.example.com", "shop.proof.test"] });
  seedAgent({ visibility: "WORKSPACE", ownerId: null, browserSites: ["docs.proof.test"] });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

describe("a teammate's allowed sites", () => {
  it("reads the workspace's lists and the teammate's sites, and whether this person may change them", async () => {
    expect(await (await GET(new Request("https://app.test/x"), params)).json()).toEqual({
      // The workspace it was read in (step 4): the drawer sends it back with every change.
      organizationId: "org1",
      workspaceSites: ["docs.proof.test", "shop.proof.test", "*.example.com"],
      blockSites: ["evil.example.com", "shop.proof.test"],
      sites: ["docs.proof.test"],
      canManage: true,
      available: true,
    });
    st.viewer = { ...st.viewer, userId: "u-max", orgRole: "MEMBER" };
    expect(await (await GET(new Request("https://app.test/x"), params)).json()).toMatchObject({ canManage: false });
  });

  it("refuses anyone who does not manage the teammate, and writes nothing", async () => {
    st.viewer = { ...st.viewer, userId: "u-max", orgRole: "MEMBER" };
    const res = await put({ add: "shop.proof.test" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "not_manager" });
    expect(bdb.t.agents[0].browserSites).toEqual(["docs.proof.test"]);
  });

  it("refuses a site outside the workspace's list, and one it blocks", async () => {
    const outside = await put({ add: "inject.proof.test" });
    expect([outside.status, (await outside.json()).code]).toEqual([409, "not_in_workspace_list"]);
    const blocked = await put({ add: "shop.proof.test" });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toEqual({ error: "shop.proof.test is blocked in this workspace.", code: "blocked" });
    expect(bdb.t.agents[0].browserSites).toEqual(["docs.proof.test"]);
  });

  it("adds one under a lock on the Agent row, audits it, and removes one whatever the lists say now", async () => {
    const res = await put({ add: "*.example.com" });
    expect(await res.json()).toMatchObject({ changed: true, sites: ["docs.proof.test", "*.example.com"] });
    expect(bdb.rowLocks.filter((l) => l.what === "agent")).toEqual([{ what: "agent", inTx: true }]);
    expect(bdb.t.activity.find((a) => a.type === "teammate_browser.sites_changed")).toMatchObject({ description: "Let Shopper open *.example.com", targetId: "a-shop" });
    bdb.t.policies[0].allowSites = [];
    expect(await (await put({ remove: "docs.proof.test" })).json()).toMatchObject({ changed: true, sites: ["*.example.com"] });
    expect(bdb.t.activity.filter((a) => a.type === "teammate_browser.sites_changed").map((a) => a.description)).toEqual(["Let Shopper open *.example.com", "Stopped Shopper opening docs.proof.test"]);
  });

  it("takes one change per request, never a whole list, and answers another workspace's page with workspace_changed", async () => {
    expect((await put({ add: "docs.proof.test", remove: "docs.proof.test" })).status).toBe(400);
    expect((await put({ sites: ["docs.proof.test", "shop.proof.test"] })).status).toBe(400);
    const other = await put({ add: "*.example.com", organizationId: "org2" });
    expect([other.status, (await other.json()).code]).toEqual([409, "workspace_changed"]);
    expect(bdb.t.agents[0].browserSites).toEqual(["docs.proof.test"]);
  });

  it("refuses a list at its most", async () => {
    bdb.t.agents[0].browserSites = Array.from({ length: 50 }, (_, i) => `s${i}.example.com`);
    const res = await put({ add: "docs.proof.test" });
    expect([res.status, (await res.json()).code]).toEqual([409, "too_many"]);
  });
});
