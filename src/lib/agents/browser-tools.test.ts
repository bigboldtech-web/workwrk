// The ten browser tools' handlers (src/lib/agents/browser-tools.ts,
// docs/plans/ai-teammates-phase4.md step 3), with the person, the teammate,
// the computer's access, the sessions and the pictures mocked at their
// module boundaries, the process's registry real (live.ts) and the driver a
// fake that records every navigation and act: the browser started once and
// only for an address the guard allows, only links after a read, the
// current page checked against the call's fresh rules before every read, no
// field value in a read, a picture never in an answer, acts only from their
// approval on the page they were asked on, a step lost before sending held,
// the steps written while the turn's run is open, and the guard's notes in
// the next answer.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  person: { userId: "me", organizationId: "org", firstName: "Max", name: "Max Pine" } as Row | null,
  agent: { id: "a1", name: "Shopper", status: "ENABLED", browserSites: ["shop.proof.test"], browserTools: true } as Row | null,
  access: null as null | Row,
  /** What computerAccess answers first, read by read, before `access` (review of Phase 4 step 3). */
  accessQueue: [] as Row[],
  accessCalls: 0,
  /** The session's waiting card (sessions.ts waitingCardOf). */
  waiting: null as null | Row,
  /** What useBrowserSession answers, call by call (last one repeats). */
  uses: [] as Row[],
  useCalls: [] as Row[],
  opened: { ok: true, rowId: "bs1" } as Row,
  openCalls: [] as Row[],
  steps: [] as Array<{ rowId: string; s: Row; opts: Row }>,
  sites: [] as Array<[string, string | null]>,
  ends: [] as Array<[string, string, unknown, unknown]>,
  capped: false,
  released: [] as unknown[],
  shotId: "sh0123456789abcdef0123456789abcdef" as string | null,
  shots: [] as Row[],
  /** The session as sessionNow reads it under the lock (review round 1 of Phase 4). */
  now: null as null | Row,
  /** Whether this call's own end wins (review round 4 of Phase 4: false when the person's Stop won first). */
  endWins: true,
  /** What sessionNow answers first, read by read, before `now` (review round 4 of Phase 4). */
  nowQueue: [] as Row[],
}));

vi.mock("./acting", () => ({ actingPersonFor: async () => h.person }));
vi.mock("./browser-access", () => ({ computerAgentById: async () => h.agent }));
vi.mock("@/lib/browser/sessions", () => ({
  computerAccess: async () => {
    h.accessCalls += 1;
    return h.accessQueue.length > 0 ? h.accessQueue.shift() : h.access;
  },
  waitingCardOf: async () => h.waiting,
  useBrowserSession: async (a: Row) => {
    h.useCalls.push(a);
    return h.uses.length > 1 ? h.uses.shift() : h.uses[0];
  },
  openBrowserSession: async (a: Row) => {
    h.openCalls.push(a);
    return h.opened;
  },
  recordStep: async (rowId: string, _userId: string, s: Row, opts: Row = {}) => {
    h.steps.push({ rowId, s, opts });
    return true;
  },
  setCurrentSite: async (rowId: string, site: string | null) => {
    h.sites.push([rowId, site]);
  },
  endBrowserSession: async (rowId: string, reason: string, actor: unknown, o?: unknown) => {
    h.ends.push([rowId, reason, actor, o]);
    return h.endWins;
  },
  stepsUsedUp: async () => h.capped,
  releaseWaiting: async (rowId: unknown) => {
    h.released.push(rowId);
  },
  sessionNow: async () => (h.nowQueue.length > 0 ? h.nowQueue.shift() : h.now),
  SYSTEM_END: { id: null, type: "system" },
  GUARD_GONE_ONLY: { status: { in: ["live", "waiting", "handed_over"] } },
}));
vi.mock("@/lib/browser/shots", () => ({
  saveShot: async (a: Row) => {
    h.shots.push(a);
    return h.shotId;
  },
}));

import { BROWSER_TOOLS_DEFS, closedSentence } from "./browser-tools";
import { BrowserLost } from "@/lib/browser/cdp-driver";
import { BROWSER_COPY, BROWSER_PANEL_COPY, TEAMMATE_TOOL_ERRORS } from "./teammate-copy";
import type { ToolContext, TeammateToolContext } from "./tools";
import { nextRulesVersion, putLiveBrowser, resetLiveRegistryForTests, rulesVersionNow, withBrowserLock, type LiveBrowser } from "@/lib/browser/live";
import { fingerprintOf } from "@/lib/browser/snapshot";
import { FIXTURE_SUFFIX, siteOf, type SiteRules } from "@/lib/browser/sites";
import { END_REASONS, type ActOutcome, type BrowserHandle, type ElementFingerprint, type NavOutcome, type RawElement, type RawSnapshot } from "@/lib/browser/types";

/** No long dash and no double hyphen in a sentence the copy builds. */
const BANNED_DASH = /\u2014|\u2013|--/;

const RULES: SiteRules = { allow: ["docs.proof.test", "shop.proof.test"], block: ["blocked.proof.test"], appHosts: [], schemes: ["https:", "http:"], fixtureSuffix: FIXTURE_SUFFIX };
const STALE_RULES: SiteRules = { ...RULES, allow: ["everything.proof.test"] };

