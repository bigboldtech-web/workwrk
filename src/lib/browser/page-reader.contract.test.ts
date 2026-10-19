// The page reader's own lines, run (src/lib/browser/page-reader.ts,
// docs/plans/ai-teammates-phase5.md Decision 18): a link that may act is
// listed among the controls too, marked `followable`, after every control,
// by a prefilter that is a superset of the server's exact rule; a link that
// does not act is never a control. The script runs in a DOM double with the
// real naming rules (NAMING_SOURCE): only how the browser renders (whether a
// text is seen, a control shows, a list shows) is answered by a stub, and an
// element is hidden only by its own `gone` flag (display none). Then the
// whole way, through the real driver over a fake connection: the read the
// model gets, a click card's preparation on a link, its step line in a skill
// run, and its approval, which finds the link again by its fingerprint,
// clicks it, and asks the guard about the page it goes to.

import { describe, expect, it } from "vitest";
import { BROWSER_COPY, SKILL_COPY } from "@/lib/agents/teammate-copy";
import { browserCard, type BrowserCardInput } from "@/lib/agents/browser-rules";
import { matchStep, stepsFromRecording } from "@/lib/skills/steps";
import type { RecordedControl, RecordedEvent } from "@/lib/skills/types";
import type { Cdp } from "./cdp";
import { attachBrowser, type GuardHooks } from "./cdp-driver";
import { ADDRESS_ACTION_WORDS, actingAddress, actingWords } from "./classes";
import type { LiveBrowser } from "./live";
import { actingLinkRefusal, prepareStepOn, readOn, runStepOn } from "./page-calls";
import { NAMING_SOURCE, READER_SOURCE } from "./page-reader";
import type { shapeSnapshot } from "./snapshot";
import { FIXTURE_SUFFIX, type SiteRules, type SiteVerdict } from "./sites";

// ── The DOM double ──────────────────────────────────────────────────

const INLINE = new Set(["A", "SPAN", "LABEL", "IMG", "B"]);

class Txt {
  readonly nodeType = 3;
  parentElement: El | null = null;
  parentNode: El | null = null;
  constructor(public nodeValue: string) {}
}

class El {
  readonly nodeType = 1;
  readonly namespaceURI = "http://www.w3.org/1999/xhtml";
  childNodes: Array<El | Txt> = [];
  parentElement: El | null = null;
  parentNode: El | null = null;
  shadowRoot = null;
  isContentEditable = false;
  /** The double's display none. */
  gone = false;
  constructor(
    private readonly page: Page,
    readonly tagName: string,
    readonly attrs: Record<string, string> = {},
  ) {}
  get localName(): string {
    return this.tagName.toLowerCase();
  }
  /** As a browser gives it: an anchor's address resolved against the page, "" with none; nothing on any other element. */
  get href(): string | undefined {
    if (this.tagName !== "A") return undefined;
    const h = this.attrs.href;
    if (h === undefined) return "";
    try {
      return new URL(h, this.page.url).href;
    } catch {
      return h;
    }
  }
  get id(): string {
    return this.attrs.id ?? "";
  }
  get textContent(): string {
    return this.childNodes.map((k) => (k instanceof Txt ? k.nodeValue : k.textContent)).join("");
  }
  getAttribute(n: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null;
  }
  hasAttribute(n: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.attrs, n);
  }
  getRootNode(): unknown {
    return this.page.doc;
  }
  matches(sel: string): boolean {
    if (sel === ":disabled") return false;
    throw new Error(`the double reads no selector ${sel}`);
  }
  closest(sel: string): El | null {
    if (this.localName === sel) return this;
    return this.parentElement ? this.parentElement.closest(sel) : null;
  }
  descendants(): El[] {
    return this.childNodes.flatMap((k) => (k instanceof El ? [k, ...k.descendants()] : []));
  }
  querySelector(sel: string): El | null {
    if (sel !== "img[alt]") throw new Error(`the double reads no selector ${sel}`);
    return this.descendants().find((e) => e.tagName === "IMG" && e.hasAttribute("alt")) ?? null;
  }
  getBoundingClientRect() {
    return { left: 10, top: 10, right: 110, bottom: 30, width: 100, height: 20, x: 10, y: 10 };
  }
  /** Where a click lands next (deepHit): the control just scrolled into view. */
  scrollIntoView(): void {
    this.page.placed = this;
  }
  append(...kids: Array<El | Txt>): this {
    for (const k of kids) {
      k.parentElement = this;
      k.parentNode = this;
      this.childNodes.push(k);
    }
    return this;
  }
}

