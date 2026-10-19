// What each browser call does on the page (src/lib/browser/page-calls.ts,
// docs/plans/ai-teammates-phase4.md step 3), with the driver as a fake that
// records every navigation and every act: the guard's verdict before any
// request, only links after a read (Decision 11), the current page checked
// against the call's rules before every read, no field value and no hidden
// code in what the model reads (Decision 17), an approved step only on the
// page and the element its card showed (Decision 14), never a sensitive
// field (Decision 18), and the guard's notes joined to the next answer.

import { beforeEach, describe, expect, it } from "vitest";
import { BROWSER_COPY, BROWSER_PANEL_COPY, SKILL_COPY, type FillStop } from "@/lib/agents/teammate-copy";
import { FIXTURE_SUFFIX, siteOf, type SiteRules } from "./sites";
import { BrowserLost } from "./cdp-driver";
import { cleanTyped, findOn, openOn, prepareStepOn, prepareTakeOverOn, readOn, runFillOn, runStepOn, scrollOn, withNotes } from "./page-calls";
import type { LiveBrowser } from "./live";
import { fingerprintOf, sealFingerprint } from "./snapshot";
import type { ActOutcome, BrowserHandle, ElementFingerprint, ListOption, NavOutcome, RawElement, RawSnapshot } from "./types";
import { pageKeyHash, storedCardInput, type BrowserCardInput } from "@/lib/agents/browser-rules";

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
  twins: 1,
  anchor: "b0b0b0b0",
  at: 0,
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
  calls: { navigate: string[]; click: ElementFingerprint[]; type: Array<[ElementFingerprint, string, boolean]>; select: Array<[ElementFingerprint, { index: number; label: string }]>; snapshot: number; blank: number; screenshot: unknown[]; scroll: number; options: number };
  url: string;
  snap: RawSnapshot;
  nav: ((u: string) => NavOutcome) | null;
  act: ActOutcome | null;
  matches: Array<{ text: string; near: ElementFingerprint | null }>;
  /** The tab's document (review of Phase 4 step 3). */
  doc: string;
  /** A list's every option, as the reader reads them for matching; else the snapshot element's own. */
  listed: { options: ListOption[]; total: number } | null;
  /** Run after the picture is taken: the page moving while a card is made. */
  afterShot: (() => void) | null;
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
    doc: "doc.1",
    listed: null,
    afterShot: null,
    calls: { navigate: [], click: [], type: [], select: [], snapshot: 0, blank: 0, screenshot: [], scroll: 0, options: 0 },
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
      f.afterShot?.();
      return { jpeg: new Uint8Array([0xff, 0xd8, 0xff]), width: 480, height: 320 };
    },
    options: async (t) => {
      f.calls.options += 1;
      if (f.listed) return { ok: true, ...f.listed };
      const el = f.snap.elements.find((e) => e.name === t.name && e.tag === t.tag);
      if (!el) return { ok: false, code: "not_found" };
      return { ok: true, options: (el.options ?? []).map((label) => ({ label, disabled: false })), total: (el.options ?? []).length };
    },
    click: async (t) => {
      f.calls.click.push(t);
      return actOut();
    },
    type: async (t, text, enter) => {
      f.calls.type.push([t, text, enter]);
      return actOut();
    },
    select: async (t, choice) => {
      f.calls.select.push([t, choice]);
      return actOut();
    },
    currentUrl: () => f.url,
    documentId: () => f.doc,
    blank: async () => {
      f.calls.blank += 1;
      f.url = "about:blank";
    },
    // The recorder (Phase 5 step 2): never on in these tests.
    watch: async () => undefined,
    drainEvents: async () => ({ events: [], pages: [] }),
    close: async () => undefined,
  };
  return f;
}