const button: RawElement = { tag: "button", role: "button", name: "Place order", kind: "none", type: "submit", formHost: "shop.proof.test", href: null, twin: 0, twins: 1, anchor: "b0b0b0b0", at: 0, disabled: false, filled: false, inMainFrame: true };
const PAGE: RawSnapshot = {
  url: "http://shop.proof.test/checkout",
  title: "Checkout",
  contentType: "text/html",
  blocks: ["Gift card", "Your code is 482913"],
  elements: [button, { ...button, tag: "input", role: "textbox", name: "Email", kind: "email", type: "email", filled: true, at: 1, value: "max@proof.test" } as RawElement],
  links: [{ text: "Buy now", href: "http://shop.proof.test/buy-now?item=giftcard" }],
};

const f = {
  url: "about:blank",
  navigate: [] as string[],
  clicks: [] as ElementFingerprint[],
  nav: null as null | ((u: string) => NavOutcome),
  act: null as null | ActOutcome,
  snapshotThrows: null as null | Error,
};

const handle: BrowserHandle = {
  navigate: async (u) => {
    f.navigate.push(u);
    const out = f.nav ? f.nav(u) : ({ ok: true, url: u, site: siteOf(u) ?? "" } as NavOutcome);
    if (out.ok) f.url = out.url;
    return out;
  },
  snapshot: async () => {
    if (f.snapshotThrows) throw f.snapshotThrows;
    return PAGE;
  },
  find: async () => ({ matches: [] }),
  scroll: async () => ({ atEnd: false }),
  screenshot: async () => ({ jpeg: new Uint8Array([0xff, 0xd8, 0xff]), width: 1280, height: 800 }),
  options: async () => ({ ok: true, options: [], total: 0 }),
  click: async (t) => {
    f.clicks.push(t);
    return f.act ?? { ok: true, settled: true, url: f.url, site: siteOf(f.url) ?? "" };
  },
  type: async () => f.act ?? { ok: true, settled: true, url: f.url, site: siteOf(f.url) ?? "" },
  select: async () => f.act ?? { ok: true, settled: true, url: f.url, site: siteOf(f.url) ?? "" },
  currentUrl: () => f.url,
  documentId: () => "doc.1",
  blank: async () => {
    f.url = "about:blank";
  },
  close: async () => undefined,
};

let lb: LiveBrowser;
let marks: { webReads: number; starts: number };

function live(url = "about:blank"): LiveBrowser {
  f.url = url;
  lb = { rowId: "bs1", organizationId: "org", userId: "me", agentId: "a1", handle, rules: STALE_RULES, rulesVersion: 0, links: new Set(), refs: new Map(), refsUrl: null, seq: 0, lost: false, events: [] };
  putLiveBrowser(lb);
  return lb;
}

function ctx(o: Partial<TeammateToolContext> & { tainted?: boolean; mayStart?: boolean | (() => boolean) } = {}): ToolContext {
  const { tainted = false, mayStart: may = true, ...rest } = o;
  return {
    orgId: "org",
    userId: "me",
    teammate: {
      agentId: "a1",
      agentName: "Shopper",
      sessionId: "chat1",
      routineId: null,
      trigger: "CHAT",
      timezone: "UTC",
      runId: "run1",
      browser: {
        tainted,
        get mayStart() {
          return typeof may === "function" ? may() : may;
        },
        onStart: () => {
          marks.starts += 1;
        },
        onWebRead: () => {
          marks.webReads += 1;
        },
      },
      ...rest,
    },
  };
}

const run = (tool: keyof typeof BROWSER_TOOLS_DEFS, input: Row, c: ToolContext = ctx()) => BROWSER_TOOLS_DEFS[tool].handler(c, input) as Promise<Row>;

beforeEach(() => {
  resetLiveRegistryForTests();
  h.person = { userId: "me", organizationId: "org", firstName: "Max", name: "Max Pine" };
  h.agent = { id: "a1", name: "Shopper", status: "ENABLED", browserSites: ["shop.proof.test"], browserTools: true };
  h.access = { ok: true, rules: RULES, sites: ["docs.proof.test", "shop.proof.test"], cfg: {}, caps: {}, policy: {}, rulesVersion: 0 };
  h.accessQueue = [];
  h.accessCalls = 0;
  h.waiting = null;
  h.uses = [{ ok: true, row: { id: "bs1", currentSite: "shop.proof.test" } }];
  h.useCalls = [];
  h.opened = { ok: true, rowId: "bs1" };
  h.openCalls = [];
  h.steps = [];
  h.sites = [];
  h.ends = [];
  h.capped = false;
  h.released = [];
  h.shotId = "sh0123456789abcdef0123456789abcdef";
  h.shots = [];
  h.now = { status: "live", endReason: null, lastRunId: "run1", endsBy: new Date(Date.now() + 10 * 60_000), reservedMinutes: 15 };
  h.endWins = true;
  h.nowQueue = [];
  f.navigate = [];
  f.clicks = [];
  f.nav = null;
  f.act = null;
  f.snapshotThrows = null;
  marks = { webReads: 0, starts: 0 };
});

