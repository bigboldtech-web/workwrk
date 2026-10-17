// A person's own skills (src/app/api/teammate-skills/**,
// docs/plans/ai-teammates-phase5.md step 3, Decisions 10 to 14, 24, 25 and
// 28): anyone else's, an Owner's included, is 404 on every route; reading
// and deleting need no AI app, an edit does; an edit sends only what a
// review may change, by the version it read, and the server rebuilds every
// other field from the stored step; audit rows carry hosts and counts only;
// Teach a skill's start sites are plain hosts the guard lets open now.

import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  viewer: { userId: "u-max", organizationId: "org1", orgRole: "MEMBER", isAgent: false } as { userId: string; organizationId: string; orgRole: string; isAgent: boolean },
  signedIn: true,
  aiApp: true,
  /** The teammate the viewer may use, by slug, or none. */
  visible: true,
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/browser/browser-test-db")).browserDb }));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => (st.signedIn ? st.viewer : null) }));
vi.mock("@/lib/app-gate", () => ({
  requireApp: vi.fn(async () => (st.aiApp ? { viewer: st.viewer } : { error: NextResponse.json({ error: "no_access", page: "ai" }, { status: 403 }) })),
  requireManageApps: vi.fn(async () => ({ viewer: st.viewer })),
}));
vi.mock("@/lib/agents/actions", () => ({ writeEventLine: async () => null, actionHref: (s: string, id: string) => `/agents?chat=${s}&action=${id}` }));
vi.mock("@/lib/realtime-bus", () => ({ publishToUser: () => undefined }));
vi.mock("@/lib/agents/acting", () => ({ actorLabelFor: (a: { name: string }, p: { name: string }) => `${a.name} for ${p.name}`, resolveActingPerson: async () => ({ ok: true, person: {} }) }));
vi.mock("@/lib/browser/browserbase", () => ({
  releaseProviderSession: async () => "released",
  createProviderSession: async () => ({ ok: false, failure: "unavailable" }),
  listRunningProviderSessions: async () => ({ ok: true, data: [] }),
  liveViewUrl: async () => ({ ok: false, failure: "unavailable" }),
}));
vi.mock("@/lib/browser/cdp-driver", () => ({ attachBrowser: async () => Promise.reject(new Error("no browser in this test")) }));
// The teammate as the person may use it (teammate-server.ts loadTeammate), read from the double's agents.
vi.mock("@/lib/agents/teammate-server", async (orig) => {
  const real = await orig<typeof import("@/lib/agents/teammate-server")>();
  const { bdb } = await import("@/lib/browser/browser-test-db");
  return {
    ...real,
    loadTeammate: async (slug: string, viewer: { organizationId: string }) => {
      if (!st.visible) return null;
      return (bdb.t.agents.find((a) => a.slug === slug && a.organizationId === viewer.organizationId) as never) ?? null;
    },
  };
});

import { bdb, browserDb, resetBrowserDb, seedAgent, seedOrg, seedPolicy, seedRoutine, seedSession, seedSkill, seedUser } from "@/lib/browser/browser-test-db";
import { resetLiveRegistryForTests } from "@/lib/browser/live";
import { resetSkillsKeptForTests } from "@/lib/skills/kept";
import type { SkillStep } from "@/lib/skills/types";
import type { SkillListView, SkillView } from "@/lib/skills/views";
import { GET as LIST } from "./route";
import { DELETE, GET as ONE, PATCH } from "./[id]/route";

const ENV = {
  NODE_ENV: "test",
  BROWSER_OFFERED: "1",
  BROWSER_SKILLS_OFFERED: "1",
  BROWSER_PROVIDER: "stand-in",
  BROWSERBASE_API_KEY: "stand-in",
  BROWSERBASE_PROJECT_ID: "stand-in",
  BROWSERBASE_BASE_URL: "http://127.0.0.1:8789",
  BROWSER_REGION: "eu-central-1",
  BROWSER_SHOTS_DIR: "/tmp/wk-skills-route-test-shots",
  SECRETS_ENCRYPTION_KEY: "4".repeat(64),
};
const saved: Record<string, string | undefined> = {};