beforeEach(() => {
  fake = makeFake("http://shop.proof.test/checkout");
  lb = { rowId: "bs1", organizationId: "org", userId: "me", agentId: "a1", handle: fake.handle, rules: RULES, rulesVersion: 0, links: new Set(), refs: new Map(), refsUrl: null, seq: 0, lost: false, events: [] };
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
      facts: { site: "shop.proof.test", pageUrl: "http://shop.proof.test", pageKeyHash: pageKeyHash("http://shop.proof.test/checkout"), page: "shop.proof.test/checkout", element: "e1", target: sealFingerprint(fingerprintOf(button())), role: "button", name: "Place order", warnings: ["buys", "submits"], inForm: true },
      picture: { width: 480, height: 320 },
    });
    expect(fake.calls.screenshot).toEqual([{ around: fingerprintOf(button()) }]);
    const typed = await prepareStepOn(lb, "type_text", { element: "e3", text: "max@proof.test\u0000", pressEnter: true }, "Max");
    expect(typed).toMatchObject({ ok: true, facts: { text: "max@proof.test", pressEnter: true, name: "Email" } });
    const chosen = await prepareStepOn(lb, "select_option", { element: "e6", option: "blue" }, "Max");
    expect(chosen).toMatchObject({ ok: true, facts: { option: "Blue", optionLabel: "Blue", optionIndex: 1 } });
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
    pageUrl: "http://shop.proof.test",
    pageKeyHash: pageKeyHash("http://shop.proof.test/checkout"),
    documentId: "doc.1",
    page: "shop.proof.test/checkout",
    element: "e1",
    target: sealFingerprint(fingerprintOf(button())),
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
      // Last polish of Phase 4: a sensitive field carries the person's own words too (never "Ask Max to take over" to Max).
      const forPerson = code === "sensitive" ? { forPerson: "That's a password, code or payment field, which your teammate never uses, so nothing was done." } : {};
      if (code === "sensitive") expect(BROWSER_PANEL_COPY.sensitiveStep).toBe(forPerson.forPerson);
      expect((await runStepOn(lb, "click", card(), "Max")).answer, code).toEqual({ error: said, ...forPerson });
    }
  });
});

// Review of Phase 4 step 3.
describe("open_page goes only to the address that matched (review of Phase 4 step 3)", () => {
  it("in a tainted turn opens a shown link without the fragment the model added", async () => {
    lb.links.add("http://shop.proof.test/buy-now?item=giftcard&qty=50");
    expect((await openOn(lb, "http://shop.proof.test/buy-now?item=giftcard&qty=50#secret=notes", { tainted: true })).answer).toMatchObject({ ok: true });
    // Before: the raw address, fragment and all.
    expect(fake.calls.navigate).toEqual(["http://shop.proof.test/buy-now?item=giftcard&qty=50"]);
  });

  it("in a tainted turn opens the page it is on again without the model's fragment", async () => {
    fake.url = "http://shop.proof.test/checkout#pay";
    expect((await openOn(lb, "http://shop.proof.test/checkout#d=the-persons-notes", { tainted: true })).answer).toMatchObject({ ok: true });
    expect(fake.calls.navigate).toEqual(["http://shop.proof.test/checkout"]);
  });

  it("outside a taint opens the address as asked, as before", async () => {
    await openOn(lb, "http://docs.proof.test/guide#intro", { tainted: false });
    expect(fake.calls.navigate).toEqual(["http://docs.proof.test/guide#intro"]);
  });
});

describe("a card is bound to its document (review of Phase 4 step 3)", () => {
  beforeEach(async () => {
    fake.snap = page({ elements: [button()] });
    await readOn(lb, 1);
  });

  it("stores the document the card was asked on", async () => {
    expect(await prepareStepOn(lb, "click", { element: "e1" }, "Max")).toMatchObject({ ok: true, facts: { documentId: "doc.1" } });
    expect(prepareTakeOverOn(lb, "sign_in")).toMatchObject({ ok: true, facts: { documentId: "doc.1" } });
  });

  it("makes no card when the page moved while it was made", async () => {
    fake.afterShot = () => {
      fake.doc = "doc.2";
    };
    expect(await prepareStepOn(lb, "click", { element: "e1" }, "Max")).toEqual({ ok: false, error: BROWSER_COPY.staleElement });
  });

  it("does nothing when the tab shows another document at the card's address: a cart changed under a waiting card", async () => {
    const asked = await prepareStepOn(lb, "click", { element: "e1" }, "Max");
    if (!asked.ok) throw new Error(asked.error);
    // The checkout reloaded with another cart in it, at the very same address.
    fake.doc = "doc.7";
    const input = { browserSessionId: "bs1", shotId: null, shot: null, ...asked.facts } as BrowserCardInput;
    const out = await runStepOn(lb, "click", input, "Max");
    expect(out.answer).toEqual({ error: BROWSER_COPY.pageChanged });
    expect(out.step).toMatchObject({ outcome: "failed", code: "page_changed" });
    expect(fake.calls.click).toEqual([]);
    // A card with no document runs nothing either.
    fake.doc = "doc.1";
    expect((await runStepOn(lb, "click", { ...input, documentId: undefined }, "Max")).answer).toEqual({ error: BROWSER_COPY.pageChanged });
    expect(fake.calls.click).toEqual([]);
  });

  it("makes no card for a control whose twins, anchor or place changed since the read", async () => {
    // A new "Place order" twin inserted above the one the model read.
    fake.snap = page({ elements: [button({ twin: 0, twins: 2, anchor: "dddddddd" }), button({ twin: 1, twins: 2, at: 1 })] });
    expect(await prepareStepOn(lb, "click", { element: "e1" }, "Max")).toEqual({ ok: false, error: BROWSER_COPY.staleElement });
    expect(fake.calls.screenshot).toEqual([]);
  });
});

