// A browser step's card (src/lib/agents/browser-previews.ts,
// docs/plans/ai-teammates-phase4.md step 3), with the teammate, the
// computer's access, the sessions and the pictures mocked at their module
// boundaries, the process's registry real and the driver a fake: the first
// preparation checks the page as it is now under the browser's lock (one
// step waiting at a time, an id from this very page's newest read, never a
// sensitive field) and stores what the card shows and what runs; at its
// approval the stored input is kept, the person holding the browser waits,
// and the computer's refusal says its reason.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  agent: { id: "a1", name: "Shopper", status: "ENABLED", browserSites: ["shop.proof.test"], browserTools: true } as Row | null,
  access: null as null | Row,
  /** What computerAccess answers first, read by read, before `access` (review of Phase 4 step 3). */
  accessQueue: [] as Row[],
  use: null as null | Row,
  useCalls: [] as Row[],
  waiting: null as null | Row,
  capped: false,
  shotId: "sh0123456789abcdef0123456789abcdef" as string | null,
  shots: [] as Row[],
  ends: [] as unknown[][],
  /** The session as sessionNow reads it under the lock (review round 1 of Phase 4). */
  now: null as null | Row,
  /** Whether an end this module asks for wins (after the last polish of Phase 4). */
  endWins: true,
  /** What skillsAccess answers (Phase 5 step 2). */
  skills: { ok: true } as Row,
}));

vi.mock("./browser-access", () => ({ computerAgentById: async () => h.agent }));
vi.mock("@/lib/browser/sessions", () => ({
  computerAccess: async () => (h.accessQueue.length > 0 ? h.accessQueue.shift() : h.access),
  useBrowserSession: async (a: Row) => {
    h.useCalls.push(a);
    return h.use;
  },
  waitingCardOf: async () => h.waiting,
  stepsUsedUp: async () => h.capped,
  sessionNow: async () => h.now,
  endBrowserSession: async (...a: unknown[]) => {
    h.ends.push(a);
    return h.endWins;
  },
  SYSTEM_END: { id: null, type: "system" },
  GUARD_GONE_ONLY: { status: { in: ["live", "waiting", "handed_over"] } },
}));
vi.mock("@/lib/skills/recorder", () => ({ skillsAccess: async () => h.skills }));
vi.mock("@/lib/browser/shots", () => ({
  saveShot: async (a: Row) => {
    h.shots.push(a);
    return h.shotId;
  },
}));

import { prepareBrowser } from "./browser-previews";
import type { PrepareContext } from "./previews";
import { BROWSER_COPY, BROWSER_PANEL_COPY, SKILL_ROUTE_ERRORS } from "./teammate-copy";
import { nextRulesVersion, putLiveBrowser, resetLiveRegistryForTests, rulesVersionNow, withBrowserLock, type LiveBrowser } from "@/lib/browser/live";
import { readOn } from "@/lib/browser/page-calls";
import { fingerprintOf, sealFingerprint } from "@/lib/browser/snapshot";
import { FIXTURE_SUFFIX, siteOf, type SiteRules } from "@/lib/browser/sites";
import type { BrowserHandle, RawElement, RawSnapshot } from "@/lib/browser/types";

const RULES: SiteRules = { allow: ["shop.proof.test", "login.proof.test"], block: [], appHosts: [], schemes: ["https:", "http:"], fixtureSuffix: FIXTURE_SUFFIX };
const el = (o: Partial<RawElement>): RawElement => ({ tag: "button", role: "button", name: "Place order", kind: "none", type: "submit", formHost: "shop.proof.test", href: null, twin: 0, twins: 1, anchor: "b0b0b0b0", at: 0, disabled: false, filled: false, inMainFrame: true, ...o });
const PAGE: RawSnapshot = {
  url: "http://shop.proof.test/checkout",
  title: "Checkout",
  contentType: "text/html",
  blocks: ["Checkout"],
  elements: [
    el({}),
    el({ tag: "input", role: "textbox", name: "Card number", kind: "card_number", type: "text", at: 1 }),
    el({ tag: "input", role: "textbox", name: "Name on card", kind: "text", type: "text", at: 2 }),
    el({ tag: "input", role: "textbox", name: "Nickname", kind: "text", type: "text", at: 3, filled: true }),
  ],
  links: [],
};

