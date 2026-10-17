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
  /** resolveActingPerson's answer (Phase 5 step 2's record route). */
  actingOk: true,
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/browser/browser-test-db")).browserDb }));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => (st.signedIn ? st.viewer : null) }));
vi.mock("@/lib/app-gate", () => ({ requireApp: vi.fn(async () => ({ viewer: st.viewer })), requireManageApps: vi.fn(async () => ({ viewer: st.viewer })) }));
vi.mock("@/lib/agents/actions", () => ({
  writeEventLine: async (sessionId: string | null, line: Record<string, unknown>) => (st.lines.push({ sessionId, ...line }), null),
  actionHref: (s: string, id: string) => `/agents?chat=${s}&action=${id}`,
}));
vi.mock("@/lib/realtime-bus", () => ({ publishToUser: () => undefined }));
vi.mock("@/lib/agents/acting", () => ({ actorLabelFor: (a: { name: string }, p: { name: string }) => `${a.name} for ${p.name}`, resolveActingPerson: async () => (st.actingOk ? { ok: true, person: {} } : { ok: false, reason: "inactive" }) }));
vi.mock("@/lib/browser/browserbase", () => ({
  releaseProviderSession: async (_c: unknown, id: string) => (st.released.push(id), "released"),
  createProviderSession: async () => ({ ok: false, failure: "unavailable" }),
  listRunningProviderSessions: async () => ({ ok: true, data: [] }),
  liveViewUrl: async () => ((st.liveUrls += 1), { ok: true, data: "http://127.0.0.1:8789/live/pv?t=secret-token" }),
}));
vi.mock("@/lib/browser/cdp-driver", () => ({ attachBrowser: async () => Promise.reject(new Error("no browser in this test")) }));

import { saveShot } from "@/lib/browser/shots";
import { bdb, resetBrowserDb, seedAgent, seedOrg, seedPolicy, seedSession, seedUser } from "@/lib/browser/browser-test-db";
import { BOOT_ID, liveBrowser, putLiveBrowser, resetLiveRegistryForTests } from "@/lib/browser/live";

/** The live browser a row has in this process. */
const liveBrowserOf = (row: Record<string, unknown>) => liveBrowser(String(row.id))!;
import { takeOverForStep, takeOverRequestOf, type BrowserSessionView } from "@/lib/browser/views";
import { GET as LIST } from "./route";
import { GET as ONE } from "./[id]/route";
import { POST as LIVE_VIEW } from "./[id]/live-view/route";
import { POST as STOP } from "./[id]/stop/route";
import { POST as TAKE_OVER } from "./[id]/take-over/route";
import { POST as DONE } from "./[id]/take-over/done/route";
import { POST as RECORD } from "./[id]/record/route";
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
  st.actingOk = true;
  seedOrg();
  seedPolicy();
  seedAgent();
  seedUser();
  seedUser({ id: "u-olivia", firstName: "Olivia", lastName: "Park", email: "olivia@proof.test" });
  vi.spyOn(console, "error").mockImplementation(() => {});
  // A roomy disk, whatever the machine's (shots.ts keeps a free-space floor, review round 1 of Phase 4).
  vi.spyOn(fs, "statfs").mockResolvedValue({ type: 0, bsize: 4096, blocks: 100_000_000, bfree: 50_000_000, bavail: 50_000_000, files: 0, ffree: 0 } as never);
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