describe("a step after which the page tried a refused hop (review of Phase 4 step 3)", () => {
  it("fails marked unknownOutcome, since its input was sent, and says to look before asking again", async () => {
    fake.act = { ok: false, code: "blocked_hop", host: "exfil.proof.test" };
    lb.refs.set("e1", fingerprintOf(button()));
    const out = await runStepOn(
      lb,
      "click",
      { browserSessionId: "bs1", site: "shop.proof.test", pageUrl: "http://shop.proof.test", pageKeyHash: pageKeyHash("http://shop.proof.test/checkout"), documentId: "doc.1", page: "shop.proof.test/checkout", element: "e1", target: sealFingerprint(fingerprintOf(button())), shotId: null, shot: null },
      "Max",
    );
    expect(out.answer).toEqual({ error: BROWSER_COPY.mayHaveGoneThrough("exfil.proof.test"), unknownOutcome: true });
    expect(out.step).toMatchObject({ kind: "click", outcome: "failed", code: "blocked_hop" });
    expect(out.touched).toBe(true);
    expect(lb.refs.size).toBe(0);
  });
});

describe("typing replaces what a field holds (review of Phase 4 step 3)", () => {
  it("marks a card on a filled field, so it says it replaces it, and not an empty one", async () => {
    fake.snap = page({ elements: [field({ name: "Nickname", kind: "text", type: "text", filled: true }), field({ name: "Email", at: 1 })] });
    await readOn(lb, 1);
    expect(await prepareStepOn(lb, "type_text", { element: "e1", text: "Max" }, "Max")).toMatchObject({ ok: true, facts: { text: "Max", replaces: true } });
    const empty = await prepareStepOn(lb, "type_text", { element: "e2", text: "max@proof.test" }, "Max");
    expect(empty.ok && "replaces" in empty.facts).toBe(false);
  });
});

