// The rules every browser call is held to (src/lib/agents/browser-rules.ts,
// docs/plans/ai-teammates-phase4.md step 3): every refusal its real reason
// (Decision 33), the model's name for a step its kind (Decision 15), a
// record's site and count only and an audit row's role only (Decisions 23
// and 24), the answer's counts (Decision 22), and the cards built from their
// stored input alone, which an approval reads back defensively.

import { describe, expect, it } from "vitest";
import {
  BROWSER_TOOL_COUNTS,
  actSentence,
  browserActOutcome,
  browserAuditFacts,
  browserCard,
  browserNotHereOf,
  browserNotHereSentence,
  browserRefusalSentence,
  browserStored,
  browserTitle,
  closedForAnswerSentence,
  endHolds,
  pageKey,
  pageKeyHash,
  pageOrigin,
  pageWords,
  storedCardInput,
  type BrowserCardInput,
} from "./browser-rules";
import { sealFingerprint, sealWords } from "@/lib/browser/snapshot";
import { BROWSER_COPY, BROWSER_PANEL_COPY } from "./teammate-copy";
import { BROWSER_TOOL_NAMES } from "./tool-names";
import { END_REASONS, HELD_END_REASONS } from "@/lib/browser/types";

// The fingerprint as a page read gives it, and as a card stores it, sealed (review round 1 of Phase 4).
const rawTarget = { tag: "button", role: "button", name: "Place order", kind: "none" as const, type: "submit", formHost: "shop.proof.test", href: null, twin: 0, twins: 1, anchor: "1a2b3c4d", at: 3 };
const target = sealFingerprint(rawTarget);

const card = (o: Partial<BrowserCardInput> = {}): BrowserCardInput => ({
  browserSessionId: "bs1",
  site: "shop.proof.test",
  pageUrl: "http://shop.proof.test",
  pageKeyHash: pageKeyHash("http://shop.proof.test/checkout?step=2"),
  documentId: "doc-1.4",
  page: "shop.proof.test/checkout",
  element: "e4",
  target,
  role: "button",
  name: "Place order",
  warnings: ["buys", "submits"],
  inForm: true,
  shotId: "sh0123456789abcdef0123456789abcdef",
  shot: { width: 480, height: 320 },
  ...o,
});

describe("browserRefusalSentence", () => {
  it("names every reason, never only that the tool is off (Decision 33)", () => {
    expect(browserRefusalSentence("not_configured", "Shopper", "Max")).toBe(BROWSER_COPY.notConfigured);
    expect(browserRefusalSentence("trial", "Shopper", "Max")).toBe(BROWSER_COPY.trial);
    expect(browserRefusalSentence("plan", "Shopper", "Max")).toBe(BROWSER_COPY.plan);
    expect(browserRefusalSentence("workspace_off", "Shopper", "Max")).toBe(BROWSER_COPY.workspaceOff);
    expect(browserRefusalSentence("workspace_closed", "Shopper", "Max")).toBe(BROWSER_COPY.workspaceClosed);
    expect(browserRefusalSentence("no_sites", "Shopper", "Max")).toBe(BROWSER_COPY.noSites("Shopper"));
    expect(browserRefusalSentence("teammate_off", "Shopper", "Max")).toBe(BROWSER_COPY.teammateOff);
    expect(browserRefusalSentence("other_teammate", "Researcher", "Max", { otherName: "Shopper" })).toBe(BROWSER_COPY.otherTeammate("Shopper"));
    expect(browserRefusalSentence("other_teammate", "Researcher", "Max")).toBe(BROWSER_COPY.otherTeammateUnnamed);
    expect(browserRefusalSentence("person_has_it", "Shopper", "Max")).toBe(BROWSER_COPY.personHasIt("Max"));
    expect(browserRefusalSentence("workspace_at_once", "Shopper", "Max", { atOnce: 2 })).toBe(BROWSER_COPY.workspaceAtOnce(2));
    expect(browserRefusalSentence("provider_busy", "Shopper", "Max", { retryAfter: 12 })).toBe(BROWSER_COPY.providerBusy(12));
    expect(browserRefusalSentence("time_cap", "Shopper", "Max", { minutes: 15 })).toBe(BROWSER_COPY.timeCap(15));
    expect(browserRefusalSentence("none", "Shopper", "Max")).toBe(BROWSER_COPY.noBrowserYet);
    expect(browserRefusalSentence("busy", "Shopper", "Max")).toBe(BROWSER_COPY.starting);
  });

  it("names where a turn runs when that is why it has no browser (Decision 21)", () => {
    expect(browserNotHereOf("TALK", false)).toBe("talk");
    expect(browserNotHereOf("ROUTINE", false)).toBe("routine");
    expect(browserNotHereOf("AUTOMATION", false)).toBe("automation");
    expect(browserNotHereOf("DELEGATED", false)).toBe("delegated");
    expect(browserNotHereOf("CHAT", true)).toBe("group");
    expect(browserNotHereOf("RESUME", true)).toBe("group");
    expect(browserNotHereOf("CHAT", false)).toBeNull();
    expect(browserNotHereOf("RESUME", false)).toBeNull();
    expect(browserNotHereSentence("group")).toBe(BROWSER_COPY.notHereGroup);
    expect(browserNotHereSentence("routine")).toBe(BROWSER_COPY.notHereRoutine);
  });
});