let url = "http://shop.proof.test/checkout";
const shots: unknown[] = [];
const handle: BrowserHandle = {
  navigate: async (u) => ({ ok: true, url: u, site: siteOf(u) ?? "" }),
  snapshot: async () => PAGE,
  find: async () => ({ matches: [] }),
  scroll: async () => ({ atEnd: false }),
  screenshot: async (o) => {
    shots.push(o);
    return { jpeg: new Uint8Array([0xff, 0xd8, 0xff]), width: 520, height: 330 };
  },
  options: async () => ({ ok: true, options: [], total: 0 }),
  click: async () => ({ ok: true, settled: true, url, site: "shop.proof.test" }),
  type: async () => ({ ok: true, settled: true, url, site: "shop.proof.test" }),
  select: async () => ({ ok: true, settled: true, url, site: "shop.proof.test" }),
  currentUrl: () => url,
  documentId: () => "doc.1",
  blank: async () => undefined,
  // The recorder (Phase 5 step 2): never on in these tests.
  watch: async () => undefined,
  drainEvents: async () => ({ events: [], pages: [] }),
  close: async () => undefined,
};

let lb: LiveBrowser;

const PERSON = { userId: "me", organizationId: "org", firstName: "Max", name: "Max Pine" };
const prep = (trigger: "CHAT" | "APPROVAL" = "CHAT"): PrepareContext =>
  ({ person: PERSON, teammate: { agentId: "a1", agentName: "Shopper", trigger }, tainted: true, taintedBy: "web", turn: trigger === "CHAT" ? { runId: "run1", sessionId: "chat1" } : undefined }) as unknown as PrepareContext;

beforeEach(async () => {
  resetLiveRegistryForTests();
  url = "http://shop.proof.test/checkout";
  shots.length = 0;
  h.agent = { id: "a1", name: "Shopper", status: "ENABLED", browserSites: ["shop.proof.test"], browserTools: true };
  h.access = { ok: true, rules: RULES, sites: ["shop.proof.test"], rulesVersion: 0 };
  h.accessQueue = [];
  h.use = { ok: true, row: { id: "bs1", organizationId: "org", userId: "me", chatSessionId: "chat1" } };
  h.useCalls = [];
  h.waiting = null;
  h.capped = false;
  h.shotId = "sh0123456789abcdef0123456789abcdef";
  h.shots = [];
  h.ends = [];
  h.endWins = true;
  h.skills = { ok: true };
  h.now = { status: "live", endReason: null, lastRunId: "run1", endsBy: new Date(Date.now() + 10 * 60_000), reservedMinutes: 15 };
  lb = { rowId: "bs1", organizationId: "org", userId: "me", agentId: "a1", handle, rules: RULES, rulesVersion: 0, links: new Set(), refs: new Map(), refsUrl: null, seq: 0, lost: false, events: [] };
  putLiveBrowser(lb);
  // The model's read of the page: the ids the card names come from it.
  await readOn(lb, 1);
});