const MAX = { userId: "u-max", organizationId: "org1", orgRole: "MEMBER", isAgent: false };
const OLIVIA = { userId: "u-olivia", organizationId: "org1", orgRole: "OWNER", isAgent: false };

const SITE = "expenses.proof.test";
const STEPS: SkillStep[] = [
  { id: "s1", kind: "start", title: "Start on expenses.proof.test/new", site: SITE, page: `${SITE}/new`, shotId: null, address: `http://${SITE}/new` },
  { id: "s2", kind: "type", title: 'Type in "Amount"', site: SITE, page: `${SITE}/new`, shotId: "shot-1", name: "Amount", fieldKind: "text", pressEnter: false, value: { ask: true } },
  { id: "s3", kind: "click", title: 'Click "Jane Doe"', site: SITE, page: `${SITE}/new`, shotId: null, role: "button", name: "Jane Doe", tag: "button", type: null, formHost: null, warnings: [] },
  { id: "s4", kind: "choose", title: 'Choose in "Category"', site: SITE, page: `${SITE}/new`, shotId: null, via: "list", name: "Category", value: { ask: true } },
  { id: "s5", kind: "yourself", title: "Sign in yourself", site: "pay.proof.test", page: "pay.proof.test", shotId: null, reason: "sign_in" },
];

const p = (id: string) => ({ params: Promise.resolve({ id }) });
const listReq = (slug = "shopper") => new Request(`https://app.test/api/teammate-skills?agent=${slug}`);
const body = (method: string, b: Record<string, unknown>) => new Request("https://app.test/x", { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ organizationId: "org1", ...b }) });
const patch = (id: string, b: Record<string, unknown>) => PATCH(body("PATCH", b), p(id));
const del = (id: string, b: Record<string, unknown> = {}) => DELETE(body("DELETE", b), p(id));

/** Max's draft of five steps. */
function draft(o: Record<string, unknown> = {}) {
  return seedSkill({ status: "draft", name: "Submit an expense", steps: structuredClone(STEPS), stepCount: STEPS.length, sites: [SITE, "pay.proof.test"], startUrl: `http://${SITE}/new`, ...o });
}

/** Every word a skill's name, titles and values hold, which no audit row may carry. */
const PRIVATE_WORDS = ["Submit an expense", "Amount", "Jane Doe", "Category", "Weekly travel", "Taxi to the airport"];

