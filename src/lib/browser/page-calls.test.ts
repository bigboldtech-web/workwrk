// What each browser call does on the page (src/lib/browser/page-calls.ts,
// docs/plans/ai-teammates-phase4.md step 3), with the driver as a fake that
// records every navigation and every act: the guard's verdict before any
// request, only links after a read (Decision 11), the current page checked
// against the call's rules before every read, no field value and no hidden
// code in what the model reads (Decision 17), an approved step only on the
// page and the element its card showed (Decision 14), never a sensitive
// field (Decision 18), and the guard's notes joined to the next answer.

import { beforeEach, describe, expect, it } from "vitest";
import { BROWSER_COPY } from "@/lib/agents/teammate-copy";
import { FIXTURE_SUFFIX, siteOf, type SiteRules } from "./sites";
import { cleanTyped, findOn, openOn, prepareStepOn, prepareTakeOverOn, readOn, runStepOn, scrollOn, withNotes } from "./page-calls";
import type { LiveBrowser } from "./live";
import { fingerprintOf } from "./snapshot";
import type { ActOutcome, BrowserHandle, ElementFingerprint, NavOutcome, RawElement, RawSnapshot } from "./types";
import type { BrowserCardInput } from "@/lib/agents/browser-rules";

const RULES: SiteRules = {
  allow: ["docs.proof.test", "shop.proof.test", "login.proof.test", "inject.proof.test"],
  block: ["blocked.proof.test"],
  appHosts: [],
  schemes: ["https:", "http:"],
  fixtureSuffix: FIXTURE_SUFFIX,
};

const button = (o: Partial<RawElement> = {}): RawElement => ({
  tag: "button",
  role: "button",
  name: "Place order",
  kind: "none",
  type: "submit",
  formHost: "shop.proof.test",
  href: null,
  twin: 0,
  disabled: false,
  filled: false,
  inMainFrame: true,
  ...o,
});

const field = (o: Partial<RawElement> = {}): RawElement => button({ tag: "input", role: "textbox", name: "Email", kind: "email", type: "email", ...o });

const page = (o: Partial<RawSnapshot> = {}): RawSnapshot => ({
  url: "http://shop.proof.test/checkout",
  title: "Checkout",
  contentType: "text/html",
  blocks: ["Checkout", "Card 4242 4242 4242 4242 on file. Your code is 482913."],
  elements: [button()],
  links: [{ text: "Back to cart", href: "http://shop.proof.test/cart#top" }],
  ...o,
});

interface Fake {
  handle: BrowserHandle;
  calls: { navigate: string[]; click: ElementFingerprint[]; type: Array<[ElementFingerprint, string, boolean]>; select: Array<[ElementFingerprint, string]>; snapshot: number; blank: number; screenshot: unknown[]; scroll: number };
  url: string;
  snap: RawSnapshot;
  nav: ((u: string) => NavOutcome) | null;
  act: ActOutcome | null;
  matches: Array<{ text: string; near: ElementFingerprint | null }>;
}

let fake: Fake;
let lb: LiveBrowser;

function makeFake(url: string): Fake {
  const f: Fake = {
    url,
    snap: page(),
    nav: null,
    act: null,
    matches: [],
    calls: { navigate: [], click: [], type: [], select: [], snapshot: 0, blank: 0, screenshot: [], scroll: 0 },
    handle: null as unknown as BrowserHandle,
  };
  const actOut = (): ActOutcome => f.act ?? { ok: true, settled: true, url: f.url, site: siteOf(f.url) ?? "" };
  f.handle = {
    navigate: async (u) => {
      f.calls.navigate.push(u);
      const out = f.nav ? f.nav(u) : ({ ok: true, url: u, site: siteOf(u) ?? "" } as NavOutcome);
      if (out.ok) f.url = out.url;
      return out;
    },
    snapshot: async () => {
      f.calls.snapshot += 1;
      return f.snap;
    },
    find: async () => ({ matches: f.matches }),
    scroll: async () => {
      f.calls.scroll += 1;
      return { atEnd: true };
    },
    screenshot: async (o) => {
      f.calls.screenshot.push(o);
      return { jpeg: new Uint8Array([0xff, 0xd8, 0xff]), width: 480, height: 320 };
    },
    click: async (t) => {
      f.calls.click.push(t);
      return actOut();
    },
    type: async (t, text, enter) => {
      f.calls.type.push([t, text, enter]);
      return actOut();
    },
    select: async (t, option) => {
      f.calls.select.push([t, option]);
      return actOut();
    },
    currentUrl: () => f.url,
    blank: async () => {
      f.calls.blank += 1;
      f.url = "about:blank";
    },
    close: async () => undefined,
  };
  return f;
}