describe("a browser still starting (review of Phase 4 step 2)", () => {
  it("answers 409 busy to the live view and to Take over, and ends nothing", async () => {
    // Its guard is not attached yet, so this process holds no entry for it.
    const here = seedSession({ status: "starting", bootId: BOOT_ID, providerSessionId: null });
    const elsewhere = seedSession({ userId: "u-olivia", status: "starting", bootId: "another-boot", providerSessionId: null });
    for (const [row, who] of [
      [here, MAX],
      [elsewhere, OLIVIA],
    ] as const) {
      st.viewer = { ...who };
      for (const route of [LIVE_VIEW, TAKE_OVER]) {
        const res = await route(post(), p(String(row.id)));
        expect([res.status, (await res.json()).code]).toEqual([409, "busy"]);
      }
      expect(row).toMatchObject({ status: "starting", endReason: null });
    }
    expect(st.liveUrls).toBe(0);
    expect(st.released).toEqual([]);
    expect(bdb.t.activity.filter((a) => a.type === "teammate_browser.session_ended")).toEqual([]);
  });

  it("still closes a live browser whose guard this process does not hold, from Take over too", async () => {
    const row = seedSession({ bootId: BOOT_ID });
    const res = await TAKE_OVER(post(), p(String(row.id)));
    expect([res.status, (await res.json()).code]).toEqual([409, "ended"]);
    expect(row).toMatchObject({ status: "ended", endReason: "restarted" });
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

  // Phase 4 step 3: the person took over from the browser card while a click waited for them.
  it("hands it back to waiting on a step that still waits, from when that step was asked", async () => {
    const row = live({ status: "handed_over", handedOverAt: new Date() });
    const id = String(row.id);
    const asked = new Date(Date.now() - 120_000);
    bdb.t.actions.push({ id: "c-click", organizationId: "org1", sessionId: "chat-1", agentId: "a-shop", toolName: "click", status: "PENDING", actingForId: "u-max", input: { browserSessionId: id }, createdAt: asked });
    const body = await (await DONE(post({ finished: true }), p(id))).json();
    // Before: live, so the idle sweep could close it under its waiting card.
    expect(body).toMatchObject({ session: { status: "waiting" }, resume: false });
    expect(bdb.t.sessions.find((s) => s.id === id)).toMatchObject({ status: "waiting", waitingSince: asked });
    expect(bdb.t.actions[0].status).toBe("PENDING");
  });
});

// Review of Phase 4 step 4: a take over request is answered by whichever card takes the browser, and Done continues the chat once.
describe("a take over request and the browser card (review of Phase 4 step 4)", () => {
  const ask = (id: string) => ({ id: "c-take", organizationId: "org1", sessionId: "chat-1", agentId: "a-shop", toolName: "ask_to_take_over", status: "PENDING", actingForId: "u-max", input: { browserSessionId: id } });
  const viewOf = async (id: string): Promise<BrowserSessionView> => (await ONE(new Request("https://app.test/x"), p(id))).json();

  /** Done, then Done again: the chat continues once, and the card's line is written once. */
  async function doneTwice(id: string) {
    const first = await (await DONE(post({ finished: true }), p(id))).json();
    expect(first).toMatchObject({ session: { status: "live" }, resume: true, chat: { kind: "teammate", slug: "shopper" } });
    const again = await DONE(post({ finished: true }), p(id));
    expect([again.status, (await again.json()).code]).toEqual([409, "not_handed_over"]);
    expect(bdb.t.actions[0]).toMatchObject({ status: "EXECUTED", result: { data: { done: true } } });
    expect(st.lines).toEqual([expect.objectContaining({ actionId: "c-take", event: "action_approved" })]);
  }

  it("the browser card's Take over names the request that waits, so Done continues the chat once", async () => {
    const row = live({ status: "waiting", waitingSince: new Date() });
    const id = String(row.id);
    bdb.t.actions.push(ask(id));
    const view = await viewOf(id);
    expect(view.waiting).toEqual({ actionId: "c-take", kind: "take_over" });
    // What the card's button sends (browser-card.tsx): before, nothing, which left the request waiting and Done continuing nothing.
    const res = await TAKE_OVER(post({ actionId: takeOverRequestOf(view) }), p(id));
    expect(res.status).toBe(200);
    expect(bdb.t.actions[0]).toMatchObject({ status: "RUNNING", decidedVia: "person" });
    await doneTwice(id);
  });

  it("names a request still waiting while the person has the browser, and the card drawn for it answers it", async () => {
    // Taken from the browser card without naming the request (a page from before, or one read before it was asked).
    const row = live({ status: "handed_over", handedOverAt: new Date() });
    const id = String(row.id);
    bdb.t.actions.push(ask(id));
    const view = await viewOf(id);
    // Before: null while handed over, so the card drawn for the request returned and the request was never answered.
    expect(view).toMatchObject({ status: "handed_over", waiting: { actionId: "c-take", kind: "take_over" } });
    expect(takeOverForStep(view, "c-take")).toBe("take");
    const res = await TAKE_OVER(post({ actionId: "c-take" }), p(id));
    expect(res.status).toBe(200);
    expect(row.status).toBe("handed_over");
    expect(bdb.t.actions[0]).toMatchObject({ status: "RUNNING" });
    // Read again, handed over through it: nothing more is sent for it, ever.
    const after = await viewOf(id);
    expect(after.waiting).toBeNull();
    expect(takeOverForStep(after, "c-take")).toBe("done");
    await doneTwice(id);
    // Back to live after Done: the card drawn for it still sends nothing (before, a second take over and "already decided").
    expect(takeOverForStep(await viewOf(id), "c-take")).toBe("done");
  });
});

// Review round 1 of Phase 4.
describe("a take over's rows and its browser (review round 1 of Phase 4)", () => {
  it("names the session's person on both take over rows, so their own feed can show them", async () => {
    const row = live();
    const id = String(row.id);
    expect((await TAKE_OVER(post(), p(id))).status).toBe(200);
    expect((await DONE(post({ finished: true }), p(id))).status).toBe(200);
    const rows = bdb.t.activity.filter((a) => a.type === "teammate_browser.take_over");
    // Before: neither row named whom it was for.
    expect(rows.map((r) => [(r.metadata as { phase: string }).phase, r.actorId, r.actingForId])).toEqual([
      ["start", "u-max", "u-max"],
      ["end", "u-max", "u-max"],
    ]);
  });

  it("sets the browser's flag under its lock at Take over and clears it at Done, emptying its notes both times", async () => {
    const row = live();
    const id = String(row.id);
    const { liveBrowser } = await import("@/lib/browser/live");
    const lb = liveBrowser(id)!;
    lb.events.push("A note from before.");
    expect((await TAKE_OVER(post(), p(id))).status).toBe(200);
    expect([lb.handedOver, lb.events]).toEqual([true, []]);
    lb.events.push("A note that slipped in.");
    expect((await DONE(post({ finished: false }), p(id))).status).toBe(200);
    expect([lb.handedOver, lb.events]).toEqual([false, []]);
  });
});

// Phase 5 step 2 (docs/plans/ai-teammates-phase5.md): POST record, the person
// showing their teammate how, only their own, never cached; and Done
// answering what it kept.
describe("Show how: the record route (Phase 5 step 2)", () => {
  const recordPost = (body: Record<string, unknown>) => post(body);
  function recordable(o: Record<string, unknown> = {}) {
    process.env.BROWSER_SKILLS_OFFERED = "1";
    bdb.t.policies[0].skillsEnabled = true;
    bdb.t.policies[0].allowSites = ["login.proof.test"];
    bdb.t.agents[0].toolNames = ["open_page", "read_page", "use_skill", "ask_to_show_me"];
    bdb.t.agents[0].browserSites = ["login.proof.test"];
    const row = live(o);
    const watched: boolean[] = [];
    Object.assign(liveBrowserOf(row).handle, {
      currentUrl: () => "http://login.proof.test/",
      watch: async (on: boolean) => void watched.push(on),
      drainEvents: async () => ({ events: [{ type: "click", control: { tag: "button", role: "button", name: "Sign in", type: null, formHost: null, formKey: null, group: null, choice: false, opener: false, inRow: null, inNav: false, suggestion: false, wordsChanged: false, href: null, hints: { tag: "button" }, formFields: [] }, at: Date.now(), page: "http://login.proof.test/" }], pages: [] }),
      screenshot: async () => ({ jpeg: new Uint8Array([0xff, 0xd8, 0xff, 1]), width: 10, height: 10 }),
    });
    return { row, watched };
  }
  afterEach(() => {
    delete process.env.BROWSER_SKILLS_OFFERED;
  });

  it("starts the person's own recording, the live view no-store, and answers the skill", async () => {
    const { row, watched } = recordable();
    const res = await RECORD(recordPost({ name: "  Sign in\nto login " }), p(String(row.id)));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ session: { status: "handed_over", recording: { name: "Sign in to login" } }, liveView: { url: "http://127.0.0.1:8789/live/pv?t=secret-token", interactive: true }, skillId: bdb.t.skills[0].id });
    expect(bdb.t.skills[0]).toMatchObject({ name: "Sign in to login", status: "recording" });
    expect(watched).toEqual([true]);
  });

  it("answers anyone else, an Owner included, not found, and changes nothing", async () => {
    const { row } = recordable();
    st.viewer = { ...OLIVIA };
    const res = await RECORD(recordPost({ name: "Steal it" }), p(String(row.id)));
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(row.status).toBe("live");
    expect(bdb.t.skills).toEqual([]);
    expect(st.liveUrls).toBe(0);
  });

  it("refuses each reason with its own code, never cached", async () => {
    const { row } = recordable();
    const id = String(row.id);
    const code = async (body: Record<string, unknown>) => {
      const res = await RECORD(recordPost(body), p(id));
      return [res.status, (await res.json()).code] as const;
    };
    expect(await code({ name: "   " })).toEqual([400, "name_needed"]);
    expect(await code({ name: "x".repeat(81) })).toEqual([400, "invalid"]);
    expect(await code({ name: "Pay with 4242 4242 4242 4242" })).toEqual([400, "name_sensitive"]);
    expect(await code({ name: "A job", organizationId: "org2" })).toEqual([409, "workspace_changed"]);
    expect(await code({ name: "A job", extra: true })).toEqual([400, "invalid"]);
    bdb.t.policies[0].skillsEnabled = false;
    expect(await code({ name: "A job" })).toEqual([403, "skills_off"]);
    bdb.t.policies[0].skillsEnabled = true;
    bdb.t.agents[0].toolNames = ["open_page", "ask_to_show_me"];
    expect(await code({ name: "A job" })).toEqual([409, "cant_learn"]);
    bdb.t.agents[0].toolNames = ["open_page", "use_skill"];
    row.endsBy = new Date(Date.now() + 60_000);
    expect(await code({ name: "A job" })).toEqual([409, "too_late"]);
    st.actingOk = false;
    expect(await code({ name: "A job" })).toEqual([403, "person_cannot"]);
    st.actingOk = true;
    const closed = seedSession({ status: "ended", userId: "u-max" });
    const res = await RECORD(recordPost({ name: "A job" }), p(String(closed.id)));
    expect([res.status, (await res.json()).code]).toEqual([409, "ended"]);
    expect(bdb.t.skills).toEqual([]);
  });

  it("answers rate_limited past 20 a minute", async () => {
    const { row } = recordable();
    st.viewer = { ...MAX, userId: "u-rate" };
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await RECORD(recordPost({ name: "A job" }), p(String(row.id)))).status;
    expect(last).toBe(429);
  });

  it("Done answers what it kept, and Discard nothing", async () => {
    const { row } = recordable();
    await RECORD(recordPost({ name: "Sign in to login" }), p(String(row.id)));
    const skillId = bdb.t.skills[0].id;
    const done = await (await DONE(post({ finished: true }), p(String(row.id)))).json();
    expect(done).toMatchObject({ session: { status: "live", recording: null }, recorded: { skillId, steps: 2 } });
    expect(bdb.t.skills[0]).toMatchObject({ status: "draft", recordingEndReason: "done" });
    const again = await RECORD(recordPost({ name: "Another" }), p(String(row.id)));
    expect(again.status).toBe(200);
    const discard = await (await DONE(post({ finished: false }), p(String(row.id)))).json();
    expect(discard).toMatchObject({ recorded: null });
    expect(bdb.t.skills.map((s) => s.name)).toEqual(["Sign in to login"]);
  });
});