describe("the first preparation", () => {
  it("stores what runs and shows it on a card of its own: the page, the element, the warnings, the picture and the session", async () => {
    const out = await prepareBrowser("click", { element: "e1" }, prep());
    expect(out).toMatchObject({
      risk: "IRREVERSIBLE",
      readWeb: true,
      input: {
        browserSessionId: "bs1",
        site: "shop.proof.test",
        // The origin and the sealed fingerprint (review round 1 of Phase 4, page-calls.ts and snapshot.ts sealFingerprint).
        pageUrl: "http://shop.proof.test",
        documentId: "doc.1",
        element: "e1",
        target: sealFingerprint(fingerprintOf(PAGE.elements[0])),
        warnings: ["buys", "submits"],
        shotId: "sh0123456789abcdef0123456789abcdef",
        shot: { width: 520, height: 330 },
      },
      preview: {
        title: 'Click "Place order"',
        lines: [BROWSER_COPY.pageLine("shop.proof.test/checkout"), BROWSER_COPY.elementLine('the button "Place order"'), BROWSER_COPY.buysLine, BROWSER_COPY.submitsLine, BROWSER_COPY.cantUndo],
        target: { label: "shop.proof.test" },
        shot: { id: "sh0123456789abcdef0123456789abcdef", width: 520, height: 330 },
        browser: { sessionId: "bs1", site: "shop.proof.test" },
      },
    });
    // The picture is around the element, sealed for the person (shots.ts), never in the card itself.
    expect(shots).toEqual([{ around: fingerprintOf(PAGE.elements[0]) }]);
    expect(h.shots).toEqual([expect.objectContaining({ kind: "element", row: { id: "bs1", organizationId: "org", userId: "me" } })]);
    expect(h.useCalls[0]).toMatchObject({ purpose: "model", runId: "run1" });
  });

  it("never types a card number, and asks the person to take over instead", async () => {
    expect(await prepareBrowser("type_text", { element: "e2", text: "4242424242424242" }, prep())).toEqual({ error: BROWSER_COPY.sensitiveField("Max") });
    expect(h.shots).toEqual([]);
  });

  it("refuses an id from an older read, and a second step while one waits (Decision 13)", async () => {
    url = "http://shop.proof.test/checkout?step=2";
    expect(await prepareBrowser("click", { element: "e1" }, prep())).toEqual({ error: BROWSER_COPY.staleElement });
    url = "http://shop.proof.test/checkout";
    h.waiting = { id: "act1", toolName: "click" };
    expect(await prepareBrowser("click", { element: "e1" }, prep())).toEqual({ error: BROWSER_COPY.oneStepWaits("Max") });
  });

  it("asks for a take over on its own card, by the page it is on", async () => {
    url = "http://login.proof.test/";
    const out = await prepareBrowser("ask_to_take_over", { reason: "sign_in" }, prep());
    expect(out).toMatchObject({
      input: { browserSessionId: "bs1", site: "login.proof.test", pageUrl: "http://login.proof.test", reason: "sign_in", shotId: null },
      preview: { title: BROWSER_COPY.takeOverTitle("login.proof.test"), browser: { sessionId: "bs1", site: "login.proof.test", takeOver: true } },
    });
  });

  // Phase 5 step 2: the teammate's ask to be shown how takes no words, from the model or a page.
  it("asks to be shown how on a card of a fixed sentence, by the page it is on, with no word of the page or the model", async () => {
    url = "http://login.proof.test/";
    // The model sends words anyway; they are no part of the card.
    const out = await prepareBrowser("ask_to_show_me", { job: "change the payout bank account", reason: "sign_in" }, prep());
    // Before: refused notYet, no card at all.
    expect(out).toMatchObject({
      risk: "IRREVERSIBLE",
      readWeb: true,
      input: { browserSessionId: "bs1", site: "login.proof.test", pageUrl: "http://login.proof.test", shotId: null, shot: null },
      preview: {
        title: BROWSER_COPY.showMeTitle("login.proof.test"),
        lines: [BROWSER_COPY.showMeAsk("login.proof.test"), BROWSER_COPY.showMeRecords, BROWSER_COPY.showMeBlind, BROWSER_COPY.takeOverTrust("login.proof.test"), BROWSER_COPY.pageLine("login.proof.test")],
        browser: { sessionId: "bs1", site: "login.proof.test", showMe: true },
      },
    });
    expect(JSON.stringify(out)).not.toMatch(/payout|bank|Checkout|Place order|reason/);
    expect("reason" in ("input" in out ? out.input : {})).toBe(false);
  });

  it("says the person's own words when their Teach a skill message started the turn, and refuses while skills may not be used", async () => {
    url = "http://login.proof.test/";
    const c = { ...prep(), turn: { runId: "run1", sessionId: "chat1", showMe: { name: "  submit\nan expense  " } } } as unknown as PrepareContext;
    const out = await prepareBrowser("ask_to_show_me", {}, c);
    expect(out).toMatchObject({ input: { personWhat: "submit an expense" }, preview: { lines: [BROWSER_COPY.showMePersonWhat("submit an expense"), BROWSER_COPY.showMeRecords, BROWSER_COPY.showMeBlind, BROWSER_COPY.takeOverTrust("login.proof.test"), BROWSER_COPY.pageLine("login.proof.test")], browser: { showMe: true, personWhat: "submit an expense" } } });
    h.skills = { ok: false, reason: "skills_off" };
    expect(await prepareBrowser("ask_to_show_me", {}, prep())).toEqual({ error: SKILL_ROUTE_ERRORS.skillsOff });
    h.skills = { ok: false, reason: "cant_learn" };
    expect(await prepareBrowser("ask_to_show_me", {}, prep())).toEqual({ error: SKILL_ROUTE_ERRORS.cantLearn("Shopper") });
    // Decided only by Show how: never at an approval.
    expect(await prepareBrowser("ask_to_show_me", { browserSessionId: "bs1", site: "login.proof.test", pageUrl: "http://login.proof.test/" }, prep("APPROVAL"))).toEqual({ error: BROWSER_COPY.useShowMe });
  });

  it("says why when the computer may not be used, or the browser is another teammate's", async () => {
    h.access = { ok: false, reason: "plan" };
    expect(await prepareBrowser("click", { element: "e1" }, prep())).toEqual({ error: BROWSER_COPY.plan });
    h.access = { ok: true, rules: RULES, sites: ["shop.proof.test"], rulesVersion: 0 };
    h.use = { ok: false, reason: "other_teammate", otherName: "Researcher" };
    expect(await prepareBrowser("click", { element: "e1" }, prep())).toEqual({ error: BROWSER_COPY.otherTeammate("Researcher") });
  });
});