beforeEach(() => {
  fake = makeFake("http://shop.proof.test/checkout");
  lb = { rowId: "bs1", organizationId: "org", userId: "me", agentId: "a1", handle: fake.handle, rules: RULES, links: new Set(), refs: new Map(), refsUrl: null, seq: 0, lost: false, events: [] };
});

describe("openOn", () => {
  it("refuses an address the guard refuses before any request leaves, with the real reason", async () => {
    for (const [url, said] of [
      ["http://exfil.proof.test/?d=notes", BROWSER_COPY.notAllowedSite("exfil.proof.test")],
      ["http://blocked.proof.test/", BROWSER_COPY.blockedSite("blocked.proof.test")],
      ["https://127.0.0.1/", BROWSER_COPY.neverSite],
      ["ftp://docs.proof.test/", BROWSER_COPY.notHttps],
      ["not a url", BROWSER_COPY.badAddress],
    ] as const) {
      const out = await openOn(lb, url, { tainted: false });
      expect(out.answer, url).toEqual({ error: said });
      expect(out.touched, url).toBe(false);
    }
    expect(fake.calls.navigate).toEqual([]);
  });

  it("refuses a redirect hop the guard stopped, and navigates nowhere else", async () => {
    fake.nav = () => ({ ok: false, code: "blocked_hop", host: "blocked.proof.test" });
    lb.refs.set("e1", fingerprintOf(button()));
    const out = await openOn(lb, "http://docs.proof.test/redirect-blocked", { tainted: false });
    expect(out.answer).toEqual({ error: BROWSER_COPY.redirectRefused("blocked.proof.test") });
    expect(fake.calls.navigate).toEqual(["http://docs.proof.test/redirect-blocked"]);
    expect(out.step).toMatchObject({ kind: "open", outcome: "refused", code: "blocked_hop" });
    // The host came from the page: the turn has met it.
    expect(out.touched).toBe(true);
    expect(lb.refs.size).toBe(0);
  });

  it("gives every way a page fails to open its own sentence, unreachable included", async () => {
    const said: Array<[NavOutcome, string]> = [
      [{ ok: false, code: "not_html" }, BROWSER_COPY.notAPage],
      [{ ok: false, code: "timeout" }, BROWSER_COPY.pageTooSlow],
      [{ ok: false, code: "private_address" }, BROWSER_COPY.privateAddress],
      [{ ok: false, code: "unreachable" }, BROWSER_COPY.unreachable],
    ];
    for (const [nav, sentence] of said) {
      fake.nav = () => nav;
      expect((await openOn(lb, "http://docs.proof.test/", { tainted: false })).answer).toEqual({ error: sentence });
    }
    fake.nav = () => ({ ok: false, code: "lost" });
    const lost = await openOn(lb, "http://docs.proof.test/", { tainted: false });
    expect(lost).toMatchObject({ answer: { error: BROWSER_COPY.browserClosed }, lost: true });
  });

  it("answers only that the page opened and its site, never its title or text", async () => {
    const out = await openOn(lb, "http://docs.proof.test/guide", { tainted: false });
    expect(out.answer).toEqual({ ok: true, site: "docs.proof.test", note: BROWSER_COPY.openedNote });
    expect(out).toMatchObject({ step: { kind: "open", site: "docs.proof.test", outcome: "ok" }, touched: true, site: "docs.proof.test" });
  });

  it("after a read opens only a link a read showed, or the page it is on (Decision 11)", async () => {
    lb.links.add("http://shop.proof.test/buy-now?item=giftcard&qty=50");
    // Composed, though the site is allowed: refused, nothing sent.
    expect((await openOn(lb, "http://docs.proof.test/?d=notes", { tainted: true })).answer).toEqual({ error: BROWSER_COPY.linkOnly });
    expect(fake.calls.navigate).toEqual([]);
    // The link a page showed, its fragment aside: opens.
    expect((await openOn(lb, "http://shop.proof.test/buy-now?item=giftcard&qty=50#top", { tainted: true })).answer).toMatchObject({ ok: true });
    // The same page again: opens.
    expect((await openOn(lb, "http://shop.proof.test/buy-now?item=giftcard&qty=50", { tainted: true })).answer).toMatchObject({ ok: true });
    expect(fake.calls.navigate).toHaveLength(2);
  });
});