describe("open_page", () => {
  it("starts the browser once, for an address the guard allows, opens it and records the step while the turn's run is open", async () => {
    h.uses = [{ ok: false, reason: "none" }];
    putLiveBrowser(live());
    const out = await run("open_page", { url: "http://docs.proof.test/guide" });
    expect(out).toEqual({ ok: true, site: "docs.proof.test", note: BROWSER_COPY.openedNote });
    expect(h.openCalls).toEqual([expect.objectContaining({ chatSessionId: "chat1", runId: "run1", agent: h.agent, person: h.person })]);
    expect(marks).toEqual({ starts: 1, webReads: 1 });
    expect(h.useCalls[0]).toMatchObject({ purpose: "model", runId: "run1" });
    expect(h.steps).toEqual([{ rowId: "bs1", s: { kind: "open", site: "docs.proof.test", outcome: "ok", actionId: null }, opts: { whileOpen: { runId: "run1", personId: "me" } } }]);
    expect(h.sites).toEqual([["bs1", "docs.proof.test"]]);
    // The guard obeys this call's fresh rules (carried from step 2).
    expect(lb.rules).toBe(RULES);
  });

  it("starts nothing for an address the guard refuses, a composed one after a read, or a second start in an answer", async () => {
    h.uses = [{ ok: false, reason: "none" }];
    expect(await run("open_page", { url: "http://exfil.proof.test/?d=notes" })).toEqual({ error: BROWSER_COPY.notAllowedSite("exfil.proof.test") });
    expect(await run("open_page", { url: "http://docs.proof.test/" }, ctx({ tainted: true }))).toEqual({ error: BROWSER_COPY.linkOnly });
    expect(await run("open_page", { url: "http://docs.proof.test/" }, ctx({ mayStart: false }))).toEqual({ error: BROWSER_COPY.oneStart });
    expect(h.openCalls).toEqual([]);
    expect(marks.webReads).toBe(0);
  });

  it("answers why the browser did not start, each in its own words", async () => {
    h.uses = [{ ok: false, reason: "none" }];
    h.opened = { ok: false, reason: "workspace_at_once", atOnce: 2 };
    expect(await run("open_page", { url: "http://docs.proof.test/" })).toEqual({ error: BROWSER_COPY.workspaceAtOnce(2) });
    h.opened = { ok: false, reason: "other_teammate", otherName: "Researcher" };
    expect(await run("open_page", { url: "http://docs.proof.test/" })).toEqual({ error: BROWSER_COPY.otherTeammate("Researcher") });
    expect(marks.starts).toBe(0);
  });

  it("refuses a redirect hop the guard stopped, navigating nowhere else", async () => {
    live("http://shop.proof.test/");
    f.nav = () => ({ ok: false, code: "blocked_hop", host: "blocked.proof.test" });
    expect(await run("open_page", { url: "http://docs.proof.test/redirect-blocked" })).toEqual({ error: BROWSER_COPY.redirectRefused("blocked.proof.test") });
    expect(f.navigate).toEqual(["http://docs.proof.test/redirect-blocked"]);
    expect(h.steps[0].s).toMatchObject({ kind: "open", outcome: "refused", code: "blocked_hop" });
    // The refused host came from the page: the turn has met it.
    expect(marks.webReads).toBe(1);
  });

  it("in a turn that read anything refuses an address not seen, and opens a link a read showed", async () => {
    live("http://shop.proof.test/");
    lb.links.add("http://shop.proof.test/buy-now?item=giftcard");
    expect(await run("open_page", { url: "http://shop.proof.test/buy-now?item=giftcard&leak=notes" }, ctx({ tainted: true }))).toEqual({ error: BROWSER_COPY.linkOnly });
    expect(f.navigate).toEqual([]);
    expect(await run("open_page", { url: "http://shop.proof.test/buy-now?item=giftcard" }, ctx({ tainted: true }))).toMatchObject({ ok: true });
    expect(f.navigate).toEqual(["http://shop.proof.test/buy-now?item=giftcard"]);
  });

  it("ends the session when its connection is lost", async () => {
    live("http://shop.proof.test/");
    f.nav = () => ({ ok: false, code: "lost" });
    expect(await run("open_page", { url: "http://docs.proof.test/" })).toEqual({ error: BROWSER_COPY.browserClosed });
    expect(h.ends).toEqual([["bs1", "provider_ended", { id: null, type: "system" }, undefined]]);
  });
});

