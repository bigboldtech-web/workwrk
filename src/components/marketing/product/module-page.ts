// The eight module pages, as data (marketing-concept.md section 5,
// "/product/[module]", and section 12 Phase 4 item 16).
//
// One page per block, and each page is that block's chapter of the SAME
// Tuesday: same cast, same client, same clock. That is the whole reason this
// module exists rather than eight hand written pages. A chapter that invents
// its own day is a second story, and two stories drift.
//
// So every sentence a /product page prints comes from one of three places:
//
//   1. the Tuesday fixture, through the gated readers (`tourLineFor`,
//      `narrationForBeat`), so a mechanism that has not shipped prints its
//      fallback here exactly as it does on the home page;
//   2. the pricing source, for what a block replaces and which tier carries
//      it;
//   3. the capability pages under /features, which are listed here so the
//      index and the module pages cannot disagree about what exists.
//
// Nothing below is a claim typed into a JSX file. That matters most for the
// "upcoming features" disclosure: the concept asks for unbuilt items to be
// hidden behind a toggle, and the only honest source for "unbuilt" is the
// storyboard's own truth gates. An item appears there because a stop says
// its mechanism has not shipped, and it LEAVES on the day that stop flips,
// with no copy edit anywhere.
//
// Everything here is pure. No React, no network, no database.

import { categoryLabel, pricing } from "../data/pricing";
import {
  DOT_HEX,
  beatIsShipped,
  narrationForBeat,
  replacesTag,
  tourLineFor,
  tuesday,
  type Beat,
  type DotColor,
  type HubBlock,
} from "../data/tuesday";

/**
 * The tab order, which is the brief's and not the rail's: Work, Docs, Talk,
 * Tables, Goals, Teams, Planner, AI. It is the same constant the home page's
 * module tour orders its tabs by, and it is exported from here so the tour,
 * the routes and the sitemap read one list.
 *
 * Settings is not a module page, because it is not one of the story's blocks.
 */
export const MODULE_ORDER = ["work", "docs", "talk", "tables", "goals", "teams", "planner", "ai"] as const;

export type ModuleId = (typeof MODULE_ORDER)[number];

export function isModuleId(value: string): value is ModuleId {
  return (MODULE_ORDER as readonly string[]).includes(value);
}

/** The route. One place, so a link and a sitemap row cannot disagree. */
export function moduleHref(id: string): string {
  return `/product/${id}`;
}

/**
 * The capability pages under /features, and which block owns each one.
 *
 * They are listed here rather than derived from the filesystem for the
 * reason /features already gives: the note beside each one is a sentence
 * somebody wrote and can be held to, and a page that gets retired leaves
 * this list in the same commit.
 *
 * `block` is what is new. The twelve pages were reachable only from the
 * index, so a visitor who arrived on the Work chapter had no route to the
 * page describing what a task actually carries. Now the chapter lists its
 * own, and the index still lists all twelve, from this one array.
 */
export interface CapabilityPage {
  href: string;
  label: string;
  note: string;
  /** The module page that links to it. `null` means the index only. */
  block: ModuleId | null;
}

export const CAPABILITY_PAGES: CapabilityPage[] = [
  { href: "/features/tasks", label: "Tasks", note: "lists, boards and every view, with custom fields.", block: "work" },
  { href: "/features/sops", label: "SOPs", note: "four kinds of process doc, with acknowledgement.", block: "docs" },
  { href: "/features/kras", label: "KRAs", note: "what a role owns, not what a person remembers.", block: "goals" },
  { href: "/features/kpis", label: "KPIs", note: "targets, readings and the weight each one carries.", block: "goals" },
  { href: "/features/okrs", label: "Goals and OKRs", note: "cascade, rollup and the on track verdict.", block: "goals" },
  {
    href: "/features/reviews",
    label: "Reviews",
    note: "cycles with the KPI and SOP scores already on them.",
    block: "teams",
  },
  { href: "/features/people", label: "People", note: "directory, org chart, roles and history.", block: "teams" },
  { href: "/features/kudos", label: "Kudos", note: "recognition against the company's own values.", block: "teams" },
  { href: "/features/access", label: "Access and roles", note: "who can see what, at every level.", block: null },
  { href: "/features/ai-engine", label: "AI", note: "one Ask, reading the workspace it is in.", block: "ai" },
  {
    href: "/features/analytics",
    label: "Reporting",
    note: "what the numbers are, and where they are not.",
    block: "ai",
  },
  {
    href: "/features/integrations",
    label: "Integrations",
    note: "what connects today, which is very little.",
    block: null,
  },
];

