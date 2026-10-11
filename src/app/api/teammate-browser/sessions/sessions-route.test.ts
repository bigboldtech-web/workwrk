// A person's own browser (src/app/api/teammate-browser/sessions/** and
// shots/[id], Decisions 19, 29 and 30): anyone else's, an Owner's included,
// is 404 on every route; the live view is minted for its person only and
// never cached; Stop is idempotent; a take over moves only its own session's
// waiting card and the session together; Done makes the card EXECUTED with
// { done } and continues the chat; Done without the browser is refused.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  viewer: { userId: "u-max", organizationId: "org1", orgRole: "MEMBER", isAgent: false } as { userId: string; organizationId: string; orgRole: string; isAgent: boolean },
  signedIn: true,
  liveUrls: 0,
  released: [] as string[],
  lines: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/browser/browser-test-db")).browserDb }));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => (st.signedIn ? st.viewer : null) }));
vi.mock("@/lib/app-gate", () => ({ requireApp: vi.fn(async () => ({ viewer: st.viewer })), requireManageApps: vi.fn(async () => ({ viewer: st.viewer })) }));
vi.mock("@/lib/agents/actions", () => ({
  writeEventLine: async (sessionId: string | null, line: Record<string, unknown>) => (st.lines.push({ sessionId, ...line }), null),
  actionHref: (s: string, id: string) => `/agents?chat=${s}&action=${id}`,
}));
vi.mock("@/lib/realtime-bus", () => ({ publishToUser: () => undefined }));
vi.mock("@/lib/agents/acting", () => ({ actorLabelFor: (a: { name: string }, p: { name: string }) => `${a.name} for ${p.name}`, resolveActingPerson: async () => ({ ok: true, person: {} }) }));
vi.mock("@/lib/browser/browserbase", () => ({
  releaseProviderSession: async (_c: unknown, id: string) => (st.released.push(id), "released"),
  createProviderSession: async () => ({ ok: false, failure: "unavailable" }),
  listRunningProviderSessions: async () => ({ ok: true, data: [] }),
  liveViewUrl: async () => ((st.liveUrls += 1), { ok: true, data: "http://127.0.0.1:8789/live/pv?t=secret-token" }),
}));
vi.mock("@/lib/browser/cdp-driver", () => ({ attachBrowser: async () => Promise.reject(new Error("no browser in this test")) }));

import { saveShot } from "@/lib/browser/shots";
import { bdb, resetBrowserDb, seedAgent, seedOrg, seedPolicy, seedSession, seedUser } from "@/lib/browser/browser-test-db";
import { BOOT_ID, putLiveBrowser, resetLiveRegistryForTests } from "@/lib/browser/live";
import { GET as LIST } from "./route";
import { GET as ONE } from "./[id]/route";
import { POST as LIVE_VIEW } from "./[id]/live-view/route";
import { POST as STOP } from "./[id]/stop/route";
import { POST as TAKE_OVER } from "./[id]/take-over/route";
import { POST as DONE } from "./[id]/take-over/done/route";
import { GET as SHOT } from "../shots/[id]/route";

const ENV = {
  BROWSER_OFFERED: "1",
  BROWSER_PROVIDER: "stand-in",
  BROWSERBASE_API_KEY: "stand-in",
  BROWSERBASE_PROJECT_ID: "stand-in",
  BROWSERBASE_BASE_URL: "http://127.0.0.1:8789",
  BROWSER_REGION: "us-east-1",
  SECRETS_ENCRYPTION_KEY: "2".repeat(64),
};
const saved: Record<string, string | undefined> = {};
let shotsDir = "";

const OLIVIA = { userId: "u-olivia", organizationId: "org1", orgRole: "OWNER", isAgent: false };
const MAX = { userId: "u-max", organizationId: "org1", orgRole: "MEMBER", isAgent: false };

