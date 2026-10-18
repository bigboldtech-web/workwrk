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
  /** Phase 5 step 4: what readFollowedSkill answers, and what it was asked. */
  stillReady: { id: "sk1", version: 2 } as Row | null,
  followReads: [] as Row[],
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
  sessionNow: async () => {
    const n = h.nowQueue.length > 0 ? h.nowQueue.shift() : h.now;
    // A read that fails (last polish of Phase 4): { throws: true }.
    if (n && n.throws === true) throw new Error("The database didn't answer");
    return n;
  },
  SYSTEM_END: { id: null, type: "system" },
  GUARD_GONE_ONLY: { status: { in: ["live", "waiting", "handed_over"] } },
}));
// Phase 5 step 4: whether the skill a turn follows is still ready at its version.
vi.mock("@/lib/skills/follow", () => ({
  readFollowedSkill: async (o: Row) => {
    h.followReads.push(o);
    return h.stillReady;
  },
}));
vi.mock("@/lib/browser/shots", () => ({
  saveShot: async (a: Row) => {
    h.shots.push(a);
    return h.shotId;
  },
}));

import { BROWSER_TOOLS_DEFS, closedSentence } from "./browser-tools";
import { BrowserLost } from "@/lib/browser/cdp-driver";
import { ACTION_ERRORS, BROWSER_COPY, BROWSER_PANEL_COPY, SKILL_COPY, TEAMMATE_TOOL_ERRORS } from "./teammate-copy";
import type { TeammateBrowserContext, ToolContext, TeammateToolContext } from "./tools";
import { nextRulesVersion, putLiveBrowser, rememberLinks, resetLiveRegistryForTests, rulesVersionNow, withBrowserLock, type LiveBrowser } from "@/lib/browser/live";
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
  // The recorder (Phase 5 step 2): never on in these tests.
  watch: async () => undefined,
  drainEvents: async () => ({ events: [], pages: [] }),
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

