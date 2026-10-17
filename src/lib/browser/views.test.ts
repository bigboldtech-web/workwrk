// The session views' words (src/lib/browser/views.ts): one line per step
// kind, by host alone, one per end reason, and a step's line never carries
// an address path.

import { describe, expect, it } from "vitest";
import { BROWSER_PANEL_COPY, RECORDING_COPY } from "@/lib/agents/teammate-copy";
import { END_REASONS, STEP_KINDS } from "./types";
import { STEP_OUTCOMES, type SessionStatus } from "./types";
import {
  browserCardState,
  browserSectionShown,
  costWords,
  endedLine,
  hostOf,
  newestPageShot,
  outcomeWord,
  sessionMinutes,
  shotSrc,
  stepLine,
  stepViewOf,
  takeOverForStep,
  takeOverRequestOf,
  usageLines,
  type ComputerRefusal,
} from "./views";

describe("stepLine", () => {
  it("says each kind by its host", () => {
    expect(STEP_KINDS.map((kind) => stepLine({ kind, site: "docs.proof.test", outcome: "ok" }))).toEqual([
      "Opened docs.proof.test",
      "Read docs.proof.test",
      "Searched docs.proof.test",
      "Scrolled docs.proof.test",
      "Showed you docs.proof.test",
      "Clicked on docs.proof.test",
      "Typed on docs.proof.test",
      "Chose an option on docs.proof.test",
      "You took over on docs.proof.test",
      "You gave it back",
      "Closed the browser",
      "Closed",
    ]);
  });

  it("names no site it does not know, and never more than the host it is given", () => {
    expect(stepLine({ kind: "open", site: null, outcome: "refused" })).toBe("Opened a page");
    expect(stepLine({ kind: "click", site: "  ", outcome: "ok" })).toBe("Clicked on a page");
  });
});

describe("endedLine", () => {
  it("has its own words for every end reason", () => {
    for (const r of END_REASONS) expect(endedLine(r), r).toBe((BROWSER_PANEL_COPY.ENDED_WORDS as Record<string, string>)[r]);
    expect(endedLine(null)).toBe("Closed");
    expect(endedLine("admin_stopped")).toBe("An Owner or Admin stopped every browser in this workspace.");
  });
});

describe("sessionMinutes", () => {
  it("is what an ended session was billed, and what a live one has run, within its reserve", () => {
    const startedAt = new Date("2026-10-11T10:00:00Z");
    expect(sessionMinutes({ status: "ended", startedAt, endedAt: new Date(), billedMinutes: 4, reservedMinutes: 15 }, new Date())).toBe(4);
    expect(sessionMinutes({ status: "ended", startedAt, endedAt: new Date(), billedMinutes: null, reservedMinutes: 15 }, new Date())).toBe(15);
    expect(sessionMinutes({ status: "live", startedAt, endedAt: null, billedMinutes: null, reservedMinutes: 15 }, new Date("2026-10-11T10:02:30Z"))).toBe(3);
    expect(sessionMinutes({ status: "live", startedAt, endedAt: null, billedMinutes: null, reservedMinutes: 15 }, new Date("2026-10-11T11:00:00Z"))).toBe(15);
  });
});