const p = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: Record<string, unknown> = {}) => new Request("https://app.test/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organizationId: "org1", ...body }) });

function live(o: Record<string, unknown> = {}) {
  const row = seedSession({ bootId: BOOT_ID, currentSite: "login.proof.test", providerSessionId: "pv-1", ...o });
  putLiveBrowser({
    rowId: String(row.id),
    organizationId: String(row.organizationId),
    userId: String(row.userId),
    agentId: String(row.agentId),
    handle: { close: async () => undefined } as never,
    rules: { allow: ["login.proof.test"], block: [], appHosts: [], schemes: ["https:", "http:"], fixtureSuffix: ".proof.test" },
    links: new Set(),
    refs: new Map(),
    refsUrl: null,
    seq: 0,
    lost: false,
    events: [],
  });
  return row;
}

beforeEach(async () => {
  resetBrowserDb();
  resetLiveRegistryForTests();
  shotsDir = await fs.mkdtemp(path.join(os.tmpdir(), "wk-session-route-shots-"));
  for (const [k, v] of Object.entries({ ...ENV, BROWSER_SHOTS_DIR: shotsDir })) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  st.viewer = { ...MAX };
  st.signedIn = true;
  st.liveUrls = 0;
  st.released = [];
  st.lines = [];
  seedOrg();
  seedPolicy();
  seedAgent();
  seedUser();
  seedUser({ id: "u-olivia", firstName: "Olivia", lastName: "Park", email: "olivia@proof.test" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
  await fs.rm(shotsDir, { recursive: true, force: true });
});

describe("only the session's person", () => {
  it("answers 404 to anyone else on every route, an Owner included, and drives nothing", async () => {
    const row = live();
    const id = String(row.id);
    const shot = await saveShot({ row: { id, organizationId: "org1", userId: "u-max" }, kind: "page", jpeg: Buffer.from([0xff, 0xd8, 0xff, 1]), width: 10, height: 10 });
    st.viewer = { ...OLIVIA };
    const codes = [
      (await ONE(new Request("https://app.test/x"), p(id))).status,
      (await STOP(post(), p(id))).status,
      (await LIVE_VIEW(post(), p(id))).status,
      (await TAKE_OVER(post(), p(id))).status,
      (await DONE(post({ finished: true }), p(id))).status,
      (await SHOT(new Request("https://app.test/x"), p(shot!))).status,
    ];
    expect(codes).toEqual([404, 404, 404, 404, 404, 404]);
    expect((await (await LIST(new Request(`https://app.test/x?chat=chat-1`))).json()).sessions).toEqual([]);
    expect(row.status).toBe("live");
    expect(st.liveUrls).toBe(0);
    // Its own person sees it and its picture.
    st.viewer = { ...MAX };
    expect((await ONE(new Request("https://app.test/x"), p(id))).status).toBe(200);
    const pic = await SHOT(new Request("https://app.test/x"), p(shot!));
    expect([pic.status, pic.headers.get("content-type"), pic.headers.get("cache-control")]).toEqual([200, "image/jpeg", "private, no-store"]);
  });

  it("answers a signed-out request 401", async () => {
    st.signedIn = false;
    expect((await LIST(new Request("https://app.test/x?chat=chat-1"))).status).toBe(401);
    expect((await STOP(post(), p("x"))).status).toBe(401);
  });

  it("lists the person's own sessions in the chat, newest first, steps as hosts only", async () => {
    const older = seedSession({ status: "ended", endReason: "idle", startedAt: new Date(Date.now() - 3600_000), billedMinutes: 3 });
    const row = live();
    bdb.t.steps.push({ id: "s1", browserSessionId: row.id, userId: "u-max", seq: 1, kind: "open", site: "login.proof.test", outcome: "ok", code: null, at: new Date(), shotId: null });
    const body = await (await LIST(new Request("https://app.test/x?chat=chat-1"))).json();
    expect(body.sessions.map((s: { id: string }) => s.id)).toEqual([row.id, older.id]);
    expect(body.sessions[0].steps).toEqual([expect.objectContaining({ kind: "open", site: "login.proof.test", line: "Opened login.proof.test" })]);
    expect(body.sessions[1]).toMatchObject({ status: "ended", endedLine: "Closed after 5 idle minutes.", minutes: 3 });
  });
});

describe("the live view", () => {
  it("is minted for its person, never cached, interactive only while they have it", async () => {
    const row = live();
    const res = await LIVE_VIEW(post(), p(String(row.id)));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ url: "http://127.0.0.1:8789/live/pv?t=secret-token", interactive: false });
    row.status = "handed_over";
    expect(await (await LIVE_VIEW(post(), p(String(row.id)))).json()).toMatchObject({ interactive: true });
    // Never in any log line.
    for (const call of vi.mocked(console.error).mock.calls) expect(call.join(" ")).not.toContain("secret-token");
  });

  it("closes a browser whose guard this process no longer holds rather than show it", async () => {
    const row = seedSession({ bootId: "another-boot" });
    const res = await LIVE_VIEW(post(), p(String(row.id)));
    expect([res.status, (await res.json()).code]).toEqual([409, "ended"]);
    expect(row).toMatchObject({ status: "ended", endReason: "restarted" });
    expect(st.liveUrls).toBe(0);
  });
});

describe("Stop", () => {
  it("closes the person's browser once and answers it as it is after", async () => {
    const row = live();
    const first = await (await STOP(post(), p(String(row.id)))).json();
    expect(first.session).toMatchObject({ status: "ended", endReason: "stopped", endedLine: "You stopped it." });
    const again = await STOP(post(), p(String(row.id)));
    expect(again.status).toBe(200);
    expect(st.released).toEqual(["pv-1"]);
    expect(bdb.t.activity.filter((a) => a.type === "teammate_browser.session_ended")).toHaveLength(1);
  });
});

describe("Take over", () => {
  it("swaps only its own session's waiting card, together with the session, and mints the live view", async () => {
    const row = live({ status: "waiting", waitingSince: new Date() });
    const id = String(row.id);
    bdb.t.actions.push(
      { id: "c-take", organizationId: "org1", sessionId: "chat-1", agentId: "a-shop", toolName: "ask_to_take_over", status: "PENDING", actingForId: "u-max", input: { browserSessionId: id } },
      { id: "c-elsewhere", organizationId: "org1", sessionId: "chat-1", agentId: "a-shop", toolName: "ask_to_take_over", status: "PENDING", actingForId: "u-max", input: { browserSessionId: "another" } },
    );
    // Another session's card moves nothing, and nothing of this session.
    const wrong = await TAKE_OVER(post({ actionId: "c-elsewhere" }), p(id));
    expect([wrong.status, (await wrong.json()).code]).toEqual([409, "card_decided"]);
    expect(row.status).toBe("waiting");
    expect(bdb.t.actions.map((a) => a.status)).toEqual(["PENDING", "PENDING"]);

    const res = await TAKE_OVER(post({ actionId: "c-take" }), p(id));
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ session: { status: "handed_over" }, liveView: { url: "http://127.0.0.1:8789/live/pv?t=secret-token", interactive: true } });
    expect(bdb.t.actions[0]).toMatchObject({ status: "RUNNING", decidedVia: "person", decidedById: "u-max" });
    // Read again: the refused attempt's transaction was rolled back, which puts back copies of the rows.
    expect(bdb.t.sessions.find((s) => s.id === id)).toMatchObject({ status: "handed_over", waitingSince: null });
    expect(bdb.t.steps.at(-1)).toMatchObject({ kind: "take_over", site: "login.proof.test" });
    expect(bdb.t.activity.find((a) => a.type === "teammate_browser.take_over")).toMatchObject({ actorId: "u-max", metadata: { phase: "start", site: "login.proof.test" } });
    // The same card again is decided.
    expect((await TAKE_OVER(post({ actionId: "c-take" }), p(id))).status).toBe(409);
  });

  it("refuses a browser that is closed", async () => {
    const row = seedSession({ status: "ended" });
    const res = await TAKE_OVER(post(), p(String(row.id)));
    expect([res.status, (await res.json()).code]).toEqual([409, "ended"]);
  });
});

