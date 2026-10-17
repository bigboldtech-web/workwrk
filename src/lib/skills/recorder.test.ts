// Showing a teammate how (src/lib/skills/recorder.ts and its callers,
// docs/plans/ai-teammates-phase5.md Decisions 5 to 7, step 2), the database
// an in-memory double: the record route's order (access, time, the lock, one
// transaction swapping the card and the session together), Done keeping a
// draft and Discard deleting it, each end's own reason, the switch stopping a
// recording while the take over goes on, the poll stopping once its row is
// gone, and no audit row or chat line holding a step's words.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  lines: [] as Array<{ sessionId: string | null; line: Record<string, unknown> }>,
  published: [] as unknown[],
  watched: [] as boolean[],
  drains: [] as Array<{ events: unknown[]; pages: unknown[] }>,
  /** What the recorder hands over at watch(false), when the test sets it. */
  left: null as { events: unknown[] } | null,
  url: "http://expenses.proof.test/",
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/browser/browser-test-db")).browserDb }));
vi.mock("@/lib/agents/actions", () => ({
  writeEventLine: vi.fn(async (sessionId: string | null, line: Record<string, unknown>) => (st.lines.push({ sessionId, line }), null)),
  actionHref: (slug: string, id: string) => `/agents?chat=${slug}&action=${id}`,
}));
vi.mock("@/lib/realtime-bus", () => ({ publishToUser: (...a: unknown[]) => st.published.push(a) }));
vi.mock("@/lib/agents/acting", () => ({
  actorLabelFor: (a: { name: string }, p: { name: string }) => `${a.name} for ${p.name}`,
  resolveActingPerson: async (_o: string, userId: string) => ({ ok: true, person: { userId } }),
}));
vi.mock("@/lib/browser/browserbase", () => ({
  releaseProviderSession: async () => "released",
  createProviderSession: async () => ({ ok: false, failure: "unavailable" }),
  listRunningProviderSessions: async () => ({ ok: true, data: [] }),
  liveViewUrl: async () => ({ ok: true, data: "http://127.0.0.1:8789/live/pv?t=secret" }),
}));
vi.mock("@/lib/browser/cdp-driver", () => ({ attachBrowser: async () => Promise.reject(new Error("no browser in this test")) }));

import { bdb, resetBrowserDb, seedAgent, seedOrg, seedPolicy, seedSession, seedSkill, seedUser } from "@/lib/browser/browser-test-db";
import { BOOT_ID, liveBrowser, putLiveBrowser, resetLiveRegistryForTests, withBrowserLock } from "@/lib/browser/live";
import { endBrowserSession, SYSTEM_END } from "@/lib/browser/sessions";
import { finishTakeOver } from "@/lib/browser/take-over";
import { BROWSER_COPY, RECORDING_COPY, SKILL_ROUTE_ERRORS } from "@/lib/agents/teammate-copy";
import { endRecordingOf, startRecording, stopRecordingsOf } from "./recorder";
import { SKILL_LIMITS } from "./types";

const ENV = {
  BROWSER_OFFERED: "1",
  BROWSER_SKILLS_OFFERED: "1",
  BROWSER_PROVIDER: "stand-in",
  BROWSERBASE_API_KEY: "stand-in",
  BROWSERBASE_PROJECT_ID: "stand-in",
  BROWSERBASE_BASE_URL: "http://127.0.0.1:8789",
  BROWSER_REGION: "us-east-1",
  BROWSER_SHOTS_DIR: "/tmp/wk-recorder-test-shots-none",
  SECRETS_ENCRYPTION_KEY: "7".repeat(64),
};
const saved: Record<string, string | undefined> = {};
const MAX = { userId: "u-max", organizationId: "org1" };

/** The person's control, with words that must never reach an audit row or a line. */
const SUBMIT = { tag: "button", role: "button", name: "Submit expense", type: null, formHost: "expenses.proof.test", formKey: 0, group: null, choice: false, opener: false, inRow: null, inNav: false, suggestion: false, wordsChanged: false, href: null, hints: { tag: "button", type: null, autocomplete: null, inputmode: null, name: null, id: null, label: null, maxLength: null }, formFields: [] };
const AMOUNT = { ...SUBMIT, tag: "input", role: "textbox", name: "Amount", type: "text", hints: { ...SUBMIT.hints, tag: "input", type: "text", label: "Amount" } };

