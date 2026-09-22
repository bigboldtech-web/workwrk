// The Tuesday fixture (marketing-concept.md section 12, Phase 0 item 1).
//
// One JSON is the single source for three consumers: the marketing site's
// story and every marketing-lite surface, the Phase 3 sandbox, and the
// "Tuesday: client onboarding" Template Center template. If they read
// different data the site stops matching the trial, which is the one thing
// the concept's truth gates exist to prevent.
//
// Everything here is PURE. No React, no network, no database. The site
// renders it; nothing writes it.
//
// Honesty contract: the cast, the client and the workspace are a TEMPLATE,
// never a customer. Every surface that shows them carries
// `tuesday.workspace.sidebarLabel`. Each stop carries its own truth gate
// with the narration that ships while the mechanism is unbuilt; a stop with
// `shipped: false` must render `fallbackNarration`, not `narration`.

import raw from "./tuesday.json";

// The four hexes moved to ../dots.ts, which imports them from
// src/components/brand and nothing else. This module reads the 850 line
// fixture at module scope, so a client component asking it for a dot colour
// used to drag the whole storyboard into the browser. They are re-exported
// here so every existing import keeps working against one definition.
export { DOT_HEX, DOT_ORDER } from "../dots";
export type { DotColor } from "../dots";

import type { DotColor } from "../dots";

export type StopDot = DotColor | "all" | null;

export interface CastMember {
  id: string;
  name: string;
  initials: string;
  jobTitle: string;
  note: string;
}

export interface HubBlock {
  id: string;
  label: string;
  dot: DotColor;
  icon: string;
  href: string;
  /** Category ids from pricing.json. Empty when the block replaces no priced category. */
  replaces: string[];
  replacesNote?: string;
  surface: string;
  /**
   * The one sentence this block gets in the module tour and on /features.
   *
   * It is a CLAIM, and for a while it was the last one on the site that was
   * not gated. Six of the eight lines assert, as plain fact, the mechanism
   * their stop marks as unbuilt: "the role owned the process before anybody
   * asked" is stop 1, "step 3 of the SOP is where the task came from" is
   * stop 2, "the ring moved at 4:45 because the work moved" is stop 5. The
   * spine, the beats, the wire labels, the receipt rows and the task caption
   * all answer to `narrationFor` and its siblings; these eight strings were
   * rendered raw, on the home page and on /features.
   *
   * So a block that names a mechanism carries the same pair every other
   * claim on the fixture carries, and `tourLineFor` is the only way to read
   * it. Two blocks (Planner and Tables) describe a huddle, a logged
   * duration and a form writing a row, all of which ship, so they have no
   * fallback and get their own line back.
   */
  tourLine: string;
  tourLineFallback?: string;
  /** The stop whose truth gate decides which of the two prints. */
  tourLineStop?: number;
  features: string;
}

export interface SopStep {
  n: number;
  title: string;
  owner: string;
  spawnsTask?: boolean;
  linkedKpi?: string;
}

export interface ReceiptLine {
  time: string;
  label: string;
  modules: string[];
  dot?: DotColor;
  /**
   * What this line says while the mechanism it names is unbuilt.
   *
   * A receipt row is a CLAIM, exactly as a stop's narration is. "SOP step 3
   * live, owner by role" asserts stop 1's mechanism in five words, and a
   * gate that covers the prose and not the artefact leaves the artefact
   * saying the thing the prose is forbidden to say. Worse than that: the
   * receipt is the shareable half of the concept, so the ungated version is
   * the sentence that travels.
   *
   * Present only on the lines that name a mechanism. A line reporting a
   * status, an attachment or a logged duration is true either way and
   * carries no fallback.
   */
  labelFallback?: string;
  /** The stop whose truth gate decides which label prints. */
  stop?: number;
}

export interface TruthGate {
  mechanism: string;
  /** True only when the running product does what the stop shows. */
  shipped: boolean;
  status: string;
  fallbackNarration: string;
}