class Page {
  placed: El | null = null;
  readonly html: El;
  readonly body: El;
  readonly doc: Record<string, unknown>;
  readonly win: Record<string, unknown>;
  constructor(readonly url: string) {
    this.html = new El(this, "HTML");
    this.body = new El(this, "BODY");
    this.html.append(this.body);
    this.doc = {
      nodeType: 9,
      documentElement: this.html,
      body: this.body,
      contentType: "text/html",
      title: "My expenses",
      URL: url,
      baseURI: url,
      createRange: () => ({}),
      elementFromPoint: () => this.placed,
      getElementById: (id: string) => this.html.descendants().find((e) => e.id === id) ?? null,
    };
    this.win = {
      scrollX: 0,
      scrollY: 0,
      innerWidth: 1280,
      innerHeight: 800,
      scrollBy: () => undefined,
      getComputedStyle: (el: El) => ({
        display: el.gone ? "none" : INLINE.has(el.tagName) ? "inline" : "block",
        visibility: "visible",
        opacity: "1",
        clip: "auto",
        clipPath: "none",
        transform: "none",
        position: "static",
        overflow: "visible",
        overflowX: "visible",
        overflowY: "visible",
        contain: "none",
      }),
    };
  }
  /** An element: attributes, then children, a string a text. */
  h(tag: string, attrs: Record<string, string> = {}, ...kids: Array<El | string>): El {
    return new El(this, tag.toUpperCase(), attrs).append(...kids.map((k) => (typeof k === "string" ? new Txt(k) : k)));
  }
}

/** How the browser renders, answered by the double: every text is seen, every control and list shows. The naming rules stay real. */
const RENDER = `
  function textSeen(node) { return !!node.parentElement; }
  function controlShows() { return true; }
  function listShows() { return true; }
`;

type Reader = (mode: string, arg: Record<string, unknown>) => Record<string, unknown>;

/** The reader script as cdp-driver.ts runs it, on this page. */
function readerOn(page: Page): Reader {
  const src = READER_SOURCE.replace(NAMING_SOURCE, NAMING_SOURCE + RENDER);
  return new Function("document", "window", "location", `return ${src};`)(page.doc, page.win, { href: page.url }) as Reader;
}

const LIST = "http://expenses.proof.test/list";

/** The expense fixture's /list (scripts/browser-stand-in.mjs): a nav bar, a "More" menu, and rows with "Approve" and "Open" links that act by a GET. */
function listPage(): Page {
  const p = new Page(LIST);
  const menu = p.h("div", { role: "menu", id: "more-menu", hidden: "" }, p.h("button", { type: "button", role: "menuitem" }, "Duplicate"), p.h("button", { type: "button", role: "menuitem" }, "Delete draft"));
  menu.gone = true;
  const row = (id: string, words: string) =>
    p.h("tr", {}, p.h("td", {}, p.h("a", { href: `/expense/${id}` }, words)), p.h("td", {}, p.h("a", { href: `/approve?id=${id}` }, "Approve")), p.h("td", {}, p.h("a", { href: `/wf.do?method=approve&id=${id}` }, "Open")));
  p.body.append(
    p.h(
      "header",
      {},
      p.h("nav", { "aria-label": "Main" }, p.h("a", { href: "/reports" }, "Reports"), " ", p.h("a", { href: "/list" }, "My expenses")),
      p.h("div", {}, p.h("button", { type: "button", id: "more", "aria-haspopup": "menu" }, "More"), menu),
    ),
    p.h("h1", { id: "list-title" }, "My expenses"),
    p.h("table", {}, p.h("tbody", {}, row("101", "Jane Doe, sick leave, 3 days"), row("102", "Lee Park, train to Leeds"))),
  );
  return p;
}

type ReadEl = { i: number; tag: string; role: string; name: string; href: string | null; followable?: boolean };

