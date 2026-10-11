// The session views' words (src/lib/browser/views.ts): one line per step
// kind, by host alone, one per end reason, and a step's line never carries
// an address path.

import { describe, expect, it } from "vitest";
import { BROWSER_PANEL_COPY } from "@/lib/agents/teammate-copy";
import { END_REASONS, STEP_KINDS } from "./types";
import { endedLine, sessionMinutes, stepLine } from "./views";

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