describe("at its approval", () => {
  const stored = async () => {
    const first = await prepareBrowser("type_text", { element: "e3", text: "Max Pine" }, prep());
    if ("error" in first) throw new Error(first.error);
    return first.input;
  };

  it("keeps the stored input, cleans an edited text again and shows it whole", async () => {
    const input = await stored();
    const out = await prepareBrowser("type_text", { ...input, text: "Max\u0000 J. Pine‮" }, prep("APPROVAL"));
    expect(out).toMatchObject({ input: { ...input, text: "Max J. Pine" }, preview: { body: "Max J. Pine", title: 'Type into "Name on card"' } });
    expect(h.useCalls[1]).toMatchObject({ purpose: "approval", browserSessionId: "bs1", runId: null });
  });

  it("waits while the person has the browser, and while it is still starting", async () => {
    const input = await stored();
    h.use = { ok: false, reason: "person_has_it" };
    // Last polish of Phase 4: the toast is the person's own ("You have the browser now"), the teammate's sentence kept beside it.
    expect(await prepareBrowser("type_text", input, prep("APPROVAL"))).toEqual({ error: BROWSER_COPY.personHasIt("Max"), held: "browser_busy", forPerson: "You have the browser now. Press Done or Give it back first." });
    h.use = { ok: false, reason: "busy" };
    expect(await prepareBrowser("type_text", input, prep("APPROVAL"))).toEqual({ error: BROWSER_COPY.starting, held: "retry_later" });
  });

  it("answers the computer's real reason, and refuses a site taken away since", async () => {
    const input = await stored();
    h.access = { ok: false, reason: "workspace_off" };
    expect(await prepareBrowser("type_text", input, prep("APPROVAL"))).toEqual({ error: BROWSER_COPY.workspaceOff });
    h.access = { ok: true, rules: { ...RULES, allow: ["login.proof.test"] }, sites: ["login.proof.test"], rulesVersion: 0 };
    expect(await prepareBrowser("type_text", input, prep("APPROVAL"))).toEqual({ error: BROWSER_COPY.siteNowNotAllowed("shop.proof.test") });
    h.access = { ok: true, rules: RULES, sites: ["shop.proof.test"], rulesVersion: 0 };
    h.use = { ok: false, reason: "ended" };
    // Review round 5 of Phase 4: the continue that hears this card starts tainted, so it is never invited to open a page.
    // Polish after review round 6: the person reads their own words beside it.
    expect(await prepareBrowser("type_text", input, prep("APPROVAL"))).toEqual({ error: BROWSER_COPY.closedNoOther, forPerson: BROWSER_PANEL_COPY.stepClosed(null) });
  });

  it("never approves a take over request: Take over decides it", async () => {
    expect(await prepareBrowser("ask_to_take_over", { browserSessionId: "bs1", site: "login.proof.test", pageUrl: "http://login.proof.test/", reason: "sign_in" }, prep("APPROVAL"))).toEqual({ error: BROWSER_COPY.useTakeOver });
  });
});