export function capabilityPagesFor(hubId: string): CapabilityPage[] {
  return CAPABILITY_PAGES.filter((p) => p.block === hubId);
}

/* ═══════════════════════════════════════════════════════════════════
 * The chapter.
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * The H1, one short line per block, in that block's voice.
 *
 * These are the only eight sentences on the eight pages that are not read
 * out of a fixture, and there is a rule that makes that safe: NOT ONE OF
 * THEM NAMES A MECHANISM. Each describes surfaces that ship and can be
 * opened today, so none of them needs a truth gate, and none of them can
 * fall out of step with a stop that has not shipped.
 *
 * The gated sentence sits directly underneath, as the story line, and it is
 * `tourLineFor(hub)`: the same string the module tour and /features print,
 * which switches to its fallback the moment a stop says the mechanism is
 * unbuilt. Using that sentence AS the H1 was the first version of this page
 * and it is why this constant exists: the fallbacks are written to be read
 * beside a picture, not set at 64px, and Work's ran to five lines of display
 * type before the lede began.
 */
// SIX WORDS OR FEWER, every one of them, because these eight strings are
// the h1 on eight routes and rule 2 is the one measurable line in the brief.
// They ran to seven, eight and nine words, which at 72px is three lines of
// display type before a visitor reaches a single idea.
const HEADLINES: Record<ModuleId, string> = {
  work: "One task. Everything attached to it.",
  docs: "Docs, SOPs and contracts, one library.",
  talk: "Channels and calls, beside the work.",
  tables: "Sheets and forms, with real formulas.",
  goals: "Goals, with the work underneath.",
  teams: "The roles, and what each owns.",
  planner: "The week, the call, the hours.",
  ai: "One Ask, on every page.",
};

export function moduleHeadline(hubId: string): string {
  return isModuleId(hubId) ? HEADLINES[hubId] : "";
}

export interface ModuleMoment {
  n: number;
  clock: string;
  headline: string;
  /** Gated: the fallback prints while the beat's stop is unbuilt. */
  narration: string;
  /** The marketing-lite surface this beat shows for THIS block. */
  surface: string;
  /** The other blocks on the same beat, for the caption under the frame. */
  withHubs: string[];
  shipped: boolean;
}

export interface ModuleNeighbour {
  id: string;
  label: string;
  dot: DotColor;
  dotHex: string;
  href: string;
  /** The wire the storyboard draws between the two, in the story's words. */
  wire: string;
  /** The stop that draws it. */
  stop: number;
}

export interface ModuleUpcoming {
  stop: number;
  mechanism: string;
  status: string;
}

export interface ModuleChapter {
  hub: HubBlock;
  /** The H1: one short line, in the block's voice, naming no mechanism. */
  headline: string;
  /** The gated story line, the same string the module tour prints. */
  storyLine: string;
  /** The block's first appearance on Tuesday, for the section heading. */
  firstClock: string;
  moments: ModuleMoment[];
  neighbours: ModuleNeighbour[];
  capabilities: CapabilityPage[];
  upcoming: ModuleUpcoming[];
  /** Category nouns. Never a vendor. */
  replaces: string | null;
  tierLine: string;
}

/**
 * Which surface a beat shows for one block, in the fixture's own order of
 * precedence (see the note on `Beat.surfaces` in data/tuesday.ts):
 *
 *   1. the beat's own override for this hub, when it has one. Stop 3's Docs
 *      block is the SOP at 10:30 and contract v2 at 11:15, and the 11:15
 *      narration is about the contract, so the frame beside it has to be;
 *   2. THE STOP'S OWN ANSWER for this hub. This is the step that was
 *      missing, and it is the one that carries most of the work: Work's five
 *      beats were all falling through to `my-work`, so the Work chapter
 *      printed the same picture five times while its narration moved from
 *      the task being created, to the decision landing on it, to it being
 *      blocked, to it being done. The stop names board-list, then
 *      board-list-drawer, then board-list-blocked, then board-list-done;
 *   3. the block's default surface.
 */