describe("the reads", () => {
  it("need a browser open", async () => {
    h.uses = [{ ok: false, reason: "none" }];
    for (const tool of ["read_page", "find_on_page", "scroll_page", "show_page"] as const) {
      expect(await run(tool, { text: "x", direction: "down" }), tool).toEqual({ error: BROWSER_COPY.noBrowserYet });
    }
    expect(h.openCalls).toEqual([]);
  });

  it("read_page hands back no field value, the codes hidden, and keeps the page's ids for the acts", async () => {
    live("http://shop.proof.test/checkout");
    const out = await run("read_page", {});
    const json = JSON.stringify(out);
    expect(json).not.toContain("max@proof.test");
    expect(json).not.toMatch(/"value"/);
    expect(json).not.toContain("482913");
    expect(out).toMatchObject({ site: "shop.proof.test", part: 1, note: BROWSER_COPY.pageNote });
    expect([...lb.refs.keys()]).toEqual(["e1", "e2"]);
    expect(lb.refsUrl).toBe("http://shop.proof.test/checkout");
    expect(marks.webReads).toBe(1);
  });

  it("checks the page it is on against the call's fresh rules first, and leaves it when they refuse it", async () => {
    live("http://shop.proof.test/checkout");
    h.access = { ...h.access, rules: { ...RULES, allow: ["docs.proof.test"] } };
    expect(await run("read_page", {})).toEqual({ error: BROWSER_COPY.siteNoLongerAllowed("shop.proof.test") });
    expect(f.url).toBe("about:blank");
    expect(h.sites).toEqual([["bs1", null]]);
    expect(marks.webReads).toBe(0);
  });

  it("show_page answers that the picture was shown, never its bytes, and keeps it for the person", async () => {
    live("http://shop.proof.test/checkout");
    const out = await run("show_page", {});
    expect(out).toEqual({ shown: true, site: "shop.proof.test", note: BROWSER_COPY.shownNote });
    expect(h.shots).toEqual([expect.objectContaining({ kind: "page", width: 1280, height: 800, row: { id: "bs1", organizationId: "org", userId: "me" } })]);
    expect(h.steps[0].s).toMatchObject({ kind: "show", outcome: "ok", shotId: "sh0123456789abcdef0123456789abcdef" });
    h.shotId = null;
    expect(await run("show_page", {})).toEqual({ error: BROWSER_COPY.noPictureNow });
  });

  it("joins the guard's notes since the last call to the answer's note", async () => {
    live("http://shop.proof.test/checkout");
    lb.events.push(BROWSER_COPY.dialogClosed);
    expect(await run("scroll_page", { direction: "down" })).toEqual({ site: "shop.proof.test", atEnd: false, note: BROWSER_COPY.dialogClosed });
  });

  it("refuses at the session's step cap and while another step holds the browser", async () => {
    live("http://shop.proof.test/checkout");
    h.capped = true;
    expect(await run("read_page", {})).toEqual({ error: BROWSER_COPY.tooManySteps });
    h.capped = false;
    let release!: () => void;
    const holding = withBrowserLock("bs1", 1000, () => new Promise<void>((r) => (release = r)));
    await new Promise((r) => setTimeout(r, 0));
    const waited = run("read_page", {});
    // The handler waits up to 20 seconds; release it within that, so it reads.
    release();
    await holding;
    expect(await waited).toMatchObject({ site: "shop.proof.test" });
  });

  it("ends a browser this process no longer guards", async () => {
    // No live entry: the guard is gone.
    expect(await run("read_page", {})).toEqual({ error: BROWSER_COPY.restarted });
    expect(h.ends).toEqual([["bs1", "restarted", { id: null, type: "system" }, { only: { status: { in: ["live", "waiting", "handed_over"] } } }]]);
  });

  it("refuses where the computer may not be used, with its real reason, before any session is read", async () => {
    h.access = { ok: false, reason: "workspace_off" };
    expect(await run("read_page", {})).toEqual({ error: BROWSER_COPY.workspaceOff });
    h.agent = null;
    expect(await run("read_page", {})).toEqual({ error: BROWSER_COPY.teammateOff });
    h.person = null;
    expect(await run("read_page", {})).toEqual({ error: TEAMMATE_TOOL_ERRORS.personCant });
    expect(h.useCalls).toEqual([]);
  });
});

describe("close_browser", () => {
  it("ends the session as the teammate for the person, even at the step cap, and says so", async () => {
    live("http://shop.proof.test/");
    h.capped = true;
    expect(await run("close_browser", {})).toEqual({ ok: true, closed: true });
    expect(h.ends).toEqual([["bs1", "closed_by_teammate", { id: "me", type: "agent" }, undefined]]);
    expect(h.steps[0].s).toMatchObject({ kind: "close", outcome: "ok" });
    h.uses = [{ ok: false, reason: "none" }];
    expect(await run("close_browser", {})).toEqual({ ok: true, closed: false, note: BROWSER_COPY.notOpen });
  });
});

