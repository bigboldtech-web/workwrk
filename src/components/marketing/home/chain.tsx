// NO LONGER RENDERED. The home route draws `home/stack.tsx` instead.
//
// This file was the home page until 2026-09-22. It argues in the quiet
// register the founder rejected twice (six word headlines at 80px, one
// object per section, no card grids, almost no colour); the register he
// asked for is the one ClickUp, Asana and monday.com share, and stack.tsx
// is that page.
//
// It is still on disk for one reason: `home.test.ts` imports `COPY` and
// `MODULE_LINE` from here across roughly 70 assertions, and that same file
// also covers `spine.tsx` and `spine-pin.client.tsx`, which ARE still live
// on /tuesday. Untangling the two was not worth doing while the new page is
// still being judged. When the new home page is settled, delete this file,
// chain.css, and the chain half of home.test.ts together.
//
// Nothing new should import from here.
//
// THE CHAIN OF OWNERSHIP: the home page, top to bottom.
//
// The argument, in one paragraph, because every section below is a sentence
// of it: WorkwrK is the only work system where a piece of work is attached
// to the person accountable for it, the standard it has to meet and the
// goal it moves. By the end of a quarter the record of who delivered what
// already exists, because it was assembled as the work happened rather than
// reconstructed afterwards. A rival cannot say that back without rebuilding
// its data model.
//
// The spine, in order, one idea per screen:
//
//   1 the claim, six words, over one product frame
//   2 the problem, one number, one sentence
//   3 the chain, four beats, one screen each, each with its real surface
//   4 the payoff, the quarter ends and the record already exists
//   5 the rest of the system, quietly, one line per module
//   6 proof, and only what is true today
//   7 one closing line, one button
//
// WHAT IS NOT HERE, and what it used to do:
//
//   * The exploded eight block hero. It floated eight labelled cards and
//     four wires around a centre frame whose contents were held at opacity
//     zero until a scroll scrub passed 0.35. Gone: the argument is no
//     longer "eight things snap together", and a hero object that is empty
//     at rest is the one thing this page may not ship.
//   * The fourteen grey Replaces tiles and the stack calculator. Gone from
//     the home page. The category list and the arithmetic still live on
//     /compare/your-stack, which is the page a visitor asking that question
//     is already looking for.
//   * The five viewport pinned Tuesday. It is /tuesday, whole, and the home
//     page links nothing at it: one idea per screen means the home page
//     states the argument rather than narrating a day.
//   * The eight tab module tour. Replaced by section 5, which says the same
//     eight names in eight lines with nothing to click.
//   * The seven answer FAQ. It is /faq, which is the document whose whole
//     job it is.
//   * The anonymous customer anecdote that used to sit above the fold. No
//     customer, no logo, no counter and no testimonial appears on this page,
//     because none of them can be evidenced yet. Section 6 says so plainly.
//
// Nothing on this page is a screenshot. Every frame is the marketing lite
// surface library rendering the product's own chrome from the sample
// fixture, at a scale where the product's real 14px text stays above its
// own 10px caption floor, whole and legible at first paint.

import type { ReactNode } from "react";
import Link from "next/link";

import { PrimaryCta } from "../cta";
import { heldCertifications } from "../flags";
import { pricing } from "../data/pricing";
import { tuesday } from "../data/tuesday";
import { MarketingShell } from "../shell/marketing-shell";
import {
  BoardListSurface,
  GoalDetailSurface,
  MkSidebar,
  ReviewTimelineSurface,
  RolePageSurface,
  SopDocSurface,
} from "../shell/surfaces";
import { Reveal } from "./reveal.client";
import "./chain.css";

/* ═══════════════════════════════════════════════════════════════════
 * The copy, in one place, so the founder can read the page without
 * opening it and so a test can hold it to the rules.
 *
 * Every headline on this page is six words or fewer. That is not a style
 * preference, it is the rule the page is judged on, and home.test.ts counts
 * the words in each one of these strings.
 * ═══════════════════════════════════════════════════════════════════ */