describe("what is kept and named", () => {
  it("names a browser card by its kind, never an element's words", () => {
    expect(browserTitle("click")).toBe("Click on the page");
    expect(browserTitle("type_text")).toBe("Type on the page");
    expect(browserTitle("ask_to_take_over")).toBe("Ask you to take over the browser");
    expect(browserTitle("read_page")).toBe("Read web pages");
  });

  it("keeps of a read its site and a count, never its text or a link (Decision 23)", () => {
    const view = { site: "docs.proof.test", url: "http://docs.proof.test/", title: "Docs", part: 2, parts: 3, text: "Every word of the page", elements: [{ id: "e1", name: "Go" }], links: [{ id: "l1", href: "http://docs.proof.test/x" }], note: "x" };
    expect(browserStored(view)).toEqual({ site: "docs.proof.test", ok: true, part: 2 });
    expect(browserStored({ site: "docs.proof.test", count: 3, matches: [{ text: "secret" }] })).toEqual({ site: "docs.proof.test", ok: true, count: 3 });
    expect(browserStored({ site: "<script>", ok: true })).toEqual({ site: null, ok: true });
  });

  it("audits a step's site, kind, session and the element's role, never its words or typed text (Decision 24)", () => {
    const facts = browserAuditFacts("type_text", { ...card({ text: "my secret words", name: "Search reviews" }), role: "textbox", target: { ...target, role: "textbox", name: "Search reviews" } }, { ok: true, site: "shop.proof.test" });
    expect(facts).toEqual({ site: "shop.proof.test", kind: "type", browserSessionId: "bs1", element: "textbox", outcome: "ok" });
    expect(JSON.stringify(facts)).not.toContain("secret");
    expect(JSON.stringify(facts)).not.toContain("Search reviews");
  });

  it("says how an act came out: ran, did nothing, or may have gone through (review of Phase 4 step 3)", () => {
    expect(browserActOutcome({ ok: true, site: "shop.proof.test" })).toBe("ok");
    expect(browserActOutcome({ error: BROWSER_COPY.pageChanged })).toBe("failed");
    expect(browserActOutcome({ error: BROWSER_COPY.unknownOutcome, unknownOutcome: true })).toBe("unknown");
    expect(browserAuditFacts("click", { ...card() }, { error: "x", unknownOutcome: true }).outcome).toBe("unknown");
  });

  it("says an act after which the page tried a refused hop may have gone through (review of Phase 4 step 3)", () => {
    expect(actSentence({ ok: false, code: "blocked_hop", host: "exfil.proof.test" }, "Max")).toBe(BROWSER_COPY.mayHaveGoneThrough("exfil.proof.test"));
    expect(actSentence({ ok: false, code: "blocked_hop", host: "exfil.proof.test" }, "Max")).not.toBe(BROWSER_COPY.redirectRefused("exfil.proof.test"));
  });

  it("counts each tool per answer, the three acts sharing one step asked (Decision 22)", () => {
    expect(Object.keys(BROWSER_TOOL_COUNTS).sort()).toEqual([...BROWSER_TOOL_NAMES].sort());
    expect(BROWSER_TOOL_COUNTS.open_page).toMatchObject({ key: "opens", max: 8 });
    expect(BROWSER_TOOL_COUNTS.read_page).toMatchObject({ key: "reads", max: 6 });
    expect(BROWSER_TOOL_COUNTS.show_page).toMatchObject({ key: "shows", max: 3 });
    for (const t of ["click", "type_text", "select_option"] as const) expect(BROWSER_TOOL_COUNTS[t]).toMatchObject({ key: "asks", max: 1 });
    expect(BROWSER_TOOL_COUNTS.ask_to_take_over).toMatchObject({ key: "takeOvers", max: 1 });
    expect(BROWSER_TOOL_COUNTS.close_browser).toBeNull();
  });

  it("compares pages without their fragment, and names one by its site and path", () => {
    expect(pageKey("http://shop.proof.test/checkout#pay")).toBe("http://shop.proof.test/checkout");
    expect(pageWords("http://shop.proof.test/checkout?card=4242#pay")).toBe("shop.proof.test/checkout");
    expect(pageWords("https://docs.proof.test/")).toBe("docs.proof.test");
  });

  // Review round 1 of Phase 4.
  it("names a page whose path carries a code by its redacted path, and keeps its origin and sealed address apart", () => {
    expect(pageWords("https://accounts.proof.test/verify-code/482913?state=x")).toBe("accounts.proof.test/verify-code/[hidden]");
    expect(pageWords("https://shop.proof.test/caf%C3%A9")).toBe("shop.proof.test/caf%C3%A9");
    expect(pageOrigin("https://shop.proof.test/checkout?token=abc#x")).toBe("https://shop.proof.test");
    expect(pageOrigin("not a url")).toBe("");
    expect(pageKeyHash("https://shop.proof.test/checkout?token=abc#pay")).toBe(sealWords("https://shop.proof.test/checkout?token=abc"));
    expect(pageKeyHash("https://shop.proof.test/checkout?token=abc")).not.toBe(pageKeyHash("https://shop.proof.test/checkout?token=abd"));
  });
});