// Review of Phase 4 step 3.
describe("the preparation (review of Phase 4 step 3)", () => {
  it("says on the card that a typing replaces what a filled field holds", async () => {
    const out = await prepareBrowser("type_text", { element: "e4", text: "Max" }, prep());
    expect(out).toMatchObject({ input: { replaces: true }, preview: { lines: expect.arrayContaining([BROWSER_COPY.replacesLine]) } });
    const empty = await prepareBrowser("type_text", { element: "e3", text: "Max Pine" }, prep());
    expect("preview" in empty && empty.preview.lines).not.toContain(BROWSER_COPY.replacesLine);
  });

  it("never puts back rules older than a refresh installed: it reads them again under the lock", async () => {
    const NEWER = { ...RULES, allow: ["login.proof.test"] };
    lb.rules = NEWER;
    lb.rulesVersion = nextRulesVersion();
    h.accessQueue = [{ ...h.access }, { ...h.access, rules: NEWER, rulesVersion: rulesVersionNow() }];
    expect(await prepareBrowser("click", { element: "e1" }, prep())).toEqual({ error: BROWSER_COPY.notAllowedSite("shop.proof.test") });
    // Before: the preparation's older rules replaced the newer ones, and a card was made.
    expect(lb.rules).toBe(NEWER);
    expect(h.shots).toEqual([]);
  });
});

// Review round 1 of Phase 4.
describe("the preparation reads the session again under the lock (review round 1 of Phase 4)", () => {
  it("reads and pictures nothing once a take over landed while it waited", async () => {
    let release!: () => void;
    const holding = withBrowserLock("bs1", 1000, async (b) => {
      await new Promise<void>((r) => (release = r));
      b.handedOver = true;
    });
    await new Promise((r) => setTimeout(r, 0));
    const preparing = prepareBrowser("click", { element: "e1" }, prep());
    await new Promise((r) => setTimeout(r, 5));
    release();
    await holding;
    // Before: the page the person had was read and pictured for a card.
    expect(await preparing).toEqual({ error: BROWSER_COPY.personHasIt("Max") });
    expect([shots, h.shots]).toEqual([[], []]);
  });

  it("says an end that landed while it waited by its own reason, and never ends it restarted", async () => {
    h.now = { ...h.now, status: "ended", endReason: "admin_stopped" };
    // Follow-up to review round 1 of Phase 4: one sentence of its own, not "Open a page to start a new one" before the card's line.
    const said = 'The browser closed before this step, and the browser card says why: "An Owner or Admin stopped every browser in this workspace."';
    expect(await prepareBrowser("click", { element: "e1" }, prep())).toEqual({ error: said });
    resetLiveRegistryForTests();
    expect(await prepareBrowser("click", { element: "e1" }, prep())).toEqual({ error: said });
    // Before: "WorkwrK restarted", with a restarted end asked for.
    expect(h.ends).toEqual([]);
  });

  it("refuses once another turn of the person's holds the browser", async () => {
    h.now = { ...h.now, lastRunId: "run-other" };
    expect(await prepareBrowser("click", { element: "e1" }, prep())).toEqual({ error: BROWSER_COPY.otherTurn });
    expect(h.shots).toEqual([]);
  });
});

