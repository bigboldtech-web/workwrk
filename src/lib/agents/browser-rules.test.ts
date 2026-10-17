// The rules every browser call is held to (src/lib/agents/browser-rules.ts,
// docs/plans/ai-teammates-phase4.md step 3): every refusal its real reason
// (Decision 33), the model's name for a step its kind (Decision 15), a
// record's site and count only and an audit row's role only (Decisions 23
// and 24), the answer's counts (Decision 22), and the cards built from their
// stored input alone, which an approval reads back defensively.

import { describe, expect, it } from "vitest";
import {
  BROWSER_STEP_KIND,
  BROWSER_TOOL_COUNTS,
  actForPersonLine,
  actSentence,
  approvalRefusal,
  browserActOutcome,
  browserAuditFacts,
  browserCard,
  browserNotHereOf,
  browserNotHereSentence,
  browserRefusalSentence,
  browserStored,
  browserTitle,
  closedForAnswerSentence,
  closedForPersonLine,
  closedSentence,
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
    // Phase 5 step 1: a fill card is the answer's one step asked (Decision 19), a request to be shown its one take over request.
    expect(BROWSER_TOOL_COUNTS.fill_fields).toMatchObject({ key: "asks", max: 1 });
    expect(BROWSER_TOOL_COUNTS.ask_to_show_me).toMatchObject({ key: "takeOvers", max: 1 });
    expect([BROWSER_STEP_KIND.fill_fields, BROWSER_STEP_KIND.ask_to_show_me]).toEqual(["type", "take_over"]);
    // The model and the history name them by their neutral titles, never a field's words.
    expect([browserTitle("fill_fields"), browserTitle("ask_to_show_me")]).toEqual(["Fill in fields on the page", "Ask you to show it how in the browser"]);
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

// Review round 5 of Phase 4: an answer that can start no browser is never
// told to open one.
describe("a browser that closed, told to an answer that can start no other", () => {
  const INVITES = /Open a page|open_page first|start a new one|Open the page again|Try again/;

  it("says the two inviting sentences without the invitation, and every other end as before", () => {
    // Before: closedSentence took no such choice, and said "Open a page to start a new one" and "Open the page again to start a new one".
    expect(closedSentence(null, undefined, { mayOpen: false })).toBe(BROWSER_COPY.closedNoOther);
    expect(closedSentence("nonsense", undefined, { mayOpen: false })).toBe(BROWSER_COPY.closedNoOther);
    expect(closedSentence("restarted", undefined, { mayOpen: false })).toBe(BROWSER_COPY.restartedNoOther);
    // A failed start has its own sentence since the polish after review round 6 (below).
    for (const r of END_REASONS.filter((x) => x !== "restarted" && x !== "start_failed")) {
      const said = closedSentence(r, undefined, { mayOpen: false });
      expect(said, r).toBe(closedSentence(r));
      expect(INVITES.test(said), r).toBe(false);
    }
    expect(closedSentence("time_cap", 15, { mayOpen: false })).toBe(BROWSER_COPY.timeCap(15));
    // Where the answer may still start one, or nothing says: as before.
    expect(closedSentence(null, undefined, { mayOpen: true })).toBe(BROWSER_COPY.browserClosed);
    expect(closedSentence("restarted")).toBe(BROWSER_COPY.restarted);
  });

  it("browserRefusalSentence passes the choice on for ended, restarted and the time cap", () => {
    const no = { mayOpen: false };
    expect(browserRefusalSentence("ended", "Shopper", "Max", no)).toBe(BROWSER_COPY.closedNoOther);
    expect(browserRefusalSentence("restarted", "Shopper", "Max", no)).toBe(BROWSER_COPY.restartedNoOther);
    expect(browserRefusalSentence("time_cap", "Shopper", "Max", { ...no, minutes: 15 })).toBe(BROWSER_COPY.timeCap(15));
    expect(browserRefusalSentence("restarted", "Shopper", "Max")).toBe(BROWSER_COPY.restarted);
    expect(browserRefusalSentence("ended", "Shopper", "Max", { mayOpen: true })).toBe(BROWSER_COPY.browserClosed);
  });

  it("closedForAnswerSentence quotes any known reason when asked, a reason it does not know as the card's plain line", () => {
    // A failed start drew no card: its own sentence since the polish after review round 6 (below).
    for (const r of END_REASONS.filter((x) => x !== "start_failed")) {
      const said = closedForAnswerSentence(r, { anyReason: true });
      expect(said, r).toBe(BROWSER_COPY.closedForAnswer((BROWSER_PANEL_COPY.ENDED_WORDS as Record<string, string>)[r]));
      expect(INVITES.test(said), r).toBe(false);
    }
    for (const r of [null, undefined, "", "nonsense", "constructor"]) expect(closedForAnswerSentence(r, { anyReason: true }), String(r)).toBe(BROWSER_COPY.closedForAnswer("Closed."));
    // Not asked: a reason that does not hold still reads "Closed." (round 4).
    expect(closedForAnswerSentence("idle")).toBe(BROWSER_COPY.closedForAnswer("Closed."));
  });
});

// Polish after review round 6 of Phase 4: the person reads their own words at
// an approval, a failed start is never told as a closed browser with a card,
// and no answer that can start a browser is invited to.
describe("polish after review round 6 of Phase 4", () => {
  /** What the teammate is told, never shown to the person: "the person", a tool's name, what this answer may open. */
  const MODEL_WORDS = /the person|open_page|close_browser|This answer|A teammate doesn't|Open a page|start a new one/i;
  const INVITES = /Open a page|open_page first|start a new one|Open the page again|Try again/;
  const DASH = /\u2014|\u2013|--/;

  it("says a browser that closed before an approved step in the person's words: the browser card's own end line, never the teammate's sentence", () => {
    // Last polish of Phase 4: the plain "Closed." (left, deactivated) and "It didn't start." add nothing after it, so the line stands alone.
    const plain = new Set(["left", "deactivated", "start_failed"]);
    for (const r of END_REASONS) {
      const line = closedForPersonLine(r);
      expect(line, r).toBe(BROWSER_PANEL_COPY.stepClosed(plain.has(r) ? null : (BROWSER_PANEL_COPY.ENDED_WORDS as Record<string, string>)[r]));
      expect(MODEL_WORDS.test(line), r).toBe(false);
      expect(DASH.test(line), r).toBe(false);
    }
    for (const r of [null, undefined, "", "nonsense", "constructor", 1]) expect(closedForPersonLine(r), String(r)).toBe("The browser closed before the step could run, so nothing was done.");
    expect(closedForPersonLine("stopped")).toBe("The browser closed before the step could run, so nothing was done. You stopped it.");
    for (const line of [BROWSER_PANEL_COPY.stepsUsedUp, BROWSER_PANEL_COPY.stepClosed(null)]) {
      expect(MODEL_WORDS.test(line), line).toBe(false);
      expect(DASH.test(line), line).toBe(false);
    }
  });

  it("answers a card's own session refused at its approval with the teammate's sentence and, for a browser closed or gone, the person's own", () => {
    // Before: the one sentence, closedNoOther or restartedNoOther, reached the card and the chat line.
    expect(approvalRefusal("ended", "Shopper", "Max")).toEqual({ error: BROWSER_COPY.closedNoOther, forPerson: closedForPersonLine(null) });
    expect(approvalRefusal("restarted", "Shopper", "Max")).toEqual({ error: BROWSER_COPY.restartedNoOther, forPerson: closedForPersonLine("restarted") });
    expect(approvalRefusal("ended", "Shopper", "Max", { endReason: "stopped" })).toEqual({ error: BROWSER_COPY.closedBecause("You stopped it."), forPerson: closedForPersonLine("stopped") });
    expect(approvalRefusal("ended", "Shopper", "Max", { endReason: "time_cap", minutes: 15 })).toEqual({ error: BROWSER_COPY.timeCap(15), forPerson: closedForPersonLine("time_cap") });
    expect(approvalRefusal("time_cap", "Shopper", "Max", { minutes: 15 })).toEqual({ error: BROWSER_COPY.timeCap(15), forPerson: closedForPersonLine("time_cap") });
    // The card's session row gone: before, "No page is open. Open one with open_page first." on the card.
    expect(approvalRefusal("none", "Shopper", "Max")).toEqual({ error: BROWSER_COPY.noBrowserNoOther, forPerson: closedForPersonLine(null) });
    // A refusal whose sentence is the person's already keeps it alone.
    expect(approvalRefusal("other_teammate", "Shopper", "Max", {})).toEqual({ error: BROWSER_COPY.otherTeammateUnnamed });
    for (const reason of ["ended", "restarted", "time_cap", "none"] as const) {
      const r = approvalRefusal(reason, "Shopper", "Max");
      expect(INVITES.test(r.error), reason).toBe(false);
      expect(r.forPerson && MODEL_WORDS.test(r.forPerson), reason).toBe(false);
    }
  });

  it("tells no browser open as an invitation only where the answer may still start one", () => {
    // Before: noBrowserYet whatever the answer could do.
    expect(browserRefusalSentence("none", "Shopper", "Max", { mayOpen: false })).toBe(BROWSER_COPY.noBrowserNoOther);
    expect(browserRefusalSentence("none", "Shopper", "Max", { mayOpen: true })).toBe(BROWSER_COPY.noBrowserYet);
    expect(browserRefusalSentence("none", "Shopper", "Max")).toBe(BROWSER_COPY.noBrowserYet);
    for (const s of [BROWSER_COPY.noBrowserNoOther, BROWSER_COPY.tooManyStepsNoOther, BROWSER_COPY.startFailedNoOther]) {
      expect(INVITES.test(s), s).toBe(false);
      expect(DASH.test(s), s).toBe(false);
    }
  });

  it("says a failed start in its own words, never the browser card it never drew, and never try again where the answer can't", () => {
    // Before: 'The browser closed before this step, and the browser card says why: "It didn't start."', and for open_page's retry closedForAnswer's.
    expect(closedSentence("start_failed", undefined, { mayOpen: false })).toBe(BROWSER_COPY.startFailedNoOther);
    expect(closedForAnswerSentence("start_failed", { anyReason: true })).toBe(BROWSER_COPY.startFailedNoOther);
    expect(closedForAnswerSentence("start_failed")).toBe(BROWSER_COPY.startFailedNoOther);
    expect(browserRefusalSentence("ended", "Shopper", "Max", { endReason: "start_failed", mayOpen: false })).toBe(BROWSER_COPY.startFailedNoOther);
    // An answer that may still start one: no page is open, and it may open one.
    expect(closedSentence("start_failed", undefined, { mayOpen: true })).toBe(BROWSER_COPY.noBrowserYet);
    for (const s of [closedSentence("start_failed", undefined, { mayOpen: false }), closedForAnswerSentence("start_failed", { anyReason: true })]) {
      expect(s).not.toMatch(/browser card|closed/);
      expect(INVITES.test(s), s).toBe(false);
    }
  });
});

// Last polish of Phase 4: a failed start that used the answer's one start
// never says "Try again"; a browser that closed while it was starting drew
// no card; the person's line after "nothing was done" adds only what is
// news; a sensitive field in the person's own words.
describe("last polish of Phase 4", () => {
  const words = BROWSER_PANEL_COPY.ENDED_WORDS as Record<string, string>;
  const DASH = /\u2014|\u2013|--/;

  it("reads the person's line cleanly for every end reason: never '...nothing was done. Closed.', never 'It didn't start.' after 'closed' (item 7)", () => {
    for (const r of END_REASONS) {
      const line = closedForPersonLine(r);
      // Before: left and deactivated read "The browser closed before the step could run, so nothing was done. Closed."
      expect(line, r).not.toMatch(/nothing was done\. Closed\.?$/);
      expect(line, r).not.toContain("It didn't start.");
      // The plain line, then at most the card's reason, one sentence each, never a bare "Closed" after it.
      expect(line.startsWith(BROWSER_PANEL_COPY.stepClosed(null)), r).toBe(true);
      const after = line.slice(BROWSER_PANEL_COPY.stepClosed(null).length).trim();
      expect(["Closed", "Closed."], r).not.toContain(after);
      expect(line, r).toMatch(/\.$/);
      expect(line, r).not.toMatch(/ {2}|\.\./);
      expect(DASH.test(line), r).toBe(false);
    }
    for (const r of ["left", "deactivated", "start_failed"]) expect(closedForPersonLine(r), r).toBe("The browser closed before the step could run, so nothing was done.");
    expect(closedForPersonLine("idle")).toBe("The browser closed before the step could run, so nothing was done. Closed after 5 idle minutes.");
    expect(closedForPersonLine("admin_stopped")).toBe("The browser closed before the step could run, so nothing was done. An Owner or Admin stopped every browser in this workspace.");
  });

  it("says a failed start that used the answer's one start can't try again, and keeps 'Try again' where the start was not used (item 3)", () => {
    // Before: "Try again in a moment." and "Try again in 20 seconds." whatever the answer had used.
    expect(browserRefusalSentence("provider_unavailable", "Shopper", "Max", { mayOpen: false })).toBe(BROWSER_COPY.providerUnavailableNoOther);
    expect(browserRefusalSentence("provider_busy", "Shopper", "Max", { mayOpen: false, retryAfter: 20 })).toBe(BROWSER_COPY.providerBusyNoOther(20));
    expect(browserRefusalSentence("start_failed", "Shopper", "Max", { mayOpen: false })).toBe(BROWSER_COPY.startFailedNoOther);
    for (const r of ["provider_unavailable", "provider_busy", "start_failed"] as const) {
      expect(browserRefusalSentence(r, "Shopper", "Max", { mayOpen: false }), r).not.toMatch(/Try again/);
    }
    expect(browserRefusalSentence("provider_unavailable", "Shopper", "Max")).toBe(BROWSER_COPY.providerUnavailable);
    expect(browserRefusalSentence("provider_busy", "Shopper", "Max", { retryAfter: 20 })).toBe(BROWSER_COPY.providerBusy(20));
    expect(browserRefusalSentence("start_failed", "Shopper", "Max", { mayOpen: true })).toBe(BROWSER_COPY.startFailed);
  });

  it("quotes the chat's line, never the browser card, for a browser that closed while it was starting (item 4)", () => {
    for (const r of HELD_END_REASONS) {
      // Before: "...and the browser card says why: ..." for a card never drawn.
      // After the last polish: the plain "Closed." of a person who left or was deactivated is no reason, so it is not quoted.
      const plain = words[r] === "Closed.";
      const noCard = plain ? BROWSER_COPY.closedNoCardPlain : BROWSER_COPY.closedNoCard(words[r]);
      const forAnswer = plain ? BROWSER_COPY.closedForAnswerNoCardPlain : BROWSER_COPY.closedForAnswerNoCard(words[r]);
      expect(closedSentence(r, undefined, { noCard: true }), r).toBe(noCard);
      expect(closedForAnswerSentence(r, { noCard: true }), r).toBe(forAnswer);
      expect(browserRefusalSentence("closed_in_answer", "Shopper", "Max", { endReason: r, noCard: true }), r).toBe(forAnswer);
      expect(browserRefusalSentence("ended", "Shopper", "Max", { endReason: r, noCard: true, mayOpen: false }), r).toBe(noCard);
      for (const said of [closedSentence(r, undefined, { noCard: true }), closedForAnswerSentence(r, { noCard: true })]) {
        expect(said, r).not.toContain("browser card");
        expect(DASH.test(said), r).toBe(false);
      }
      // One that drew its card keeps the card's words.
      expect(closedForAnswerSentence(r), r).toBe(BROWSER_COPY.closedForAnswer(words[r]));
    }
    // A failed start says its own words whatever the card; no reason known says only that it closed.
    expect(closedSentence("start_failed", undefined, { noCard: true, mayOpen: false })).toBe(BROWSER_COPY.startFailedNoOther);
    expect(closedForAnswerSentence("start_failed", { noCard: true })).toBe(BROWSER_COPY.startFailedNoOther);
    expect(closedSentence(null, undefined, { noCard: true, mayOpen: false })).toBe(BROWSER_COPY.closedNoOther);
    expect(closedForAnswerSentence(null, { noCard: true })).toBe(BROWSER_COPY.closedForAnswerNoCardPlain);
  });

  it("never quotes a plain \"Closed.\" as the reason a browser closed while it was starting (after the last polish)", () => {
    for (const r of ["left", "deactivated"] as const) {
      expect(words[r]).toBe("Closed.");
      for (const said of [closedSentence(r, undefined, { noCard: true }), closedForAnswerSentence(r, { noCard: true }), closedForAnswerSentence(r, { noCard: true, anyReason: true })]) {
        expect(said, r).not.toContain('"Closed."');
      }
    }
    // A reason with words keeps them.
    expect(closedSentence("stopped", undefined, { noCard: true })).toBe(BROWSER_COPY.closedNoCard(words.stopped));
  });

  it("says a browser that couldn't be reached is not known to be closed (after the last polish)", () => {
    expect(browserRefusalSentence("not_reached", "Shopper", "Max")).toBe(BROWSER_COPY.notReachedNow);
    expect(approvalRefusal("not_reached", "Shopper", "Max")).toEqual({ error: BROWSER_COPY.notReachedNow });
  });

  it("says a sensitive field in the person's own words, and only that act (item 2)", () => {
    expect(actForPersonLine({ ok: false, code: "sensitive" })).toBe(BROWSER_PANEL_COPY.sensitiveStep);
    for (const code of ["not_found", "changed", "covered", "frame", "disabled", "lost_before", "unknown_outcome", "blocked_hop"] as const) {
      expect(actForPersonLine({ ok: false, code }), code).toBeUndefined();
    }
    expect(BROWSER_PANEL_COPY.sensitiveStep).not.toMatch(/the person|Max|take over/i);
  });
});