describe("browserCard", () => {
  it("shows a click's page, element, warnings, that it may not be undone and its picture, with no link to the site", () => {
    const p = browserCard("click", card());
    expect(p).toEqual({
      title: 'Click "Place order"',
      lines: [BROWSER_COPY.pageLine("shop.proof.test/checkout"), BROWSER_COPY.elementLine('the button "Place order"'), BROWSER_COPY.buysLine, BROWSER_COPY.submitsLine, BROWSER_COPY.cantUndo],
      target: { label: "shop.proof.test" },
      shot: { id: "sh0123456789abcdef0123456789abcdef", width: 480, height: 320 },
      browser: { sessionId: "bs1", site: "shop.proof.test" },
    });
    expect(browserCard("click", card({ shotId: null, shot: null })).lines).toContain(BROWSER_COPY.noPicture);
  });

  it("shows every word a typing types, and that Enter may send the form", () => {
    const p = browserCard("type_text", card({ role: "textbox", name: "Search reviews", text: "gift cards for the team", pressEnter: true }));
    expect(p.title).toBe('Type into "Search reviews"');
    expect(p.body).toBe("gift cards for the team");
    expect(p.lines).toEqual([BROWSER_COPY.pageLine("shop.proof.test/checkout"), BROWSER_COPY.fieldLine("Search reviews"), BROWSER_COPY.pressEnterLine, BROWSER_COPY.submitsLine]);
  });

  it("says a typing replaces what a filled field holds (review of Phase 4 step 3)", () => {
    const p = browserCard("type_text", card({ role: "textbox", name: "Nickname", text: "Max", replaces: true, inForm: false }));
    expect(p.lines).toEqual([BROWSER_COPY.pageLine("shop.proof.test/checkout"), BROWSER_COPY.fieldLine("Nickname"), BROWSER_COPY.replacesLine]);
    expect(browserCard("type_text", card({ role: "textbox", name: "Nickname", text: "Max", inForm: false })).lines).not.toContain(BROWSER_COPY.replacesLine);
  });

  it("asks the person to take over on its own card, with why, what the teammate sees and whom to trust", () => {
    const p = browserCard("ask_to_take_over", { browserSessionId: "bs1", site: "login.proof.test", pageUrl: "http://login.proof.test", pageKeyHash: pageKeyHash("http://login.proof.test/"), page: "login.proof.test", shotId: null, shot: null, reason: "sign_in" });
    expect(p).toEqual({
      title: BROWSER_COPY.takeOverTitle("login.proof.test"),
      lines: [BROWSER_COPY.TAKE_OVER_REASON.sign_in, BROWSER_COPY.takeOverBlind, BROWSER_COPY.takeOverTrust("login.proof.test"), BROWSER_COPY.pageLine("login.proof.test")],
      target: { label: "login.proof.test" },
      browser: { sessionId: "bs1", site: "login.proof.test", takeOver: true },
    });
  });
});