function liveHere(o: Record<string, unknown> = {}) {
  const row = seedSession({ bootId: BOOT_ID, currentSite: "expenses.proof.test", providerSessionId: "pv-1", ...o });
  putLiveBrowser({
    rowId: String(row.id),
    organizationId: String(row.organizationId),
    userId: String(row.userId),
    agentId: String(row.agentId),
    handle: {
      close: async () => undefined,
      currentUrl: () => st.url,
      blank: async () => undefined,
      watch: async (on: boolean) => {
        st.watched.push(on);
        return on ? undefined : (st.left ?? undefined);
      },
      drainEvents: async () => st.drains.shift() ?? { events: [], pages: [] },
      screenshot: async () => ({ jpeg: new Uint8Array([0xff, 0xd8, 0xff]), width: 10, height: 10 }),
    } as never,
    rules: { allow: ["expenses.proof.test"], block: [], appHosts: [], schemes: ["https:", "http:"], fixtureSuffix: ".proof.test" },
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

const event = (type: string, control: unknown, page = "http://expenses.proof.test/new") => ({ type, control, at: Date.now(), page });

beforeEach(() => {
  resetBrowserDb();
  resetLiveRegistryForTests();
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  st.lines = [];
  st.published = [];
  st.watched = [];
  st.drains = [];
  st.left = null;
  st.url = "http://expenses.proof.test/";
  seedOrg();
  seedPolicy({ allowSites: ["expenses.proof.test"], skillsEnabled: true });
  seedAgent({ browserSites: ["expenses.proof.test"], toolNames: ["open_page", "read_page", "click", "ask_to_show_me", "use_skill"] });
  seedUser();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const showMeCard = (session: string, o: Record<string, unknown> = {}) => {
  const card = { id: "c-show", sessionId: "chat-1", agentId: "a-shop", organizationId: "org1", toolName: "ask_to_show_me", status: "PENDING", actingForId: "u-max", input: { browserSessionId: session, site: "expenses.proof.test" }, ...o };
  bdb.t.actions.push(card);
  return card;
};

describe("startRecording: the record route's order", () => {
  it("swaps the teammate's card and the session together, makes the recording row, switches the recorder on and audits counts and hosts only", async () => {
    const row = liveHere();
    const card = showMeCard(String(row.id));
    const out = await startRecording(MAX, String(row.id), { name: "Submit an expense", actionId: card.id });
    expect(out).toMatchObject({ ok: true, url: "http://127.0.0.1:8789/live/pv?t=secret" });
    const skill = bdb.t.skills[0];
    expect(skill).toMatchObject({ status: "recording", name: "Submit an expense", recordingSessionId: row.id, startUrl: "http://expenses.proof.test/" });
    expect(row).toMatchObject({ status: "handed_over", recordingSkillId: skill.id });
    expect(card).toMatchObject({ status: "RUNNING", decidedVia: "person" });
    // The recorder on, under the browser's lock, its flag set as a take over's.
    expect(st.watched).toEqual([true]);
    expect(liveBrowser(String(row.id))).toMatchObject({ handedOver: true, recording: { skillId: skill.id } });
    // The day's cap counts it (a take_over step with code "recording"), and the audit row names a host, never the name.
    expect(bdb.t.steps.filter((x) => x.kind === "take_over")).toEqual([expect.objectContaining({ code: "recording", site: "expenses.proof.test" })]);
    const audit = bdb.t.activity.filter((a) => a.type === "teammate_skill.recording");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: "u-max", actingForId: "u-max", metadata: expect.objectContaining({ phase: "start", site: "expenses.proof.test", skillId: skill.id }) });
    expect(JSON.stringify(audit)).not.toContain("Submit an expense");
    // The first steps on record at once (the start step), so a crash keeps them.
    expect(skill.stepCount).toBe(1);
  });

  it("refuses with skills off or the teammate holding no use_skill before anything moves, and a browser closing in under 3 minutes", async () => {
    const row = liveHere();
    bdb.t.policies[0].skillsEnabled = false;
    expect(await startRecording(MAX, String(row.id), { name: "X", actionId: null })).toMatchObject({ ok: false, status: 403, code: "skills_off", error: SKILL_ROUTE_ERRORS.skillsOff });
    bdb.t.policies[0].skillsEnabled = true;
    bdb.t.agents[0].toolNames = ["open_page", "read_page", "ask_to_show_me"];
    expect(await startRecording(MAX, String(row.id), { name: "X", actionId: null })).toMatchObject({ ok: false, status: 409, code: "cant_learn", error: SKILL_ROUTE_ERRORS.cantLearn("Shopper") });
    bdb.t.agents[0].toolNames = ["open_page", "use_skill"];
    row.endsBy = new Date(Date.now() + 2 * 60_000);
    expect(await startRecording(MAX, String(row.id), { name: "X", actionId: null })).toMatchObject({ ok: false, status: 409, code: "too_late", error: SKILL_ROUTE_ERRORS.tooLate });
    // Not offered on this WorkwrK at all: off as well.
    delete process.env.BROWSER_SKILLS_OFFERED;
    row.endsBy = new Date(Date.now() + 14 * 60_000);
    expect(await startRecording(MAX, String(row.id), { name: "X", actionId: null })).toMatchObject({ ok: false, code: "skills_off" });
    expect(row.status).toBe("live");
    expect(bdb.t.skills).toEqual([]);
    expect(st.watched).toEqual([]);
  });

  it("changes neither the card nor the session when the card was decided, and makes no recording", async () => {
    const row = liveHere();
    const card = showMeCard(String(row.id), { status: "DENIED" });
    expect(await startRecording(MAX, String(row.id), { name: "Submit an expense", actionId: card.id })).toMatchObject({ ok: false, status: 409, code: "card_decided" });
    // Read again: the transaction rolled back.
    const now = bdb.t.sessions.find((x) => x.id === row.id)!;
    expect(now.status).toBe("live");
    expect(now.recordingSkillId ?? null).toBeNull();
    expect(bdb.t.actions.find((x) => x.id === card.id)?.status).toBe("DENIED");
    expect(bdb.t.skills).toEqual([]);
    expect(liveBrowser(String(row.id))?.handedOver).toBeUndefined();
    expect(st.watched).toEqual([]);
  });

  it("answers anyone else's session not found, an Owner's request included, and a browser on no web page no_page", async () => {
    const row = liveHere();
    expect(await startRecording({ userId: "u-olivia", organizationId: "org1" }, String(row.id), { name: "X", actionId: null })).toMatchObject({ status: 404 });
    st.url = "about:blank";
    expect(await startRecording(MAX, String(row.id), { name: "X", actionId: null })).toMatchObject({ status: 409, code: "no_page" });
    expect(row.status).toBe("live");
  });

  it("refuses each cap with its own reason and status", async () => {
    const row = liveHere();
    seedSkill({ status: "draft", name: "Submit an expense" });
    expect(await startRecording(MAX, String(row.id), { name: "submit an EXPENSE", actionId: null })).toMatchObject({ status: 409, code: "name_taken", error: SKILL_ROUTE_ERRORS.nameTaken });
    for (let i = 0; i < SKILL_LIMITS.perTeammate; i++) seedSkill({ status: "draft", name: `S${i}` });
    expect(await startRecording(MAX, String(row.id), { name: "New", actionId: null })).toMatchObject({ status: 409, code: "too_many_for_teammate" });
    expect(row.status).toBe("live");
  });
});

describe("the end of a recording", () => {
  async function recording(o: { actionId?: boolean } = {}) {
    const row = liveHere();
    const card: Record<string, unknown> | null = o.actionId ? showMeCard(String(row.id)) : null;
    const out = await startRecording(MAX, String(row.id), { name: "Submit an expense", actionId: card ? String(card.id) : null });
    if (!out.ok) throw new Error(out.code);
    return { row, card, skill: bdb.t.skills[0] };
  }

  it("Done keeps the steps as a draft, the card EXECUTED with only done and its note, and the line in the person's words", async () => {
    const { row, card, skill } = await recording({ actionId: true });
    st.drains.push({ events: [event("input", AMOUNT), event("click", SUBMIT)], pages: [] });
    const out = await finishTakeOver(MAX, String(row.id), true);
    expect(out).toMatchObject({ ok: true, resume: true, recorded: { skillId: skill.id } });
    expect(skill).toMatchObject({ status: "draft", recordingEndReason: "done" });
    expect((skill.steps as Array<{ kind: string }>).map((s) => s.kind)).toEqual(["start", "type", "click"]);
    expect(card).toMatchObject({ status: "EXECUTED", result: { text: RECORDING_COPY.showMeDoneText, data: { done: true, note: BROWSER_COPY.showMeDoneNote("Max") } } });
    expect(row).toMatchObject({ status: "live", recordingSkillId: null });
    expect(st.watched).toEqual([true, false]);
    expect(liveBrowser(String(row.id))?.recording).toBeNull();
    const line = st.lines.find((l) => l.line.event === "skill_recorded");
    expect(line?.line).toMatchObject({ text: RECORDING_COPY.recordedLine(3, "Submit an expense"), skillId: skill.id, agentId: "a-shop" });
    // The hand back is the recording's end, and its own audit row stands for the take over's.
    expect(bdb.t.steps.filter((x) => x.kind === "give_back")).toEqual([expect.objectContaining({ code: "recording" })]);
    expect(bdb.t.activity.filter((a) => a.type === "teammate_browser.take_over")).toEqual([]);
    const audit = bdb.t.activity.filter((a) => a.type === "teammate_skill.recording");
    expect(audit.map((a) => (a.metadata as { phase: string }).phase)).toEqual(["start", "end"]);
    expect(audit[1]).toMatchObject({ metadata: expect.objectContaining({ kept: true, steps: 3, sites: ["expenses.proof.test"] }) });
    // No step's words in any audit row or line, and the skill's name only in the person's own line.
    const written = JSON.stringify([bdb.t.activity, st.lines.filter((l) => l.line.event !== "skill_recorded"), card?.result]);
    for (const w of ["Submit expense", "Amount", "Submit an expense"]) expect(written).not.toContain(w);
  });

  it("Discard deletes the steps, and the card says the person stopped without showing it", async () => {
    const { row, card, skill } = await recording({ actionId: true });
    st.drains.push({ events: [event("click", SUBMIT)], pages: [] });
    const out = await finishTakeOver(MAX, String(row.id), false);
    expect(out).toMatchObject({ ok: true, recorded: null });
    expect(bdb.t.skills.find((s) => s.id === skill.id)).toBeUndefined();
    expect(card).toMatchObject({ status: "EXECUTED", result: { text: RECORDING_COPY.showMeStoppedText, data: { done: false, note: BROWSER_COPY.showMeStoppedNote("Max") } } });
    expect(st.lines.some((l) => l.line.event === "skill_recorded")).toBe(false);
  });

  it("keeps a recording as a draft when its browser ends, by the end's own reason, its card closed, never left RUNNING", async () => {
    for (const [reason, kept] of [["take_over_too_long", "time"], ["turned_off", "turned_off"], ["stopped", "ended"], ["time_cap", "ended"]] as const) {
      resetBrowserDb();
      resetLiveRegistryForTests();
      seedOrg();
      seedPolicy({ allowSites: ["expenses.proof.test"], skillsEnabled: true });
      seedAgent({ browserSites: ["expenses.proof.test"], toolNames: ["open_page", "use_skill"] });
      seedUser();
      st.lines = [];
      const { row, card, skill } = await recording({ actionId: true });
      st.drains.push({ events: [event("click", SUBMIT)], pages: [] });
      expect(await endBrowserSession(String(row.id), reason, SYSTEM_END)).toBe(true);
      expect(skill, reason).toMatchObject({ status: "draft", recordingEndReason: kept });
      expect(card?.status, reason).toBe("CANCELLED");
      expect(st.lines.find((l) => l.line.event === "skill_recorded")?.line.text, reason).toBe(RECORDING_COPY.endedWhileRecording(2));
    }
  });

  it("stops every recording in the workspace as a draft when skills go off, the take over going on", async () => {
    const { row, skill } = await recording();
    st.drains.push({ events: [event("click", SUBMIT)], pages: [] });
    expect(await stopRecordingsOf("org1", "skills_off")).toBe(1);
    expect(skill).toMatchObject({ status: "draft", recordingEndReason: "skills_off" });
    expect(row).toMatchObject({ status: "handed_over", recordingSkillId: null });
    expect(liveBrowser(String(row.id))).toMatchObject({ handedOver: true, recording: null });
    expect(st.lines.find((l) => l.line.event === "skill_recorded")?.line.text).toBe(RECORDING_COPY.stoppedSkillsOff);
    // Done afterwards is a plain one: nothing more to keep.
    expect(await finishTakeOver(MAX, String(row.id), true)).toMatchObject({ ok: true, recorded: null });
    expect(bdb.t.activity.filter((a) => a.type === "teammate_browser.take_over")).toHaveLength(1);
  });

  it("stops a recording for Delete every skill without keeping it, so no line says a draft was kept (Phase 5 step 3)", async () => {
    const { row, skill } = await recording();
    st.drains.push({ events: [event("click", SUBMIT)], pages: [] });
    expect(await stopRecordingsOf("org1", "skills_off", { keep: false })).toBe(1);
    // Before: kept as a draft, and the line "What was recorded is kept as a draft" written a moment before every skill was deleted.
    expect(bdb.t.skills.find((s) => s.id === skill.id)).toBeUndefined();
    expect(st.lines.filter((l) => l.line.event === "skill_recorded")).toEqual([]);
    expect(row).toMatchObject({ status: "handed_over", recordingSkillId: null });
    const end = bdb.t.activity.find((a) => a.type === "teammate_skill.recording" && (a.metadata as Record<string, unknown>)?.phase === "end");
    expect(end).toMatchObject({ description: "Stopped showing a teammate how: nothing kept", metadata: expect.objectContaining({ kept: false, reason: "skills_off" }) });
  });

  it("ends within its two seconds when a step holds the browser's lock, the last drain skipped", async () => {
    const { row, skill } = await recording();
    let release!: () => void;
    const held = withBrowserLock(String(row.id), 0, () => new Promise<void>((r) => (release = r)));
    const at = Date.now();
    const out = await endRecordingOf(String(row.id), { keep: true, reason: "ended", drain: true });
    expect(Date.now() - at).toBeLessThan(3_500);
    release();
    await held;
    // Its last drain unread and nothing handed over at the stop: what the
    // person did last may be missing, said as a gap the draft keeps (review
    // of Phase 5 step 2, low 1). Before: deleted as if nothing was done.
    expect(out).toEqual({ skillId: skill.id, kept: true, steps: 2 });
    expect((skill.steps as Array<{ kind: string }>).map((s) => s.kind)).toEqual(["start", "gap"]);
  });

  it("keeps what the recorder handed over at its stop, and adds no gap for a drain that ran", async () => {
    const { row, skill } = await recording();
    st.drains.push({ events: [event("input", AMOUNT)], pages: [] });
    st.left = { events: [event("click", SUBMIT)] };
    expect(await finishTakeOver(MAX, String(row.id), true)).toMatchObject({ ok: true, recorded: { skillId: skill.id } });
    // Before: the click still waiting at the stop was thrown away.
    expect((skill.steps as Array<{ title: string }>).map((s) => s.title)).toEqual(["Start on expenses.proof.test", 'Type in "Amount"', 'Click "submit"']);
  });

  // Review of Phase 5 step 2, M1: typing filled the 400 events, and Submit was lost with no gap.
  const NOTES = { ...AMOUNT, tag: "textarea", name: "Notes", type: null, hints: { ...AMOUNT.hints, tag: "textarea", type: null, label: "Notes" } };
  const keys = (n: number, control: unknown) => Array.from({ length: n }, () => event("input", control));

  it("folds a field typed key by key: 300 keystrokes, then more fields, then Submit keeps Submit", async () => {
    const { row, skill } = await recording();
    st.drains.push({ events: [...keys(300, AMOUNT), ...keys(150, NOTES), event("click", SUBMIT)], pages: [] });
    expect(await finishTakeOver(MAX, String(row.id), true)).toMatchObject({ ok: true });
    expect((skill.steps as Array<{ title: string }>).map((s) => s.title)).toEqual(["Start on expenses.proof.test", 'Type in "Amount"', 'Type in "Notes"', 'Click "submit"']);
    expect(skill.recordingFull).toBe(false);
  });

  it("folds typing across the poll's drains too", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { row, skill } = await recording();
    st.drains.push({ events: keys(200, AMOUNT), pages: [] });
    await vi.advanceTimersByTimeAsync(SKILL_LIMITS.pollMs + 10);
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
    st.drains.push({ events: [...keys(200, AMOUNT), ...keys(100, NOTES), event("click", SUBMIT)], pages: [] });
    await vi.advanceTimersByTimeAsync(SKILL_LIMITS.pollMs + 10);
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
    expect(liveBrowser(String(row.id))?.recording?.events.map((e) => e.type)).toEqual(["input", "input", "click"]);
    expect((skill.steps as Array<{ kind: string }>).map((s) => s.kind)).toEqual(["start", "type", "type", "click"]);
  });

  it("is full past what it holds, with a gap where the first event was dropped, never a silent loss", async () => {
    const { row, skill } = await recording();
    // Clicks on two fields, no step of their own and nothing to fold, then Submit.
    const clicks = Array.from({ length: SKILL_LIMITS.eventsMax }, (_, i) => event("click", i % 2 ? AMOUNT : NOTES));
    st.drains.push({ events: [...clicks, event("click", SUBMIT), event("click", SUBMIT)], pages: [] });
    expect(await finishTakeOver(MAX, String(row.id), true)).toMatchObject({ ok: true, recorded: { skillId: skill.id } });
    // Before: Submit dropped, no gap, and the draft deleted as empty.
    expect((skill.steps as Array<{ kind: string }>).map((s) => s.kind)).toEqual(["start", "gap"]);
    expect(skill.recordingFull).toBe(true);
  });

  it("stops its poll once its row is gone elsewhere, and switches the recorder off", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { row, skill } = await recording();
    bdb.t.skills = bdb.t.skills.filter((s) => s.id !== skill.id);
    st.drains.push({ events: [event("click", SUBMIT)], pages: [] });
    await vi.advanceTimersByTimeAsync(SKILL_LIMITS.pollMs + 10);
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
    expect(liveBrowser(String(row.id))?.recording).toBeNull();
    expect(st.watched).toEqual([true, false]);
    expect(row.recordingSkillId).toBeNull();
    // Nothing more is drained.
    st.drains.push({ events: [event("click", SUBMIT)], pages: [] });
    await vi.advanceTimersByTimeAsync(SKILL_LIMITS.pollMs * 3);
    expect(st.drains).toHaveLength(1);
  });

  it("writes each poll's steps from every event so far", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { skill } = await recording();
    st.drains.push({ events: [event("input", AMOUNT)], pages: [] });
    await vi.advanceTimersByTimeAsync(SKILL_LIMITS.pollMs + 10);
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
    expect((skill.steps as Array<{ kind: string }>).map((s) => s.kind)).toEqual(["start", "type"]);
    st.drains.push({ events: [event("click", SUBMIT)], pages: [] });
    await vi.advanceTimersByTimeAsync(SKILL_LIMITS.pollMs + 10);
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
    expect((skill.steps as Array<{ kind: string }>).map((s) => s.kind)).toEqual(["start", "type", "click"]);
  });
});