// Review round 5 of Phase 4: a continue's preparation reads the answers it
// carries on, and a browser that closed is never said to open again where
// it can't.
describe("review round 5 of Phase 4", () => {
  const withTurn = (o: { tainted: boolean; mayStart?: boolean; continues?: string[] }): PrepareContext =>
    ({
      person: PERSON,
      teammate: { agentId: "a1", agentName: "Shopper", trigger: "RESUME" },
      tainted: o.tainted,
      taintedBy: "web",
      turn: { runId: "run1", sessionId: "chat1", ...(o.continues ? { continues: o.continues } : {}), ...(o.mayStart === undefined ? {} : { mayStart: o.mayStart }) },
    }) as unknown as PrepareContext;

  it("hands the session's read the answers a continue carries on, and nothing for a turn that continues none", async () => {
    h.use = { ok: false, reason: "ended", endReason: "stopped" };
    expect(await prepareBrowser("click", { element: "e1" }, withTurn({ tainted: true, continues: ["run0"] }))).toEqual({ error: BROWSER_COPY.closedBecause("You stopped it.") });
    expect(h.useCalls[0]).toMatchObject({ runId: "run1", continues: ["run0"], purpose: "model" });
    await prepareBrowser("click", { element: "e1" }, withTurn({ tainted: true }));
    expect(h.useCalls[1]).not.toHaveProperty("continues");
  });

  it("never invites a new browser in a turn that read anything or used its one start; keeps it where the turn may start one", async () => {
    for (const c of [withTurn({ tainted: true }), withTurn({ tainted: false, mayStart: false })]) {
      h.use = { ok: false, reason: "ended" };
      expect(await prepareBrowser("click", { element: "e1" }, c)).toEqual({ error: BROWSER_COPY.closedNoOther });
      h.use = { ok: false, reason: "restarted" };
      expect(await prepareBrowser("ask_to_take_over", { reason: "sign_in" }, c)).toEqual({ error: BROWSER_COPY.restartedNoOther });
    }
    // The guard gone from this process, in a tainted turn.
    h.use = { ok: true, row: { id: "bs1", organizationId: "org", userId: "me", chatSessionId: "chat1" } };
    resetLiveRegistryForTests();
    expect(await prepareBrowser("click", { element: "e1" }, withTurn({ tainted: true }))).toEqual({ error: BROWSER_COPY.restartedNoOther });
    h.use = { ok: false, reason: "restarted" };
    expect(await prepareBrowser("click", { element: "e1" }, withTurn({ tainted: false, mayStart: true }))).toEqual({ error: BROWSER_COPY.restarted });
  });

  it("never invites one at an approval, whose continue starts tainted", async () => {
    const input = { browserSessionId: "bs1", site: "shop.proof.test", pageUrl: "http://shop.proof.test/checkout", documentId: "doc.1", page: "shop.proof.test/checkout", element: "e1", target: fingerprintOf(el({})), role: "button", name: "Place order", shotId: null, shot: null };
    h.use = { ok: false, reason: "restarted" };
    // Polish after review round 6: the person reads their own words beside it.
    expect(await prepareBrowser("click", input, prep("APPROVAL"))).toEqual({ error: BROWSER_COPY.restartedNoOther, forPerson: BROWSER_PANEL_COPY.stepClosed("Closed: WorkwrK restarted.") });
  });
});