describe("select_option matches every option the list has (review of Phase 4 step 3)", () => {
  const list = (o: Partial<RawElement> = {}) => button({ tag: "select", role: "combobox", name: "Country", kind: "select", type: null, at: 1, ...o });
  const opts = (labels: string[], disabled: number[] = []) => ({ options: labels.map((label, k) => ({ label, disabled: disabled.includes(k) })), total: labels.length });

  beforeEach(async () => {
    const countries = Array.from({ length: 250 }, (_, i) => `Country ${i + 1}`);
    fake.snap = page({ elements: [button(), list({ options: countries.slice(0, 60), optionCount: 250 })] });
    fake.listed = opts(countries);
    await readOn(lb, 1);
  });

  it("chooses an option of a 250-option list the read did not show, by its index and label", async () => {
    // The model was shown 30, and told how many more there are.
    const read = await readOn(lb, 1);
    expect((read.answer.elements as Array<{ options?: string[]; moreOptions?: number }>)[1]).toMatchObject({ moreOptions: 220 });
    const out = await prepareStepOn(lb, "select_option", { element: "e2", option: "Country 200" }, "Max");
    // Before: noSuchOption, the match read only the 30 shown.
    expect(out).toMatchObject({ ok: true, facts: { option: "Country 200", optionLabel: "Country 200", optionIndex: 199 } });
    expect(fake.calls.options).toBe(1);
  });

  it("chooses a long option by the words a read shows, and a cleaned one, storing its label as the list has it", async () => {
    const long = `Premium plan ${"with every extra ".repeat(8)}`.trim();
    fake.listed = opts(["Basic", long, "＜Gold＞ plan"]);
    const shown = (await import("./snapshot")).optionWords(long).text;
    expect(shown.length).toBeLessThan(long.length);
    expect(await prepareStepOn(lb, "select_option", { element: "e2", option: shown }, "Max")).toMatchObject({ ok: true, facts: { option: shown, optionLabel: long, optionIndex: 1 } });
    expect(await prepareStepOn(lb, "select_option", { element: "e2", option: "<Gold> plan" }, "Max")).toMatchObject({ ok: true, facts: { option: "<Gold> plan", optionLabel: "＜Gold＞ plan", optionIndex: 2 } });
  });

  it("never matches an earlier option that differs only by case", async () => {
    fake.listed = opts(["Red", "red"]);
    expect(await prepareStepOn(lb, "select_option", { element: "e2", option: "red" }, "Max")).toMatchObject({ ok: true, facts: { optionIndex: 1, optionLabel: "red" } });
    expect(await prepareStepOn(lb, "select_option", { element: "e2", option: "Red" }, "Max")).toMatchObject({ ok: true, facts: { optionIndex: 0 } });
    // Neither is "RED": which one is meant can't be told.
    expect(await prepareStepOn(lb, "select_option", { element: "e2", option: "RED" }, "Max")).toEqual({ ok: false, error: BROWSER_COPY.optionTwice("RED") });
    // The only one, whatever its case.
    fake.listed = opts(["Red", "Blue"]);
    expect(await prepareStepOn(lb, "select_option", { element: "e2", option: "BLUE" }, "Max")).toMatchObject({ ok: true, facts: { optionIndex: 1 } });
  });

  it("refuses two options with the same words, one with something hidden in it, one turned off, and says when the list is longer than it read", async () => {
    fake.listed = opts(["Standard", "Standard"]);
    expect(await prepareStepOn(lb, "select_option", { element: "e2", option: "Standard" }, "Max")).toEqual({ ok: false, error: BROWSER_COPY.optionTwice("Standard") });
    fake.listed = opts(["Visa 4242 4242 4242 4242", "New card"]);
    expect(await prepareStepOn(lb, "select_option", { element: "e2", option: "Visa [hidden]" }, "Max")).toEqual({ ok: false, error: BROWSER_COPY.sensitiveField("Max") });
    fake.listed = opts(["Small", "Large"], [1]);
    expect(await prepareStepOn(lb, "select_option", { element: "e2", option: "Large" }, "Max")).toEqual({ ok: false, error: BROWSER_COPY.elementHidden });
    fake.listed = { options: Array.from({ length: 1000 }, (_, k) => ({ label: `Year ${k}`, disabled: false })), total: 4000 };
    expect(await prepareStepOn(lb, "select_option", { element: "e2", option: "Year 3000" }, "Max")).toEqual({ ok: false, error: BROWSER_COPY.optionNotInFirst("Year 3000", 1000) });
    expect(fake.calls.screenshot).toEqual([]);
  });

  it("chooses at its approval by the stored index and label", async () => {
    const asked = await prepareStepOn(lb, "select_option", { element: "e2", option: "Country 200" }, "Max");
    if (!asked.ok) throw new Error(asked.error);
    await runStepOn(lb, "select_option", { browserSessionId: "bs1", shotId: null, shot: null, ...asked.facts } as BrowserCardInput, "Max");
    expect(fake.calls.select).toEqual([[fingerprintOf(list({ options: undefined })), { index: 199, label: "Country 200" }]]);
  });
});