export interface Stop {
  n: number;
  id: string;
  clock: string;
  clockRange: string;
  title: string;
  headline: string;
  narration: string;
  left: { hub: string; surface: string };
  right: { hub: string; surface: string };
  wireLabel: string;
  /**
   * What the wire between the two blocks says while this stop's mechanism is
   * unbuilt.
   *
   * The wire label is a claim in four words, and for a while it was the one
   * spine string that escaped the gate: stop 4 printed "Status changed,
   * Finance notified" one inch above a narration saying Sam mentions Priya
   * by hand. A label naming a mechanism answers to the same gate the prose
   * does, so every stop carries both versions and `wireLabelFor` picks.
   */
  wireLabelFallback?: string;
  dot: StopDot;
  trail: string;
  /**
   * What the trail line says while this stop's mechanism is unbuilt.
   *
   * The trail is the task's own record, repeated under every beat and
   * printed on the receipt, so a line reading "born from SOP step 3, owner
   * by role" asserts the mechanism as plainly as the narration does and
   * travels further. Present only on the stops whose trail names a
   * mechanism: a line reporting a status, a huddle or a logged duration is
   * true either way.
   */
  trailFallback?: string;
  truthGate: TruthGate;
}

export interface Beat {
  n: number;
  clock: string;
  hubs: string[];
  headline: string;
  narration: string;
  /**
   * The stop whose mechanism this beat asserts. The beat does not carry its
   * own `shipped` flag on purpose: one mechanism has one answer to "has this
   * shipped", and duplicating the flag per surface is how the mobile stepper
   * and the desktop spine end up making different claims about the same
   * feature.
   */
  stop: number;
  /**
   * A surface this beat shows INSTEAD of the one its stop names, by hub id.
   *
   * A stop declares one surface per side, which is right for the stop: it
   * is one picture. A stop made of two beats is two moments, and one of
   * them can be a different picture of the same block. Stop 3's Docs block
   * is the SOP at 10:30 and contract v2 at 11:15, and the 11:15 narration
   * is about the contract, so the frame beside it has to be.
   *
   * Optional, and only ever an override: a beat that does not name a hub
   * falls through to the stop's own answer, then to the hub's default.
   */
  surfaces?: Record<string, string>;
  /** What the beat prints while that mechanism is unbuilt. */
  fallbackNarration: string;
}

