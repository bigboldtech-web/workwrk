// The session views' words (src/lib/browser/views.ts): one line per step
// kind, by host alone, one per end reason, and a step's line never carries
// an address path.

import { describe, expect, it } from "vitest";
import { BROWSER_PANEL_COPY } from "@/lib/agents/teammate-copy";
import { END_REASONS, STEP_KINDS } from "./types";
import { STEP_OUTCOMES, type SessionStatus } from "./types";
import { browserCardState, costWords, endedLine, hostOf, outcomeWord, sessionMinutes, shotSrc, stepLine, stepViewOf, usageLines } from "./views";

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
    expect(usageLines(u)).toEqual(["120 of 1000 browser minutes used.", "1 of 2 running now.", "7 of 100 sessions today."]);
  });
  it("says about the cost only when the founder set a rate, in US dollars", () => {
    expect(usageLines({ ...u, costCents: 240 })).toEqual([...usageLines(u), "About $2.40 of browser time this month."]);
    expect(costWords(0)).toBe("$0.00");
    expect(costWords(123456)).toBe("$1,234.56");
  });
});