// Review round 1 of Phase 4.
describe("a card keeps no secret it only compares (review round 1 of Phase 4)", () => {
  const SECRET_PAGE = "https://shop.proof.test/checkout?token=PAGETOKEN7731&step=2";
  const secretLink = () => button({ tag: "a", role: "link", name: "Pay with saved card", kind: "none", type: null, formHost: null, href: "https://shop.proof.test/pay;jsessionid=SESSIONID5521?key=SHAREKEY0098", at: 1 });
  const codeButton = () => button({ name: "Use code 482913", at: 2 });

  beforeEach(async () => {
    fake = makeFake(SECRET_PAGE);
    lb.handle = fake.handle;
    fake.snap = page({ url: SECRET_PAGE, elements: [button(), secretLink(), codeButton()] });
    await readOn(lb, 1);
  });

  it("stores neither the page's ?token= nor a link's ;jsessionid=, nor a name's code, and still acts on the card's element", async () => {
    for (const element of ["e2", "e3"]) {
      // An act forgets the page's ids: the model reads it again first.
      await readOn(lb, 1);
      const asked = await prepareStepOn(lb, "click", { element }, "Max");
      if (!asked.ok) throw new Error(asked.error);
      // What AgentAction.input keeps, as browser-previews.ts stores it.
      const stored = JSON.stringify({ browserSessionId: "bs1", shotId: null, shot: null, ...asked.facts });
      for (const secret of ["PAGETOKEN7731", "token=", "step=2", "SESSIONID5521", "jsessionid", "SHAREKEY0098", "482913"]) expect(stored, `${element} ${secret}`).not.toContain(secret);
      expect(asked.facts).toMatchObject({ pageUrl: "https://shop.proof.test", page: "shop.proof.test/checkout" });
      // Read back by its approval and run: the very element, found by its sealed words.
      const input = storedCardInput("click", JSON.parse(stored));
      if (!input) throw new Error("not a card");
      const out = await runStepOn(lb, "click", input, "Max");
      expect(out.answer, element).toMatchObject({ ok: true });
    }
    expect(fake.calls.click).toEqual([fingerprintOf(secretLink()), fingerprintOf(codeButton())]);
    // The card's words are the read's, redacted.
    await readOn(lb, 1);
    const named = await prepareStepOn(lb, "click", { element: "e3" }, "Max");
    expect(named.ok && named.facts.name).toBe("Use code [hidden]");
  });

  it("shows a path that carries a code redacted on the card's Page line", async () => {
    fake.url = "https://shop.proof.test/verification-code/482913";
    fake.snap = page({ url: fake.url, elements: [button()] });
    await readOn(lb, 1);
    const asked = await prepareStepOn(lb, "click", { element: "e1" }, "Max");
    if (!asked.ok) throw new Error(asked.error);
    expect(JSON.stringify(asked.facts)).not.toContain("482913");
    expect(prepareTakeOverOn(lb, "code")).toMatchObject({ ok: true, facts: { pageUrl: "https://shop.proof.test", pageKeyHash: pageKeyHash(fake.url) } });
    expect(JSON.stringify(prepareTakeOverOn(lb, "code"))).not.toContain("482913");
  });

  it("does nothing when the page or the element changed under a sealed card, and waits when the read fails before anything is sent", async () => {
    const asked = await prepareStepOn(lb, "click", { element: "e2" }, "Max");
    if (!asked.ok) throw new Error(asked.error);
    const input = { browserSessionId: "bs1", shotId: null, shot: null, ...asked.facts } as BrowserCardInput;
    // Another token: another page.
    fake.url = "https://shop.proof.test/checkout?token=OTHER&step=2";
    expect((await runStepOn(lb, "click", input, "Max")).answer).toEqual({ error: BROWSER_COPY.pageChanged });
    fake.url = SECRET_PAGE;
    // The link now goes elsewhere: its sealed address no longer matches.
    fake.snap = page({ url: SECRET_PAGE, elements: [button(), secretLink(), codeButton()].map((e) => (e.role === "link" ? { ...e, href: "https://shop.proof.test/pay;jsessionid=NEW" } : e)) });
    expect((await runStepOn(lb, "click", input, "Max")).answer).toEqual({ error: BROWSER_COPY.pageChanged });
    fake.snap.elements = [button(), secretLink(), codeButton()];
    fake.handle.snapshot = async () => {
      throw new Error("reader");
    };
    expect((await runStepOn(lb, "click", input, "Max")).answer).toEqual({ error: BROWSER_COPY.readFailed, held: "retry_later" });
    expect(fake.calls.click).toEqual([]);
  });

  it("reads a card stored before, with its whole address and raw words, so it compares as it did or fails as a page that changed", async () => {
    const legacy = { browserSessionId: "bs1", site: "shop.proof.test", pageUrl: "https://shop.proof.test/checkout?token=PAGETOKEN7731&step=2", documentId: "doc.1", page: "shop.proof.test/checkout", element: "e2", target: fingerprintOf(secretLink()), role: "link", name: "Pay with saved card", shotId: null, shot: null };
    const read = storedCardInput("click", legacy);
    expect(read).toMatchObject({ pageUrl: "https://shop.proof.test", pageKeyHash: pageKeyHash(SECRET_PAGE), target: sealFingerprint(fingerprintOf(secretLink())) });
    expect(JSON.stringify(read)).not.toContain("SESSIONID5521");
    expect((await runStepOn(lb, "click", read!, "Max")).answer).toMatchObject({ ok: true });
    expect(fake.calls.click).toEqual([fingerprintOf(secretLink())]);
    fake.url = "https://shop.proof.test/checkout";
    expect((await runStepOn(lb, "click", read!, "Max")).answer).toEqual({ error: BROWSER_COPY.pageChanged });
    expect(fake.calls.click).toHaveLength(1);
  });
});