function surfaceForBeat(beat: Beat, hubId: string, fallback: string): string {
  const override = beat.surfaces?.[hubId];
  if (override) return override;
  const stop = tuesday.stops.find((s) => s.n === beat.stop);
  if (stop?.left.hub === hubId) return stop.left.surface;
  if (stop?.right.hub === hubId) return stop.right.surface;
  return fallback;
}

/**
 * The beats this block appears in, in clock order.
 */
export function momentsFor(hubId: string): ModuleMoment[] {
  const hub = tuesday.hubs.find((h) => h.id === hubId);
  return tuesday.beats
    .filter((b: Beat) => b.hubs.includes(hubId))
    .map((b: Beat) => ({
      n: b.n,
      clock: b.clock,
      headline: b.headline,
      narration: narrationForBeat(b),
      surface: surfaceForBeat(b, hubId, hub?.surface ?? "my-work"),
      withHubs: b.hubs.filter((h) => h !== hubId),
      shipped: beatIsShipped(b),
    }));
}

/**
 * A fixture clock with its meridiem, for a product frame's top bar.
 *
 * The fixture writes one clock format, the 12 hour one the storyboard uses
 * ("9:03", "2:30", "6:02"), and a frame's bar shows the time the way the
 * product does. Appending " AM" was fine for the four blocks whose first
 * beat is in the morning and printed "2:00 AM" on the Planner chapter,
 * whose whole beat is the afternoon huddle. The rule is the fixture's own,
 * the one `clockMinutes` sorts by: 7 through 12 are the morning, 1 through
 * 6 the afternoon.
 *
 * With one correction that rule does not have to make, because it is only
 * ordering. 12 is NOON, so it reads PM even though `clockMinutes` files it
 * with the morning hours. No fixture time falls in that hour today, and a
 * helper that will print "12:30 AM" for lunchtime the first day one does is
 * a bug waiting rather than a simplification.
 */
export function clockLabel(clock: string): string {
  const hours = Number(clock.split(":")[0]);
  if (!Number.isFinite(hours)) return clock;
  return `${clock} ${hours >= 7 && hours <= 11 ? "AM" : "PM"}`;
}

/**
 * The blocks a stop wires this one to.
 *
 * Read from the storyboard rather than from a hand written adjacency list,
 * for the reason the module tour gives: two blocks are neighbours when a
 * stop puts them on the two ends of one wire, so a page cannot claim a
 * connection the story never shows.
 *
 * The WIRE LABEL comes through `wireLabelFor`, which is the gated reader, so
 * a connection whose mechanism is unbuilt prints the label the story is
 * allowed to print today and not the one it wants to.
 */
export function neighboursFor(hubId: string): ModuleNeighbour[] {
  const out: ModuleNeighbour[] = [];
  for (const stop of tuesday.stops) {
    const pair = [stop.left.hub, stop.right.hub];
    if (!pair.includes(hubId)) continue;
    for (const other of pair) {
      if (other === hubId) continue;
      if (out.some((n) => n.id === other)) continue;
      const hub = tuesday.hubs.find((h) => h.id === other);
      if (!hub) continue;
      out.push({
        id: hub.id,
        label: hub.label,
        dot: hub.dot,
        dotHex: DOT_HEX[hub.dot],
        href: moduleHref(hub.id),
        wire: wireLabelForStop(stop.n),
        stop: stop.n,
      });
    }
  }
  // The beats wire a few pairs the six desktop stops compress away. The
  // mobile stepper is the fuller telling of the same day, so it counts.
  for (const beat of tuesday.beats) {
    if (!beat.hubs.includes(hubId)) continue;
    for (const other of beat.hubs) {
      if (other === hubId) continue;
      if (out.some((n) => n.id === other)) continue;
      const hub = tuesday.hubs.find((h) => h.id === other);
      if (!hub) continue;
      out.push({
        id: hub.id,
        label: hub.label,
        dot: hub.dot,
        dotHex: DOT_HEX[hub.dot],
        href: moduleHref(hub.id),
        wire: wireLabelForStop(beat.stop),
        stop: beat.stop,
      });
    }
  }
  return out;
}