describe("the reads check the page they are on first (carried from step 2)", () => {
  it("answers noBrowserYet with no page open, and touches nothing", async () => {
    fake.url = "about:blank";
    const out = await readOn(lb, undefined);
    expect(out).toEqual({ answer: { error: BROWSER_COPY.noBrowserYet }, step: null, touched: false });
    expect(fake.calls.snapshot).toBe(0);
  });

  it("leaves a page the call's rules no longer allow, reads nothing of it, and says why", async () => {
    lb.rules = { ...RULES, allow: ["docs.proof.test"] };
    lb.refs.set("e1", fingerprintOf(button()));
    lb.refsUrl = "http://shop.proof.test/checkout";
    for (const call of [() => readOn(lb, 1), () => findOn(lb, "gift"), () => scrollOn(lb, "down", 1)]) {
      fake.url = "http://shop.proof.test/checkout";
      const out = await call();
      expect(out.answer).toEqual({ error: BROWSER_COPY.siteNoLongerAllowed("shop.proof.test") });
      expect(out.step).toMatchObject({ site: "shop.proof.test", outcome: "refused", code: "not_allowed" });
      expect(out.site).toBeNull();
    }
    expect(fake.calls.snapshot).toBe(0);
    expect(fake.calls.scroll).toBe(0);
    expect(fake.calls.blank).toBe(3);
    expect(lb.refs.size).toBe(0);
    expect(lb.refsUrl).toBeNull();
  });
});

describe("readOn", () => {
  it("hands the model the view with no field value and the codes hidden, and keeps its ids and links", async () => {
    fake.snap = page({ elements: [button(), { ...field({ filled: true }), value: "hunter2" } as RawElement] });
    const out = await readOn(lb, undefined);
    const json = JSON.stringify(out.answer);
    expect(json).not.toContain("hunter2");
    expect(json).not.toMatch(/"value"/);
    expect(json).not.toContain("4242 4242 4242 4242");
    expect(json).not.toContain("482913");
    expect(out.answer).toMatchObject({ site: "shop.proof.test", note: BROWSER_COPY.pageNote, elements: [{ id: "e1", name: "Place order" }, { id: "e2", kind: "email", filled: true }] });
    expect([...lb.refs.keys()]).toEqual(["e1", "e2"]);
    expect(lb.refsUrl).toBe("http://shop.proof.test/checkout");
    expect([...lb.links]).toEqual(["http://shop.proof.test/cart"]);
    expect(out).toMatchObject({ step: { kind: "read", site: "shop.proof.test", outcome: "ok" }, touched: true });
  });

  it("says a document that is not HTML is not a page", async () => {
    fake.snap = page({ contentType: "application/pdf", blocks: [], elements: [] });
    expect((await readOn(lb, 1)).answer).toEqual({ error: BROWSER_COPY.notAPage });
  });
});

describe("findOn", () => {
  it("answers each match redacted with the id of the nearest control from a fresh read, which replaces the ids", async () => {
    lb.refs.set("e9", fingerprintOf(field()));
    fake.matches = [
      { text: "Place order with card 4242 4242 4242 4242", near: fingerprintOf(button()) },
      { text: "nothing near", near: null },
    ];
    const out = await findOn(lb, "order");
    expect(out.answer).toEqual({
      site: "shop.proof.test",
      count: 2,
      matches: [{ text: "Place order with card [hidden]", element: "e1" }, { text: "nothing near" }],
      note: BROWSER_COPY.pageNote,
    });
    expect([...lb.refs.keys()]).toEqual(["e1"]);
    // Its links were never shown, so none is kept for open_page.
    expect(lb.links.size).toBe(0);
  });
});