// Review round 2 of Phase 4: the card kept its element's anchor as the
// reader gave it, an unkeyed 32 bit hash of the raw words in its row ("Your
// recovery code is 482913. Copy code"), which trying every code undoes.
describe("a card keeps its element's anchor only sealed (review round 2 of Phase 4)", () => {
  /** The reader's hash of the row's raw words (page-reader.ts anchorOf). */
  const ANCHOR = "5d1e0a77";
  const copy = (o: Partial<RawElement> = {}) => button({ name: "Copy code", type: "button", formHost: null, anchor: ANCHOR, at: 1, ...o });

  beforeEach(async () => {
    fake.snap = page({ elements: [button(), copy()] });
    await readOn(lb, 1);
  });

  const asked = async () => {
    const out = await prepareStepOn(lb, "click", { element: "e2" }, "Max");
    if (!out.ok) throw new Error(out.error);
    // What AgentAction.input keeps, as browser-previews.ts stores it.
    return JSON.stringify({ browserSessionId: "bs1", shotId: null, shot: null, ...out.facts });
  };

  it("stores 64 hex digits in place of the reader's anchor, and its approval still acts on the element", async () => {
    const stored = await asked();
    // Before: the stored target held `"anchor":"5d1e0a77"`.
    expect(stored).not.toContain(ANCHOR);
    const target = (JSON.parse(stored) as { target: Record<string, unknown> }).target;
    expect(target).not.toHaveProperty("anchor");
    expect(target.anchorHash).toMatch(/^[0-9a-f]{64}$/);
    const input = storedCardInput("click", JSON.parse(stored));
    if (!input) throw new Error("not a card");
    expect((await runStepOn(lb, "click", input, "Max")).answer).toMatchObject({ ok: true });
    // The driver gets the fresh read's own fingerprint, its plain anchor with it.
    expect(fake.calls.click).toEqual([fingerprintOf(copy())]);
  });

  it("does nothing when the row's words changed under the card", async () => {
    const input = storedCardInput("click", JSON.parse(await asked()));
    if (!input) throw new Error("not a card");
    fake.snap = page({ elements: [button(), copy({ anchor: "0badc0de" })] });
    expect((await runStepOn(lb, "click", input, "Max")).answer).toEqual({ error: BROWSER_COPY.pageChanged });
    expect(fake.calls.click).toEqual([]);
  });
});

describe("a click's warnings read the words a control is also called by (review round 1 of Phase 4)", () => {
  it("warns that it buys when the visible words say nothing of it but its aria-labelledby words do", async () => {
    fake.url = "http://shop.proof.test/item/123";
    const relabelled = { ...button({ name: "Add to wishlist", formHost: null, type: "button" }), alsoNamed: "Buy now $480" } as RawElement;
    fake.snap = page({ url: fake.url, elements: [relabelled] });
    await readOn(lb, 1);
    const out = await prepareStepOn(lb, "click", { element: "e1" }, "Max");
    expect(out).toMatchObject({ ok: true, facts: { name: "Add to wishlist", warnings: ["buys"] } });
    // The words it is also called by never reach the model's read.
    expect(JSON.stringify((await readOn(lb, 1)).answer)).not.toContain("Buy now");
  });
});

describe("cleanTyped", () => {
  it("keeps every word, a line break and a tab, drops other control characters and look-alike brackets, at most 2,000", () => {
    expect(cleanTyped("Hi\u0000 there\r\nline\ttab‮")).toBe("Hi there\nline\ttab");
    expect(cleanTyped("＜b＞")).toBe("<b>");
    expect(cleanTyped("x".repeat(2500))).toHaveLength(2000);
    // The line and paragraph separators are a line break (review of Phase 5 step 5, low 1).
    expect(cleanTyped("4250\u2028Notes: none\u2029x")).toBe("4250\nNotes: none\nx");
  });
});

// Phase 5 step 4 (docs/plans/ai-teammates-phase5.md Decisions 17 to 19).
describe("links that act, and the skill's start (Phase 5 step 4)", () => {
  it("marks the links a read showed whose words or address act, beside every link it remembers", async () => {
    fake.snap = page({
      links: [
        { text: "Approve", href: "http://shop.proof.test/x/7" },
        { text: "Open", href: "http://shop.proof.test/wf.do?method=approve&id=5" },
        { text: "My expenses", href: "http://shop.proof.test/list" },
      ],
    });
    await readOn(lb, 1);
    expect([...lb.links]).toEqual(["http://shop.proof.test/x/7", "http://shop.proof.test/wf.do?method=approve&id=5", "http://shop.proof.test/list"]);
    // Before: no read marked any, so open_page could open "Approve" with no card.
    expect([...(lb.actingLinks ?? [])]).toEqual(["http://shop.proof.test/x/7", "http://shop.proof.test/wf.do?method=approve&id=5"]);
  });

  it("opens in a tainted turn the one more address it is given, as stored, and nothing else", async () => {
    const out = await openOn(lb, "http://shop.proof.test/new", { tainted: true, also: ["http://shop.proof.test/new"] });
    expect(out.answer).toMatchObject({ ok: true, site: "shop.proof.test" });
    expect(fake.calls.navigate).toEqual(["http://shop.proof.test/new"]);
    expect((await openOn(lb, "http://shop.proof.test/new2", { tainted: true, also: ["http://shop.proof.test/new"] })).answer).toEqual({ error: BROWSER_COPY.linkOnly });
    expect(fake.calls.navigate).toEqual(["http://shop.proof.test/new"]);
  });
});