export interface TuesdayFixture {
  version: number;
  workspace: {
    org: string;
    sidebarLabel: string;
    templateName: string;
    templateDeepLink: string;
    notice: string;
    receiptFooterSite: string;
    receiptFooterShare: string;
  };
  cast: CastMember[];
  client: { name: string; signedAt: string; sourceTable: string; sourceRow: number };
  hubs: HubBlock[];
  role: {
    id: string;
    title: string;
    holder: string;
    department: string;
    kraId: string;
    ownsSops: string[];
    boundaries: string[];
  };
  kra: { id: string; title: string; weight: number; progress: number; roleId: string; kpiId: string };
  kpi: { id: string; name: string; unit: string; target: number; current: number; direction: string };
  sop: {
    id: string;
    title: string;
    kind: string;
    /**
     * The cast id of the person the SOP header shows as its owner.
     *
     * NOT a role. The fixture used to carry `ownedByRole: "Onboarding lead"`
     * and the Docs surface rendered "Owned by: Onboarding lead", which put a
     * field on a marketing surface that the product does not model: prisma
     * `model SOP` has a kraId and no roleId and no ownerId, and the product's
     * own SOP page renders Owner from the row's creator
     * (src/components/sops/sop-editor-page.tsx). This is the same defect the
     * fixture already fixed on Goals, caught on the other object.
     *
     * What a ROLE owns is the KRA, and `ownedByKra` is the link that really
     * exists. Stop 1's shipped fallback says exactly that.
     */
    owner: string;
    ownedByKra: string;
    slaDays: number;
    steps: SopStep[];
  };
  board: {
    id: string;
    name: string;
    space: string;
    view: string;
    views: string[];
    groups: Array<{
      name: string;
      rows: Array<{
        id: string;
        primary?: boolean;
        title?: string;
        status?: string;
        owner?: string;
        due?: string;
      }>;
    }>;
  };
  task: {
    id: string;
    title: string;
    status: string;
    statusLabel: string;
    owner: string;
    ownerResolvedFrom: string;
    createdBy: string;
    dueLabel: string;
    movesKpi: string;
    checklist: Array<{ title: string; done: boolean; addedBy?: string }>;
    links: Array<{ type: string; label: string }>;
    /**
     * The caption on the task in a marketing-lite surface. It states the
     * MECHANISM ("Created by SOP ... Owner by role"), so it is gated exactly
     * like a stop's narration: `taskCaption()` picks between this and the
     * fallback, and no surface reads this field directly.
     */
    snapCaption: string;
    /** What the caption says while the mechanism is unbuilt: links, not causation. */
    snapCaptionFallback: string;
    /** The stop whose truth gate decides which of the two prints. */
    snapCaptionStop: number;
  };
  goal: {
    id: string;
    title: string;
    /**
     * The person accountable for the goal.
     *
     * There is no `ownerRole` here on purpose. A Goal (prisma model OKR) has
     * an ownerId and a departmentId and no roleId; what a ROLE owns is the
     * KRA. The fixture used to carry an invented `ownerRole` and the goal
     * header rendered it, which put a field on a marketing surface that the
     * product does not model.
     */
    owner: string;
    progressBefore: number;
    progressAfter: number;
    verdict: string;
    verdictSource: string;
    effort: Array<{ taskId: string; title: string; owner: string }>;
  };
  thread: {
    channel: string;
    /** The stop whose gate decides whether the thread may show the pin at all. */
    pinStop: number;
    /** What the thread says about the task while that mechanism is unbuilt. */
    pinLabelFallback: string;
    messages: Array<{ at: string; from: string; body: string; pinnedToTask?: boolean }>;
  };
  contract: {
    id: string;
    title: string;
    clause: string;
    clauseBody: string;
    linkedPolicy: string;
    attachedAt: string;
  };
  huddle: { at: string; minutes: number; with: string; title: string; kind: string };
  timer: { loggedMs: number; loggedLabel: string };
  kudos: { at: string; from: string; to: string; value: string; message: string; landsOn: string };
  review: { personId: string; cycle: string; timeline: Array<{ at: string; kind: string; label: string }> };
  table: {
    name: string;
    formulaBar: string;
    columns: string[];
    rows: Array<{ n: number; cells: string[]; highlight?: boolean }>;
  };
  askAi: {
    question: string;
    answer: string[];
    sources: Array<{ dot: DotColor; label: string }>;
  };
  receipt: { title: string; meta: string; lines: ReceiptLine[]; totals: string[] };
  stops: Stop[];
  beats: Beat[];
}

export const tuesday = raw as unknown as TuesdayFixture;

/** The eight marketing blocks in rail order. Goals sits in the eighth slot: Settings is not a story block. */
export const HUB_IDS: string[] = tuesday.hubs.map((h) => h.id);

export function castMember(id: string): CastMember | undefined {
  return tuesday.cast.find((c) => c.id === id);
}

/** The display name for a cast id, or the id itself so a surface never renders "undefined". */
export function castName(id: string): string {
  return castMember(id)?.name ?? id;
}

export function castInitials(id: string): string {
  return castMember(id)?.initials ?? id.slice(0, 2).toUpperCase();
}

export function hub(id: string): HubBlock | undefined {
  return tuesday.hubs.find((h) => h.id === id);
}

export function stopByNumber(n: number): Stop | undefined {
  return tuesday.stops.find((s) => s.n === n);
}