describe("withNotes", () => {
  it("joins the guard's notes to the answer's note, once, and says the call met the page", () => {
    lb.events.push(BROWSER_COPY.popupClosed("exfil.proof.test"), BROWSER_COPY.dialogClosed);
    const out = withNotes(lb, { answer: { ok: true, note: BROWSER_COPY.openedNote }, step: null, touched: false });
    expect(out.answer.note).toBe(`${BROWSER_COPY.openedNote} ${BROWSER_COPY.popupClosed("exfil.proof.test")} ${BROWSER_COPY.dialogClosed}`);
    expect(out.touched).toBe(true);
    expect(lb.events).toEqual([]);
  });
});

describe("prepareStepOn", () => {
  beforeEach(async () => {
    fake.snap = page({
      elements: [
        button(),
        field({ name: "Password", kind: "password", type: "password", twin: 0 }),
        field(),
        button({ tag: "input", role: "button", name: "Attach", kind: "file", type: "file" }),
        button({ name: "Pay later", disabled: true }),
        button({ tag: "select", role: "combobox", name: "Colour", kind: "select", type: null, options: ["Red", "Blue"] }),
      ],
    });
    await readOn(lb, 1);
  });

  it("refuses an id from an older read of another page", async () => {
    lb.refsUrl = "http://shop.proof.test/cart";
    expect(await prepareStepOn(lb, "click", { element: "e1" }, "Max")).toEqual({ ok: false, error: BROWSER_COPY.staleElement });
    expect(await prepareStepOn(lb, "click", { element: "e77" }, "Max")).toEqual({ ok: false, error: BROWSER_COPY.staleElement });
  });

  it("never types into, chooses in or clicks a sensitive field, a file input, a control turned off or one that takes no words", async () => {
    expect(await prepareStepOn(lb, "type_text", { element: "e2", text: "hunter2" }, "Max")).toEqual({ ok: false, error: BROWSER_COPY.sensitiveField("Max") });
    expect(await prepareStepOn(lb, "click", { element: "e2" }, "Max")).toEqual({ ok: false, error: BROWSER_COPY.sensitiveField("Max") });
    expect(await prepareStepOn(lb, "click", { element: "e4" }, "Max")).toEqual({ ok: false, error: BROWSER_COPY.uploadsOff });
    expect(await prepareStepOn(lb, "click", { element: "e5" }, "Max")).toEqual({ ok: false, error: BROWSER_COPY.elementHidden });
    expect(await prepareStepOn(lb, "type_text", { element: "e1", text: "x" }, "Max")).toEqual({ ok: false, error: BROWSER_COPY.notAField });
    expect(await prepareStepOn(lb, "type_text", { element: "e3", text: "\u0000\u0007 " }, "Max")).toEqual({ ok: false, error: BROWSER_COPY.emptyText });
    expect(await prepareStepOn(lb, "select_option", { element: "e6", option: "Green" }, "Max")).toEqual({ ok: false, error: BROWSER_COPY.noSuchOption("Green") });
    // Nothing was pictured for a step refused.
    expect(fake.calls.screenshot).toEqual([]);
  });

  it("refuses a control the page no longer has", async () => {
    fake.snap = page({ elements: [] });
    expect(await prepareStepOn(lb, "click", { element: "e1" }, "Max")).toEqual({ ok: false, error: BROWSER_COPY.elementGone });
  });

  it("finds the control again, warns what a click may do, and takes the picture around it", async () => {
    const out = await prepareStepOn(lb, "click", { element: "e1" }, "Max");
    expect(out).toMatchObject({
      ok: true,
      facts: { site: "shop.proof.test", pageUrl: "http://shop.proof.test/checkout", page: "shop.proof.test/checkout", element: "e1", role: "button", name: "Place order", warnings: ["buys", "submits"], inForm: true },
      picture: { width: 480, height: 320 },
    });
    expect(fake.calls.screenshot).toEqual([{ around: fingerprintOf(button()) }]);
    const typed = await prepareStepOn(lb, "type_text", { element: "e3", text: "max@proof.test\u0000", pressEnter: true }, "Max");
    expect(typed).toMatchObject({ ok: true, facts: { text: "max@proof.test", pressEnter: true, name: "Email" } });
    const chosen = await prepareStepOn(lb, "select_option", { element: "e6", option: "blue" }, "Max");
    expect(chosen).toMatchObject({ ok: true, facts: { option: "Blue" } });
  });

  it("asks the person to take over only on a page the rules allow", () => {
    expect(prepareTakeOverOn(lb, "sign_in")).toMatchObject({ ok: true, facts: { site: "shop.proof.test", reason: "sign_in" } });
    lb.rules = { ...RULES, allow: [] };
    expect(prepareTakeOverOn(lb, "sign_in")).toEqual({ ok: false, error: BROWSER_COPY.notAllowedSite("shop.proof.test") });
  });
});