describe("storedCardInput", () => {
  it("reads back what a preparation stored, and nothing a planted or broken row could add", () => {
    const stored = { ...card(), extra: "ignored" };
    expect(storedCardInput("click", stored)).toEqual(card());
    expect(storedCardInput("click", { ...card(), target: { ...target, kind: "laser" } })).toBeNull();
    // Sealed words that are not 64 hex digits are no seal (review round 1 of Phase 4).
    expect(storedCardInput("click", { ...card(), target: { ...target, nameHash: "Place order" } })).toBeNull();
    expect(storedCardInput("click", { ...card(), target: { ...target, hrefHash: "x" } })).toBeNull();
    expect(storedCardInput("click", { ...card(), pageKeyHash: "http://shop.proof.test/checkout?step=2" })).toBeNull();
    expect(storedCardInput("click", { ...card(), pageUrl: "not a url" })).toBeNull();
    expect(storedCardInput("click", { ...card(), element: "#buy" })).toBeNull();
    expect(storedCardInput("click", { ...card(), site: "evil host" })).toBeNull();
    expect(storedCardInput("click", { ...card(), browserSessionId: undefined })).toBeNull();
    expect(storedCardInput("type_text", { ...card(), text: 7 })).toBeNull();
    expect(storedCardInput("select_option", card())).toBeNull();
    expect(storedCardInput("ask_to_take_over", { browserSessionId: "bs1", site: "login.proof.test", pageUrl: "http://login.proof.test/", reason: "anything" })).toBeNull();
    expect(storedCardInput("click", { ...card(), warnings: ["buys", "rm -rf"] })?.warnings).toEqual(["buys"]);
  });

  it("needs an act's document, its twins, anchor and place, and a choice's label and index (review of Phase 4 step 3)", () => {
    expect(storedCardInput("click", { ...card(), documentId: undefined })).toBeNull();
    for (const bad of [{ twins: undefined }, { twins: 0 }, { twin: 1, twins: 1 }, { at: -1 }, { at: undefined }]) {
      expect(storedCardInput("click", { ...card(), target: { ...target, ...bad } }), JSON.stringify(bad)).toBeNull();
      expect(storedCardInput("click", { ...card(), target: { ...rawTarget, ...bad } }), `a card stored before ${JSON.stringify(bad)}`).toBeNull();
    }
    // The anchor in each form (review round 2 of Phase 4): sealed, 64 hex digits; the reader's own, at most 16 characters.
    for (const bad of [{ anchorHash: undefined }, { anchorHash: "1a2b3c4d" }, { anchorHash: "x".repeat(64) }]) {
      expect(storedCardInput("click", { ...card(), target: { ...target, ...bad } }), `anchorHash ${String(bad.anchorHash)}`).toBeNull();
    }
    for (const bad of [{ anchor: undefined }, { anchor: "x".repeat(40) }]) {
      expect(storedCardInput("click", { ...card(), target: { ...rawTarget, ...bad } }), `a card stored before, anchor ${String(bad.anchor)}`).toBeNull();
    }
    const choice = card({ role: "combobox", name: "Country", option: "Zimbabwe", optionLabel: "Zimbabwe", optionIndex: 249 });
    expect(storedCardInput("select_option", choice)).toMatchObject({ option: "Zimbabwe", optionLabel: "Zimbabwe", optionIndex: 249 });
    expect(storedCardInput("select_option", { ...choice, optionIndex: undefined })).toBeNull();
    expect(storedCardInput("select_option", { ...choice, optionIndex: 1.5 })).toBeNull();
    expect(storedCardInput("select_option", { ...choice, optionLabel: undefined })).toBeNull();
    expect(storedCardInput("type_text", { ...card(), text: "Max", replaces: true })?.replaces).toBe(true);
    // A take over is asked on a page, never acted on: it needs no document.
    expect(storedCardInput("ask_to_take_over", { browserSessionId: "bs1", site: "login.proof.test", pageUrl: "http://login.proof.test/", reason: "sign_in" })).toMatchObject({ reason: "sign_in" });
  });

  // Review round 1 of Phase 4.
  it("reads a card stored before, with its whole address and raw words, into the sealed form it compares by", () => {
    const before = { ...card(), pageUrl: "http://shop.proof.test/checkout?step=2&token=SECRET42", pageKeyHash: undefined, page: "shop.proof.test/verify-code/482913", target: rawTarget };
    delete (before as Record<string, unknown>).pageKeyHash;
    const read = storedCardInput("click", before);
    expect(read).toEqual({ ...card(), pageKeyHash: pageKeyHash("http://shop.proof.test/checkout?step=2&token=SECRET42"), page: "shop.proof.test/checkout" });
    expect(JSON.stringify(read)).not.toContain("SECRET42");
    expect(read?.target).toEqual(sealFingerprint(rawTarget));
    // A take over request stored before reads the same way.
    expect(storedCardInput("ask_to_take_over", { browserSessionId: "bs1", site: "login.proof.test", pageUrl: "http://login.proof.test/?code=1234", reason: "sign_in" })).toMatchObject({ pageUrl: "http://login.proof.test", pageKeyHash: pageKeyHash("http://login.proof.test/?code=1234") });
  });

  // Review round 2 of Phase 4: the anchor sealed too.
  it("stores the anchor only sealed, and reads a card stored before it, its name sealed and the reader's anchor plain, into the sealed form", () => {
    // Before: the stored target kept `anchor: "1a2b3c4d"`, the reader's unkeyed 32 bit hash.
    expect(target).not.toHaveProperty("anchor");
    expect(target.anchorHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(card())).not.toContain("1a2b3c4d");
    expect(storedCardInput("click", card())?.target).toEqual(target);
    // A card stored in round 1: the name and link sealed, the anchor as the reader gave it.
    const { anchorHash: _sealed, ...round1 } = target;
    void _sealed;
    const read = storedCardInput("click", { ...card(), target: { ...round1, anchor: "1a2b3c4d" } });
    expect(read?.target).toEqual(target);
    expect(read?.target).toEqual(sealFingerprint(rawTarget));
    expect(JSON.stringify(read)).not.toContain("1a2b3c4d");
    // Another anchor read from a card stored before seals to another seal: it compares as a page that changed.
    expect(storedCardInput("click", { ...card(), target: { ...round1, anchor: "5e6f7a8b" } })?.target?.anchorHash).not.toBe(target.anchorHash);
  });
});