const elementsOf = (out: Record<string, unknown>) => out.elements as ReadEl[];

// ── The reader ──────────────────────────────────────────────────────

describe("the reader lists a link that may act among the controls (Phase 5 Decision 18)", () => {
  it("puts the links that may act after every control, marked followable, and keeps them among the links", () => {
    const out = readerOn(listPage())("read", {});
    const els = elementsOf(out);
    // Before: only "More"; "Approve" and "Open" could not be clicked at all.
    expect(els.map((e) => [e.i, e.role, e.name, e.followable === true])).toEqual([
      [0, "button", "More", false],
      [1, "link", "Approve", true],
      [2, "link", "Open", true],
      [3, "link", "Approve", true],
      [4, "link", "Open", true],
    ]);
    expect(els.slice(1).map((e) => e.href)).toEqual([
      "http://expenses.proof.test/approve?id=101",
      "http://expenses.proof.test/wf.do?method=approve&id=101",
      "http://expenses.proof.test/approve?id=102",
      "http://expenses.proof.test/wf.do?method=approve&id=102",
    ]);
    // Every followable link is still among the links, in order; the hidden menu's items are nowhere.
    expect((out.links as Array<{ text: string }>).map((l) => l.text)).toEqual(["Reports", "My expenses", "Jane Doe, sick leave, 3 days", "Approve", "Open", "Lee Park, train to Leeds", "Approve", "Open"]);
    expect(JSON.stringify(out)).not.toMatch(/Duplicate|Delete draft/);
  });

  it("leaves every control's index and a find's nearest control as they were, the links counted after them", () => {
    const read = readerOn(listPage());
    expect(elementsOf(read("read", {}))[0]).toMatchObject({ i: 0, name: "More", followable: false });
    // Words after the last control, inside a link: the nearest control is still "More", never a link listed after it.
    expect(read("find", { text: "Lee Park" })).toEqual({ matches: [{ text: "Lee Park, train to Leeds", near: 0 }] });
    // A link is located by its own index, as a control is.
    expect(read("locate", { i: 2, tag: "a", name: "Open", anchor: (elementsOf(read("read", {}))[2] as unknown as { anchor: string }).anchor })).toMatchObject({ ok: true });
    expect(read("locate", { i: 2, tag: "a", name: "Approve" })).toEqual({ ok: false, code: "changed" });
  });

  // Review of Phase 5 step 6, M2: past 400 controls the links that act were never described.
  it("describes the links that may act beside a page's 400 controls, never pushed out by them", () => {
    const p = new Page(LIST);
    p.body.append(...Array.from({ length: 401 }, (_, i) => p.h("button", { type: "button" }, `Details ${i}`)), p.h("a", { href: "/approve?id=1" }, "Approve"), p.h("a", { href: "/approve?id=2" }, "Approve"));
    const els = elementsOf(readerOn(p)("read", {}));
    // Before: 400 controls and no link.
    expect(els).toHaveLength(402);
    expect(els[399]).toMatchObject({ i: 399, name: "Details 399" });
    expect(els.slice(400).map((e) => [e.i, e.name, e.followable])).toEqual([
      [401, "Approve", true],
      [402, "Approve", true],
    ]);
  });

  it("is given the address action words from classes.ts, never a list of its own", () => {
    expect(READER_SOURCE).toContain(`var ACT_WORDS = ${JSON.stringify(ADDRESS_ACTION_WORDS)};`);
    // The naming rules, which the recorder shares, are untouched by it.
    expect(NAMING_SOURCE).not.toMatch(/ACT_WORDS|mayAct/);
  });

  it("lets through every link the server's rule says acts, by its words, its address or a name it has no text for, and not plain ones", () => {
    // `listed`: what the rough prefilter lets through; every link that acts is among them.
    const p = new Page(LIST);
    const hidden = p.h("span", {}, "x".repeat(400));
    hidden.gone = true;
    const samples: Array<{ name: string; link: El; acts: boolean; listed?: boolean }> = [
      { name: "Approve", link: p.h("a", { href: "/x/7" }, "Approve"), acts: true },
      { name: "Open", link: p.h("a", { href: "/wf.do?method=approve&id=5" }, "Open"), acts: true },
      { name: "Leave", link: p.h("a", { href: "/Leave/ApproveLeave/5" }, "Leave"), acts: true },
      { name: "All", link: p.h("a", { href: "/timesheets/approveAll" }, "All"), acts: true },
      { name: "Go", link: p.h("a", { href: "/approveRequest.do" }, "Go"), acts: true },
      { name: "Members", link: p.h("a", { href: "/members/5/deactivate" }, "Members"), acts: true },
      { name: "Mark all as read", link: p.h("a", { href: "/inbox" }, "Mark all as read"), acts: true },
      { name: "PAY NOW", link: p.h("a", { href: "/bills/3" }, "PAY NOW"), acts: true },
      { name: "Odd", link: p.h("a", { href: "/x?a=%E9" }, "Odd"), acts: true },
      { name: "Next", link: p.h("a", { href: "/%61pprove" }, "Next"), acts: true },
      { name: "Invoice", link: p.h("a", { href: "/app#/invoices/7/approve" }, "Invoice"), acts: true },
      // Named by words its text lacks: an aria-label, an aria-labelledby target, an image's alt on a button-role link.
      { name: "Approve expense 9", link: p.h("a", { href: "/x/9", "aria-label": "Approve expense 9" }, p.h("img", { src: "a.png" })), acts: true },
      { name: "Reject", link: p.h("a", { href: "/x/10", "aria-labelledby": "lbl10" }), acts: true },
      { name: "Delete", link: p.h("a", { href: "/x/11", role: "button" }, p.h("img", { alt: "Delete" })), acts: true },
      // Its seen words come after more than a name's worth of words nobody sees.
      { name: "Confirm", link: p.h("a", { href: "/x/13" }, hidden, "Confirm"), acts: true },
      // Through the prefilter ("post", "send", "add" anywhere), and not acting: the server drops them (snapshot.ts actingLink).
      { name: "Posts", link: p.h("a", { href: "/posts" }, "Posts"), acts: false, listed: true },
      { name: "A page that sends you away", link: p.h("a", { href: "/js-away" }, "A page that sends you away"), acts: false, listed: true },
      { name: "Your address", link: p.h("a", { href: "/profile" }, "Your address"), acts: false, listed: true },
      { name: "Home", link: p.h("a", { href: "/" }, "Home"), acts: false },
      { name: "The guide", link: p.h("a", { href: "/guide" }, "The guide"), acts: false },
      { name: "My expenses", link: p.h("a", { href: "/list" }, "My expenses"), acts: false },
    ];
    p.body.append(p.h("span", { id: "lbl10" }, "Reject"), ...samples.map((s) => p.h("p", {}, s.link)));
    const els = elementsOf(readerOn(p)("read", {}));
    for (const s of samples) {
      const href = s.link.href ?? "";
      // The server's own rule (snapshot.ts actingLink), by the name a read gives and the address.
      expect(actingWords(s.name) !== null || actingAddress(href), s.name).toBe(s.acts);
      const listed = els.find((e) => e.href === href);
      if (s.acts || s.listed) expect(listed, s.name).toMatchObject({ name: s.name, followable: true });
      else expect(listed, s.name).toBeUndefined();
    }
  });
});