beforeEach(() => {
  resetBrowserDb();
  resetLiveRegistryForTests();
  resetSkillsKeptForTests();
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  st.viewer = { ...MAX };
  st.signedIn = true;
  st.aiApp = true;
  st.visible = true;
  seedOrg();
  seedPolicy({ allowSites: [SITE, "pay.proof.test", "*.acme.com"], skillsEnabled: true });
  seedAgent({ browserSites: [SITE, "pay.proof.test", "*.acme.com"], toolNames: ["open_page", "read_page", "click", "use_skill"], visibility: "WORKSPACE", ownerId: null });
  seedUser();
  seedUser({ id: "u-olivia", firstName: "Olivia", lastName: "Park", email: "olivia@proof.test" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

describe("only the person's own (Decision 25)", () => {
  it("answers anyone else, an Owner included, 404 on every route, and lists none of it", async () => {
    const s = draft();
    st.viewer = { ...OLIVIA };
    expect((await ONE(new Request("https://app.test/x"), p(String(s.id)))).status).toBe(404);
    expect((await patch(String(s.id), { version: 1, name: "Mine now" })).status).toBe(404);
    expect((await del(String(s.id))).status).toBe(404);
    const list = (await (await LIST(listReq())).json()) as { skills: SkillListView[] };
    expect(list.skills).toEqual([]);
    // Nothing changed or deleted.
    expect(bdb.t.skills).toHaveLength(1);
    expect(s).toMatchObject({ name: "Submit an expense", version: 1 });
  });

  it("is 404 for a teammate the person cannot see, and 401 signed out", async () => {
    st.visible = false;
    expect((await LIST(listReq())).status).toBe(404);
    st.visible = true;
    st.signedIn = false;
    expect((await LIST(listReq())).status).toBe(401);
    expect((await ONE(new Request("https://app.test/x"), p("sk1"))).status).toBe(401);
  });
});

describe("reading (Decision 13)", () => {
  it("lists and reads without the AI app, a removed teammate's skills included, with the day they go", async () => {
    st.aiApp = false;
    (bdb.t.agents[0] as Record<string, unknown>).status = "ARCHIVED";
    const orphanedAt = new Date("2026-10-01T09:00:00.000Z");
    const s = draft({ orphanedAt });
    const res = await LIST(listReq());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const list = (await res.json()) as { skills: SkillListView[]; availability: Record<string, unknown>; startSites: unknown[] };
    expect(list.skills.map((x) => x.id)).toEqual([s.id]);
    expect(list.skills[0]).toMatchObject({ status: "draft", stepCount: 5, deletesOn: "2026-10-31T09:00:00.000Z", notAllowed: [] });
    // A removed teammate is never on, and Teach a skill is not offered for it.
    expect(list.availability).toEqual({ offered: true, on: false, canTeach: false, reason: null });
    expect(list.startSites).toEqual([]);
    const one = (await (await ONE(new Request("https://app.test/x"), p(String(s.id)))).json()) as SkillView;
    expect(one.steps.map((x) => x.kind)).toEqual(["start", "type", "click", "choose", "yourself"]);
    expect(one.steps[0]).toMatchObject({ facts: "Starts at http://expenses.proof.test/new", address: "http://expenses.proof.test/new" });
    // A picture no longer kept is gone, never its id.
    expect(one.steps[1]).toMatchObject({ shot: null, pictureGone: true, hasName: true, plainTitle: "Type in a field" });
    // An edit needs the AI app.
    expect((await patch(String(s.id), { version: 1, name: "New name" })).status).toBe(403);
  });

  it("names each host the teammate may not open now (Decision 12)", async () => {
    const s = draft();
    (bdb.t.policies[0] as Record<string, unknown>).blockSites = ["pay.proof.test"];
    const list = (await (await LIST(listReq())).json()) as { skills: SkillListView[] };
    expect(list.skills.find((x) => x.id === s.id)?.notAllowed).toEqual(["pay.proof.test"]);
  });
});

// Review of step 3, M2: My account's Your data card lists every skill of the
// person's own, with any teammate, through this route with no teammate
// named, so a person with AI off can still see and delete them.
describe("every one of the person's own skills, no teammate named (review of step 3, M2)", () => {
  const allReq = () => new Request("https://app.test/api/teammate-skills");

  it("lists them all without the AI app, each with its teammate's name, a removed one's included, newest first, and nobody else's", async () => {
    st.aiApp = false;
    seedAgent({ id: "a-res", slug: "researcher", name: "Researcher", status: "ARCHIVED", browserSites: [], toolNames: [] });
    const older = draft({ createdAt: new Date("2026-10-10T09:00:00.000Z") });
    const removed = seedSkill({ status: "ready", agentId: "a-res", name: "Weekly report", stepCount: 2, sites: ["docs.proof.test"], orphanedAt: new Date("2026-10-05T09:00:00.000Z"), createdAt: new Date("2026-10-12T09:00:00.000Z") });
    seedSkill({ status: "ready", userId: "u-olivia", name: "Olivia's own" });
    seedSkill({ status: "ready", organizationId: "org2", name: "Max elsewhere" });
    const res = await LIST(allReq());
    // Before: 404, since no teammate was named.
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const out = (await res.json()) as { skills: Array<SkillListView & { teammate: string }> };
    expect(out.skills.map((x) => x.id)).toEqual([removed.id, older.id]);
    expect(out.skills[0]).toMatchObject({ teammate: "Researcher", status: "ready", stepCount: 2, sites: ["docs.proof.test"], deletesOn: "2026-11-04T09:00:00.000Z", organizationId: "org1" });
    expect(out.skills[1]).toMatchObject({ teammate: "Shopper", status: "draft", notAllowed: [] });
    expect(JSON.stringify(out)).not.toMatch(/Olivia's own|Max elsewhere/);
    // And each can be deleted there, still without the AI app.
    expect((await del(String(removed.id))).status).toBe(200);
    expect(bdb.t.skills.some((x) => x.id === removed.id)).toBe(false);
  });

  it("reads no skill where none can be kept and this WorkwrK does not offer them, and is 401 signed out; an empty teammate name is still 404", async () => {
    delete process.env.BROWSER_SKILLS_OFFERED;
    const spy = vi.spyOn(browserDb.teammateSkill as { findMany: (...a: unknown[]) => Promise<unknown> }, "findMany");
    expect(await (await LIST(allReq())).json()).toEqual({ skills: [] });
    expect(await (await LIST(allReq())).json()).toEqual({ skills: [] });
    expect(spy).not.toHaveBeenCalled();
    // Kept from when it was offered: listed, offered or not.
    resetSkillsKeptForTests();
    const s = draft();
    expect(((await (await LIST(allReq())).json()) as { skills: Array<{ id: string }> }).skills.map((x) => x.id)).toEqual([s.id]);
    expect((await LIST(new Request("https://app.test/api/teammate-skills?agent="))).status).toBe(404);
    st.signedIn = false;
    expect((await LIST(allReq())).status).toBe(401);
  });
});

describe("Teach a skill's start sites (step 3)", () => {
  it("gives a wildcard entry's base host, never a *., only hosts the guard lets open now, each with its home address", async () => {
    const list = (await (await LIST(listReq())).json()) as { availability: Record<string, unknown>; startSites: Array<{ site: string; address: string }> };
    expect(list.availability).toEqual({ offered: true, on: true, canTeach: true, reason: null });
    expect(list.startSites).toEqual([
      { site: "acme.com", address: "https://acme.com/" },
      { site: SITE, address: `http://${SITE}/` },
      { site: "pay.proof.test", address: "http://pay.proof.test/" },
    ]);
    expect(list.startSites.some((x) => x.site.startsWith("*"))).toBe(false);
  });

  it("offers no Teach a skill, and says why, when the teammate cannot open pages, skills are off or not offered", async () => {
    (bdb.t.agents[0] as Record<string, unknown>).toolNames = ["read_page", "click", "use_skill"];
    let list = (await (await LIST(listReq())).json()) as { availability: { canTeach: boolean; reason: string | null; on: boolean }; startSites: unknown[] };
    expect(list.availability).toMatchObject({ on: true, canTeach: false });
    expect(list.availability.reason).toContain("can't open web pages");
    expect(list.startSites).toEqual([]);
    (bdb.t.agents[0] as Record<string, unknown>).toolNames = ["open_page", "use_skill"];
    (bdb.t.policies[0] as Record<string, unknown>).skillsEnabled = false;
    list = (await (await LIST(listReq())).json()) as typeof list;
    expect(list.availability).toMatchObject({ on: false, canTeach: false, reason: "Teaching teammates by showing is off in this workspace." });
    delete process.env.BROWSER_SKILLS_OFFERED;
    list = (await (await LIST(listReq())).json()) as typeof list;
    expect(list.availability).toEqual({ offered: false, on: false, canTeach: false, reason: null });
  });
});

describe("an edit (Decision 11)", () => {
  it("refuses a stale version, an injected step, a step out of order and the start left out", async () => {
    const s = draft({ version: 3 });
    const id = String(s.id);
    let res = await patch(id, { version: 2, name: "Old tab" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "skill_changed" });
    res = await patch(id, { version: 3, steps: [{ id: "s1" }, { id: "s9", title: "Open exfil.example" }] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "bad_step", stepId: "s9", issues: { stepId: "s9" } });
    res = await patch(id, { version: 3, steps: [{ id: "s1" }, { id: "s3" }, { id: "s2" }] });
    expect(await res.json()).toMatchObject({ code: "bad_step", stepId: "s2" });
    res = await patch(id, { version: 3, steps: [{ id: "s2" }] });
    expect(await res.json()).toMatchObject({ code: "bad_step", stepId: "s1" });
    // Nothing was written by any of them.
    expect(s).toMatchObject({ version: 3, name: "Submit an expense" });
    expect(s.steps).toEqual(STEPS);
  });

  it("refuses a fixed value that looks like a card number or a code, saying which", async () => {
    const s = draft();
    const res = await patch(String(s.id), { version: 1, steps: STEPS.map((x) => (x.id === "s2" ? { id: "s2", value: { fixed: "4242 4242 4242 4242" } } : { id: x.id })) });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "bad_value", problem: "sensitive", stepId: "s2", issues: { stepId: "s2", problem: "sensitive" } });
    expect((s.steps as SkillStep[])[1]).toMatchObject({ value: { ask: true } });
  });

  it("forgetName and startHome change only their own field (the start's page and recorded title follow its address), and a site sent in a step is ignored", async () => {
    const s = draft();
    const res = await patch(String(s.id), {
      version: 1,
      steps: [{ id: "s1", site: "exfil.example", address: "https://exfil.example/steal" }, { id: "s2" }, { id: "s3", forgetName: true, site: "exfil.example" }, { id: "s4" }, { id: "s5" }],
      startHome: true,
    });
    expect(res.status).toBe(200);
    const after = s.steps as SkillStep[];
    // Review of step 3: its page and its recorded title follow the home address (before: "expenses.proof.test/new" kept in both).
    expect(after[0]).toEqual({ ...STEPS[0], address: `http://${SITE}/`, page: SITE, title: `Start on ${SITE}` });
    // The click keeps its role and every other field; its words are gone from its name and its title.
    expect(after[2]).toEqual({ ...STEPS[2], name: "", title: "Click the button" });
    expect(JSON.stringify(after)).not.toContain("Jane Doe");
    expect(JSON.stringify(after)).not.toContain("exfil");
    expect(after[1]).toEqual(STEPS[1]);
    expect(s).toMatchObject({ version: 2, status: "draft", startUrl: `http://${SITE}/`, sites: [SITE, "pay.proof.test"] });
    const view = (await res.json()) as SkillView;
    expect(view.version).toBe(2);
  });

  it("refuses a card number split by dots or slashes, or an IBAN in lower case, in a value, a name or what it is for (review of step 3)", async () => {
    const s = draft();
    const id = String(s.id);
    // Before: each was kept.
    let res = await patch(id, { version: 1, steps: STEPS.map((x) => (x.id === "s2" ? { id: "s2", value: { fixed: "4242/4242/4242/4242" } } : { id: x.id })) });
    expect(await res.json()).toMatchObject({ code: "bad_value", problem: "sensitive", stepId: "s2" });
    res = await patch(id, { version: 1, name: "Pay 4242.4242.4242.4242" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "name_sensitive" });
    res = await patch(id, { version: 1, description: "Into de89 3704 0044 0532 0130 00" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "description_sensitive" });
    expect(s).toMatchObject({ version: 1, name: "Submit an expense", description: "" });
  });

  it("says why a step's name was refused: empty, too long, or holding the page's words removed (review of step 3)", async () => {
    const s = draft();
    const id = String(s.id);
    let res = await patch(id, { version: 1, steps: STEPS.map((x) => (x.id === "s3" ? { id: "s3", title: "  " } : { id: x.id })) });
    // Before: "Give the step a name of one line, without the page's words you removed." for each of the three.
    expect(await res.json()).toMatchObject({ code: "bad_title", stepId: "s3", error: "Give the step a name." });
    res = await patch(id, { version: 1, steps: STEPS.map((x) => (x.id === "s3" ? { id: "s3", title: "x".repeat(121) } : { id: x.id })) });
    expect(await res.json()).toMatchObject({ code: "bad_title", stepId: "s3", error: "Keep the step's name to 120 characters or fewer." });
    res = await patch(id, { version: 1, steps: STEPS.map((x) => (x.id === "s3" ? { id: "s3", forgetName: true, title: "Pay jane doe" } : { id: x.id })) });
    expect(await res.json()).toMatchObject({ code: "bad_title", stepId: "s3", error: "Give the step a name without the page's words you removed." });
  });

  it("keeps a fixed value the person typed, deletes a step, and turns a draft ready, writing one saved row of hosts and counts", async () => {
    const s = draft();
    const res = await patch(String(s.id), {
      version: 1,
      name: "Weekly travel",
      description: "Taxi to the airport",
      steps: [{ id: "s1" }, { id: "s2", value: { fixed: "42.50" }, title: "Type the amount" }, { id: "s4", value: { fixed: "Travel" } }],
      ready: true,
    });
    expect(res.status).toBe(200);
    expect(s).toMatchObject({ status: "ready", version: 2, stepCount: 3, name: "Weekly travel", description: "Taxi to the airport" });
    expect((s.steps as SkillStep[]).map((x) => x.id)).toEqual(["s1", "s2", "s4"]);
    expect((s.steps as SkillStep[])[1]).toMatchObject({ title: "Type the amount", value: { fixed: "42.50" } });
    const rows = bdb.t.activity.filter((a) => String(a.type).startsWith("teammate_skill."));
    expect(rows.map((r) => r.type)).toEqual(["teammate_skill.saved"]);
    expect(rows[0]).toMatchObject({ actorId: "u-max", actingForId: "u-max", description: "Saved a skill with 3 steps on expenses.proof.test" });
    const text = JSON.stringify(rows);
    for (const w of [...PRIVATE_WORDS, "42.50", "Travel", "Type the amount"]) expect(text).not.toContain(w);
  });

  it("refuses ready with nothing to do but start, a name taken case aside, and a recording", async () => {
    const empty = draft({ name: "Only a start", steps: [STEPS[0]], stepCount: 1 });
    let res = await patch(String(empty.id), { version: 1, ready: true });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "no_steps" });
    expect(empty.status).toBe("draft");
    const s = draft();
    res = await patch(String(s.id), { version: 1, name: "ONLY A START" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "name_taken" });
    const rec = seedSkill({ status: "recording", name: "Being shown", steps: structuredClone(STEPS), stepCount: 5 });
    res = await patch(String(rec.id), { version: 1, name: "Renamed" });
    expect(await res.json()).toMatchObject({ code: "still_recording" });
    res = await del(String(rec.id));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "still_recording" });
    expect(bdb.t.skills.some((x) => x.id === rec.id)).toBe(true);
  });

  it("takes the person's lock (73040) and the row FOR UPDATE before it writes, in one transaction", async () => {
    const s = draft();
    await patch(String(s.id), { version: 1, name: "Renamed" });
    expect(bdb.locks).toContainEqual({ cls: 73_040, key: "u-max", inTx: true });
    expect(bdb.rowLocks).toContainEqual({ what: "skill", inTx: true });
    const ops = bdb.events.map((e) => e.op);
    expect(ops.indexOf("lock")).toBeLessThan(ops.indexOf("skill.forUpdate"));
    expect(bdb.events.find((e) => e.op.startsWith("teammateSkill.updateMany"))?.inTx).toBe(true);
  });

  it("answers a session switched in another tab with workspace_changed, writing nothing", async () => {
    const s = draft();
    const res = await PATCH(new Request("https://app.test/x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ organizationId: "org2", version: 1, name: "X" }) }), p(String(s.id)));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "workspace_changed" });
    expect(s.name).toBe("Submit an expense");
  });
});

describe("deleting (Decision 14)", () => {
  it("deletes the person's own skill without the AI app, its routines with it, a browser following it forgetting it, and audits hosts and counts only", async () => {
    st.aiApp = false;
    const s = draft();
    const other = draft({ name: "Another" });
    seedRoutine({ skillId: s.id, name: "Weekly travel" });
    seedRoutine({ skillId: null, name: "Plain routine" });
    const session = seedSession({ skillId: s.id, skillVersion: 1 });
    const res = await del(String(s.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(bdb.t.skills.map((x) => x.id)).toEqual([other.id]);
    expect(bdb.t.routines.map((r) => r.name)).toEqual(["Plain routine"]);
    expect(session.skillId).toBeNull();
    const rows = bdb.t.activity.filter((a) => a.type === "teammate_skill.deleted");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ description: "Deleted a skill", actorId: "u-max", actingForId: "u-max" });
    for (const w of PRIVATE_WORDS) expect(JSON.stringify(rows)).not.toContain(w);
    // Deleted already: 404.
    expect((await del(String(s.id))).status).toBe(404);
  });
});