export const COPY = {
  hero: {
    h1: "Every task knows who owns it.",
    sub: "The owner, the standard and the goal travel with the work.",
  },
  problem: {
    eyebrow: "The problem",
    figure: "13 weeks",
    figureCaption: "one quarter",
    line: "Then somebody rebuilds the record of who did what.",
  },
  beats: [
    {
      n: "01",
      label: "Task",
      h2: "Work starts as one task.",
      line: "One row: a name, a status, a date, an owner.",
      frameLabel:
        "A task open beside its board in a sample workspace, showing its owner, its checklist and the records it is linked to.",
    },
    {
      n: "02",
      label: "Owner",
      h2: "The task knows its owner.",
      line: "Not a name on a card, but the person who holds the role.",
      frameLabel:
        "A role page in a sample workspace: who holds the role, the result it owns and the limits of it.",
    },
    {
      n: "03",
      label: "Standard",
      h2: "The work has a standard.",
      line: "The task carries the process it follows and the number it has to move.",
      frameLabel:
        "A process document in a sample workspace, with an owner on every step and the measure it moves.",
    },
    {
      n: "04",
      label: "Goal",
      h2: "And the work moves a goal.",
      line: "The goal counts the tasks under it, so progress is measured, not claimed.",
      frameLabel:
        "A goal in a sample workspace, with its progress ring and the tasks counted under it.",
    },
  ],
  payoff: {
    h2: "The quarter ends. The record exists.",
    line: "Nobody assembles it, because it was assembled as the work happened.",
    frameLabel:
      "A review cycle for one person in a sample workspace, with the quarter's own record already on the timeline.",
  },
  system: {
    eyebrow: "The system",
    h2: "Eight parts. One record.",
  },
  proof: {
    eyebrow: "Proof",
    h2: "We publish what we can prove.",
  },
  close: {
    h2: "Put your quarter on the record.",
  },
} as const;

/**
 * One plain line per module, keyed by the fixture's hub id.
 *
 * It is a map rather than eight strings in the markup so that a ninth hub
 * cannot appear on this page without a line, and an eighth cannot quietly
 * disappear: home.test.ts asserts the keys are exactly the fixture's hubs.
 * The words are the shipped feature list, shortened to one clause, and none
 * of them names a tool this replaces. The Replaces vocabulary belongs on
 * /compare and does not appear on this page at all.
 */
export const MODULE_LINE: Record<string, string> = {
  work: "Tasks, lists, boards, seventeen views.",
  planner: "The calendar and the timesheet.",
  ai: "Ask on any page. It reads the workspace.",
  talk: "Channels, threads and calls.",
  teams: "The directory, roles, reviews, recognition.",
  docs: "Docs, wikis, processes, contracts.",
  tables: "Sheets and forms.",
  goals: "Goals, results, measures.",
};

/** Small numbers as words, so a count read from the data still reads as prose. */
const NUMBER_WORD = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

function numberWord(n: number): string {
  return NUMBER_WORD[n] ?? String(n);
}

/* ═══════════════════════════════════════════════════════════════════
 * The band. Every section on the page is one of these: a ground, its air,
 * and one block that does the page's single move as it arrives.
 * ═══════════════════════════════════════════════════════════════════ */