// ── The whole way, through the real driver ──────────────────────────

class FakeCdp implements Cdp {
  sent: Array<{ method: string; params: Record<string, unknown>; sessionId?: string }> = [];
  closed = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handlers = new Map<string, Array<(p: any, s?: string) => void>>();
  constructor(private readonly respond: (method: string, params: Record<string, unknown>, fake: FakeCdp) => unknown) {}
  async send<T>(method: string, params: object = {}, sessionId?: string): Promise<T> {
    this.sent.push({ method, params: params as Record<string, unknown>, sessionId });
    return (await this.respond(method, params as Record<string, unknown>, this)) as T;
  }
  on(event: string, fn: (p: unknown, s?: string) => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]);
  }
  emit(event: string, params: Record<string, unknown>, sessionId?: string) {
    for (const fn of this.handlers.get(event) ?? []) fn(params, sessionId);
  }
  onClose() {}
  async close() {
    this.closed = true;
  }
}

/** A tab whose reader is the real script on the page double; `onClick` runs as the press is released. */
function tabOn(page: Page, onClick: (fake: FakeCdp) => void): FakeCdp {
  const reader = readerOn(page);
  return new FakeCdp((method, params, fake) => {
    switch (method) {
      case "Target.getTargets":
        return { targetInfos: [{ targetId: "TAB", type: "page", url: "about:blank", attached: false }] };
      case "Target.attachToTarget":
        return { sessionId: "S1" };
      case "Page.getFrameTree":
        return { frameTree: { frame: { id: "TAB", url: "about:blank" } } };
      case "Page.createIsolatedWorld":
        return { executionContextId: 7 };
      case "Runtime.callFunctionOn": {
        const args = params.arguments as Array<{ value: unknown }>;
        return { result: { value: reader(String(args[0].value), args[1].value as Record<string, unknown>) } };
      }
      case "Page.captureScreenshot":
        return { data: Buffer.from([0xff, 0xd8, 0xff]).toString("base64") };
      case "Input.dispatchMouseEvent":
        if (params.type === "mouseReleased") onClick(fake);
        return {};
      default:
        return {};
    }
  });
}