/** The gated wire label for a stop number. */
function wireLabelForStop(n: number): string {
  const stop = tuesday.stops.find((s) => s.n === n);
  if (!stop) return "";
  if (!stop.wireLabelFallback) return stop.wireLabel;
  return stop.truthGate.shipped ? stop.wireLabel : stop.wireLabelFallback;
}

/**
 * What is NOT built yet for this block, from the storyboard's truth gates.
 *
 * The concept asks for unbuilt items behind a "Show upcoming features"
 * disclosure. This is the only honest source for the list: a mechanism is
 * here because the stop that shows it says `shipped: false`, and it
 * disappears the day that flag flips. Nothing is typed.
 */
export function upcomingFor(hubId: string): ModuleUpcoming[] {
  const seen = new Set<number>();
  const out: ModuleUpcoming[] = [];
  for (const stop of tuesday.stops) {
    if (stop.truthGate.shipped) continue;
    const touches = stop.left.hub === hubId || stop.right.hub === hubId;
    if (!touches) continue;
    if (seen.has(stop.n)) continue;
    seen.add(stop.n);
    out.push({ stop: stop.n, mechanism: stop.truthGate.mechanism, status: stop.truthGate.status });
  }
  return out;
}

/**
 * Which tier carries this block.
 *
 * Read from the pricing source's premium module list, which is the same list
 * the comparison table builds its module rows from. Two blocks are premium
 * and the sentence says which tier they start on; the other six say the
 * thing that sells the free tier, which is that they are all in it.
 */
export function tierLineFor(hubId: string): string {
  const hub = tuesday.hubs.find((h) => h.id === hubId);
  if (!hub) return "";
  const premium = pricing.premiumModules.find((m) => m.name === hub.label);
  if (!premium) {
    const starter = pricing.tiers.find((t) => t.id === "starter");
    return `On every tier, including the free ${starter?.name ?? "Starter"} plan.`;
  }
  const from = pricing.tiers.find((t) => t.id === premium.fromTier);
  return `Included from ${from?.name ?? "Growth"}, at no surcharge. There is no per module pricing.`;
}

/** The whole chapter, assembled. The page component renders it and adds nothing. */
export function moduleChapter(hubId: string): ModuleChapter | null {
  const hub = tuesday.hubs.find((h) => h.id === hubId);
  if (!hub) return null;
  const moments = momentsFor(hubId);
  return {
    hub,
    headline: moduleHeadline(hubId),
    storyLine: tourLineFor(hub),
    firstClock: moments[0]?.clock ?? "",
    moments,
    neighbours: neighboursFor(hubId),
    capabilities: capabilityPagesFor(hubId),
    upcoming: upcomingFor(hubId),
    replaces: replacesTag(hub, categoryLabel),
    tierLine: tierLineFor(hubId),
  };
}

/**
 * The page's own description, built from the block's gated line.
 *
 * A meta description is copy that a search engine quotes back, so it goes
 * through the same gate everything else does rather than being typed into a
 * `metadata` export where nothing checks it.
 */
export function moduleDescription(hubId: string): string {
  const hub = tuesday.hubs.find((h) => h.id === hubId);
  if (!hub) return "";
  const replaces = replacesTag(hub, categoryLabel);
  const stands = replaces ? ` It stands in for ${replaces}.` : "";
  return `${hub.label} in WorkwrK: ${hub.features} ${tourLineFor(hub)}${stands}`;
}

/**
 * A small count, spelled, for display type.
 *
 * The rule is the module tour's, written there when the home page set
 * "8 blocks. One system." at 48px: a small number at display size is a
 * word, like every other word on the ramp. It lived as a private constant
 * in tour.tsx while the home page was the only surface with the problem,
 * and three more display headings have since been written with a digit in
 * them ("The 5 we are usually put beside", "Goals is one of 8"). One rule,
 * one place.
 *
 * Body text keeps its digits. A table row and a lede are not display type,
 * and "12 records across the 8 blocks" reads better as a number.
 */
const SPELLED: Record<number, string> = {
  1: "One",
  2: "Two",
  3: "Three",
  4: "Four",
  5: "Five",
  6: "Six",
  7: "Seven",
  8: "Eight",
  9: "Nine",
  10: "Ten",
};

export function spellCount(n: number, lowercase = false): string {
  const word = SPELLED[n];
  if (!word) return String(n);
  return lowercase ? word.toLowerCase() : word;
}