// Polish after review round 6 of Phase 4: at an approval the person reads
// their own words; a failed start is told in its own; and a turn that can
// start no browser is never invited to.
describe("polish after review round 6 of Phase 4", () => {
  /** What the teammate is told, never shown to the person. */
  const MODEL_WORDS = /the person|open_page|close_browser|This answer|A teammate doesn't|Open a page|start a new one/i;
  const withTurn = (o: { tainted: boolean; mayStart?: boolean }): PrepareContext =>
    ({
      person: PERSON,
      teammate: { agentId: "a1", agentName: "Shopper", trigger: "CHAT" },
      tainted: o.tainted,
      taintedBy: "web",
      turn: { runId: "run1", sessionId: "chat1", ...(o.mayStart === undefined ? {} : { mayStart: o.mayStart }) },
    }) as unknown as PrepareContext;
  const input = { browserSessionId: "bs1", site: "shop.proof.test", pageUrl: "http://shop.proof.test/checkout", documentId: "doc.1", page: "shop.proof.test/checkout", element: "e1", target: fingerprintOf(el({})), role: "button", name: "Place order", shotId: null, shot: null };

  it("tells the person at an approval in their own words, never closedNoOther, restartedNoOther or noBrowserYet", async () => {
    const cases: Array<[Row, string, string]> = [
      [{ ok: false, reason: "ended" }, BROWSER_COPY.closedNoOther, BROWSER_PANEL_COPY.stepClosed(null)],
      [{ ok: false, reason: "restarted" }, BROWSER_COPY.restartedNoOther, BROWSER_PANEL_COPY.stepClosed("Closed: WorkwrK restarted.")],
      [{ ok: false, reason: "ended", endReason: "stopped" }, BROWSER_COPY.closedBecause("You stopped it."), BROWSER_PANEL_COPY.stepClosed("You stopped it.")],
      // The card's session row gone. Before: "No page is open. Open one with open_page first." on the card.
      [{ ok: false, reason: "none" }, BROWSER_COPY.noBrowserNoOther, BROWSER_PANEL_COPY.stepClosed(null)],
    ];
    for (const [use, said, forPerson] of cases) {
      h.use = use;
      // Before: { error: <the teammate's sentence> } alone, the card's failed line and its chat line.
      expect(await prepareBrowser("click", input, prep("APPROVAL")), JSON.stringify(use)).toEqual({ error: said, forPerson });
      expect(MODEL_WORDS.test(forPerson)).toBe(false);
    }
  });

  it("a turn that can start no browser is never told to open one: no browser yet, its most steps, a failed start", async () => {
    for (const c of [withTurn({ tainted: true }), withTurn({ tainted: false, mayStart: false })]) {
      h.use = { ok: false, reason: "none" };
      // Before: "No page is open. Open one with open_page first."
      expect(await prepareBrowser("click", { element: "e1" }, c)).toEqual({ error: BROWSER_COPY.noBrowserNoOther });
      h.use = { ok: false, reason: "ended", endReason: "start_failed" };
      // Before: 'The browser closed before this step, and the browser card says why: "It didn't start."'
      expect(await prepareBrowser("click", { element: "e1" }, c)).toEqual({ error: BROWSER_COPY.startFailedNoOther });
      h.use = { ok: true, row: { id: "bs1", organizationId: "org", userId: "me", chatSessionId: "chat1" } };
      h.capped = true;
      // Before: "This browser took its most steps. Close it with close_browser, then open a page to start a new one."
      expect(await prepareBrowser("click", { element: "e1" }, c)).toEqual({ error: BROWSER_COPY.tooManyStepsNoOther });
      h.capped = false;
    }
    // A turn that may still start one keeps the invitation.
    const may = withTurn({ tainted: false, mayStart: true });
    h.use = { ok: false, reason: "none" };
    expect(await prepareBrowser("click", { element: "e1" }, may)).toEqual({ error: BROWSER_COPY.noBrowserYet });
    h.use = { ok: true, row: { id: "bs1", organizationId: "org", userId: "me", chatSessionId: "chat1" } };
    h.capped = true;
    expect(await prepareBrowser("click", { element: "e1" }, may)).toEqual({ error: BROWSER_COPY.tooManySteps });
  });
});