export function beatByNumber(n: number): Beat | undefined {
  return tuesday.beats.find((b) => b.n === n);
}

/**
 * The narration a stop is allowed to print today. An unshipped mechanism
 * prints its fallback; this is the truth gate, in code, so a page cannot
 * opt out of it by reading `stop.narration` directly.
 */
export function narrationFor(stop: Stop): string {
  return stop.truthGate.shipped ? stop.narration : stop.truthGate.fallbackNarration;
}

/**
 * Has the mechanism a stop shows really shipped?
 *
 * One place for the question, so a surface, a wire label and a receipt row
 * cannot each ask it differently. An unknown stop number is a no.
 */
export function stopShipped(n: number): boolean {
  return stopByNumber(n)?.truthGate.shipped ?? false;
}

/**
 * The label the wire between a stop's two blocks may carry today.
 *
 * The same gate as `narrationFor`, applied to the four words drawn between
 * the pictures. A stop with no fallback carries a label that is true either
 * way, and gets its own label back.
 */
export function wireLabelFor(stop: Stop): string {
  if (!stop.wireLabelFallback) return stop.wireLabel;
  return stop.truthGate.shipped ? stop.wireLabel : stop.wireLabelFallback;
}

/**
 * The Talk thread as today's gate allows it to be DRAWN.
 *
 * The picture is the claim. Stop 3's mechanism is a Talk thread that
 * references the task with a pinned summary on it, and it is not built, so
 * while the gate is closed the thread shows the two people talking and says
 * the decision was recorded on the task, which is what a comment does. The
 * Sidekick message that writes the decision into the channel, and the "Pinned
 * to ..." chip under it, are the mechanism itself and wait for it.
 */
export function threadView(): {
  messages: TuesdayFixture["thread"]["messages"];
  /** The index in the returned list that carries the chip. */
  pinAt: number;
  pinLabel: string;
} {
  const t = tuesday.thread;
  if (stopShipped(t.pinStop)) {
    return {
      messages: t.messages,
      pinAt: t.messages.findIndex((m) => m.pinnedToTask === true),
      pinLabel: `Pinned to ${tuesday.task.title}`,
    };
  }
  const messages = t.messages.filter((m) => m.from !== "sidekick");
  return { messages, pinAt: messages.length - 1, pinLabel: t.pinLabelFallback };
}

/**
 * The same gate for the mobile stepper. Eight beats carry roughly 83 percent
 * of the traffic, so an ungated beat is the bigger lie, not the smaller one:
 * it is the surface most visitors read. A beat resolves its shipped state
 * through the stop it names, so a mechanism can never be gated on one surface
 * and asserted on the other.
 */
export function beatIsShipped(beat: Beat): boolean {
  return stopByNumber(beat.stop)?.truthGate.shipped ?? false;
}

export function narrationForBeat(beat: Beat): string {
  return beatIsShipped(beat) ? beat.narration : beat.fallbackNarration;
}

/**
 * The caption a marketing-lite surface may print on the Tuesday task.
 *
 * The surface IS the claim. A caption reading "Created by SOP ... Owner by
 * role" asserts stop 2's mechanism just as plainly as stop 2's narration
 * does, so it answers to the same gate. Until an SOP step really spawns the
 * task, the caption says what the product does do: the task is LINKED to the
 * SOP, the KPI and the role.
 */
export function taskCaption(): string {
  const t = tuesday.task;
  const shipped = stopByNumber(t.snapCaptionStop)?.truthGate.shipped ?? false;
  return shipped ? t.snapCaption : t.snapCaptionFallback;
}

/** The trail line a stop is allowed to print today. Same gate as the rest. */
export function trailFor(stop: Stop): string {
  if (!stop.trailFallback) return stop.trail;
  return stop.truthGate.shipped ? stop.trail : stop.trailFallback;
}