describe("the acts (Decisions 12 and 14)", () => {
  const stored = () => ({
    browserSessionId: "bs1",
    site: "shop.proof.test",
    pageUrl: "http://shop.proof.test/checkout",
    documentId: "doc.1",
    page: "shop.proof.test/checkout",
    element: "e1",
    target: fingerprintOf(button),
    role: "button",
    name: "Place order",
    warnings: ["buys"],
    inForm: true,
    shotId: null,
    shot: null,
  });
  const approval = (o: Partial<TeammateToolContext> = {}) => ctx({ trigger: "APPROVAL", actionId: "act9", runId: undefined, ...o });

  it("run only from their approval", async () => {
    for (const tool of ["click", "type_text", "select_option"] as const) {
      expect(await run(tool, { element: "e1", text: "x", option: "x" }), tool).toEqual({ error: BROWSER_COPY.needsApproval });
      expect(await run(tool, stored(), ctx({ trigger: "APPROVAL" })), tool).toEqual({ error: BROWSER_COPY.needsApproval });
    }
    expect(await run("ask_to_take_over", { reason: "sign_in" })).toEqual({ error: BROWSER_COPY.useTakeOver });
    expect(await run("click", { element: "e1" }, approval())).toEqual({ error: TEAMMATE_TOOL_ERRORS.notAllowed });
    expect(f.clicks).toEqual([]);
  });

  it("act on the card's own session, page and element, record the step with the card, and release the waiting", async () => {
    live("http://shop.proof.test/checkout#pay");
    const out = await run("click", stored(), approval());
    expect(out).toEqual({ ok: true, site: "shop.proof.test", settled: true, note: BROWSER_COPY.actNote });
    expect(f.clicks).toEqual([fingerprintOf(button)]);
    expect(h.useCalls[0]).toMatchObject({ purpose: "approval", browserSessionId: "bs1", runId: null });
    // An approval is no turn: its step is written whatever any run says, with its card.
    expect(h.steps).toEqual([{ rowId: "bs1", s: { kind: "click", site: "shop.proof.test", outcome: "ok", actionId: "act9" }, opts: {} }]);
    expect(h.released).toEqual(["bs1"]);
  });

  it("do nothing on a page that moved since the card, and say so", async () => {
    live("http://shop.proof.test/cart");
    expect(await run("click", stored(), approval())).toEqual({ error: BROWSER_COPY.pageChanged });
    expect(f.clicks).toEqual([]);
    expect(h.released).toEqual(["bs1"]);
  });

  it("wait, never failing, while the person has the browser, or when it lost the step before sending anything", async () => {
    h.uses = [{ ok: false, reason: "person_has_it" }];
    expect(await run("click", stored(), approval())).toEqual({ error: BROWSER_COPY.personHasIt("Max"), held: "browser_busy" });
    h.uses = [{ ok: true, row: { id: "bs1" } }];
    live("http://shop.proof.test/checkout");
    f.act = { ok: false, code: "lost_before" };
    expect(await run("click", stored(), approval())).toEqual({ error: BROWSER_COPY.providerUnavailable, held: "retry_later" });
    // Held: nothing is on record, and the session still waits on the card.
    expect(h.steps).toEqual([]);
    expect(h.released).toEqual([]);
  });

  it("fail a step sent and not confirmed, marked so it is never run again", async () => {
    live("http://shop.proof.test/checkout");
    f.act = { ok: false, code: "unknown_outcome" };
    expect(await run("click", stored(), approval())).toEqual({ error: BROWSER_COPY.unknownOutcome, unknownOutcome: true });
  });

  it("wait when the teammate was paused since the approval's own check", async () => {
    h.agent = null;
    expect(await run("click", stored(), approval())).toEqual({ error: BROWSER_COPY.teammateOff, held: "agent_paused" });
  });
});

// Review of Phase 4 step 3.
describe("no navigation while a step waits (review of Phase 4 step 3)", () => {
  it("refuses open_page while a card of the session waits, and lets the reads go on", async () => {
    live("http://shop.proof.test/checkout");
    h.waiting = { id: "act1", toolName: "click", createdAt: new Date() };
    expect(await run("open_page", { url: "http://docs.proof.test/" })).toEqual({ error: BROWSER_COPY.oneStepWaits("Max") });
    lb.links.add("http://shop.proof.test/buy-now?item=giftcard");
    expect(await run("open_page", { url: "http://shop.proof.test/buy-now?item=giftcard" }, ctx({ tainted: true }))).toEqual({ error: BROWSER_COPY.oneStepWaits("Max") });
    // Before: both navigated, under the waiting card.
    expect(f.navigate).toEqual([]);
    expect(await run("read_page", {})).toMatchObject({ site: "shop.proof.test" });
    h.waiting = null;
    expect(await run("open_page", { url: "http://docs.proof.test/" })).toMatchObject({ ok: true });
  });
});

describe("one start an answer counts the starts that failed (review of Phase 4 step 3)", () => {
  it("counts a start that reached the provider and failed, so a second start in the answer is refused", async () => {
    h.uses = [{ ok: false, reason: "none" }];
    h.opened = { ok: false, reason: "provider_unavailable", reachedProvider: true };
    const c = ctx({ mayStart: () => marks.starts < 1 });
    expect(await run("open_page", { url: "http://docs.proof.test/" }, c)).toEqual({ error: BROWSER_COPY.providerUnavailable });
    // Before: 0, so the answer could ask the provider again and again.
    expect(marks.starts).toBe(1);
    expect(await run("open_page", { url: "http://docs.proof.test/" }, c)).toEqual({ error: BROWSER_COPY.oneStart });
    expect(h.openCalls).toHaveLength(1);
  });

  it("does not count a start the caps refused before the provider was asked", async () => {
    h.uses = [{ ok: false, reason: "none" }];
    h.opened = { ok: false, reason: "person_today" };
    await run("open_page", { url: "http://docs.proof.test/" });
    expect(marks.starts).toBe(0);
  });
});