// Step 4: what the browser card and the settings section read.
describe("a view's steps never carry a path (step 4)", () => {
  it("names a host alone, whatever a row holds", () => {
    expect(hostOf("docs.proof.test")).toBe("docs.proof.test");
    expect(hostOf("Docs.Proof.Test")).toBe("docs.proof.test");
    expect(hostOf("https://shop.proof.test/checkout?card=4242424242424242#pay")).toBe("shop.proof.test");
    expect(hostOf("shop.proof.test/orders/1234")).toBe("shop.proof.test");
    expect(hostOf("max:secret@shop.proof.test:8443/x")).toBe("shop.proof.test");
    expect(hostOf("not a host")).toBeNull();
    expect(hostOf("")).toBeNull();
    expect(hostOf(null)).toBeNull();
    expect(stepLine({ kind: "open", site: "shop.proof.test/checkout?card=4242", outcome: "ok" })).toBe("Opened shop.proof.test");
  });

  it("builds each step from its row with its host, its line, its time and nothing else", () => {
    const row = { seq: 3, kind: "click", site: "https://shop.proof.test/checkout?email=max@proof.test", outcome: "ok", code: null, at: new Date("2026-10-11T10:00:00Z"), shotId: "sh1" };
    const v = stepViewOf(row);
    expect(v).toEqual({ seq: 3, kind: "click", site: "shop.proof.test", outcome: "ok", code: null, at: "2026-10-11T10:00:00.000Z", shotId: "sh1", line: "Clicked on shop.proof.test" });
    const json = JSON.stringify(v);
    expect(json).not.toContain("/checkout");
    expect(json).not.toContain("max@proof.test");
    // Fails without hostOf: the row's whole address reached the card.
    expect(stepViewOf({ ...row, kind: "open", site: "inject.proof.test/?q=the-notes" }).site).toBe("inject.proof.test");
  });

  it("says each outcome's word, and none for one that went as asked", () => {
    expect(STEP_OUTCOMES.map(outcomeWord)).toEqual(["", "not allowed", "didn't work", "waiting for you", "practice"]);
  });

  // Review round 3 follow-up of Phase 4: the proof's closed card listed
  // "You took over on login.proof.test, waiting for you" above the take over
  // itself, and kept saying so after the browser closed.
  it("reads a step that waited on its card as the ask, not the act", () => {
    expect(stepLine({ kind: "click", site: "shop.proof.test", outcome: "waiting" })).toBe("Asked to click on shop.proof.test");
    expect(stepLine({ kind: "type", site: "shop.proof.test", outcome: "waiting" })).toBe("Asked to type on shop.proof.test");
    expect(stepLine({ kind: "select", site: "shop.proof.test", outcome: "waiting" })).toBe("Asked to choose an option on shop.proof.test");
    expect(stepLine({ kind: "take_over", site: "login.proof.test", outcome: "waiting" })).toBe("Asked you to take over on login.proof.test");
    // The act once done, and every other outcome, as before.
    expect(stepLine({ kind: "take_over", site: "login.proof.test", outcome: "ok" })).toBe("You took over on login.proof.test");
    expect(stepLine({ kind: "click", site: "shop.proof.test", outcome: "failed" })).toBe("Clicked on shop.proof.test");
  });

  it("says waiting for you only while the ask's card is the one its session waits on", () => {
    const ask = { seq: 4, kind: "take_over", site: "login.proof.test", outcome: "waiting", code: null, at: new Date("2026-10-11T10:00:00Z"), shotId: null, actionId: "act1" };
    const open = stepViewOf(ask, "act1");
    expect(open).toMatchObject({ outcome: "waiting", line: "Asked you to take over on login.proof.test" });
    expect(outcomeWord(open.outcome)).toBe("waiting for you");
    // Decided, expired, another card waiting, or the browser closed: the ask alone.
    for (const waiting of [null, "act2"]) {
      const past = stepViewOf(ask, waiting);
      expect(past).toMatchObject({ outcome: "ok", line: "Asked you to take over on login.proof.test" });
      expect(outcomeWord(past.outcome)).toBe("");
    }
    // A row that names no card never reads as still waiting.
    expect(stepViewOf({ ...ask, actionId: null }, "act1").outcome).toBe("ok");
    // Other outcomes are kept whatever waits.
    expect(stepViewOf({ ...ask, outcome: "refused" }, null).outcome).toBe("refused");
  });
});

describe("browserCardState (step 4)", () => {
  const w = { actionId: "act1", kind: "act" as const };
  it("reads each status as the card shows it", () => {
    const of = (status: SessionStatus, waiting: typeof w | null = null) => browserCardState({ status, waiting });
    expect(of("starting")).toBe("live");
    expect(of("live")).toBe("live");
    expect(of("live", w)).toBe("waiting");
    expect(of("waiting", w)).toBe("waiting");
    expect(of("waiting")).toBe("waiting");
    expect(of("handed_over")).toBe("handed_over");
    expect(of("handed_over", w)).toBe("handed_over");
    expect(of("ending")).toBe("closed");
    expect(of("ended")).toBe("closed");
  });
});

describe("shotSrc (step 4)", () => {
  it("reads a picture only from its own route, and nothing for an id that is not one", () => {
    expect(shotSrc("sh_1-a")).toBe("/api/teammate-browser/shots/sh_1-a");
    expect(shotSrc("../../etc/passwd")).toBeNull();
    expect(shotSrc("https://evil.example.com/x.jpg")).toBeNull();
    expect(shotSrc("x".repeat(65))).toBeNull();
    expect(shotSrc("")).toBeNull();
    expect(shotSrc(null)).toBeNull();
  });
});

describe("the settings section's usage (step 4)", () => {
  const u = { minutesUsed: 120, minutesCap: 1000, atOnce: 1, atOnceCap: 2, sessionsToday: 7, sessionsTodayCap: 100, costCents: null };
  it("says the minutes, the browsers running and the sessions today, as numbers only", () => {
    expect(usageLines(u)).toEqual(["120 of 1,000 browser minutes used.", "1 of 2 running now.", "7 of 100 sessions today."]);
  });
  it("says about the cost only when the founder set a rate, in US dollars", () => {
    expect(usageLines({ ...u, costCents: 240 })).toEqual([...usageLines(u), "About $2.40 of browser time this month."]);
    expect(costWords(0)).toBe("$0.00");
    expect(costWords(123456)).toBe("$1,234.56");
  });
});