// Last polish of Phase 4: the first preparation invites a browser only where
// its turn says it may start one, a browser that closed while it was
// starting names the chat's line, and an approval's typing left with nothing
// to type tells the person in their own words.
describe("last polish of Phase 4", () => {
  /** Words that invite the model to open a new browser. */
  const INVITES = /Open a page|open_page first|start a new one|Open the page again/;
  const noTurn = (o: { tainted?: boolean; turn?: Row } = {}): PrepareContext =>
    ({ person: PERSON, teammate: { agentId: "a1", agentName: "Shopper", trigger: "CHAT" }, tainted: o.tainted ?? false, taintedBy: "web", ...(o.turn ? { turn: o.turn } : {}) }) as unknown as PrepareContext;

  it("never invites a browser when the turn is missing or names no mayStart, as the tools read it (item 8)", async () => {
    for (const c of [noTurn(), noTurn({ turn: { runId: "run1", sessionId: "chat1" } })]) {
      const which = JSON.stringify((c as unknown as Row).turn ?? null);
      h.use = { ok: false, reason: "none" };
      // Before: "No page is open. Open one with open_page first."
      expect(await prepareBrowser("click", { element: "e1" }, c), which).toEqual({ error: BROWSER_COPY.noBrowserNoOther });
      h.use = { ok: false, reason: "ended" };
      // Before: "The browser closed. Open a page to start a new one."
      expect(await prepareBrowser("click", { element: "e1" }, c), which).toEqual({ error: BROWSER_COPY.closedNoOther });
      h.use = { ok: false, reason: "restarted" };
      expect(await prepareBrowser("ask_to_take_over", { reason: "sign_in" }, c), which).toEqual({ error: BROWSER_COPY.restartedNoOther });
    }
    // Its most steps, in a turn that names no mayStart.
    h.use = { ok: true, row: { id: "bs1", organizationId: "org", userId: "me", chatSessionId: "chat1" } };
    h.capped = true;
    const out = await prepareBrowser("click", { element: "e1" }, noTurn({ turn: { runId: "run1", sessionId: "chat1" } }));
    expect(out).toEqual({ error: BROWSER_COPY.tooManyStepsNoOther });
    expect(INVITES.test(String((out as Row).error))).toBe(false);
    // A turn that says it may start one keeps the invitation.
    h.capped = false;
    h.use = { ok: false, reason: "none" };
    expect(await prepareBrowser("click", { element: "e1" }, noTurn({ turn: { runId: "run1", sessionId: "chat1", mayStart: true } }))).toEqual({ error: BROWSER_COPY.noBrowserYet });
  });

  it("names the chat's line for a browser that closed while it was starting, never the browser card (item 4)", async () => {
    h.use = { ok: false, reason: "ended", endReason: "stopped", noCard: true };
    // Before: 'The browser closed before this step, and the browser card says why: "You stopped it."'
    expect(await prepareBrowser("click", { element: "e1" }, prep())).toEqual({ error: BROWSER_COPY.closedNoCard("You stopped it.") });
    h.use = { ok: false, reason: "ended", endReason: "stopped" };
    expect(await prepareBrowser("click", { element: "e1" }, prep())).toEqual({ error: BROWSER_COPY.closedBecause("You stopped it.") });
  });

  it("tells the person at an approval that there was nothing to type, the teammate keeping 'Say what to type' (item 2)", async () => {
    const first = await prepareBrowser("type_text", { element: "e3", text: "Max Pine" }, prep());
    if ("error" in first) throw new Error(first.error);
    // The person's edit, cleaned, leaves nothing.
    const out = await prepareBrowser("type_text", { ...first.input, text: "\u0000\u0007" }, prep("APPROVAL"));
    // Before: { error: "Say what to type." } on the person's card.
    expect(out).toEqual({ error: BROWSER_COPY.emptyText, forPerson: "There's nothing to type, so nothing was done." });
    expect(BROWSER_PANEL_COPY.nothingToType).not.toMatch(/Say what/);
  });
});

// After the last polish of Phase 4: a guard gone whose restarted end lost on
// a row the person holds named nobody (" has the browser now"), and a card's
// own session not known to be closed waits.
describe("after the last polish of Phase 4", () => {
  it("names the person when a guard gone finds the browser in their hands", async () => {
    resetLiveRegistryForTests();
    h.endWins = false;
    h.now = { ...h.now, status: "handed_over" };
    // Before: " has the browser now. Wait until they finish."
    expect(await prepareBrowser("click", { element: "e1" }, prep())).toEqual({ error: BROWSER_COPY.personHasIt("Max") });
  });

  it("holds a card whose browser couldn't be read, never fails it", async () => {
    const input = { browserSessionId: "bs1", site: "shop.proof.test", pageUrl: "http://shop.proof.test/checkout", documentId: "doc.1", page: "shop.proof.test/checkout", element: "e1", target: fingerprintOf(el({})), role: "button", name: "Place order", shotId: null, shot: null };
    h.use = { ok: false, reason: "not_reached" };
    expect(await prepareBrowser("click", input, prep("APPROVAL"))).toEqual({ error: BROWSER_COPY.notReachedNow, held: "retry_later" });
    // A turn's first preparation is told the same, with nothing held.
    h.use = { ok: false, reason: "not_reached" };
    expect(await prepareBrowser("click", { element: "e1" }, prep())).toEqual({ error: BROWSER_COPY.notReachedNow });
  });
});