describe("a call's rules never replace newer ones (review of Phase 4 step 3)", () => {
  const NEWER: SiteRules = { ...RULES, allow: ["docs.proof.test"] };

  it("reads the rules again under the lock when a refresh installed newer ones after the call read its own", async () => {
    live("http://shop.proof.test/checkout");
    // The call read its access (version 0, shop allowed); then the lists
    // changed and the refresh gave the guard newer rules.
    lb.rules = NEWER;
    lb.rulesVersion = nextRulesVersion();
    h.accessQueue = [{ ...h.access }, { ...h.access, rules: NEWER, rulesVersion: rulesVersionNow() }];
    expect(await run("read_page", {})).toEqual({ error: BROWSER_COPY.siteNoLongerAllowed("shop.proof.test") });
    // Before: the call's older rules were put back, and the page was read.
    expect(lb.rules).toBe(NEWER);
    expect(h.accessCalls).toBe(2);
  });

  it("reads them again when a refresh began after the call read its own, before it installed anything", async () => {
    live("http://shop.proof.test/checkout");
    nextRulesVersion();
    h.accessQueue = [{ ...h.access }, { ...h.access, rules: NEWER, rulesVersion: rulesVersionNow() }];
    expect(await run("read_page", {})).toEqual({ error: BROWSER_COPY.siteNoLongerAllowed("shop.proof.test") });
    expect(lb.rules).toBe(NEWER);
  });

  it("closes the browser whatever a read of the rules again would say: closing opens nothing", async () => {
    live("http://shop.proof.test/checkout");
    lb.rulesVersion = nextRulesVersion();
    h.accessQueue = [{ ...h.access }, { ok: false, reason: "workspace_off" }];
    expect(await run("close_browser", {})).toEqual({ ok: true, closed: true });
    expect(h.ends).toEqual([["bs1", "closed_by_teammate", { id: "me", type: "agent" }, undefined]]);
  });

  it("uses the call's own rules when nothing newer began, reading nothing again", async () => {
    live("http://shop.proof.test/checkout");
    expect(await run("read_page", {})).toMatchObject({ site: "shop.proof.test" });
    expect(lb.rules).toBe(RULES);
    expect(h.accessCalls).toBe(1);
  });

  it("refuses with the computer's reason when the read again refuses, and waits at an approval", async () => {
    live("http://shop.proof.test/checkout");
    lb.rulesVersion = nextRulesVersion();
    h.accessQueue = [{ ...h.access }, { ok: false, reason: "workspace_off" }];
    expect(await run("read_page", {})).toEqual({ error: BROWSER_COPY.workspaceOff });
    lb.rulesVersion = nextRulesVersion();
    h.accessQueue = [{ ...h.access }];
    h.agent = { ...h.agent!, browserTools: true };
    // A refresh that never settles: the approval waits rather than act on rules it cannot trust.
    const always = { ...h.access, rulesVersion: -1 };
    h.access = always;
    const card = { browserSessionId: "bs1", site: "shop.proof.test", pageUrl: "http://shop.proof.test/checkout", documentId: "doc.1", page: "shop.proof.test/checkout", element: "e1", target: fingerprintOf(button), role: "button", name: "Place order", shotId: null, shot: null };
    expect(await run("click", card, ctx({ trigger: "APPROVAL", actionId: "act9", runId: undefined }))).toEqual({ error: BROWSER_COPY.busyNow, held: "retry_later" });
    expect(f.clicks).toEqual([]);
  });
});

