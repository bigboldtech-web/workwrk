import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import {
  DOT_HEX,
  DOT_ORDER,
  beatByNumber,
  beatIsShipped,
  castInitials,
  castName,
  clockMinutes,
  hub,
  narrationFor,
  narrationForBeat,
  receiptLineLabel,
  receiptModules,
  replacesTag,
  stopByNumber,
  taskCaption,
  threadView,
  tourLineFor,
  clock24,
  trailUpTo,
  tuesday,
  wireLabelFor,
  type Stop,
} from "./tuesday";
import { category, categoryLabel, pricing } from "./pricing";
import { BRAND_BLUE, BRAND_GREEN, BRAND_RED, BRAND_YELLOW } from "@/components/brand/logo";

describe("the Tuesday fixture", () => {
  it("names the one workspace, the one template and the one deep link", () => {
    expect(tuesday.workspace.org).toBe("Northwind Ops");
    expect(tuesday.workspace.templateName).toBe("Tuesday: client onboarding");
    expect(tuesday.workspace.templateDeepLink).toBe("/signup?template=tuesday");
  });

  it("carries eight blocks, in rail order, with Goals in the eighth slot", () => {
    expect(tuesday.hubs).toHaveLength(8);
    expect(tuesday.hubs.map((h) => h.label)).toEqual([
      "Work",
      "Planner",
      "AI",
      "Talk",
      "Teams",
      "Docs",
      "Tables",
      "Goals",
    ]);
    // Settings is not a story block: admin is one FAQ answer (concept 3).
    expect(tuesday.hubs.some((h) => h.label === "Settings")).toBe(false);
  });

  it("gives every block a brand dot and never red, which is reserved for status inside a surface", () => {
    for (const h of tuesday.hubs) {
      expect(DOT_ORDER).toContain(h.dot);
      expect(h.dot).not.toBe("red");
    }
  });

  it("takes the four brand hexes from the brand, so they cannot drift from the logo", () => {
    expect(DOT_HEX).toEqual({
      yellow: BRAND_YELLOW,
      blue: BRAND_BLUE,
      red: BRAND_RED,
      green: BRAND_GREEN,
    });
    // The values, pinned once here so a change to the brand is a deliberate
    // change to this line and not a silent repaint of the marketing site.
    expect(DOT_HEX).toEqual({ yellow: "#FFCB00", blue: "#0073EA", red: "#FF3D57", green: "#00C875" });
  });

  it("only claims to replace categories that the pricing source actually prices", () => {
    for (const h of tuesday.hubs) {
      for (const id of h.replaces) {
        expect(category(id), `block ${h.label} replaces unknown category ${id}`).toBeDefined();
      }
    }
  });

  it("covers all fourteen priced categories across the eight blocks", () => {
    const claimed = new Set(tuesday.hubs.flatMap((h) => h.replaces));
    for (const c of pricing.categories) {
      expect(claimed.has(c.id), `no block replaces ${c.label}`).toBe(true);
    }
    expect(claimed.size).toBe(pricing.categories.length);
  });

  it("renders a Replaces tag for every block, including the one with no priced category", () => {
    for (const h of tuesday.hubs) {
      expect(replacesTag(h, categoryLabel)).toBeTruthy();
    }
    expect(replacesTag(hub("ai")!, categoryLabel)).toBe("the status meeting");
    expect(replacesTag(hub("tables")!, categoryLabel)).toBe("Spreadsheets, Forms");
  });

  it("resolves the cast, and never renders an id as a name", () => {
    expect(castName("sam")).toBe("Sam Okafor");
    expect(castInitials("maya")).toBe("MD");
    expect(castName("nobody")).toBe("nobody");
  });

  it("owns the task by role, not by a person typed into a field", () => {
    expect(tuesday.task.ownerResolvedFrom).toBe("Onboarding lead");
    expect(tuesday.role.title).toBe("Onboarding lead");
    expect(tuesday.role.holder).toBe(tuesday.task.owner);
  });

  it("spawns the task from exactly one SOP step, and that step carries the KPI", () => {
    const spawning = tuesday.sop.steps.filter((s) => s.spawnsTask);
    expect(spawning).toHaveLength(1);
    expect(spawning[0].n).toBe(3);
    expect(spawning[0].linkedKpi).toBe(tuesday.kpi.id);
  });
});