function ctx(o: Partial<TeammateToolContext> & { tainted?: boolean; mayStart?: boolean | (() => boolean); skill?: TeammateBrowserContext["skill"]; onSkill?: TeammateBrowserContext["onSkill"] } = {}): ToolContext {
  const { tainted = false, mayStart: may = true, skill, onSkill, ...rest } = o;
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
        // Phase 5 step 4: the skill this turn follows.
        ...(skill ? { skill } : {}),
        ...(onSkill ? { onSkill } : {}),
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
  h.stillReady = { id: "sk1", version: 2 };
  h.followReads = [];
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

// Phase 5 step 4 (docs/plans/ai-teammates-phase5.md Decisions 17 and 18):
// the one widening of Decision 11, the skill's own start address as stored,
// and links that act refused while a skill runs.
describe("open_page while a turn follows a skill (Phase 5 step 4)", () => {
  const SKILL = { id: "sk1", version: 2, name: "Weekly expenses", startUrl: "http://shop.proof.test/new" };

  it("opens the skill's start address in a tainted turn, starting the browser for it and pinning the skill on it", async () => {
    h.uses = [{ ok: false, reason: "none" }];
    putLiveBrowser(live());
    // Before: linkOnly, so a Run pressed after any card could never open its start.
    expect(await run("open_page", { url: SKILL.startUrl }, ctx({ tainted: true, skill: SKILL }))).toMatchObject({ ok: true, site: "shop.proof.test" });
    expect(h.openCalls).toEqual([expect.objectContaining({ skill: { id: "sk1", version: 2 } })]);
    expect(f.navigate).toEqual(["http://shop.proof.test/new"]);
    expect(marks.starts).toBe(1);
  });

  it("opens the start in a tainted turn with a browser already open, the stored address and nothing else", async () => {
    live("http://shop.proof.test/");
    const c = ctx({ tainted: true, skill: SKILL });
    // One character more, a later page's address and a composed one: linkOnly, as Decision 11 says.
    expect(await run("open_page", { url: "http://shop.proof.test/new2" }, c)).toEqual({ error: BROWSER_COPY.linkOnly });
    expect(await run("open_page", { url: "http://shop.proof.test/list" }, c)).toEqual({ error: BROWSER_COPY.linkOnly });
    expect(await run("open_page", { url: "http://shop.proof.test/new?q=notes" }, c)).toEqual({ error: BROWSER_COPY.linkOnly });
    expect(f.navigate).toEqual([]);
    expect(await run("open_page", { url: SKILL.startUrl }, c)).toMatchObject({ ok: true });
    expect(f.navigate).toEqual(["http://shop.proof.test/new"]);
    // Without the skill, its start is a composed address like any other (the browser on another page).
    f.navigate = [];
    f.url = "http://shop.proof.test/";
    expect(await run("open_page", { url: SKILL.startUrl }, ctx({ tainted: true }))).toEqual({ error: BROWSER_COPY.linkOnly });
    expect(f.navigate).toEqual([]);
  });

  it("refuses an address that acts, by its path or its query, and a shown link whose words act, before anything starts or leaves", async () => {
    h.uses = [{ ok: false, reason: "none" }];
    const c = ctx({ tainted: true, skill: SKILL });
    for (const url of ["http://shop.proof.test/approve?id=7", "http://shop.proof.test/wf.do?method=approve&id=5"]) {
      // Before: linkOnly at best, and a shown one opened with no card.
      expect(await run("open_page", { url }, c), url).toEqual({ error: SKILL_COPY.useClickForLink });
    }
    expect([h.openCalls, f.navigate, h.accessCalls]).toEqual([[], [], 2]);
    // A link a read showed whose words act ("Approve" to /x/7): asked on its own click card.
    h.uses = [{ ok: true, row: { id: "bs1", currentSite: "shop.proof.test" } }];
    live("http://shop.proof.test/list");
    rememberLinks(lb, ["http://shop.proof.test/x/7", "http://shop.proof.test/approve?id=7"], ["http://shop.proof.test/x/7", "http://shop.proof.test/approve?id=7"]);
    expect(await run("open_page", { url: "http://shop.proof.test/x/7" }, c)).toEqual({ error: SKILL_COPY.useClickForLink });
    expect(f.navigate).toEqual([]);
    // Outside a skill neither rule applies: a shown link opens, whatever its words.
    expect(await run("open_page", { url: "http://shop.proof.test/x/7" }, ctx({ tainted: true }))).toMatchObject({ ok: true });
    expect(await run("open_page", { url: "http://shop.proof.test/approve?id=7" }, ctx({ tainted: true }))).toMatchObject({ ok: true });
    expect(f.navigate).toEqual(["http://shop.proof.test/x/7", "http://shop.proof.test/approve?id=7"]);
  });

  it("follows no skill that changed or was deleted since its answer loaded it, and opens nothing for it", async () => {
    live("http://shop.proof.test/");
    h.stillReady = null;
    const dropped: unknown[] = [];
    expect(await run("open_page", { url: SKILL.startUrl }, ctx({ tainted: true, skill: SKILL, onSkill: (s) => dropped.push(s) }))).toEqual({ error: SKILL_COPY.skillChanged });
    expect(dropped).toEqual([null]);
    expect(h.followReads[0]).toMatchObject({ id: "sk1", version: 2, userId: "me", agentId: "a1" });
    expect(f.navigate).toEqual([]);
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

  // Phase 5 step 2: a request to be shown how is decided only by Show how on its card (the record route).
  it("answer a request to be shown how with Show how, at its call and at an approval, and a fill card only from its approval", async () => {
    // Before: "This skill tool isn't ready yet."
    expect(await run("ask_to_show_me", {})).toEqual({ error: BROWSER_COPY.useShowMe });
    expect(await run("ask_to_show_me", {}, approval())).toEqual({ error: BROWSER_COPY.useShowMe });
    // Phase 5 step 4: a fill card runs only from its approval (Decision 19), never from the model's call.
    expect(await run("fill_fields", { fields: [{ element: "e1", text: "x" }] })).toEqual({ error: BROWSER_COPY.needsApproval });
    expect(f.clicks).toEqual([]);
  });

  // Phase 5 step 4: a fill card at its approval, field by field (page-calls.ts runFillOn).
  it("run a fill card from its approval on its own session: a step row a field, the count it filled, the waiting released", async () => {
    live("http://shop.proof.test/checkout");
    const email = PAGE.elements[1];
    const fill = {
      browserSessionId: "bs1",
      site: "shop.proof.test",
      pageUrl: "http://shop.proof.test/checkout",
      documentId: "doc.1",
      page: "shop.proof.test/checkout",
      inForm: true,
      shotId: null,
      shot: null,
      fields: [{ element: "e2", target: fingerprintOf(email), label: "Email", kind: "type", text: "max@proof.test" }],
      skill: { id: "sk1", version: 2, name: "Weekly expenses", steps: [1], total: 3 },
    };
    // Before: refused notYet whatever the card said.
    expect(await run("fill_fields", fill, approval())).toEqual({ ok: true, site: "shop.proof.test", filled: 1, note: SKILL_COPY.fillDone(1) });
    expect(h.steps).toEqual([{ rowId: "bs1", s: { kind: "type", site: "shop.proof.test", outcome: "ok", actionId: "act9" }, opts: {} }]);
    expect(h.useCalls[0]).toMatchObject({ purpose: "approval", browserSessionId: "bs1", runId: null });
    expect(h.released).toEqual(["bs1"]);
    // A stored card that is no fill card (no skill) runs nothing.
    expect(await run("fill_fields", { ...fill, skill: undefined }, approval())).toEqual({ error: TEAMMATE_TOOL_ERRORS.notAllowed });
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
    // Last polish of Phase 4: the held toast in the person's own words beside the teammate's.
    expect(await run("click", stored(), approval())).toEqual({ error: BROWSER_COPY.personHasIt("Max"), held: "browser_busy", forPerson: "You have the browser now. Press Done or Give it back first." });
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
    // Last polish of Phase 4: the answer's one start is used, so never "Try again in a moment".
    expect(await run("open_page", { url: "http://docs.proof.test/" }, c)).toEqual({ error: BROWSER_COPY.providerUnavailableNoOther });
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
    expect(click).toEqual({ error: BROWSER_COPY.personHasIt("Max"), held: "browser_busy", forPerson: "You have the browser now. Press Done or Give it back first." });
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
    // Polish after review round 6 of Phase 4: the person reads their own words beside the teammate's.
    expect(await run("click", card(), approval())).toEqual({ error: BROWSER_COPY.timeCap(15), forPerson: BROWSER_PANEL_COPY.stepClosed(BROWSER_PANEL_COPY.ENDED_WORDS.time_cap) });
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
    // A failed start drew no card: its own sentence since the polish after review round 6.
    for (const r of END_REASONS.filter((x) => x !== "restarted" && x !== "start_failed")) {
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

// Review round 5 of Phase 4. The sessions module is mocked here; the same
// flows over the real one are in src/lib/browser/sessions.test.ts.
describe("review round 5 of Phase 4", () => {
  /** Words that invite the model to open a new browser. */
  const INVITES = /Open a page|open_page first|start a new one|Open the page again/;
  const stoppedWords = 'The browser closed before this step, and the browser card says why: "You stopped it."';
  const held = (why: string) => `The browser closed in this answer, and the browser card says why: "${why}" A teammate doesn't open another one in the same answer. If the person wants one, they can ask in a new message.`;
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

  describe("an approved step held on a browser that ended meanwhile fails, never waits (medium 1)", () => {
    it("fails in the end's own words when a Stop closed the browser during the step's read of the page, nothing sent", async () => {
      live("http://shop.proof.test/checkout");
      const liveNow = h.now as Row;
      // Live when the step took the lock; stopped by the time its read of the page failed.
      h.nowQueue = [liveNow];
      h.now = { ...liveNow, status: "ended", endReason: "stopped" };
      f.snapshotThrows = new BrowserLost();
      // Before: { error: "The browser service didn't answer. Try again in a moment.", held: "retry_later" }, and the card went back to waiting.
      // Polish after review round 6: the person reads their own words beside the teammate's.
      expect(await run("click", card(), approval())).toEqual({ error: stoppedWords, forPerson: BROWSER_PANEL_COPY.stepClosed("You stopped it.") });
      expect(f.clicks).toEqual([]);
      expect(h.steps).toEqual([]);
    });

    it("the same when the act's input never left, and for any end, ending or ended", async () => {
      const cases: Array<[Row, string]> = [
        [{ status: "ending", endReason: "stopped" }, stoppedWords],
        [{ status: "ended", endReason: "admin_stopped" }, BROWSER_COPY.closedBecause(BROWSER_PANEL_COPY.ENDED_WORDS.admin_stopped)],
        [{ status: "ending", endReason: "time_cap" }, BROWSER_COPY.timeCap(15)],
        [{ status: "ended", endReason: "provider_ended" }, BROWSER_COPY.closedBecause(BROWSER_PANEL_COPY.ENDED_WORDS.provider_ended)],
        // An approval's continue starts tainted: never "Open the page again".
        [{ status: "ended", endReason: "restarted" }, BROWSER_COPY.restartedNoOther],
        [{ status: "ended", endReason: null }, BROWSER_COPY.closedNoOther],
      ];
      for (const [end, said] of cases) {
        live("http://shop.proof.test/checkout");
        const liveNow = { status: "live", endReason: null, lastRunId: "run1", endsBy: new Date(Date.now() + 10 * 60_000), reservedMinutes: 15 };
        h.nowQueue = [liveNow];
        h.now = { ...liveNow, ...end };
        f.act = { ok: false, code: "lost_before" };
        const out = await run("click", card(), approval());
        // Polish after review round 6: the person reads the browser card's own end line beside the teammate's sentence.
        const why = end.endReason ? (BROWSER_PANEL_COPY.ENDED_WORDS as Record<string, string>)[String(end.endReason)] : null;
        expect(out, JSON.stringify(end)).toEqual({ error: said, forPerson: BROWSER_PANEL_COPY.stepClosed(why) });
        expect(INVITES.test(said), said).toBe(false);
      }
      // Each reached the driver once and sent nothing it could not take back.
      expect(f.clicks).toHaveLength(cases.length);
    });

    it("still waits on a browser still open: the person holding it, or the provider not answering (Decision 14)", async () => {
      live("http://shop.proof.test/checkout");
      f.act = { ok: false, code: "lost_before" };
      expect(await run("click", card(), approval())).toEqual({ error: BROWSER_COPY.providerUnavailable, held: "retry_later" });
      h.now = { ...(h.now as Row), status: "handed_over" };
      h.nowQueue = [{ ...(h.now as Row), status: "live" }];
      expect(await run("click", card(), approval())).toEqual({ error: BROWSER_COPY.providerUnavailable, held: "retry_later" });
      expect(h.released).toEqual([]);
    });

    it("keeps a step sent and not confirmed failed as it was, never run again (Decision 14)", async () => {
      live("http://shop.proof.test/checkout");
      const liveNow = h.now as Row;
      h.nowQueue = [liveNow];
      h.now = { ...liveNow, status: "ended", endReason: "stopped" };
      f.act = { ok: false, code: "unknown_outcome" };
      expect(await run("click", card(), approval())).toEqual({ error: BROWSER_COPY.unknownOutcome, unknownOutcome: true });
    });
  });

  describe("a continue reads the answers it carries on (medium 2)", () => {
    const resume = (continues: string[] | undefined, o: { tainted?: boolean } = {}) => {
      const c = ctx({ trigger: "RESUME", tainted: o.tainted ?? true });
      if (continues) (c.teammate!.browser as { continues?: string[] }).continues = continues;
      return c;
    };

    it("hands the session's reads and the start the runs it continues", async () => {
      h.uses = [{ ok: false, reason: "ended", endReason: "stopped" }];
      expect(await run("read_page", {}, resume(["run0"]))).toEqual({ error: stoppedWords });
      expect(await run("open_page", { url: "http://docs.proof.test/" }, resume(["run0"]))).toEqual({ error: held("You stopped it.") });
      expect(await run("close_browser", {}, resume(["run0"]))).toEqual({ ok: true, closed: false, note: BROWSER_COPY.notOpen });
      // Before: useBrowserSession was never told, so it read only the continue's own run.
      expect(h.useCalls.map((u) => u.continues)).toEqual([["run0"], ["run0"], ["run0"]]);
      h.uses = [{ ok: false, reason: "none" }];
      live();
      expect(await run("open_page", { url: "http://docs.proof.test/" }, resume(["run0"], { tainted: false }))).toMatchObject({ ok: true });
      expect(h.openCalls[0]).toMatchObject({ runId: "run1", continues: ["run0"] });
    });

    it("tells a turn that continues nothing nothing more", async () => {
      h.uses = [{ ok: false, reason: "none" }];
      await run("read_page", {}, resume(undefined));
      await run("open_page", { url: "http://docs.proof.test/" }, ctx());
      expect(h.useCalls.every((u) => !("continues" in u))).toBe(true);
      expect(h.openCalls.every((u) => !("continues" in u))).toBe(true);
    });
  });

  describe("an answer that can start no browser is never told to open one (low 6)", () => {
    const cannot: Array<[string, ToolContext]> = [
      ["tainted", ctx({ tainted: true })],
      ["its one start used", ctx({ mayStart: false })],
    ];

    it("says a browser that closed for a reason no person chose can't be opened again in this answer", async () => {
      for (const [why, c] of cannot) {
        h.uses = [{ ok: false, reason: "ended" }];
        // Before: "The browser closed. Open a page to start a new one."
        expect(await run("read_page", {}, c), why).toEqual({ error: BROWSER_COPY.closedNoOther });
        h.uses = [{ ok: false, reason: "restarted" }];
        // Before: "The browser closed because WorkwrK restarted. Open the page again to start a new one."
        expect(await run("find_on_page", { text: "x" }, c), why).toEqual({ error: BROWSER_COPY.restartedNoOther });
        h.uses = [{ ok: false, reason: "ended", endReason: "idle" }];
        expect(await run("scroll_page", { direction: "down" }, c), why).toEqual({ error: BROWSER_COPY.closedBecause(BROWSER_PANEL_COPY.ENDED_WORDS.idle) });
      }
    });

    it("open_page after this answer's browser closed says so in the card's words, never linkOnly or oneStart, and starts nothing", async () => {
      for (const [why, c] of cannot) {
        for (const endReason of ["idle", "restarted", "provider_ended", "time_cap", "waited_too_long", "closed_by_teammate"]) {
          h.uses = [{ ok: false, reason: "ended", endReason }];
          const said = held((BROWSER_PANEL_COPY.ENDED_WORDS as Record<string, string>)[endReason]);
          // Before: linkOnly ("...or the same page again") in a tainted answer, oneStart in one that used its start.
          expect(await run("open_page", { url: "http://docs.proof.test/" }, c), `${why} ${endReason}`).toEqual({ error: said });
        }
        h.uses = [{ ok: false, reason: "ended" }];
        expect(await run("open_page", { url: "http://docs.proof.test/" }, c), why).toEqual({ error: held(BROWSER_PANEL_COPY.ENDED_WORDS.left) });
      }
      // An answer that never had a browser keeps Decision 11's and Decision 22's own sentences.
      h.uses = [{ ok: false, reason: "none" }];
      expect(await run("open_page", { url: "http://docs.proof.test/" }, ctx({ tainted: true }))).toEqual({ error: BROWSER_COPY.linkOnly });
      expect(await run("open_page", { url: "http://docs.proof.test/" }, ctx({ mayStart: false }))).toEqual({ error: BROWSER_COPY.oneStart });
      expect(h.openCalls).toEqual([]);
      expect(marks.starts).toBe(0);
    });

    it("says a lost connection, a guard gone and an end under the lock without inviting a new browser", async () => {
      for (const [why, c] of cannot) {
        // The browser service's own end, during the call.
        live("http://shop.proof.test/checkout");
        f.nav = () => ({ ok: false, code: "lost" });
        lb.links.add("http://shop.proof.test/next");
        expect(await run("open_page", { url: "http://shop.proof.test/next" }, c), why).toEqual({ error: BROWSER_COPY.closedNoOther });
        f.nav = null;
        // The guard gone from this process.
        resetLiveRegistryForTests();
        expect(await run("read_page", {}, c), why).toEqual({ error: BROWSER_COPY.restartedNoOther });
        // An end that landed while the call waited, of no known reason.
        live("http://shop.proof.test/checkout");
        h.now = { ...(h.now as Row), status: "ended", endReason: null };
        expect(await run("read_page", {}, c), why).toEqual({ error: BROWSER_COPY.closedNoOther });
        h.now = { ...(h.now as Row), status: "live" };
      }
    });

    it("says the same to open_page whose own new browser lost its connection: the answer's one start is used", async () => {
      h.uses = [{ ok: false, reason: "none" }];
      live();
      f.nav = () => ({ ok: false, code: "lost" });
      // Before: "The browser closed. Open a page to start a new one.", and a second open_page heard oneStart.
      expect(await run("open_page", { url: "http://docs.proof.test/" })).toEqual({ error: BROWSER_COPY.closedNoOther });
      expect(marks.starts).toBe(1);
    });

    it("says the same on an approval's card, whose continue starts tainted", async () => {
      // Polish after review round 6: the person reads their own words beside the teammate's.
      h.uses = [{ ok: false, reason: "ended" }];
      expect(await run("click", card(), approval())).toEqual({ error: BROWSER_COPY.closedNoOther, forPerson: BROWSER_PANEL_COPY.stepClosed(null) });
      h.uses = [{ ok: false, reason: "restarted" }];
      expect(await run("click", card(), approval())).toEqual({ error: BROWSER_COPY.restartedNoOther, forPerson: BROWSER_PANEL_COPY.stepClosed(BROWSER_PANEL_COPY.ENDED_WORDS.restarted) });
    });

    it("keeps the invitation where the answer may still start one", async () => {
      h.uses = [{ ok: false, reason: "ended" }];
      expect(await run("read_page", {})).toEqual({ error: BROWSER_COPY.browserClosed });
      h.uses = [{ ok: false, reason: "restarted" }];
      expect(await run("read_page", {})).toEqual({ error: BROWSER_COPY.restarted });
      for (const s of [BROWSER_COPY.closedNoOther, BROWSER_COPY.restartedNoOther]) {
        expect(INVITES.test(s), s).toBe(false);
        expect(BANNED_DASH.test(s), s).toBe(false);
      }
    });
  });
});

// Polish after review round 6 of Phase 4. The sessions module is mocked
// here; a Stop during an approved step over the real one is in
// src/lib/browser/sessions.test.ts.
describe("polish after review round 6 of Phase 4", () => {
  /** What the teammate is told, never shown to the person: "the person", a tool's name, what this answer may open. */
  const MODEL_WORDS = /the person|open_page|close_browser|This answer|A teammate doesn't|Open a page|start a new one/i;
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
  const words = BROWSER_PANEL_COPY.ENDED_WORDS as Record<string, string>;

  describe("an approval whose browser closed tells the person in their own words (low 1)", () => {
    it("on every path a card's step meets a closed browser, the teammate keeping its own sentence", async () => {
      const liveNow = () => ({ status: "live", endReason: null, lastRunId: "run1", endsBy: new Date(Date.now() + 10 * 60_000), reservedMinutes: 15 });
      const cases: Array<[string, () => void, string, string]> = [
        ["the card's session ended, no reason on record", () => void (h.uses = [{ ok: false, reason: "ended" }]), BROWSER_COPY.closedNoOther, BROWSER_PANEL_COPY.stepClosed(null)],
        ["the card's session ended by a restart", () => void (h.uses = [{ ok: false, reason: "restarted" }]), BROWSER_COPY.restartedNoOther, BROWSER_PANEL_COPY.stepClosed(words.restarted)],
        ["the card's session row gone", () => void (h.uses = [{ ok: false, reason: "none" }]), BROWSER_COPY.noBrowserNoOther, BROWSER_PANEL_COPY.stepClosed(null)],
        ["the card's session stopped", () => void (h.uses = [{ ok: false, reason: "ended", endReason: "stopped" }]), BROWSER_COPY.closedBecause(words.stopped), BROWSER_PANEL_COPY.stepClosed(words.stopped)],
        [
          "an end under the browser's lock",
          () => {
            live("http://shop.proof.test/checkout");
            h.now = { ...liveNow(), status: "ended", endReason: null };
          },
          BROWSER_COPY.closedNoOther,
          BROWSER_PANEL_COPY.stepClosed(null),
        ],
        [
          "the guard gone from this process",
          () => {
            resetLiveRegistryForTests();
            h.now = liveNow();
          },
          BROWSER_COPY.restartedNoOther,
          BROWSER_PANEL_COPY.stepClosed(words.restarted),
        ],
        [
          "held before anything was sent, on a browser that ended meanwhile",
          () => {
            live("http://shop.proof.test/checkout");
            h.nowQueue = [liveNow()];
            h.now = { ...liveNow(), status: "ended", endReason: null };
            f.act = { ok: false, code: "lost_before" };
          },
          BROWSER_COPY.closedNoOther,
          BROWSER_PANEL_COPY.stepClosed(null),
        ],
      ];
      for (const [why, arm, said, forPerson] of cases) {
        h.uses = [{ ok: true, row: { id: "bs1", currentSite: "shop.proof.test" } }];
        h.now = liveNow();
        h.nowQueue = [];
        f.act = null;
        arm();
        const out = await run("click", card(), approval());
        // Before: { error: <the teammate's sentence> } alone, which the card, its chat line and the Inbox showed the person.
        expect(out, why).toEqual({ error: said, forPerson });
        expect(MODEL_WORDS.test(forPerson), why).toBe(false);
        expect([BROWSER_COPY.closedNoOther, BROWSER_COPY.restartedNoOther], why).not.toContain(forPerson);
      }
    });

    it("says a browser at its most steps in the person's words too, and the teammate is never told to open a new one", async () => {
      live("http://shop.proof.test/checkout");
      h.capped = true;
      // Before: { error: "This browser took its most steps. Close it with close_browser, then open a page to start a new one." } on the card.
      expect(await run("click", card(), approval())).toEqual({ error: BROWSER_COPY.tooManyStepsNoOther, forPerson: BROWSER_PANEL_COPY.stepsUsedUp });
      expect(MODEL_WORDS.test(BROWSER_PANEL_COPY.stepsUsedUp)).toBe(false);
      expect(f.clicks).toEqual([]);
    });

    it("never hands the person's words to a turn's own call, which the model reads", async () => {
      h.uses = [{ ok: false, reason: "ended" }];
      expect(await run("read_page", {}, ctx({ tainted: true }))).toEqual({ error: BROWSER_COPY.closedNoOther });
      live("http://shop.proof.test/checkout");
      h.uses = [{ ok: true, row: { id: "bs1", currentSite: "shop.proof.test" } }];
      h.now = { ...(h.now as Row), status: "ended", endReason: "stopped" };
      expect(await run("read_page", {}, ctx({ tainted: true }))).toEqual({ error: BROWSER_COPY.closedBecause(words.stopped) });
    });
  });

  describe("a retry after a failed start (low 2)", () => {
    it("hears the start's own reason, never the browser card it never drew, and never try again", async () => {
      for (const failed of [
        { ok: false, reason: "provider_unavailable", reachedProvider: true },
        { ok: false, reason: "provider_busy", retryAfter: 20, reachedProvider: true },
        { ok: false, reason: "start_failed", reachedProvider: true },
      ]) {
        marks = { webReads: 0, starts: 0 };
        h.openCalls = [];
        const c = ctx({ mayStart: () => marks.starts === 0 });
        h.uses = [{ ok: false, reason: "none" }];
        h.opened = failed;
        const first = await run("open_page", { url: "http://docs.proof.test/" }, c);
        expect(first.error, failed.reason).toBeTruthy();
        // It reached the provider: the answer's one start (Decision 22).
        expect(marks.starts, failed.reason).toBe(1);
        // The retry reads this run's row, ended start_failed (sessions.ts runEnds).
        h.uses = [{ ok: false, reason: "ended", endReason: "start_failed" }];
        const retry = await run("open_page", { url: "http://docs.proof.test/" }, c);
        // Before: 'The browser closed in this answer, and the browser card says why: "It didn't start." A teammate doesn't open another one ...'
        expect(retry, failed.reason).toEqual({ error: BROWSER_COPY.startFailedNoOther });
        expect(String(retry.error)).not.toMatch(/browser card|Try again|closed/);
        // Every other call of the answer says the same, never "and the browser card says why".
        expect(await run("read_page", {}, c), failed.reason).toEqual({ error: BROWSER_COPY.startFailedNoOther });
        expect(h.openCalls, failed.reason).toHaveLength(1);
      }
    });

    it("lets an answer that may still start one open a page, as before", async () => {
      h.uses = [{ ok: false, reason: "ended", endReason: "start_failed" }];
      expect(await run("read_page", {})).toEqual({ error: BROWSER_COPY.noBrowserYet });
      live();
      expect(await run("open_page", { url: "http://docs.proof.test/" })).toMatchObject({ ok: true });
      expect(h.openCalls).toHaveLength(1);
    });
  });

  describe("no invitation where the answer can start no browser (low 3)", () => {
    const cannot: Array<[string, ToolContext]> = [
      ["tainted", ctx({ tainted: true })],
      ["its one start used", ctx({ mayStart: false })],
    ];

    it("a tainted answer's read with no browser never says 'Open one with open_page first'", async () => {
      h.uses = [{ ok: false, reason: "none" }];
      for (const [why, c] of cannot) {
        for (const tool of ["read_page", "find_on_page", "scroll_page", "show_page"] as const) {
          const out = await run(tool, { text: "x", direction: "down" }, c);
          // Before: "No page is open. Open one with open_page first."
          expect(out, `${why} ${tool}`).toEqual({ error: BROWSER_COPY.noBrowserNoOther });
          expect(String(out.error)).not.toContain("Open one with open_page first");
        }
      }
      // An answer that may still start one keeps the invitation.
      expect(await run("read_page", {})).toEqual({ error: BROWSER_COPY.noBrowserYet });
      expect(h.openCalls).toEqual([]);
    });

    it("at the session's most steps says to close it, never to open a page to start a new one", async () => {
      live("http://shop.proof.test/checkout");
      h.capped = true;
      for (const [why, c] of cannot) {
        // Before: "This browser took its most steps. Close it with close_browser, then open a page to start a new one."
        expect(await run("read_page", {}, c), why).toEqual({ error: BROWSER_COPY.tooManyStepsNoOther });
      }
      expect(await run("read_page", {})).toEqual({ error: BROWSER_COPY.tooManySteps });
    });
  });
});

// Last polish of Phase 4: the sentences the person or the model read that
// were untrue or in the wrong voice. The sessions module is mocked here; the
// flows over the real one are in src/lib/browser/sessions.test.ts.
describe("last polish of Phase 4", () => {
  /** What the teammate is told, never shown to the person: "the person", a tool's name, a first name, what this answer may open. */
  const MODEL_WORDS = /the person|open_page|close_browser|This answer|A teammate doesn't|Open a page|start a new one|Max/i;
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
  const liveNow = (o: Row = {}) => ({ status: "live", endReason: null, lastRunId: "run1", endsBy: new Date(Date.now() + 10 * 60_000), reservedMinutes: 15, ...o });
  const words = BROWSER_PANEL_COPY.ENDED_WORDS as Record<string, string>;
  /** The person's own lines, word for word (teammate-copy.ts BROWSER_PANEL_COPY), so a test never passes on a line that does not exist. */
  const YOU_HAVE_IT = "You have the browser now. Press Done or Give it back first.";
  const SENSITIVE_STEP = "That's a password, code or payment field, which your teammate never uses, so nothing was done.";

  describe("the person holding the browser, at an approval (item 1)", () => {
    it("holds the card with the person's own words on every path, the teammate's sentence kept beside them", async () => {
      expect(BROWSER_PANEL_COPY.youHaveIt).toBe(YOU_HAVE_IT);
      const held = { error: BROWSER_COPY.personHasIt("Max"), held: "browser_busy", forPerson: YOU_HAVE_IT };
      // The card's own session read: handed over.
      h.uses = [{ ok: false, reason: "person_has_it" }];
      expect(await run("click", card(), approval())).toEqual(held);
      // Read fresh under the lock: the row handed over, then the flag Take over sets under the lock.
      h.uses = [{ ok: true, row: { id: "bs1" } }];
      live("http://shop.proof.test/checkout");
      h.now = liveNow({ status: "handed_over" });
      // Before: { error: "Max has the browser now. Wait until they finish.", held: "browser_busy" }, the toast Max read.
      expect(await run("click", card(), approval())).toEqual(held);
      h.now = liveNow();
      lb.handedOver = true;
      expect(await run("click", card(), approval())).toEqual(held);
      expect(MODEL_WORDS.test(YOU_HAVE_IT)).toBe(false);
      expect([f.clicks, h.steps, h.released]).toEqual([[], [], []]);
    });

    it("never hands the person's words to a turn's own call, which the model reads", async () => {
      live("http://shop.proof.test/checkout");
      lb.handedOver = true;
      expect(await run("read_page", {})).toEqual({ error: BROWSER_COPY.personHasIt("Max") });
    });
  });

  describe("an approval's other refusals in the teammate's words (item 2)", () => {
    it("a password, code or payment field: the person's line, never 'Ask Max to take over'", async () => {
      live("http://shop.proof.test/checkout");
      f.act = { ok: false, code: "sensitive" };
      const out = await run("click", card(), approval());
      // Before: { error: "That's a password, code or payment field. Ask Max to take over and type it themselves." } on Max's card.
      expect(out).toEqual({ error: BROWSER_COPY.sensitiveField("Max"), forPerson: SENSITIVE_STEP });
      expect(MODEL_WORDS.test(SENSITIVE_STEP)).toBe(false);
      // Decided, nothing sent: the session waits on it no more.
      expect(h.released).toEqual(["bs1"]);
    });

    it("the person no longer someone a teammate may act for: the person's line at an approval, the teammate's alone in a turn", async () => {
      h.person = null;
      // Before: { error: "The person this teammate works for can't do that in this workspace now." } on the card.
      expect(await run("click", card(), approval())).toEqual({ error: TEAMMATE_TOOL_ERRORS.personCant, forPerson: ACTION_ERRORS.personCannot });
      expect(MODEL_WORDS.test(ACTION_ERRORS.personCannot)).toBe(false);
      expect(await run("read_page", {})).toEqual({ error: TEAMMATE_TOOL_ERRORS.personCant });
    });
  });

  describe("a failed start that used the answer's one start (item 3)", () => {
    it("never says try again, and says how long the service is busy for a new message", async () => {
      const cases: Array<[Row, string]> = [
        [{ ok: false, reason: "provider_unavailable", reachedProvider: true }, BROWSER_COPY.providerUnavailableNoOther],
        [{ ok: false, reason: "provider_busy", retryAfter: 20, reachedProvider: true }, BROWSER_COPY.providerBusyNoOther(20)],
        [{ ok: false, reason: "start_failed", reachedProvider: true }, BROWSER_COPY.startFailedNoOther],
      ];
      for (const [failed, said] of cases) {
        marks = { webReads: 0, starts: 0 };
        h.uses = [{ ok: false, reason: "none" }];
        h.opened = failed;
        const out = await run("open_page", { url: "http://docs.proof.test/" });
        // Before: "Try again in a moment." or "Try again in 20 seconds." though the answer's one start was used.
        expect(out, String(failed.reason)).toEqual({ error: said });
        expect(String(out.error)).not.toMatch(/Try again/);
        expect(marks.starts, String(failed.reason)).toBe(1);
      }
      expect(BROWSER_COPY.providerBusyNoOther(20)).toContain("after 20 seconds");
    });

    it("keeps a refusal's own words when the provider was never asked", async () => {
      h.uses = [{ ok: false, reason: "none" }];
      h.opened = { ok: false, reason: "workspace_at_once", atOnce: 2 };
      expect(await run("open_page", { url: "http://docs.proof.test/" })).toEqual({ error: BROWSER_COPY.workspaceAtOnce(2) });
      expect(marks.starts).toBe(0);
    });
  });

  describe("a browser that closed while it was starting drew no card (item 4)", () => {
    it("every later call quotes the chat's line, never the browser card's", async () => {
      h.uses = [{ ok: false, reason: "ended", endReason: "stopped", noCard: true }];
      for (const tool of ["read_page", "find_on_page", "scroll_page", "show_page"] as const) {
        // Before: 'The browser closed before this step, and the browser card says why: "You stopped it."'
        expect(await run(tool, { text: "x", direction: "down" }), tool).toEqual({ error: BROWSER_COPY.closedNoCard(words.stopped) });
      }
      // Before: 'The browser closed in this answer, and the browser card says why: "You stopped it." ...'
      expect(await run("open_page", { url: "http://docs.proof.test/" })).toEqual({ error: BROWSER_COPY.closedForAnswerNoCard(words.stopped) });
      expect(await run("open_page", { url: "http://docs.proof.test/" }, ctx({ tainted: true, mayStart: false }))).toEqual({ error: BROWSER_COPY.closedForAnswerNoCard(words.stopped) });
      expect(h.openCalls).toEqual([]);
    });

    it("a start the end met on its way says the chat's line too, and one that went live keeps the card's", async () => {
      h.uses = [{ ok: false, reason: "none" }];
      h.opened = { ok: false, reason: "closed_in_answer", endReason: "stopped", reachedProvider: true, noCard: true };
      expect(await run("open_page", { url: "http://docs.proof.test/" })).toEqual({ error: BROWSER_COPY.closedForAnswerNoCard(words.stopped) });
      // A browser that went live drew its card: its sentence as before.
      h.opened = { ok: false, reason: "closed_in_answer", endReason: "stopped" };
      expect(await run("open_page", { url: "http://docs.proof.test/" })).toEqual({ error: BROWSER_COPY.closedForAnswer(words.stopped) });
      h.uses = [{ ok: false, reason: "ended", endReason: "stopped" }];
      expect(await run("read_page", {})).toEqual({ error: BROWSER_COPY.closedBecause(words.stopped) });
    });
  });

  describe("an end that lost to another names the end that won (item 5)", () => {
    it("the time cap's own end lost to a Stop: the Stop, to the model and to the person", async () => {
      live("http://shop.proof.test/checkout");
      h.endWins = false;
      // Under the lock the row is past its time; by the time its own end is tried, the person's Stop has won.
      h.nowQueue = [liveNow({ endsBy: new Date(Date.now() - 1000) })];
      h.now = liveNow({ status: "ending", endReason: "stopped" });
      // Before: "The browser closed: it reached its 15 minutes."
      expect(await run("read_page", {})).toEqual({ error: BROWSER_COPY.closedBecause(words.stopped) });
      h.nowQueue = [liveNow({ endsBy: new Date(Date.now() - 1000) })];
      // Before: the person read "...nothing was done. Closed: it reached its time limit." after they stopped it.
      expect(await run("click", card(), approval())).toEqual({ error: BROWSER_COPY.closedBecause(words.stopped), forPerson: BROWSER_PANEL_COPY.stepClosed(words.stopped) });
      expect(h.ends.map((e) => e[1])).toEqual(["time_cap", "time_cap"]);
      expect(f.clicks).toEqual([]);
    });

    it("keeps the time cap when its own end won, or when the row can't be read after", async () => {
      live("http://shop.proof.test/checkout");
      h.now = liveNow({ endsBy: new Date(Date.now() - 1000) });
      expect(await run("read_page", {})).toEqual({ error: BROWSER_COPY.timeCap(15) });
      h.endWins = false;
      h.nowQueue = [liveNow({ endsBy: new Date(Date.now() - 1000) })];
      h.now = { throws: true };
      expect(await run("read_page", {})).toEqual({ error: BROWSER_COPY.timeCap(15) });
    });
  });

  describe("a guard gone whose restarted end lost reads the row again (item 6)", () => {
    const cases: Array<[string, Row, Row, Row]> = [
      // [why, the row after the lost end, a turn's answer, an approval's answer]
      ["still starting", liveNow({ status: "starting" }), { error: BROWSER_COPY.starting }, { error: BROWSER_COPY.starting, held: "retry_later" }],
      ["open, its end not written", liveNow(), { error: BROWSER_COPY.notReachedNow }, { error: BROWSER_COPY.notReachedNow, held: "retry_later" }],
      ["unreadable", { throws: true }, { error: BROWSER_COPY.notReachedNow }, { error: BROWSER_COPY.notReachedNow, held: "retry_later" }],
      ["held by the person", liveNow({ status: "handed_over" }), { error: BROWSER_COPY.personHasIt("Max") }, { error: BROWSER_COPY.personHasIt("Max"), held: "browser_busy", forPerson: YOU_HAVE_IT }],
    ];

    it("never says a browser still open closed, and an approval's card waits (Decision 14)", async () => {
      for (const [why, after, turn, approved] of cases) {
        resetLiveRegistryForTests();
        h.endWins = false;
        h.nowQueue = [liveNow()];
        h.now = after;
        // Before: "The browser closed. Open a page to start a new one.", and at an approval the card FAILED with "...nothing was done."
        expect(await run("read_page", {}), why).toEqual(turn);
        h.nowQueue = [liveNow()];
        expect(await run("click", card(), approval()), why).toEqual(approved);
        expect(h.released, why).toEqual([]);
      }
      expect(f.clicks).toEqual([]);
    });

    it("still says a row gone or ended closed, in its end's words", async () => {
      resetLiveRegistryForTests();
      h.endWins = false;
      h.nowQueue = [liveNow()];
      h.now = liveNow({ status: "ended", endReason: "stopped" });
      expect(await run("read_page", {})).toEqual({ error: BROWSER_COPY.closedBecause(words.stopped) });
      h.nowQueue = [liveNow()];
      h.now = null;
      expect(await run("read_page", {}, ctx({ tainted: true }))).toEqual({ error: BROWSER_COPY.closedNoOther });
      // Its own end won: restarted, as before.
      h.endWins = true;
      h.nowQueue = [];
      h.now = liveNow();
      expect(await run("read_page", {})).toEqual({ error: BROWSER_COPY.restarted });
    });
  });

  describe("a failed start told to a continue that started none itself (item 9)", () => {
    it("says this answer can't start one, never another", async () => {
      // A continue, tainted (Decision 15), told of the answer it carries on, whose start failed.
      h.uses = [{ ok: false, reason: "ended", endReason: "start_failed" }];
      const c = ctx({ tainted: true, trigger: "RESUME", browser: { tainted: true, mayStart: true, onStart: () => undefined, onWebRead: () => undefined, continues: ["run0"] } });
      const out = await run("read_page", {}, c);
      expect(out).toEqual({ error: BROWSER_COPY.startFailedNoOther });
      // Before: "The browser didn't start. This answer can't start another one. ..." to a continue that started none.
      expect(String(out.error)).not.toMatch(/another/);
      expect(await run("open_page", { url: "http://docs.proof.test/" }, c)).toEqual({ error: BROWSER_COPY.startFailedNoOther });
      expect(h.openCalls).toEqual([]);
    });
  });
});

// After the last polish of Phase 4 (its reviewer's lows): a time cap's own
// end whose swap failed on a row still open said "closed"; a card's session
// not known to be closed failed; a person with no first name read as
// " has the browser now".
describe("after the last polish of Phase 4", () => {
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
  const liveNow = (o: Row = {}) => ({ status: "live", endReason: null, lastRunId: "run1", endsBy: new Date(Date.now() + 10 * 60_000), reservedMinutes: 15, ...o });

  it("never says a browser past its time closed while its row is still open, and an approval's card waits", async () => {
    live("http://shop.proof.test/checkout");
    h.endWins = false;
    h.nowQueue = [liveNow({ endsBy: new Date(Date.now() - 1000) })];
    // The swap itself failed: the row reads back still open.
    h.now = liveNow({ endsBy: new Date(Date.now() - 1000) });
    // Before: "The browser closed: it reached its 15 minutes."
    expect(await run("read_page", {})).toEqual({ error: BROWSER_COPY.notReachedNow });
    h.nowQueue = [liveNow({ endsBy: new Date(Date.now() - 1000) })];
    // Before: the card FAILED with "...nothing was done. Closed: it reached its time limit."
    expect(await run("click", card(), approval())).toEqual({ error: BROWSER_COPY.notReachedNow, held: "retry_later" });
    expect([f.clicks, h.released]).toEqual([[], []]);
  });

  it("holds an approval whose browser couldn't be read after an end lost, and tells a turn the same, held nowhere", async () => {
    h.uses = [{ ok: false, reason: "not_reached" }];
    expect(await run("click", card(), approval())).toEqual({ error: BROWSER_COPY.notReachedNow, held: "retry_later" });
    expect(await run("read_page", {})).toEqual({ error: BROWSER_COPY.notReachedNow });
    expect(f.clicks).toEqual([]);
  });

  it("names \"The person\" when their first name is empty, never \" has the browser now\"", async () => {
    h.person = { ...(h.person as Row), firstName: "" } as never;
    live("http://shop.proof.test/checkout");
    lb.handedOver = true;
    expect(await run("read_page", {})).toEqual({ error: BROWSER_COPY.personHasIt("The person") });
    expect(await run("click", card(), approval())).toMatchObject({ error: BROWSER_COPY.personHasIt("The person"), held: "browser_busy" });
  });
});