// Review round 4 of Phase 4: a Stop holds for the rest of its answer.
describe("an end that holds for its answer", () => {
  it("holds exactly the ends a person chose, and nothing that is not an end", () => {
    expect([...HELD_END_REASONS]).toEqual(["stopped", "turned_off", "plan", "left", "deactivated", "no_access", "workspace_closed", "teammate_off", "admin_stopped"]);
    for (const r of END_REASONS) expect(endHolds(r), r).toBe(HELD_END_REASONS.includes(r));
    for (const r of [null, undefined, "", "nonsense", "constructor", "toString", 1]) expect(endHolds(r), String(r)).toBe(false);
  });

  it("refuses open_page in the card's own words, never inviting a new browser", () => {
    for (const r of HELD_END_REASONS) {
      const said = closedForAnswerSentence(r);
      expect(said, r).toBe(BROWSER_COPY.closedForAnswer(BROWSER_PANEL_COPY.ENDED_WORDS[r]));
      expect(said, r).not.toMatch(/Open a page|open_page|start a new one|Try again/);
      expect(browserRefusalSentence("closed_in_answer", "Shopper", "Max", { endReason: r }), r).toBe(said);
    }
    // A reason that does not hold reads as the card's plain "Closed.", never as one it was not.
    expect(closedForAnswerSentence("idle")).toBe(BROWSER_COPY.closedForAnswer("Closed."));
    expect(browserRefusalSentence("closed_in_answer", "Shopper", "Max")).toBe(BROWSER_COPY.closedForAnswer("Closed."));
  });

  it("answers an ended browser by its reason when the refusal carries one, and the time cap with no minutes by its reason", () => {
    expect(browserRefusalSentence("ended", "Shopper", "Max", { endReason: "stopped" })).toBe(BROWSER_COPY.closedBecause("You stopped it."));
    expect(browserRefusalSentence("ended", "Shopper", "Max")).toBe(BROWSER_COPY.browserClosed);
    // Before: "The browser closed. Open a page to start a new one."
    expect(browserRefusalSentence("time_cap", "Shopper", "Max")).toBe(BROWSER_COPY.closedBecause("Closed: it reached its time limit."));
  });
});