/** The guard's verdict: exfil.proof.test is refused, every other web address allowed. */
function guard(): GuardHooks & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    verdict: (url: string, main: boolean): SiteVerdict | { ok: true; frame: true } => {
      asked.push(url);
      const host = new URL(url).hostname;
      if (host === "exfil.proof.test") return { ok: false, code: "not_allowed", site: host };
      return main ? { ok: true, site: host } : { ok: true, frame: true };
    },
    onRefused: () => undefined,
    onLost: () => undefined,
    onDialog: () => undefined,
    onDownload: () => undefined,
    onUpload: () => undefined,
    onPopup: () => undefined,
  };
}

const RULES: SiteRules = { allow: ["expenses.proof.test"], block: [], appHosts: [], schemes: ["https:", "http:"], fixtureSuffix: FIXTURE_SUFFIX };

const recorded = (c: Partial<RecordedControl>): RecordedEvent => ({
  type: "click",
  at: 0,
  page: LIST,
  control: { tag: "a", role: "link", name: "", type: null, formHost: null, formKey: null, group: null, choice: false, opener: false, inRow: "My expenses", inNav: false, suggestion: false, wordsChanged: false, href: null, hints: { tag: "a", type: null, autocomplete: null, inputmode: null, name: null, id: null, label: null, maxLength: null }, formFields: [], ...c },
});

