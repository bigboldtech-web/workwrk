// The eight module chapters, held to the rules they exist under.
//
// The point of these tests is not that the page renders. It is that every
// sentence on it is still coming out of the fixture and the pricing source,
// because the moment one is typed into the JSX instead, a truth gate stops
// reaching it and the site can print a mechanism that has not shipped.

import { describe, expect, it } from "vitest";

import {
  CAPABILITY_PAGES,
  MODULE_ORDER,
  capabilityPagesFor,
  isModuleId,
  moduleChapter,
  moduleDescription,
  moduleHeadline,
  moduleHref,
  clockLabel,
  spellCount,
  momentsFor,
  neighboursFor,
  tierLineFor,
  upcomingFor,
} from "./module-page";
import { pricing } from "../data/pricing";
import { narrationForBeat, stopShipped, tourLineFor, tuesday } from "../data/tuesday";

describe("the eight module ids", () => {
  it("is exactly the fixture's blocks, no more and no fewer", () => {
    expect([...MODULE_ORDER].sort()).toEqual(tuesday.hubs.map((h) => h.id).sort());
  });

  it("accepts only those eight", () => {
    for (const id of MODULE_ORDER) expect(isModuleId(id)).toBe(true);
    expect(isModuleId("settings")).toBe(false);
    expect(isModuleId("")).toBe(false);
    expect(isModuleId("../work")).toBe(false);
  });

  it("builds one route per block", () => {
    expect(moduleHref("work")).toBe("/product/work");
    const hrefs = MODULE_ORDER.map(moduleHref);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("the headline", () => {
  it("exists for every block", () => {
    for (const id of MODULE_ORDER) expect(moduleHeadline(id).length).toBeGreaterThan(10);
  });

  it("is short enough to set at display size", () => {
    // The reason this constant exists at all: the first version used the
    // gated story line as the H1, and Work's fallback ran to five lines of
    // 64px type before the lede began.
    for (const id of MODULE_ORDER) expect(moduleHeadline(id).length).toBeLessThanOrEqual(60);
  });

  it("names no clock, so it cannot assert a moment of the story", () => {
    for (const id of MODULE_ORDER) expect(moduleHeadline(id)).not.toMatch(/\d:\d\d/);
  });

  it("is empty for anything that is not a block", () => {
    expect(moduleHeadline("settings")).toBe("");
  });
});

describe("the story line is the gated one", () => {
  it("is the same string the module tour prints", () => {
    for (const id of MODULE_ORDER) {
      const hub = tuesday.hubs.find((h) => h.id === id);
      expect(moduleChapter(id)?.storyLine).toBe(tourLineFor(hub!));
    }
  });

  it("prints the fallback while the block's stop is unbuilt", () => {
    const docs = tuesday.hubs.find((h) => h.id === "docs")!;
    // Docs' line names stop 2's mechanism and carries a fallback.
    expect(docs.tourLineFallback).toBeTruthy();
    const expected = stopShipped(docs.tourLineStop!) ? docs.tourLine : docs.tourLineFallback;
    expect(moduleChapter("docs")?.storyLine).toBe(expected);
  });
});

describe("the moments", () => {
  it("are exactly the beats that name the block, in clock order", () => {
    for (const id of MODULE_ORDER) {
      const expected = tuesday.beats.filter((b) => b.hubs.includes(id)).map((b) => b.n);
      expect(momentsFor(id).map((m) => m.n)).toEqual(expected);
    }
  });

  it("every block appears in at least one beat", () => {
    for (const id of MODULE_ORDER) expect(momentsFor(id).length).toBeGreaterThan(0);
  });

  it("carry the gated narration, never the raw one when the stop is unbuilt", () => {
    for (const beat of tuesday.beats) {
      const hub = beat.hubs[0];
      const moment = momentsFor(hub).find((m) => m.n === beat.n)!;
      expect(moment.narration).toBe(narrationForBeat(beat));
      if (!moment.shipped) expect(moment.narration).toBe(beat.fallbackNarration);
    }
  });

  it("use the beat's own surface override where it has one", () => {
    // Stop 3's Docs block is the SOP at 10:30 and contract v2 at 11:15.
    const eleven = momentsFor("docs").find((m) => m.clock === "11:15");
    expect(eleven?.surface).toBe("contract-doc");
  });

  it("fall through to the block's default surface otherwise", () => {
    const nineOhThree = momentsFor("teams").find((m) => m.clock === "9:03");
    expect(nineOhThree?.surface).toBe(tuesday.hubs.find((h) => h.id === "teams")!.surface);
  });

  it("never list the block itself as a neighbour on the beat", () => {
    for (const id of MODULE_ORDER) {
      for (const moment of momentsFor(id)) expect(moment.withHubs).not.toContain(id);
    }
  });
});

describe("the neighbours", () => {
  it("are only blocks the storyboard actually wires", () => {
    for (const id of MODULE_ORDER) {
      for (const n of neighboursFor(id)) {
        const wired = [...tuesday.stops, ...tuesday.beats].some((s) => {
          const pair = "left" in s ? [s.left.hub, s.right.hub] : s.hubs;
          return pair.includes(id) && pair.includes(n.id);
        });
        expect(wired).toBe(true);
      }
    }
  });

  it("never include the block itself, and never repeat", () => {
    for (const id of MODULE_ORDER) {
      const ids = neighboursFor(id).map((n) => n.id);
      expect(ids).not.toContain(id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("carry the wire label the stop is allowed to print today", () => {
    for (const id of MODULE_ORDER) {
      for (const n of neighboursFor(id)) {
        const stop = tuesday.stops.find((s) => s.n === n.stop);
        if (!stop) continue;
        const allowed = !stop.wireLabelFallback
          ? stop.wireLabel
          : stop.truthGate.shipped
            ? stop.wireLabel
            : stop.wireLabelFallback;
        expect(n.wire).toBe(allowed);
      }
    }
  });

  it("point at routes that exist", () => {
    for (const id of MODULE_ORDER) {
      for (const n of neighboursFor(id)) expect(n.href).toBe(`/product/${n.id}`);
    }
  });
});

describe("upcoming features", () => {
  it("only ever lists stops whose truth gate says unbuilt", () => {
    for (const id of MODULE_ORDER) {
      for (const item of upcomingFor(id)) expect(stopShipped(item.stop)).toBe(false);
    }
  });

  it("only lists stops that touch the block", () => {
    for (const id of MODULE_ORDER) {
      for (const item of upcomingFor(id)) {
        const stop = tuesday.stops.find((s) => s.n === item.stop)!;
        expect([stop.left.hub, stop.right.hub]).toContain(id);
      }
    }
  });

  it("empties itself as the stops ship", () => {
    const anyUnbuilt = tuesday.stops.some((s) => !s.truthGate.shipped);
    const total = MODULE_ORDER.reduce((n, id) => n + upcomingFor(id).length, 0);
    expect(total > 0).toBe(anyUnbuilt);
  });
});

describe("the tier row", () => {
  it("names the tier a premium block starts on", () => {
    for (const m of pricing.premiumModules) {
      const hub = tuesday.hubs.find((h) => h.label === m.name)!;
      const from = pricing.tiers.find((t) => t.id === m.fromTier)!;
      expect(tierLineFor(hub.id)).toContain(from.name);
    }
  });

  it("says every tier for a block that is not premium", () => {
    const premiumLabels = pricing.premiumModules.map((m) => m.name);
    for (const hub of tuesday.hubs) {
      if (premiumLabels.includes(hub.label)) continue;
      expect(tierLineFor(hub.id)).toContain("every tier");
    }
  });

  it("says nothing at all for something that is not a block", () => {
    expect(tierLineFor("settings")).toBe("");
  });
});

describe("the capability pages", () => {
  it("all point under /features", () => {
    for (const page of CAPABILITY_PAGES) expect(page.href.startsWith("/features/")).toBe(true);
  });

  it("have unique routes", () => {
    const hrefs = CAPABILITY_PAGES.map((p) => p.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("are owned by a real block, or by the index", () => {
    for (const page of CAPABILITY_PAGES) {
      if (page.block === null) continue;
      expect(isModuleId(page.block)).toBe(true);
    }
  });

  it("partition cleanly: a page belongs to at most one chapter", () => {
    const listed = MODULE_ORDER.flatMap((id) => capabilityPagesFor(id).map((p) => p.href));
    expect(new Set(listed).size).toBe(listed.length);
  });
});

describe("the chapter as a whole", () => {
  it("resolves for every block and for nothing else", () => {
    for (const id of MODULE_ORDER) expect(moduleChapter(id)).not.toBeNull();
    expect(moduleChapter("settings")).toBeNull();
  });

  it("puts the block's first beat time on the chapter", () => {
    for (const id of MODULE_ORDER) {
      expect(moduleChapter(id)!.firstClock).toBe(momentsFor(id)[0]!.clock);
    }
  });

  it("describes itself without an em dash or a double hyphen", () => {
    for (const id of MODULE_ORDER) {
      const text = `${moduleDescription(id)} ${moduleHeadline(id)}`;
      expect(text).not.toMatch(/[—–―]/);
      expect(text).not.toMatch(/--(?![A-Za-z])|[A-Za-z]--[A-Za-z]/);
    }
  });

  it("describes only blocks", () => {
    expect(moduleDescription("settings")).toBe("");
  });
});

describe("the clock label", () => {
  it("reads the fixture's own morning rule: 7 through 12 are AM", () => {
    expect(clockLabel("9:04")).toBe("9:04 AM");
    expect(clockLabel("11:15")).toBe("11:15 AM");
    expect(clockLabel("12:30")).toBe("12:30 PM");
  });

  it("does not print 2:00 AM on the block whose whole beat is the afternoon", () => {
    expect(clockLabel("2:00")).toBe("2:00 PM");
    expect(clockLabel("6:02")).toBe("6:02 PM");
    expect(moduleChapter("planner")!.firstClock).toBe("2:00");
    expect(clockLabel(moduleChapter("planner")!.firstClock)).toContain("PM");
  });

  it("hands back anything it cannot read, rather than guessing", () => {
    expect(clockLabel("soon")).toBe("soon");
  });
});

describe("a moment's picture matches its sentence", () => {
  it("falls through to the stop's own surface before the block's default", () => {
    // The bug this covers: all five of Work's beats fell straight to
    // `my-work`, so the chapter printed one picture while the narration
    // moved from the task being created to it being done.
    const work = momentsFor("work").map((m) => m.surface);
    expect(new Set(work).size).toBeGreaterThan(1);
    for (const moment of momentsFor("work")) {
      const stop = tuesday.stops.find((s) => s.n === tuesday.beats.find((b) => b.n === moment.n)!.stop)!;
      const fromStop = stop.left.hub === "work" ? stop.left.surface : stop.right.surface;
      expect(moment.surface).toBe(fromStop);
    }
  });

  it("still prefers the beat's own override where there is one", () => {
    expect(momentsFor("docs").find((m) => m.clock === "11:15")?.surface).toBe("contract-doc");
  });
});

describe("spelled counts for display type", () => {
  it("spells one through ten", () => {
    expect(spellCount(8)).toBe("Eight");
    expect(spellCount(5, true)).toBe("five");
    expect(spellCount(1)).toBe("One");
  });

  it("hands back the digits for anything bigger, rather than inventing a word", () => {
    expect(spellCount(12)).toBe("12");
    expect(spellCount(14, true)).toBe("14");
  });
});