function Band({
  children,
  ground,
  air,
  labelledBy,
}: {
  children: ReactNode;
  ground?: "quiet";
  air?: "wide" | "hero";
  labelledBy?: string;
}) {
  return (
    <section className="chain-sec" data-ground={ground} data-air={air} aria-labelledby={labelledBy}>
      <Reveal>
        <div className="chain-wrap chain-center">{children}</div>
      </Reveal>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 1. The claim.
 *
 * Six words, centred, over one product frame, and no button: the page has
 * one button and it is at the bottom. The frame is the Onboarding board,
 * because the claim is about tasks and owners and that surface is a column
 * of tasks with an owner on every row. It is laid out at full size and cut
 * by the fold, which is the honest way to show density: you can read what
 * is on screen, and there is visibly more of it.
 * ═══════════════════════════════════════════════════════════════════ */

export function Claim() {
  return (
    <section className="chain-sec" data-air="hero" aria-labelledby="claim">
      <div className="chain-wrap chain-center">
        <h1 className="chain-h1" id="claim">
          {COPY.hero.h1}
        </h1>
        <p className="chain-sub">{COPY.hero.sub}</p>
        <div className="chain-obj">
          <MarketingShell
            hub="work"
            breadcrumb={["Operations", "Onboarding"]}
            sidebar={<MkSidebar hub="work" />}
            label="The Onboarding board in a sample workspace, with an owner on every task row."
          >
            <BoardListSurface />
          </MarketingShell>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 2. The problem, one number.
 *
 * The number is the calendar's, not a statistic: a quarter is thirteen
 * weeks, which is a fact a reader can check on a wall. Nothing on this page
 * quotes a figure about customers, adoption or savings, because none of
 * them can be evidenced yet.
 * ═══════════════════════════════════════════════════════════════════ */

export function Problem() {
  return (
    <Band ground="quiet" air="wide" labelledBy="problem">
      <p className="chain-eyebrow">{COPY.problem.eyebrow}</p>
      <p className="chain-fig" id="problem">
        {COPY.problem.figure}
      </p>
      <p className="chain-figcap">{COPY.problem.figureCaption}</p>
      <p className="chain-sub">{COPY.problem.line}</p>
    </Band>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 3. The chain: four beats, one screen each.
 *
 * The numeral is what turns four sections into one sequence. Each beat is
 * the same anatomy in the same order, because a chain that changes shape
 * every link is not a chain: numbered label, six word claim, one plain
 * line, then the surface the claim is true on.
 * ═══════════════════════════════════════════════════════════════════ */

const BEAT_FRAMES: ReactNode[] = [
  <MarketingShell
    key="task"
    hub="work"
    breadcrumb={["Operations", "Onboarding"]}
    sidebar={<MkSidebar hub="work" />}
    label={COPY.beats[0].frameLabel}
  >
    <BoardListSurface drawer />
  </MarketingShell>,
  <MarketingShell
    key="owner"
    hub="teams"
    breadcrumb={["Teams", "Roles", tuesday.role.title]}
    sidebar={<MkSidebar hub="teams" />}
    label={COPY.beats[1].frameLabel}
  >
    <RolePageSurface />
  </MarketingShell>,
  <MarketingShell
    key="standard"
    hub="docs"
    breadcrumb={["Docs", "SOPs", tuesday.sop.title]}
    sidebar={<MkSidebar hub="docs" />}
    label={COPY.beats[2].frameLabel}
  >
    <SopDocSurface />
  </MarketingShell>,
  <MarketingShell
    key="goal"
    hub="goals"
    breadcrumb={["Goals", "Q3", tuesday.goal.title]}
    sidebar={<MkSidebar hub="goals" />}
    label={COPY.beats[3].frameLabel}
  >
    <GoalDetailSurface />
  </MarketingShell>,
];

export function Chain() {
  return (
    <>
      {COPY.beats.map((beat, i) => (
        <Band key={beat.n} labelledBy={`beat-${beat.n}`}>
          <p className="chain-eyebrow">
            <span className="chain-n">{beat.n}</span>
            {beat.label}
          </p>
          <h2 className="chain-h2" id={`beat-${beat.n}`}>
            {beat.h2}
          </h2>
          <p className="chain-line">{beat.line}</p>
          <div className="chain-obj">{BEAT_FRAMES[i]}</div>
        </Band>
      ))}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 4. The payoff.
 * ═══════════════════════════════════════════════════════════════════ */

export function Payoff() {
  return (
    <Band ground="quiet" labelledBy="payoff">
      <h2 className="chain-h2" id="payoff">
        {COPY.payoff.h2}
      </h2>
      <p className="chain-line">{COPY.payoff.line}</p>
      <div className="chain-obj">
        <MarketingShell
          hub="teams"
          breadcrumb={["Teams", "Reviews", "Q3"]}
          sidebar={<MkSidebar hub="teams" />}
          label={COPY.payoff.frameLabel}
        >
          <ReviewTimelineSurface />
        </MarketingShell>
      </div>
    </Band>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 5. The rest of the system, quietly.
 *
 * Eight names, one line each, stacked and centred. No cards, no icons, no
 * borders and nothing to click: a grid of eight tiles is what every rival
 * ships and it is the least memorable section on any of their pages. The
 * names come from the fixture, so there can never be a ninth.
 * ═══════════════════════════════════════════════════════════════════ */

export function TheRest() {
  return (
    <Band labelledBy="system">
      <p className="chain-eyebrow">{COPY.system.eyebrow}</p>
      <h2 className="chain-h2" id="system">
        {COPY.system.h2}
      </h2>
      <ul className="chain-mods">
        {tuesday.hubs.map((hub) => (
          <li key={hub.id} className="chain-mod">
            <span className="chain-modname">{hub.label}</span>
            <span className="chain-modline">{MODULE_LINE[hub.id] ?? hub.features}</span>
          </li>
        ))}
      </ul>
    </Band>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 6. Proof, and only what is true today.
 *
 * Two of the three facts are absences, and they are READ rather than
 * typed: `heldCertifications` is empty, so the second line says we hold
 * none, and the day one is real the sentence changes with the array. The
 * third says there is no customer story yet, which is the honest version
 * of the logo wall this page will not carry.
 *
 * An honest empty state beats an invented fact. The build this replaces
 * shipped a fabricated regional compliance claim and six invented cookie
 * rows, and both were caught by a reviewer rather than by the page.
 * ═══════════════════════════════════════════════════════════════════ */

export function Proof() {
  const certified = heldCertifications.length > 0;
  return (
    <Band air="wide" labelledBy="proof">
      <p className="chain-eyebrow">{COPY.proof.eyebrow}</p>
      <h2 className="chain-h2" id="proof">
        {COPY.proof.h2}
      </h2>
      <ul className="chain-proof">
        <li>
          <span className="chain-prooflead">Prices in the open.</span>
          <span className="chain-proofline">
            Plans and per seat prices are on the{" "}
            <Link className="chain-prooflink" href="/pricing" data-cta="home-proof-pricing">
              pricing page
            </Link>
            , in {numberWord(pricing.currencies.length)} currencies.
          </span>
        </li>
        <li>
          <span className="chain-prooflead">Security, stated plainly.</span>
          <span className="chain-proofline">
            {certified
              ? `We hold ${heldCertifications.join(" and ")}, and the `
              : "We hold no third party certification yet, and the "}
            <Link className="chain-prooflink" href="/security" data-cta="home-proof-security">
              security page
            </Link>{" "}
            says exactly what is in place.
          </span>
        </li>
        <li>
          <span className="chain-prooflead">No logos. No badges.</span>
          <span className="chain-proofline">
            There is no customer story here yet. When one is real and the customer has agreed to it, it goes
            here.
          </span>
        </li>
      </ul>
    </Band>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 7. One line. One button.
 *
 * The page's only filled element, and its only blue. Every other blue on
 * this page is inside a product frame, where the product's own primary
 * belongs.
 * ═══════════════════════════════════════════════════════════════════ */

export function Close() {
  return (
    <Band air="wide" labelledBy="close">
      <h2 className="chain-h2" id="close">
        {COPY.close.h2}
      </h2>
      <div className="chain-cta">
        <PrimaryCta placement="home-close" />
      </div>
    </Band>
  );
}