// Review of Phase 4 step 4.
describe("a take over request and the browser card (review of Phase 4 step 4)", () => {
  const ask = { actionId: "c-take", kind: "take_over" as const };
  const click = { actionId: "c-click", kind: "act" as const };

  it("the card's own Take over names the take over request that waits, and nothing else", () => {
    expect(takeOverRequestOf({ waiting: ask })).toBe("c-take");
    expect(takeOverRequestOf({ waiting: click })).toBeNull();
    expect(takeOverRequestOf({ waiting: null })).toBeNull();
    expect(takeOverRequestOf(null)).toBeNull();
  });

  it("a card drawn for a request takes over for it while it waits, live, waiting or already handed over", () => {
    expect(takeOverForStep({ status: "live", waiting: ask }, "c-take")).toBe("take");
    expect(takeOverForStep({ status: "waiting", waiting: ask }, "c-take")).toBe("take");
    // Taken from the browser card without naming it: the request still waits, so it is answered.
    expect(takeOverForStep({ status: "handed_over", waiting: ask }, "c-take")).toBe("take");
  });

  it("and never once the request no longer waits or the browser closed, so Done never asks again", () => {
    // Read as handed over through this very request (it is RUNNING, so it no longer waits).
    expect(takeOverForStep({ status: "handed_over", waiting: null }, "c-take")).toBe("done");
    // Decided elsewhere, or another card waits.
    expect(takeOverForStep({ status: "live", waiting: null }, "c-take")).toBe("done");
    expect(takeOverForStep({ status: "waiting", waiting: click }, "c-take")).toBe("done");
    expect(takeOverForStep({ status: "live", waiting: { actionId: "c-other", kind: "take_over" } }, "c-take")).toBe("done");
    for (const status of ["ending", "ended"] as const) expect(takeOverForStep({ status, waiting: ask }, "c-take"), status).toBe("done");
  });
});

describe("an open browser's newest page picture (review of Phase 4 step 4)", () => {
  const shot = (id: string, kind: "page" | "element", at: string) => ({ id, kind, at, expiresAt: "2026-10-12T10:00:00.000Z" });

  it("is the newest picture of a page the route still keeps", () => {
    expect(
      newestPageShot({
        shots: [shot("sh1", "page", "2026-10-11T10:00:00.000Z"), shot("sh2", "page", "2026-10-11T10:05:00.000Z"), shot("sh3", "element", "2026-10-11T10:06:00.000Z")],
      }),
    ).toBe("sh2");
    // Two at the same moment: the later listed.
    expect(newestPageShot({ shots: [shot("sh1", "page", "2026-10-11T10:00:00.000Z"), shot("sh2", "page", "2026-10-11T10:00:00.000Z")] })).toBe("sh2");
  });

  it("is never an act's picture, nor an id the shots route would not read, and nothing when none is kept", () => {
    expect(newestPageShot({ shots: [shot("sh3", "element", "2026-10-11T10:06:00.000Z")] })).toBeNull();
    expect(newestPageShot({ shots: [shot("../x", "page", "2026-10-11T10:06:00.000Z")] })).toBeNull();
    expect(newestPageShot({ shots: [] })).toBeNull();
  });
});

describe("whether the settings section is drawn (review of Phase 4 step 4)", () => {
  const v = (available: boolean, reason: ComputerRefusal | null) => ({ available, reason });

  it("draws nothing before an answer, nor where this WorkwrK does not offer the computer", () => {
    expect(browserSectionShown(null)).toBe(false);
    expect(browserSectionShown(undefined)).toBe(false);
    expect(browserSectionShown(v(false, "not_configured"))).toBe(false);
  });

  it("draws it once known to be available, or held back by the plan, a trial or a closed workspace", () => {
    expect(browserSectionShown(v(true, null))).toBe(true);
    expect(browserSectionShown(v(false, "plan"))).toBe(true);
    expect(browserSectionShown(v(false, "trial"))).toBe(true);
    expect(browserSectionShown(v(false, "workspace_closed"))).toBe(true);
  });
});

// Phase 5 step 2: a recording's start and end are a take over and a give back with code "recording".
describe("a recording's steps (Phase 5 step 2)", () => {
  it("read as showing how, by their host alone, and a plain take over as before", () => {
    // Before: "You took over on expenses.proof.test" and "You gave it back".
    expect(stepLine({ kind: "take_over", site: "expenses.proof.test", outcome: "ok", code: "recording" })).toBe(RECORDING_COPY.STEP_WORDS.recording("expenses.proof.test"));
    expect(stepLine({ kind: "give_back", site: "expenses.proof.test", outcome: "ok", code: "recording" })).toBe(RECORDING_COPY.STEP_WORDS.recordingEnd);
    expect(stepLine({ kind: "take_over", site: "expenses.proof.test/new?x=1", outcome: "ok", code: "recording" })).toBe("You showed it how on expenses.proof.test");
    expect(stepLine({ kind: "take_over", site: "login.proof.test", outcome: "ok", code: null })).toBe("You took over on login.proof.test");
    expect(stepViewOf({ seq: 1, kind: "take_over", site: "expenses.proof.test", outcome: "ok", code: "recording", at: new Date(0), shotId: null }).line).toBe("You showed it how on expenses.proof.test");
  });
});