describe("runStepOn (Decision 14)", () => {
  const card = (o: Partial<BrowserCardInput> = {}): BrowserCardInput => ({
    browserSessionId: "bs1",
    site: "shop.proof.test",
    pageUrl: "http://shop.proof.test/checkout",
    page: "shop.proof.test/checkout",
    element: "e1",
    target: fingerprintOf(button()),
    role: "button",
    name: "Place order",
    shotId: null,
    shot: null,
    ...o,
  });

  it("does nothing on a page that moved, or a site taken away since", async () => {
    fake.url = "http://shop.proof.test/cart";
    expect((await runStepOn(lb, "click", card(), "Max")).answer).toEqual({ error: BROWSER_COPY.pageChanged });
    fake.url = "http://shop.proof.test/checkout#pay";
    lb.rules = { ...RULES, allow: ["docs.proof.test"] };
    expect((await runStepOn(lb, "click", card(), "Max")).answer).toEqual({ error: BROWSER_COPY.siteNowNotAllowed("shop.proof.test") });
    expect(fake.calls.click).toEqual([]);
  });

  it("acts on the card's element on the card's page, its fragment aside, and forgets the old ids", async () => {
    fake.url = "http://shop.proof.test/checkout#pay";
    lb.refs.set("e1", fingerprintOf(button()));
    const out = await runStepOn(lb, "click", card(), "Max");
    expect(out.answer).toEqual({ ok: true, site: "shop.proof.test", settled: true, note: BROWSER_COPY.actNote });
    expect(fake.calls.click).toEqual([fingerprintOf(button())]);
    expect(lb.refs.size).toBe(0);
    await runStepOn(lb, "type_text", card({ text: "Max", pressEnter: true }), "Max");
    expect(fake.calls.type).toEqual([[fingerprintOf(button()), "Max", true]]);
  });

  it("holds a step lost before anything was sent, and fails one sent and not confirmed, never to run again", async () => {
    fake.act = { ok: false, code: "lost_before" };
    const held = await runStepOn(lb, "click", card(), "Max");
    expect(held).toEqual({ answer: { error: BROWSER_COPY.providerUnavailable, held: "retry_later" }, step: null, touched: false });
    fake.act = { ok: false, code: "unknown_outcome" };
    const unknown = await runStepOn(lb, "click", card(), "Max");
    expect(unknown.answer).toEqual({ error: BROWSER_COPY.unknownOutcome, unknownOutcome: true });
    expect(unknown.step).toMatchObject({ kind: "click", outcome: "failed", code: "unknown_outcome" });
    for (const [code, said] of [
      ["changed", BROWSER_COPY.pageChanged],
      ["covered", BROWSER_COPY.pageChanged],
      ["disabled", BROWSER_COPY.elementHidden],
      ["frame", BROWSER_COPY.inFrame],
      ["sensitive", BROWSER_COPY.sensitiveField("Max")],
    ] as const) {
      fake.act = { ok: false, code };
      expect((await runStepOn(lb, "click", card(), "Max")).answer, code).toEqual({ error: said });
    }
    fake.act = { ok: false, code: "blocked_hop", host: "exfil.proof.test" };
    expect((await runStepOn(lb, "click", card(), "Max")).answer).toEqual({ error: BROWSER_COPY.redirectRefused("exfil.proof.test") });
  });
});

describe("cleanTyped", () => {
  it("keeps every word, a line break and a tab, drops other control characters and look-alike brackets, at most 2,000", () => {
    expect(cleanTyped("Hi\u0000 there\r\nline\ttab‮")).toBe("Hi there\nline\ttab");
    expect(cleanTyped("＜b＞")).toBe("<b>");
    expect(cleanTyped("x".repeat(2500))).toHaveLength(2000);
  });
});