describe("runFillOn: a fill card at its approval (Phase 5 Decision 19)", () => {
  const amount = field({ name: "Amount", kind: "text", type: "text", at: 0, anchor: "a0" });
  const category = button({ tag: "select", role: "combobox", name: "Category", kind: "select", type: null, at: 1, anchor: "a1", options: ["Choose one", "Travel", "Meals"] });
  const notes = field({ tag: "textarea", name: "Notes", kind: "textarea", type: null, at: 2, anchor: "a2" });
  const submit = button({ name: "Submit expense", at: 3, anchor: "a3" });
  const FORM = page({ url: "http://shop.proof.test/new", elements: [amount, category, notes, submit], links: [] });
  const card = (): BrowserCardInput => ({
    browserSessionId: "bs1",
    site: "shop.proof.test",
    pageUrl: "http://shop.proof.test",
    pageKeyHash: pageKeyHash("http://shop.proof.test/new"),
    documentId: "doc.1",
    page: "shop.proof.test/new",
    inForm: true,
    shotId: null,
    shot: null,
    fields: [
      { element: "e1", target: sealFingerprint(fingerprintOf(amount)), label: "Amount", kind: "type", text: "42.50" },
      { element: "e2", target: sealFingerprint(fingerprintOf(category)), label: "Category", kind: "choose", option: "Travel", optionLabel: "Travel", optionIndex: 1 },
      { element: "e3", target: sealFingerprint(fingerprintOf(notes)), label: "Notes", kind: "type", text: "Taxi to the airport" },
    ],
    skill: { id: "sk1", version: 2, name: "Weekly expenses", steps: [1, 2, 3], total: 5 },
  });

  beforeEach(() => {
    fake.url = "http://shop.proof.test/new";
    fake.snap = FORM;
  });

  it("fills every field, replacing what each holds, and never clicks or presses Enter", async () => {
    const out = await runFillOn(lb, card(), "Max");
    expect(out.answer).toEqual({ ok: true, site: "shop.proof.test", filled: 3, note: SKILL_COPY.fillDone(3) });
    expect(out.filled).toBe(3);
    expect(out.steps).toEqual([
      { kind: "type", site: "shop.proof.test", outcome: "ok" },
      { kind: "select", site: "shop.proof.test", outcome: "ok" },
      { kind: "type", site: "shop.proof.test", outcome: "ok" },
    ]);
    expect(fake.calls.type.map(([, text, enter]) => [text, enter])).toEqual([
      ["42.50", false],
      ["Taxi to the airport", false],
    ]);
    expect(fake.calls.select.map(([, c]) => c)).toEqual([{ index: 1, label: "Travel" }]);
    expect(fake.calls.click).toEqual([]);
  });

  it("names the fields filled and fails as one that may have gone through when the page moves after field 1, never saying nothing was sent", async () => {
    // The stand-in's jumpy shape: typing in Amount moves the page a moment later.
    const typed = fake.handle.type;
    fake.handle.type = async (t, text, enter) => {
      const out = await typed(t, text, enter);
      fake.doc = "doc.2";
      return out;
    };
    const out = await runFillOn(lb, card(), "Max");
    expect(out.answer).toEqual({
      error: SKILL_COPY.fillPartial(1, 3, "Amount"),
      unknownOutcome: true,
      mayHaveGoneThrough: true,
      forPerson: BROWSER_PANEL_COPY.fillPartialForPerson(1, 3),
    });
    expect(out.filled).toBe(1);
    expect(JSON.stringify(out.answer)).not.toMatch(/nothing (was )?(sent|filled)/i);
    expect([fake.calls.type.length, fake.calls.select.length, fake.calls.click.length]).toEqual([1, 0, 0]);
    expect(lb.refs.size).toBe(0);
  });

  it("says nothing was filled for a field not found before any input, and stops at a later one with what was filled", async () => {
    fake.snap = page({ url: "http://shop.proof.test/new", elements: [category, notes, submit], links: [] });
    const none = await runFillOn(lb, card(), "Max");
    expect(none.answer).toEqual({ error: SKILL_COPY.fillNothing, forPerson: BROWSER_COPY.pageChanged });
    expect(none.steps).toEqual([{ kind: "type", site: "shop.proof.test", outcome: "failed", code: "not_found" }]);
    expect(fake.calls.type).toEqual([]);
    // Amount filled, then Category gone: the site may have saved Amount.
    fake.snap = page({ url: "http://shop.proof.test/new", elements: [amount, notes, submit], links: [] });
    const some = await runFillOn(lb, card(), "Max");
    expect(some.answer).toEqual({ error: SKILL_COPY.fillPartial(1, 3, "Amount"), unknownOutcome: true, forPerson: BROWSER_PANEL_COPY.fillPartialForPerson(1, 3) });
  });

  it("holds the card when the browser lost the connection before any field, and fails one whose input may have been sent", async () => {
    fake.handle.snapshot = async () => {
      throw new BrowserLost();
    };
    const held = await runFillOn(lb, card(), "Max");
    expect(held.answer).toEqual({ error: BROWSER_COPY.providerUnavailable, held: "retry_later" });
    expect(held.steps).toEqual([]);
    expect(fake.calls.type).toEqual([]);
    fake.handle.snapshot = async () => FORM;
    fake.act = { ok: false, code: "unknown_outcome" };
    const unknown = await runFillOn(lb, card(), "Max");
    // Its real reason (review of step 4): the browser didn't confirm, never "the page changed".
    expect(unknown.answer).toMatchObject({ error: SKILL_COPY.fillPartial(1, 3, "Amount", "unconfirmed"), unknownOutcome: true, mayHaveGoneThrough: true });
  });

  it("says the real reason it stopped after a field, never that the page changed when it didn't (review of step 4)", async () => {
    const cases: Array<[ActOutcome, FillStop]> = [
      [{ ok: false, code: "covered" }, "covered"],
      [{ ok: false, code: "lost_before" }, "lost"],
      [{ ok: false, code: "disabled" }, "disabled"],
      [{ ok: false, code: "frame" }, "frame"],
      [{ ok: false, code: "sensitive" }, "sensitive"],
      [{ ok: false, code: "blocked_hop", host: "exfil.proof.test" }, "blocked"],
      [{ ok: false, code: "changed" }, "changed"],
    ];
    for (const [act, why] of cases) {
      // Amount types; Category, the second field, answers `act`.
      fake.handle.select = async (t, c) => {
        fake.calls.select.push([t, c]);
        return act;
      };
      const out = await runFillOn(lb, card(), "Max");
      expect([why, out.answer.error, out.answer.forPerson]).toEqual([why, SKILL_COPY.fillPartial(why === "blocked" ? 2 : 1, 3, why === "blocked" ? "Amount, Category" : "Amount", why), BROWSER_PANEL_COPY.fillPartialForPerson(why === "blocked" ? 2 : 1, 3, why)]);
      if (why !== "changed") expect(String(out.answer.error)).not.toContain("the page changed");
    }
    // The page couldn't be read, or the connection was lost, before the second field.
    for (const [thrown, why] of [[new Error("reader"), "unread"], [new BrowserLost(), "lost"]] as Array<[Error, FillStop]>) {
      let reads = 0;
      fake.handle.snapshot = async () => {
        reads += 1;
        if (reads === 2) throw thrown;
        return FORM;
      };
      const out = await runFillOn(lb, card(), "Max");
      expect([why, out.answer.error]).toEqual([why, SKILL_COPY.fillPartial(1, 3, "Amount", why)]);
    }
  });

  it("says a covered first field covered it, with nothing filled (review of step 4)", async () => {
    fake.act = { ok: false, code: "covered" };
    const out = await runFillOn(lb, card(), "Max");
    // Before: "The page changed before the first field".
    expect(out.answer).toEqual({ error: SKILL_COPY.fillNothingCovered, forPerson: BROWSER_PANEL_COPY.fillNothingCoveredForPerson });
    // Not found is still the page that changed.
    fake.act = { ok: false, code: "not_found" };
    expect((await runFillOn(lb, card(), "Max")).answer).toEqual({ error: SKILL_COPY.fillNothing, forPerson: BROWSER_COPY.pageChanged });
  });

  it("does nothing on a page or a document that is not the card's", async () => {
    fake.url = "http://shop.proof.test/list";
    expect((await runFillOn(lb, card(), "Max")).answer).toEqual({ error: BROWSER_COPY.pageChanged });
    fake.url = "http://shop.proof.test/new";
    fake.doc = "doc.9";
    expect((await runFillOn(lb, card(), "Max")).answer).toEqual({ error: BROWSER_COPY.pageChanged });
    expect([fake.calls.type, fake.calls.select]).toEqual([[], []]);
  });
});