// Review round 1 of Phase 4.
describe("the session read again under the browser's lock (review round 1 of Phase 4)", () => {
  const card = () => ({
    browserSessionId: "bs1",
    site: "shop.proof.test",
    pageUrl: "http://shop.proof.test/checkout",
    documentId: "doc.1",
    page: "shop.proof.test/checkout",
    element: "e1",
    target: fingerprintOf(button),
    role: "button",
    name: "Place order",
    warnings: ["buys"],
    inForm: true,
    shotId: null,
    shot: null,
  });
  const approval = () => ctx({ trigger: "APPROVAL", actionId: "act9", runId: undefined });

  /**
   * A step in flight holds the lock; each call passes its checks and waits
   * on it (one at a time: vitest 3 can hand two dynamic imports of one
   * mocked module started together the real module); then the person
   * presses Take over, which sets the flag under the lock first.
   */
  async function takenOverWhileWaiting(calls: Array<() => Promise<Row>>): Promise<Row[]> {
    let release!: () => void;
    const holding = withBrowserLock("bs1", 1000, async (b) => {
      await new Promise<void>((r) => (release = r));
      b.handedOver = true;
    });
    const queued: Array<Promise<Row>> = [];
    for (const c of calls) {
      queued.push(c());
      await new Promise((r) => setTimeout(r, 5));
    }
    release();
    await holding;
    return Promise.all(queued);
  }

  it("refuses a call and an approval that waited behind a take over, the approval held so its card waits", async () => {
    live("http://shop.proof.test/checkout");
    const [read, open, click] = await takenOverWhileWaiting([() => run("read_page", {}), () => run("open_page", { url: "http://docs.proof.test/" }), () => run("click", card(), approval())]);

    // Before: the read ran on the page the person had, the open navigated under them, and the approved click went through.
    expect(read).toEqual({ error: BROWSER_COPY.personHasIt("Max") });
    expect(open).toEqual({ error: BROWSER_COPY.personHasIt("Max") });
    expect(click).toEqual({ error: BROWSER_COPY.personHasIt("Max"), held: "browser_busy" });
    expect([f.navigate, f.clicks, h.steps]).toEqual([[], [], []]);
    expect(h.released).toEqual([]);
    expect(marks.webReads).toBe(0);
  });

  it("refuses by the row read fresh too, and close_browser closes nothing while the person has it", async () => {
    live("http://shop.proof.test/checkout");
    h.now = { ...h.now, status: "handed_over" };
    expect(await run("show_page", {})).toEqual({ error: BROWSER_COPY.personHasIt("Max") });
    expect(await run("close_browser", {})).toEqual({ error: BROWSER_COPY.personHasIt("Max") });
    expect([h.shots, h.ends]).toEqual([[], []]);
  });

  it("answers a call that waited behind an end by that end's own reason, never that WorkwrK restarted", async () => {
    live("http://shop.proof.test/checkout");
    h.now = { ...h.now, status: "ending", endReason: "stopped" };
    // Before (follow-up to review round 1 of Phase 4): "The browser closed. Open a page to start a new one. You stopped it."
    expect(await run("read_page", {})).toEqual({ error: 'The browser closed before this step, and the browser card says why: "You stopped it."' });
    h.now = { ...h.now, status: "ended", endReason: "time_cap" };
    expect(await run("click", card(), approval())).toEqual({ error: BROWSER_COPY.timeCap(15) });
    // Already closed: nothing to close.
    expect(await run("close_browser", {})).toEqual({ ok: true, closed: false, note: BROWSER_COPY.notOpen });
    // Gone from this process because it ended meanwhile: its reason, and no restarted end.
    resetLiveRegistryForTests();
    h.now = { ...h.now, status: "ended", endReason: "turned_off" };
    // Before: a fresh call's refusal, "An Owner or Admin hasn't turned on the computer...".
    expect(await run("read_page", {})).toEqual({ error: BROWSER_COPY.closedBecause(BROWSER_PANEL_COPY.ENDED_WORDS.turned_off) });
    expect(h.ends).toEqual([]);
    expect([f.clicks, h.steps]).toEqual([[], []]);
  });

  it("refuses a turn's call once another turn holds the browser, and ends one whose wait ran past its time cap", async () => {
    live("http://shop.proof.test/checkout");
    h.now = { ...h.now, lastRunId: "run-other" };
    expect(await run("read_page", {})).toEqual({ error: BROWSER_COPY.otherTurn });
    h.now = { ...h.now, lastRunId: "run1", endsBy: new Date(Date.now() - 1000) };
    expect(await run("read_page", {})).toEqual({ error: BROWSER_COPY.timeCap(15) });
    expect(h.ends).toEqual([["bs1", "time_cap", { id: null, type: "system" }, undefined]]);
  });

  it("says why a start read again was refused (sessions.ts startStillAllowed)", async () => {
    h.uses = [{ ok: false, reason: "none" }];
    h.opened = { ok: false, reason: "person_cant" };
    expect(await run("open_page", { url: "http://docs.proof.test/" })).toEqual({ error: TEAMMATE_TOOL_ERRORS.personCant });
    h.opened = { ok: false, reason: "teammate_off" };
    expect(await run("open_page", { url: "http://docs.proof.test/" })).toEqual({ error: BROWSER_COPY.teammateOff });
  });

  it("says the end's own reason when the session was found ended before the lock", async () => {
    h.uses = [{ ok: false, reason: "ended", endReason: "idle" }];
    expect(await run("read_page", {})).toEqual({ error: 'The browser closed before this step, and the browser card says why: "Closed after 5 idle minutes."' });
  });
});

describe("closedSentence: a browser that ended, in one sentence of its own (follow-up to review round 1 of Phase 4)", () => {
  it("names every end's own reason as the browser card does, never a fresh call's refusal", () => {
    for (const r of END_REASONS.filter((x) => x !== "restarted")) {
      const said = closedSentence(r);
      expect(said, r).toBe(`The browser closed before this step, and the browser card says why: "${(BROWSER_PANEL_COPY.ENDED_WORDS as Record<string, string>)[r]}"`);
      // Before: "Open a page to start a new one" before the card's line, or the switch's, the plan's and a closed workspace's refusals.
      expect(said, r).not.toContain("Open a page");
      expect([BROWSER_COPY.workspaceOff, BROWSER_COPY.plan, BROWSER_COPY.workspaceClosed], r).not.toContain(said);
      expect(BANNED_DASH.test(said), r).toBe(false);
    }
  });

  it("keeps WorkwrK restarted and the time cap's minutes, and says only that it closed when no reason is known", () => {
    expect(closedSentence("restarted")).toBe(BROWSER_COPY.restarted);
    expect(closedSentence("time_cap", 15)).toBe(BROWSER_COPY.timeCap(15));
    // Before: the time cap with no minutes known said only "The browser closed. Open a page to start a new one."
    expect(closedSentence("time_cap")).toBe('The browser closed before this step, and the browser card says why: "Closed: it reached its time limit."');
    for (const r of [null, undefined, "", "nonsense", "constructor", "toString"]) expect(closedSentence(r), String(r)).toBe(BROWSER_COPY.browserClosed);
  });
});