describe("a click card on a link that acts, the whole way (Phase 5 Decision 18)", () => {
  it("reads it as a control, prepares its card, says its step, and at the approval finds it again, clicks it and asks the guard where it goes", async () => {
    let next = "http://expenses.proof.test/approve?id=101";
    const page = listPage();
    const fake = tabOn(page, (f) => f.emit("Fetch.requestPaused", { requestId: `r${f.sent.length}`, request: { url: next }, frameId: "TAB", resourceType: "Document" }, "S1"));
    const hooks = guard();
    const handle = await attachBrowser("wss://connect.example/secret", hooks, { fixtureSuffix: FIXTURE_SUFFIX, connect: async () => fake, navTimeoutMs: 200, settleMaxMs: 20 });
    fake.emit("Page.frameNavigated", { frame: { id: "TAB", loaderId: "L1", url: LIST } }, "S1");
    const lb: LiveBrowser = { rowId: "bs1", organizationId: "org", userId: "me", agentId: "a1", handle, rules: RULES, rulesVersion: 0, links: new Set(), refs: new Map(), refsUrl: null, seq: 0, lost: false, events: [] };

    // The read: the links that act are controls of role link, the one that does not is none, and every link stays a link.
    const read = await readOn(lb, 1);
    const view = read.answer as unknown as ReturnType<typeof shapeSnapshot>["view"];
    // Before: [["e1", "button", "More"]].
    expect(view.elements.map((e) => [e.id, e.role, e.name])).toEqual([
      ["e1", "button", "More"],
      ["e2", "link", "Approve"],
      ["e3", "link", "Open"],
      ["e4", "link", "Approve"],
      ["e5", "link", "Open"],
    ]);
    expect(view.links.map((l) => l.text)).toEqual(["Reports", "My expenses", "Jane Doe, sick leave, 3 days", "Approve", "Open", "Lee Park, train to Leeds", "Approve", "Open"]);
    expect([...(lb.actingLinks ?? [])].sort()).toEqual([
      "http://expenses.proof.test/approve?id=101",
      "http://expenses.proof.test/approve?id=102",
      "http://expenses.proof.test/wf.do?method=approve&id=101",
      "http://expenses.proof.test/wf.do?method=approve&id=102",
    ]);

    // The card's preparation on "Approve": found again in a fresh read, pictured, no warning it does not earn.
    const prepared = await prepareStepOn(lb, "click", { element: "e2" }, "Max");
    if (!prepared.ok) throw new Error(prepared.error);
    expect(prepared.facts).toMatchObject({ site: "expenses.proof.test", page: "expenses.proof.test/list", element: "e2", role: "link", name: "Approve", warnings: [], inForm: false });
    expect(prepared.facts.target).toMatchObject({ tag: "a", role: "link", at: 1, twin: 0, twins: 1 });
    expect(prepared.facts.target?.hrefHash).toMatch(/^[0-9a-f]{64}$/);
    expect(prepared.picture).not.toBeNull();

    // Its step in a skill run: the recorded "Approve" link is a click step named by its action word, and "Open" one by its role only.
    const steps = stepsFromRecording({
      startUrl: "http://expenses.proof.test/",
      events: [recorded({ name: "Approve", href: "/approve?id=101" }), recorded({ name: "Open", href: "/wf.do?method=approve&id=101" })],
      pageShots: new Map(),
    });
    expect(steps.slice(1)).toMatchObject([
      { kind: "click", role: "link", name: "approve" },
      { kind: "click", role: "link", name: "" },
    ]);
    const at = matchStep(steps, 0, { kind: "click", site: prepared.facts.site, role: prepared.facts.role ?? "", name: prepared.facts.name ?? "", choiceRole: false });
    expect(at).toBe(1);
    const input: BrowserCardInput = { browserSessionId: "bs1", ...prepared.facts, shotId: null, shot: null, skill: { id: "sk1", version: 1, name: "Approve expenses", steps: [at as number], total: steps.length } };
    expect(browserCard("click", input).lines).toContain(BROWSER_COPY.skillStepLine("Approve expenses", 2, 3));
    const open = await prepareStepOn(lb, "click", { element: "e3" }, "Max");
    if (!open.ok) throw new Error(open.error);
    expect(matchStep(steps, 1, { kind: "click", site: open.facts.site, role: open.facts.role ?? "", name: open.facts.name ?? "", choiceRole: false })).toBe(2);
    // Where each goes, its host and path only, and that its address acts (review of step 6, M1).
    const openLines = browserCard("click", { browserSessionId: "bs1", ...open.facts, shotId: null, shot: null }).lines ?? [];
    expect(openLines).toEqual(expect.arrayContaining([BROWSER_COPY.linkGoesTo("expenses.proof.test/wf.do"), BROWSER_COPY.linkAddressActs]));
    expect(openLines.join("\n")).not.toMatch(/method|id=/);
    expect(browserCard("click", input).lines).toContain(BROWSER_COPY.linkGoesTo("expenses.proof.test/approve"));

    // The approval: the link found again by its sealed fingerprint, clicked at its centre, and the page it goes to asked of the guard.
    const ran = await runStepOn(lb, "click", input, "Max");
    expect(ran.answer).toMatchObject({ ok: true });
    const presses = fake.sent.filter((s) => s.method === "Input.dispatchMouseEvent").map((s) => s.params.type);
    expect(presses).toEqual(["mouseMoved", "mousePressed", "mouseReleased"]);
    expect(page.placed?.attrs.href).toBe("/approve?id=101");
    expect(hooks.asked).toContain("http://expenses.proof.test/approve?id=101");
    expect(fake.sent.some((s) => s.method === "Fetch.continueRequest")).toBe(true);

    // A link whose page the guard refuses: the hop is stopped, and the card fails as one that may have gone through.
    await readOn(lb, 1);
    next = "http://exfil.proof.test/collect";
    const second = await prepareStepOn(lb, "click", { element: "e5" }, "Max");
    if (!second.ok) throw new Error(second.error);
    const refused = await runStepOn(lb, "click", { browserSessionId: "bs1", ...second.facts, shotId: null, shot: null }, "Max");
    expect(refused.answer).toMatchObject({ unknownOutcome: true });
    expect(refused.step).toMatchObject({ kind: "click", outcome: "failed", code: "blocked_hop" });
    expect(page.placed?.attrs.href).toBe("/wf.do?method=approve&id=102");
    expect(fake.sent.some((s) => s.method === "Fetch.failRequest")).toBe(true);
  });
});