describe("Done", () => {
  it("hands it back, makes the card EXECUTED with only done and its note, and continues the chat", async () => {
    const row = live({ status: "handed_over", handedOverAt: new Date() });
    const id = String(row.id);
    bdb.t.actions.push({ id: "c-take", organizationId: "org1", sessionId: "chat-1", agentId: "a-shop", toolName: "ask_to_take_over", status: "RUNNING", actingForId: "u-max", input: { browserSessionId: id } });
    const body = await (await DONE(post({ finished: true }), p(id))).json();
    expect(body).toMatchObject({ session: { status: "live" }, resume: true, chat: { kind: "teammate", slug: "shopper" } });
    expect(bdb.t.actions[0]).toMatchObject({
      status: "EXECUTED",
      result: { text: "You took over and finished.", data: { done: true, note: "Max finished the step in the browser. Nothing they typed or saw is shared with you. Read the page again before you carry on." } },
    });
    expect(st.lines).toEqual([expect.objectContaining({ sessionId: "chat-1", text: "You took over and finished.", actionId: "c-take" })]);
    expect(bdb.t.steps.at(-1)).toMatchObject({ kind: "give_back" });
  });

  it("gives it back unfinished, and continues nothing when no card asked", async () => {
    const row = live({ status: "handed_over", handedOverAt: new Date() });
    expect(await (await DONE(post({ finished: false }), p(String(row.id)))).json()).toMatchObject({ resume: false, chat: null, session: { status: "live" } });
  });

  it("is refused when the person does not have the browser", async () => {
    const row = live();
    const res = await DONE(post({ finished: true }), p(String(row.id)));
    expect([res.status, (await res.json()).code]).toEqual([409, "not_handed_over"]);
  });
});
