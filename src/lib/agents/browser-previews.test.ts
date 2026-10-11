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
  use: null as null | Row,
  useCalls: [] as Row[],
  waiting: null as null | Row,
  capped: false,
  shotId: "sh0123456789abcdef0123456789abcdef" as string | null,
  shots: [] as Row[],
  ends: [] as unknown[][],
}));

vi.mock("./browser-access", () => ({ computerAgentById: async () => h.agent }));
vi.mock("@/lib/browser/sessions", () => ({
  computerAccess: async () => h.access,
  useBrowserSession: async (a: Row) => {
    h.useCalls.push(a);
    return h.use;
  },
  waitingCardOf: async () => h.waiting,
  stepsUsedUp: async () => h.capped,
  endBrowserSession: async (...a: unknown[]) => {
    h.ends.push(a);
    return true;
  },
  SYSTEM_END: { id: null, type: "system" },
  GUARD_GONE_ONLY: { status: { in: ["live", "waiting", "handed_over"] } },
}));
vi.mock("@/lib/browser/shots", () => ({
  saveShot: async (a: Row) => {
    h.shots.push(a);
    return h.shotId;
  },
}));

import { prepareBrowser } from "./browser-previews";
import type { PrepareContext } from "./previews";
import { BROWSER_COPY } from "./teammate-copy";
import { putLiveBrowser, resetLiveRegistryForTests, type LiveBrowser } from "@/lib/browser/live";
import { readOn } from "@/lib/browser/page-calls";
import { fingerprintOf } from "@/lib/browser/snapshot";
import { FIXTURE_SUFFIX, siteOf, type SiteRules } from "@/lib/browser/sites";
import type { BrowserHandle, RawElement, RawSnapshot } from "@/lib/browser/types";

const RULES: SiteRules = { allow: ["shop.proof.test", "login.proof.test"], block: [], appHosts: [], schemes: ["https:", "http:"], fixtureSuffix: FIXTURE_SUFFIX };
const el = (o: Partial<RawElement>): RawElement => ({ tag: "button", role: "button", name: "Place order", kind: "none", type: "submit", formHost: "shop.proof.test", href: null, twin: 0, disabled: false, filled: false, inMainFrame: true, ...o });
const PAGE: RawSnapshot = {
  url: "http://shop.proof.test/checkout",
  title: "Checkout",
  contentType: "text/html",
  blocks: ["Checkout"],
  elements: [
    el({}),
    el({ tag: "input", role: "textbox", name: "Card number", kind: "card_number", type: "text" }),
    el({ tag: "input", role: "textbox", name: "Name on card", kind: "text", type: "text" }),
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
  click: async () => ({ ok: true, settled: true, url, site: "shop.proof.test" }),
  type: async () => ({ ok: true, settled: true, url, site: "shop.proof.test" }),
  select: async () => ({ ok: true, settled: true, url, site: "shop.proof.test" }),
  currentUrl: () => url,
  blank: async () => undefined,
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
  h.access = { ok: true, rules: RULES, sites: ["shop.proof.test"] };
  h.use = { ok: true, row: { id: "bs1", organizationId: "org", userId: "me", chatSessionId: "chat1" } };
  h.useCalls = [];
  h.waiting = null;
  h.capped = false;
  h.shotId = "sh0123456789abcdef0123456789abcdef";
  h.shots = [];
  h.ends = [];
  lb = { rowId: "bs1", organizationId: "org", userId: "me", agentId: "a1", handle, rules: RULES, links: new Set(), refs: new Map(), refsUrl: null, seq: 0, lost: false, events: [] };
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
        pageUrl: "http://shop.proof.test/checkout",
        element: "e1",
        target: fingerprintOf(PAGE.elements[0]),
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
      input: { browserSessionId: "bs1", site: "login.proof.test", pageUrl: "http://login.proof.test/", reason: "sign_in", shotId: null },
      preview: { title: BROWSER_COPY.takeOverTitle("login.proof.test"), browser: { sessionId: "bs1", site: "login.proof.test", takeOver: true } },
    });
  });

  it("says why when the computer may not be used, or the browser is another teammate's", async () => {
    h.access = { ok: false, reason: "plan" };
    expect(await prepareBrowser("click", { element: "e1" }, prep())).toEqual({ error: BROWSER_COPY.plan });
    h.access = { ok: true, rules: RULES, sites: ["shop.proof.test"] };
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
    expect(await prepareBrowser("type_text", input, prep("APPROVAL"))).toEqual({ error: BROWSER_COPY.personHasIt("Max"), held: "browser_busy" });
    h.use = { ok: false, reason: "busy" };
    expect(await prepareBrowser("type_text", input, prep("APPROVAL"))).toEqual({ error: BROWSER_COPY.starting, held: "retry_later" });
  });

  it("answers the computer's real reason, and refuses a site taken away since", async () => {
    const input = await stored();
    h.access = { ok: false, reason: "workspace_off" };
    expect(await prepareBrowser("type_text", input, prep("APPROVAL"))).toEqual({ error: BROWSER_COPY.workspaceOff });
    h.access = { ok: true, rules: { ...RULES, allow: ["login.proof.test"] }, sites: ["login.proof.test"] };
    expect(await prepareBrowser("type_text", input, prep("APPROVAL"))).toEqual({ error: BROWSER_COPY.siteNowNotAllowed("shop.proof.test") });
    h.access = { ok: true, rules: RULES, sites: ["shop.proof.test"] };
    h.use = { ok: false, reason: "ended" };
    expect(await prepareBrowser("type_text", input, prep("APPROVAL"))).toEqual({ error: BROWSER_COPY.browserClosed });
  });

  it("never approves a take over request: Take over decides it", async () => {
    expect(await prepareBrowser("ask_to_take_over", { browserSessionId: "bs1", site: "login.proof.test", pageUrl: "http://login.proof.test/", reason: "sign_in" }, prep("APPROVAL"))).toEqual({ error: BROWSER_COPY.useTakeOver });
  });
});