/** An approvals list too long for every row's links (review of Phase 5 step 6, M2): the nav's More, then 65 rows of a Details button, an Approve and an Open. */
function busyPage(): Page {
  const p = new Page("http://expenses.proof.test/busy");
  const rows = Array.from({ length: 65 }, (_, k) => {
    const id = String(301 + k);
    return p.h("tr", {}, p.h("td", {}, `Expense ${id}`), p.h("td", {}, p.h("button", { type: "button" }, "Details")), p.h("td", {}, p.h("a", { href: `/approve?id=${id}` }, "Approve")), p.h("td", {}, p.h("a", { href: `/wf.do?method=approve&id=${id}` }, "Open")));
  });
  p.body.append(p.h("div", {}, p.h("button", { type: "button", id: "more" }, "More")), p.h("table", {}, p.h("tbody", {}, ...rows)));
  return p;
}

describe("a busy page's links that act, the whole way (review of Phase 5 step 6, M2)", () => {
  it("keeps room for them, clicks one by the reader's own fingerprint, and says why one with no id can't be clicked", async () => {
    const page = busyPage();
    const fake = tabOn(page, () => undefined);
    const handle = await attachBrowser("wss://connect.example/secret", guard(), { fixtureSuffix: FIXTURE_SUFFIX, connect: async () => fake, navTimeoutMs: 200, settleMaxMs: 20 });
    fake.emit("Page.frameNavigated", { frame: { id: "TAB", loaderId: "L1", url: "http://expenses.proof.test/busy" } }, "S1");
    const lb: LiveBrowser = { rowId: "bs1", organizationId: "org", userId: "me", agentId: "a1", handle, rules: RULES, rulesVersion: 0, links: new Set(), refs: new Map(), refsUrl: null, seq: 0, lost: false, events: [] };
    const raw = await handle.snapshot();
    // The reader: 66 controls, then the 130 links that act, each at its own place after them.
    expect(raw.elements.filter((e) => e.followable !== true)).toHaveLength(66);
    expect(raw.elements.filter((e) => e.followable === true).map((e) => e.at).slice(0, 2)).toEqual([66, 67]);
    const read = await readOn(lb, 1);
    const view = read.answer as unknown as ReturnType<typeof shapeSnapshot>["view"];
    // 66 controls leave 54 places, all for links that act.
    expect(view.elements).toHaveLength(120);
    expect(view.elements[66]).toMatchObject({ id: "e67", role: "link", name: "Approve" });
    expect([...(lb.actingLinks ?? [])]).toHaveLength(54);
    // The reader describes 120 of the 130 (MAX_ACT_LINKS), the view's links are its first 80: 66 the model was shown that have no id.
    expect(lb.actingNoId?.size).toBe(66);
    expect(actingLinkRefusal(lb, "http://expenses.proof.test/approve?id=301")).toBe(SKILL_COPY.useClickForLink);
    expect(actingLinkRefusal(lb, "http://expenses.proof.test/approve?id=340")).toBe(BROWSER_COPY.linkTooLongToClick);
    // The id is a place in the view; the card's fingerprint is the reader's, its place on the page included.
    const card = await prepareStepOn(lb, "click", { element: "e67" }, "Max");
    if (!card.ok) throw new Error(card.error);
    expect(card.facts.target?.at).toBe(66);
    expect((await runStepOn(lb, "click", { browserSessionId: "bs1", ...card.facts, shotId: null, shot: null }, "Max")).answer).toMatchObject({ ok: true });
    expect(page.placed?.attrs.href).toBe("/approve?id=301");
  });
});
