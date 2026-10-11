// The rules every browser call is held to (src/lib/agents/browser-rules.ts,
// docs/plans/ai-teammates-phase4.md step 3): every refusal its real reason
// (Decision 33), the model's name for a step its kind (Decision 15), a
// record's site and count only and an audit row's role only (Decisions 23
// and 24), the answer's counts (Decision 22), and the cards built from their
// stored input alone, which an approval reads back defensively.

import { describe, expect, it } from "vitest";
import {
  BROWSER_TOOL_COUNTS,
  browserAuditFacts,
  browserCard,
  browserNotHereOf,
  browserNotHereSentence,
  browserRefusalSentence,
  browserStored,
  browserTitle,
  pageKey,
  pageWords,
  storedCardInput,
  type BrowserCardInput,
} from "./browser-rules";
import { BROWSER_COPY } from "./teammate-copy";
import { BROWSER_TOOL_NAMES } from "./tool-names";

const target = { tag: "button", role: "button", name: "Place order", kind: "none" as const, type: "submit", formHost: "shop.proof.test", href: null, twin: 0 };

const card = (o: Partial<BrowserCardInput> = {}): BrowserCardInput => ({
  browserSessionId: "bs1",
  site: "shop.proof.test",
  pageUrl: "http://shop.proof.test/checkout?step=2",
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
    expect(facts).toEqual({ site: "shop.proof.test", kind: "type", browserSessionId: "bs1", element: "textbox" });
    expect(JSON.stringify(facts)).not.toContain("secret");
    expect(JSON.stringify(facts)).not.toContain("Search reviews");
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

  it("asks the person to take over on its own card, with why, what the teammate sees and whom to trust", () => {
    const p = browserCard("ask_to_take_over", { browserSessionId: "bs1", site: "login.proof.test", pageUrl: "http://login.proof.test/", page: "login.proof.test", shotId: null, shot: null, reason: "sign_in" });
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
    expect(storedCardInput("click", { ...card(), element: "#buy" })).toBeNull();
    expect(storedCardInput("click", { ...card(), site: "evil host" })).toBeNull();
    expect(storedCardInput("click", { ...card(), browserSessionId: undefined })).toBeNull();
    expect(storedCardInput("type_text", { ...card(), text: 7 })).toBeNull();
    expect(storedCardInput("select_option", card())).toBeNull();
    expect(storedCardInput("ask_to_take_over", { browserSessionId: "bs1", site: "login.proof.test", pageUrl: "http://login.proof.test/", reason: "anything" })).toBeNull();
    expect(storedCardInput("click", { ...card(), warnings: ["buys", "rm -rf"] })?.warnings).toEqual(["buys"]);
  });
});