describe("the storyboard", () => {
  it("has six desktop stops and eight mobile beats, numbered without gaps", () => {
    expect(tuesday.stops.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(tuesday.beats.map((b) => b.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("moves the clock forward across the stops and never backwards", () => {
    const minutes = tuesday.stops.map((s) => clockMinutes(s.clock));
    for (const m of minutes) expect(Number.isFinite(m)).toBe(true);
    for (let i = 1; i < minutes.length; i++) {
      expect(minutes[i]).toBeGreaterThan(minutes[i - 1]);
    }
  });

  it("reads the workday clock the way a person says it: 7 to 12 morning, 1 to 6 afternoon", () => {
    expect(clockMinutes("9:03")).toBe(9 * 60 + 3);
    expect(clockMinutes("12:00")).toBe(12 * 60);
    expect(clockMinutes("2:30")).toBe(14 * 60 + 30);
    expect(clockMinutes("6:02")).toBe(18 * 60 + 2);
    expect(clockMinutes("2:30")).toBeGreaterThan(clockMinutes("11:15"));
    expect(Number.isNaN(clockMinutes("25:00"))).toBe(true);
    expect(Number.isNaN(clockMinutes("nine"))).toBe(true);
  });

  it("writes ONE clock format everywhere, so no two surfaces print the same moment differently", () => {
    const clocks = [
      ...tuesday.stops.map((s) => s.clock),
      ...tuesday.beats.map((b) => b.clock),
      ...tuesday.receipt.lines.map((l) => l.time),
      tuesday.client.signedAt,
      tuesday.contract.attachedAt,
      tuesday.huddle.at,
      tuesday.kudos.at,
      ...tuesday.thread.messages.map((m) => m.at),
    ];
    for (const c of clocks) {
      // 12-hour, no leading zero, no 24-hour hour, no AM or PM suffix.
      expect(c, `${c} is not the fixture clock format`).toMatch(/^(1[0-2]|[1-9]):[0-5]\d$/);
      expect(Number.isFinite(clockMinutes(c))).toBe(true);
    }
  });

  it("points every stop at blocks that exist", () => {
    for (const s of tuesday.stops) {
      expect(hub(s.left.hub), `stop ${s.n} left`).toBeDefined();
      expect(hub(s.right.hub), `stop ${s.n} right`).toBeDefined();
    }
  });

  it("gives every stop a truth gate with a shipped fallback narration", () => {
    for (const s of tuesday.stops) {
      expect(s.truthGate.mechanism.length).toBeGreaterThan(10);
      expect(s.truthGate.status.length).toBeGreaterThan(10);
      expect(s.truthGate.fallbackNarration.length).toBeGreaterThan(10);
      expect(typeof s.truthGate.shipped).toBe("boolean");
    }
  });

  it("prints the fallback narration for an unshipped mechanism, and only then", () => {
    const stop2 = stopByNumber(2)!;
    expect(stop2.truthGate.shipped).toBe(false);
    expect(narrationFor(stop2)).toBe(stop2.truthGate.fallbackNarration);
    expect(narrationFor(stop2)).not.toBe(stop2.narration);

    // And the other half of the gate, on a stop that really has shipped.
    // Every stop in the fixture is closed today, so the shipped branch is
    // exercised against a stop object rather than against the file, which
    // is what keeps this test honest whichever way a flag moves later.
    const shipped: Stop = { ...stop2, truthGate: { ...stop2.truthGate, shipped: true } };
    expect(narrationFor(shipped)).toBe(shipped.narration);
  });

  it("does not claim a task completion writes a KPI record", () => {
    // Stop 5 was the one stop marked shipped, and what it asserted was an
    // automatic KPI record on completion. Nothing in the product writes one:
    // every KPIRecord comes from a person (self-report, batch, manager
    // review) or from an external door (the v1 API, the ingest endpoint, the
    // Razorpay webhook), so the ring cannot move until someone records the
    // reading. The Effort card and the goal rollup are real, and that is
    // what the fallback says.
    const stop5 = stopByNumber(5)!;
    expect(stop5.truthGate.shipped).toBe(false);
    expect(narrationFor(stop5)).toBe(stop5.truthGate.fallbackNarration);
    expect(narrationFor(stop5)).not.toMatch(/nobody updated a spreadsheet/i);

    // The receipt row is the shareable half of the same claim, so it is
    // gated too: it used to carry neither a stop nor a fallback, which meant
    // it printed regardless of the gate.
    const row = tuesday.receipt.lines.find((l) => l.time === "4:45")!;
    expect(row.stop).toBe(5);
    expect(row.labelFallback).toBeTruthy();
    expect(receiptLineLabel(row)).toBe(row.labelFallback);
  });

  it("gates the wire label, which is the claim drawn between the two pictures", () => {
    // The one spine string that used to escape: stop 4 printed "Status
    // changed, Finance notified" above a narration saying Sam mentions
    // Priya by hand.
    for (const stop of tuesday.stops) {
      const printed = wireLabelFor(stop);
      if (stop.truthGate.shipped) expect(printed).toBe(stop.wireLabel);
      else expect(printed).toBe(stop.wireLabelFallback ?? stop.wireLabel);
    }
    const stop4 = stopByNumber(4)!;
    expect(wireLabelFor(stop4)).not.toMatch(/notified/i);
    const stop1 = stopByNumber(1)!;
    // Concept 4.4 stop 1 names the person in the fallback, and the stop's
    // own fallbackNarration promises exactly that wire.
    expect(wireLabelFor(stop1)).toContain("Sam");
  });

  it("never draws the Talk pin while stop 3 is closed", () => {
    const view = threadView();
    expect(stopByNumber(3)!.truthGate.shipped).toBe(false);
    expect(view.messages.some((m) => m.from === "sidekick")).toBe(false);
    expect(view.pinLabel).toBe(tuesday.thread.pinLabelFallback);
    expect(view.pinLabel).not.toMatch(/pinned/i);
    expect(view.pinAt).toBe(view.messages.length - 1);
  });

  it("gives every mobile beat the same gate, pointed at a stop that exists", () => {
    for (const b of tuesday.beats) {
      expect(stopByNumber(b.stop), `beat ${b.n} names stop ${b.stop}`).toBeDefined();
      expect(b.fallbackNarration.length).toBeGreaterThan(10);
      expect(b.fallbackNarration).not.toBe(b.narration);
    }
  });

  it("never gates a mechanism on the desktop spine while asserting it on the mobile stepper", () => {
    // The failure this test exists to stop: beat 3 stating "step 3 becomes the
    // task, with Sam on it because Sam holds the role" on the surface most
    // visitors read, while stop 2 marks that exact mechanism unshipped.
    for (const b of tuesday.beats) {
      const printed = narrationForBeat(b);
      if (!beatIsShipped(b)) {
        expect(printed, `beat ${b.n} printed its ungated narration`).toBe(b.fallbackNarration);
      } else {
        expect(printed).toBe(b.narration);
      }
    }
    const beat3 = beatByNumber(3)!;
    expect(beat3.stop).toBe(2);
    expect(beatIsShipped(beat3)).toBe(false);
    expect(narrationForBeat(beat3)).toBe(beat3.fallbackNarration);
    expect(narrationForBeat(beat3)).not.toContain("because Sam holds the role");

    // Beat 7 is the 4:45 beat, under stop 5. Its stop is closed, so it
    // prints its fallback: "the KPI records" is the assertion this gate
    // exists to hold back, and it is the sentence on the surface most
    // visitors read.
    const beat7 = beatByNumber(7)!;
    expect(beatIsShipped(beat7)).toBe(false);
    expect(narrationForBeat(beat7)).toBe(beat7.fallbackNarration);
    expect(narrationForBeat(beat7)).not.toMatch(/the KPI records/i);
  });

  it("gates the caption on the surface, not only the prose beside it", () => {
    // The surface IS the claim. "Created by SOP ... Owner by role" asserts
    // stop 2's mechanism, which is shipped:false, so the picture may not say
    // it while the words may not either.
    const t = tuesday.task;
    expect(stopByNumber(t.snapCaptionStop)!.truthGate.shipped).toBe(false);
    expect(taskCaption()).toBe(t.snapCaptionFallback);
    expect(taskCaption()).not.toBe(t.snapCaption);
    expect(taskCaption()).not.toMatch(/created by/i);
    // And the fallback still says everything that IS true: the links exist.
    for (const link of t.links) {
      const head = link.label.split(",")[0].split(" v")[0];
      expect(`${taskCaption()} ${t.links.map((l) => l.label).join(" ")}`).toContain(head.split(" ")[0]);
    }
  });

  it("never lets a surface read the ungated caption directly", () => {
    const source = readFileSync(new URL("../shell/surfaces.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/\.snapCaption\b/);
    expect(source).toContain("taskCaption()");
  });

  it("covers every stop with at least one beat, so the stepper tells the whole story", () => {
    const covered = new Set(tuesday.beats.map((b) => b.stop));
    for (const s of tuesday.stops) {
      expect(covered.has(s.n), `no beat covers stop ${s.n}`).toBe(true);
    }
  });

  it("grows the trail one line per stop", () => {
    expect(trailUpTo(1)).toHaveLength(1);
    expect(trailUpTo(6)).toHaveLength(6);
    expect(trailUpTo(3)[2]).toContain("10:30");
  });
});

describe("the work receipt lines", () => {
  it("is in clock order", () => {
    const lines = tuesday.receipt.lines;
    // The concept prints ten lines and a footer claiming eight modules; those
    // ten name only seven, because the 6:02 Sidekick answer, which is the
    // whole point of the close, never got a line of its own. It has one now,
    // at 6:00, and the brag in the footer is arithmetic again.
    expect(lines).toHaveLength(11);
    const minutes = lines.map((l) => clockMinutes(l.time));
    for (let i = 1; i < minutes.length; i++) {
      expect(minutes[i]).toBeGreaterThanOrEqual(minutes[i - 1]);
    }
  });

  it("names eight modules, which is what the footer claims", () => {
    expect(receiptModules()).toHaveLength(8);
    expect(tuesday.receipt.totals).toContain("8 modules");
  });

  it("names only modules that are blocks", () => {
    const labels = new Set(tuesday.hubs.map((h) => h.label));
    for (const m of receiptModules()) expect(labels.has(m), `${m} is not a block`).toBe(true);
  });

  it("uses a brand dot on exactly the four lines the storyboard earns one on", () => {
    const dotted = tuesday.receipt.lines.filter((l) => l.dot);
    expect(dotted.map((l) => l.dot)).toEqual(["yellow", "blue", "red", "green"]);
    expect(dotted.map((l) => l.dot)).toEqual(DOT_ORDER);
  });
});

describe("copy hygiene in the fixture", () => {
  const text = JSON.stringify(tuesday);

  it("contains no em dash and no en dash", () => {
    expect(/[—–―]/.test(text)).toBe(false);
  });

  it("contains no double hyphen used as punctuation", () => {
    expect(/--(?![A-Za-z])|[A-Za-z]--[A-Za-z]/.test(text)).toBe(false);
  });

  it("names no competitor", () => {
    expect(/\b(?:monday\.com|clickup|workday|asana|notion|bamboohr|lattice|jira)\b/i.test(text)).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * The tour line, which was the last ungated claim on the fixture.
 * ═══════════════════════════════════════════════════════════════════ */

describe("the module tour's one line per block", () => {
  /** Every block whose line names a mechanism, and the stop that owns it. */
  const GATED: Record<string, number> = {
    work: 2,
    docs: 2,
    teams: 1,
    talk: 3,
    goals: 5,
    ai: 6,
  };

  it("gates every line that asserts a stop's mechanism", () => {
    for (const [id, stop] of Object.entries(GATED)) {
      const block = hub(id);
      expect(block, id).toBeTruthy();
      expect(block!.tourLineStop, id).toBe(stop);
      expect(block!.tourLineFallback, id).toBeTruthy();
      expect(block!.tourLineFallback, id).not.toBe(block!.tourLine);
    }
  });

  it("prints the fallback while the stop is unshipped, and never the claim", () => {
    for (const [id] of Object.entries(GATED)) {
      const block = hub(id)!;
      expect(stopByNumber(block.tourLineStop!)!.truthGate.shipped, id).toBe(false);
      expect(tourLineFor(block), id).toBe(block.tourLineFallback);
      expect(tourLineFor(block), id).not.toBe(block.tourLine);
    }
  });

  it("leaves a block describing something shipped with its own line", () => {
    // Planner names a huddle and a logged duration (stop 4's status says
    // both ship) and Tables names a form writing a row. Neither asserts an
    // unbuilt mechanism, so neither carries a fallback and both get their
    // own sentence back.
    for (const id of ["planner", "tables"]) {
      const block = hub(id)!;
      expect(block.tourLineFallback, id).toBeUndefined();
      expect(tourLineFor(block), id).toBe(block.tourLine);
    }
  });

  it("covers every block: a line is either gated or describes something shipped", () => {
    for (const block of tuesday.hubs) {
      const gated = block.tourLineStop !== undefined;
      expect(gated || !block.tourLineFallback, block.id).toBe(true);
    }
  });
});

describe("the SOP is owned the way the product models it", () => {
  it("names a person, not a role", () => {
    // prisma `model SOP` has a kraId and no roleId and no ownerId, and the
    // product's own SOP page renders Owner from the row's creator. The
    // fixture used to carry `ownedByRole: "Onboarding lead"` and the Docs
    // surface printed it, which is a field on a marketing surface that the
    // product does not have. What a ROLE owns is the KRA.
    expect((tuesday.sop as unknown as Record<string, unknown>).ownedByRole).toBeUndefined();
    expect(castName(tuesday.sop.owner)).toBe("Sam Okafor");
    expect(tuesday.sop.ownedByKra).toBe(tuesday.kra.title);
  });
});

describe("the receipt clock", () => {
  it("is 24 hour, so eleven stacked rows read in one direction", () => {
    expect(clock24("9:02")).toBe("09:02");
    expect(clock24("11:15")).toBe("11:15");
    expect(clock24("2:00")).toBe("14:00");
    expect(clock24("6:02")).toBe("18:02");
  });

  it("orders the receipt exactly as the 12 hour reading does", () => {
    const minutes = tuesday.receipt.lines.map((l) => clockMinutes(l.time));
    const asStrings = tuesday.receipt.lines.map((l) => clock24(l.time));
    for (let i = 1; i < minutes.length; i += 1) {
      expect(minutes[i]).toBeGreaterThanOrEqual(minutes[i - 1]);
      expect(asStrings[i] >= asStrings[i - 1]).toBe(true);
    }
  });
});

describe("stop 2's fallback is true of the product", () => {
  it("does not claim a template carries an SOP or a KPI", () => {
    // `enum TemplateKind` is TASK, LIST, SPACE, FOLDER, DOC, VIEW,
    // WHITEBOARD. There is no SOP kind and no KPI kind, the apply route
    // handles exactly those seven, and the one SOP-adjacent seed is a DOC
    // whose body says to go and create the SOP yourself. A fallback that is
    // false is worse than the claim it replaced.
    const fallback = stopByNumber(2)!.truthGate.fallbackNarration;
    expect(fallback).not.toMatch(/template/i);
    expect(fallback).toMatch(/links/i);
  });
});