/** Trail lines collected by the task up to and including stop `n`. */
export function trailUpTo(n: number): string[] {
  return tuesday.stops.filter((s) => s.n <= n).map(trailFor);
}

/**
 * The line a block is allowed to print in the tour today.
 *
 * The same gate as `narrationFor`, applied to the eight sentences the
 * module tour and /features render. A block with no fallback describes
 * something that ships either way and gets its own line back.
 */
export function tourLineFor(h: HubBlock): string {
  if (!h.tourLineFallback || h.tourLineStop === undefined) return h.tourLine;
  return stopShipped(h.tourLineStop) ? h.tourLine : h.tourLineFallback;
}

/** The "Replaces:" tag under a block label, already a sentence. */
export function replacesTag(h: HubBlock, labelFor: (categoryId: string) => string): string | null {
  if (h.replaces.length > 0) return h.replaces.map(labelFor).join(", ");
  return h.replacesNote ?? null;
}

/**
 * Minutes past midnight for a fixture clock string.
 *
 * The fixture writes ONE clock format, the 12-hour one the concept's own
 * storyboard uses: "9:03", "2:30", "6:02". It is the narrator of the story,
 * so it reads the way a person says the time, and it reads the same on the
 * receipt, on the beat rail and in a product frame's top bar.
 *
 * Ordering a 12-hour clock needs a rule, and this is a workday: 7 through 12
 * are the morning, 1 through 6 are the afternoon. Every time in the fixture
 * falls between 9:02 and 6:02, so the rule is total over the story it has to
 * sort, and `tuesday.test.ts` asserts the receipt, the stops and the beats
 * are each in ascending order under it.
 */
export function clockMinutes(clock: string): number {
  const [h, m] = clock.split(":");
  const hours = Number(h);
  const mins = Number(m);
  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return Number.NaN;
  if (hours < 1 || hours > 12 || mins < 0 || mins > 59) return Number.NaN;
  const h24 = hours >= 7 && hours <= 12 ? hours : hours + 12;
  return h24 * 60 + mins;
}

/**
 * A fixture clock as a 24 hour string.
 *
 * The fixture speaks in 12 hour time, because that is how the story's
 * narrator says it and how concept 4 writes the storyboard: "9:03", "2:30",
 * "6:02". That is right for prose, where each time arrives in order and in
 * context.
 *
 * It is wrong for the RECEIPT, and the receipt is the artefact people share.
 * Eleven rows stacked in one column put "11:15 Contract v2 attached"
 * directly above "2:00 Blocked: finance sign off", and the second row reads
 * as two in the morning. Concept 4.1 sets the receipt in 24 hour time for
 * exactly this reason: a printed list has to read in one direction with no
 * meridiem to infer.
 *
 * The morning rule is `clockMinutes`'s, unchanged and stated once: 7 through
 * 12 are the morning, 1 through 6 are the afternoon. Every time in the
 * fixture falls between 9:02 and 6:02, so it is total over the story.
 */
export function clock24(clock: string): string {
  const mins = clockMinutes(clock);
  if (!Number.isFinite(mins)) return clock;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * The label a work receipt row is allowed to print today.
 *
 * Same gate as `narrationFor` and `taskCaption`, applied to the artefact
 * rather than to the prose, for the reason written on `ReceiptLine`: the
 * receipt is the half of the story that gets screenshotted and shared, so
 * an ungated row travels further than an ungated sentence.
 */
export function receiptLineLabel(line: ReceiptLine): string {
  if (!line.labelFallback || line.stop === undefined) return line.label;
  return stopByNumber(line.stop)?.truthGate.shipped ? line.label : line.labelFallback;
}

/** Every module named anywhere on the receipt, deduped, in first-appearance order. */
export function receiptModules(): string[] {
  const seen: string[] = [];
  for (const line of tuesday.receipt.lines) {
    for (const m of line.modules) if (!seen.includes(m)) seen.push(m);
  }
  return seen;
}