// Review round 4 of Phase 4: a Stop holds for the rest of its answer. The
// sessions module is mocked here; the same flows over the real one are in
// src/lib/browser/sessions.test.ts.
describe("a Stop holds for the rest of its answer (review round 4 of Phase 4)", () => {
  /** Words that invite the model to open a new browser. */
  const INVITES = /Open a page|open_page first|start a new one/;
  const stoppedWords = 'The browser closed before this step, and the browser card says why: "You stopped it."';
  /** open_page refused after an end that holds, word for word (BROWSER_COPY.closedForAnswer). */
  const held = (why: string) => `The browser closed in this answer, and the browser card says why: "${why}" A teammate doesn't open another one in the same answer. If the person wants one, they can ask in a new message.`;

  it("answers a Stop that closed the connection during a call by the Stop, never 'Open a page', in every call that meets the page", async () => {
    // The person's Stop won the end, so the call's own provider_ended end does not.
    h.endWins = false;
    const liveNow = h.now as Row;
    h.now = { ...liveNow, status: "ended", endReason: "stopped" };
    const lost = new BrowserLost();
    const calls: Array<[keyof typeof BROWSER_TOOLS_DEFS, Row, () => void]> = [
      ["open_page", { url: "http://docs.proof.test/" }, () => void (f.nav = () => ({ ok: false, code: "lost" }))],
      ["read_page", {}, () => void (f.snapshotThrows = lost)],
      ["find_on_page", { text: "code" }, () => void (f.snapshotThrows = lost)],
    ];
    for (const [tool, input, arm] of calls) {
      live("http://shop.proof.test/checkout");
      // Live when the call took the lock; stopped by the time it settled.
      h.nowQueue = [liveNow];
      arm();
      const out = await run(tool, input);
      // Before: "The browser closed. Open a page to start a new one."
      expect(out, tool).toEqual({ error: stoppedWords });
      expect(INVITES.test(String(out.error)), tool).toBe(false);
      f.nav = null;
      f.snapshotThrows = null;
    }
    // Each still asked its own end first, which the Stop had already won.
    expect(h.ends.map((e) => e[1])).toEqual(["provider_ended", "provider_ended", "provider_ended"]);
  });

  it("keeps the browser service's own end, and its own sentence, as it was", async () => {
    live("http://shop.proof.test/checkout");
    h.endWins = false;
    f.nav = () => ({ ok: false, code: "lost" });
    const liveNow = h.now as Row;
    // The guard's own lost-connection end won (sessions.ts guardHooks onLost).
    h.nowQueue = [liveNow];
    h.now = { ...liveNow, status: "ending", endReason: "provider_ended" };
    expect(await run("open_page", { url: "http://docs.proof.test/" })).toEqual({ error: BROWSER_COPY.browserClosed });
    // A row already gone says only that it closed.
    h.nowQueue = [liveNow];
    h.now = null;
    expect(await run("open_page", { url: "http://docs.proof.test/" })).toEqual({ error: BROWSER_COPY.browserClosed });
  });

  it("refuses open_page in the answer whose browser a person ended, before the address, the taint or the one start, and starts nothing", async () => {
    for (const endReason of ["stopped", "admin_stopped", "turned_off", "teammate_off"]) {
      h.uses = [{ ok: false, reason: "ended", endReason }];
      const said = held((BROWSER_PANEL_COPY.ENDED_WORDS as Record<string, string>)[endReason]);
      // Before: a new browser started (useBrowserSession answered none, sessions.test.ts).
      expect(await run("open_page", { url: "http://docs.proof.test/" }), endReason).toEqual({ error: said });
      expect(await run("open_page", { url: "http://exfil.proof.test/" }, ctx({ tainted: true, mayStart: false })), endReason).toEqual({ error: said });
      expect(INVITES.test(said), endReason).toBe(false);
    }
    expect(h.openCalls).toEqual([]);
    expect(f.navigate).toEqual([]);
    expect(marks).toEqual({ starts: 0, webReads: 0 });
  });

  it("lets open_page start a new browser after an end no person chose", async () => {
    for (const endReason of ["idle", "provider_ended", "restarted", "start_failed", "time_cap", "waited_too_long", "take_over_too_long", "closed_by_teammate", null]) {
      h.uses = [{ ok: false, reason: "ended", ...(endReason ? { endReason } : {}) }];
      live();
      h.openCalls = [];
      expect(await run("open_page", { url: "http://docs.proof.test/" }), String(endReason)).toEqual({ ok: true, site: "docs.proof.test", note: BROWSER_COPY.openedNote });
      expect(h.openCalls, String(endReason)).toHaveLength(1);
    }
  });

  it("says why when the start lock finds a person's end in this answer", async () => {
    h.uses = [{ ok: false, reason: "none" }];
    h.opened = { ok: false, reason: "closed_in_answer", endReason: "stopped", reachedProvider: true };
    // Before: the refusal had no sentence of its own.
    expect(await run("open_page", { url: "http://docs.proof.test/" })).toEqual({ error: held("You stopped it.") });
    // A start the Stop met on its way counts as the answer's one start.
    expect(marks.starts).toBe(1);
  });

  it("answers every other call after the end in its end's own words", async () => {
    h.uses = [{ ok: false, reason: "ended", endReason: "stopped" }];
    for (const tool of ["read_page", "find_on_page", "scroll_page", "show_page"] as const) {
      expect(await run(tool, { text: "x", direction: "down" }), tool).toEqual({ error: stoppedWords });
    }
    expect(await run("close_browser", {})).toEqual({ ok: true, closed: false, note: BROWSER_COPY.notOpen });
  });
});
