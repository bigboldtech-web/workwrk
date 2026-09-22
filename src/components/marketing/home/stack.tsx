// The home page, in the project-management category's register.
//
// This file replaces home/chain.tsx. The page it replaced argued in a quiet
// consumer-hardware register: six-word headlines at 80px, one object per
// section, no card grids, almost no colour. It was rejected twice, and the
// founder named the register he wants instead: ClickUp, Asana, monday.com.
//
// The section order below is the order all four surveyed rivals use, and
// each one is commented with the rule it satisfies. The survey lives in
// docs/plans/marketing-directions-2026-09.md; stack.css carries the visual
// half of the same argument.
//
// THE ONE PLACE THIS SITE CANNOT FOLLOW THE CATEGORY. Every rival runs the
// same proof ladder under the hero: greyscale logo wall, then a scale
// number, then named case studies, then a G2 badge. WorkwrK has none of
// those things, and src/components/marketing/flags.ts gates every one of
// them to false deliberately. `HonestRung` below is what stands in that
// slot. It is not a stat grid dressed up as proof: there is no adoption
// number on it, because there is no adoption to report. It says what the
// product is, and every line links to the page that shows it.
//
// Nothing on this page claims a customer, a logo, a certification, an
// analyst placement, a testimonial or a count of anything.

import type { ReactNode } from "react";
import Link from "next/link";
import { Check } from "lucide-react";

import { PrimaryCta, SecondaryCta, TierCta } from "../cta";
import { Container, Section } from "../primitives";
import { routes } from "../config";
import { tuesday } from "../data/tuesday";
import { pricing, starterSeatCap, tier, tierPerSeat, type MarketingCurrency } from "../data/pricing";
import { MarketingShell, MkIcon } from "../shell/marketing-shell";
import {
  BoardListSurface,
  GoalDetailSurface,
  MkSidebar,
  MyWorkSurface,
  PlannerWeekSurface,
  RolePageSurface,
  SopDocSurface,
  TableSurface,
  TalkThreadSurface,
} from "../shell/surfaces";
import { SurfaceTabs, type SurfaceTab } from "./surface-tabs.client";
import "./stack.css";

/* ═══════════════════════════════════════════════════════════════════
 * 1. Hero
 *
 * Rule 1 of the survey: nobody in this category opens with a narrative.
 * The hero states a claim and shows the product. Rule 2: the eyebrow is a
 * release marker or a caps category label, never an anecdote.
 *
 * The claim is consolidation, which is the argument the category rewards
 * and the one that happens to be true here: eight hubs in one workspace.
 * It is stated as a capability, not as an outcome, because an outcome
 * ("ship 40% faster") would be a number nobody has measured.
 * ═══════════════════════════════════════════════════════════════════ */

// The band is `md` and not `lg`. The category's hero sits close under the
// nav: at `lg` there were 112px of nothing between the nav and the eyebrow,
// which on a 1050 tall screen pushed the product frame most of the way off
// the first view.
function Hero() {
  return (
    <Section py="md" pb="none">
      <Container>
        <div className="mk-hero-stack">
          <Link href="/changelog" className="mk-pill">
            <span className="mk-pill__tag">New</span>
            Talk, Tables and the AI sidekick are live
          </Link>

          <h1 className="mk-hero-stack__h1">The work platform your whole company can run on</h1>

          <p className="mk-hero-stack__lede">
            Tasks, plans, docs, spreadsheets, chat, people and goals in one workspace, so the work
            and the record of the work are the same thing.
          </p>

          <div className="mk-hero-stack__actions">
            <PrimaryCta placement="hero" />
            <SecondaryCta placement="hero" />
            <span className="mk-reassure">
              Free for up to {starterSeatCap} people. No card needed.
            </span>
          </div>

          {/* The caps micro-line. The rivals use it for the thing they want
              remembered; ours names the eight hubs, which IS the claim. */}
          <ul className="mk-microline">
            {tuesday.hubs.map((hub) => (
              <li key={hub.id}>{hub.label}</li>
            ))}
          </ul>
        </div>

        {/* Rule 3: the product, immediately, at width, unrestyled. */}
        <div className="mk-hero-frame">
          <MarketingShell
            hub="work"
            breadcrumb={["Work", "My work"]}
            label="The WorkwrK workspace: the navy hub rail, a list of tasks grouped by when they are due, and the panel that opens on one of them."
            caption={null}
            sidebar={<MkSidebar hub="work" />}
          >
            <MyWorkSurface compact />
          </MarketingShell>
        </div>
      </Container>
    </Section>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 2. The honest rung
 *
 * Where the logo wall goes on every rival. See the file header.
 * ═══════════════════════════════════════════════════════════════════ */

const HONEST: Array<{ key: string; val: string; href: string }> = [
  {
    key: "Eight hubs, one workspace",
    val: "Work, Planner, AI, Talk, Teams, Docs, Tables and Goals, sharing one set of people and permissions.",
    href: "/features",
  },
  {
    key: "17 ways to see a list",
    val: "List, board, calendar, timeline, Gantt, table, workload and more, over the same tasks.",
    href: "/features",
  },
  {
    key: "Free for small teams",
    val: `Up to ${starterSeatCap} people, with no card and no time limit.`,
    href: routes.pricing,
  },
  {
    key: "No customers to name yet",
    val: "We would rather show you the product than a logo wall we have not earned.",
    href: "/about",
  },
];

function HonestRung() {
  return (
    <Section py="md">
      <Container>
        <div className="mk-honest">
          {HONEST.map((item) => (
            <div className="mk-honest__item" key={item.key}>
              <Link className="mk-honest__key" href={item.href}>
                {item.key}
              </Link>
              <p className="mk-honest__val">{item.val}</p>
            </div>
          ))}
        </div>
      </Container>
    </Section>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 3. Breadth, as a tab strip
 *
 * Rule 4. Every panel is a real product surface from shell/surfaces.tsx
 * inside the real MarketingShell, built HERE on the server and handed to
 * the island as a ReactNode. See surface-tabs.client.tsx for why.
 * ═══════════════════════════════════════════════════════════════════ */

/** The canvas for each hub, and the crumbs and caption that go with it. */
const VIEWS: Array<{
  hub: string;
  breadcrumb: string[];
  note: string;
  a11y: string;
  canvas: ReactNode;
}> = [
  {
    hub: "work",
    breadcrumb: ["Work", "Onboarding"],
    note: "Every task carries an owner, a due date and a status. Open one and the panel holds its subtasks, its checklist, its custom fields and its whole history.",
    a11y: "A project board in list view, with tasks grouped by status and a detail panel open on one of them.",
    canvas: <BoardListSurface drawer />,
  },
  {
    hub: "planner",
    breadcrumb: ["Planner", "This week"],
    note: "The same tasks on a calendar. Drag one to move its date, and the board, the list and the person's own view all move with it.",
    a11y: "A week calendar with scheduled tasks and meetings laid out across five days.",
    canvas: <PlannerWeekSurface />,
  },
  {
    hub: "docs",
    breadcrumb: ["Docs", "Client onboarding"],
    note: "Docs, wikis, SOPs, policies and contracts live beside the work rather than in a separate tool, so a step in a process can create the task that carries it out.",
    a11y: "A step by step standard operating procedure document, with one step highlighted.",
    canvas: <SopDocSurface />,
  },
  {
    hub: "tables",
    breadcrumb: ["Tables", "Pipeline"],
    note: "A real spreadsheet, with formulas, validation and forms. For the things a task list was never the right shape for.",
    a11y: "A spreadsheet with typed columns, a formula column and a filtered view.",
    canvas: <TableSurface />,
  },
  {
    hub: "talk",
    breadcrumb: ["Talk", "#onboarding"],
    note: "Channels, threads, huddles and calls, in the workspace where the tasks are. A decision in a thread can become a task without leaving it.",
    a11y: "A chat channel with a threaded conversation and a task referenced inside it.",
    canvas: <TalkThreadSurface />,
  },
  {
    hub: "teams",
    breadcrumb: ["Teams", "Roles"],
    note: "A directory, an org chart, roles, reviews, kudos and surveys. The people side of the company, on the same records as the work.",
    a11y: "A role definition page showing responsibilities and the person who holds the role.",
    canvas: <RolePageSurface />,
  },
  {
    hub: "goals",
    breadcrumb: ["Goals", "Q3"],
    note: "OKRs, KRAs and KPIs that read from the work underneath them, so progress is a consequence of what moved rather than a number somebody typed.",
    a11y: "A goal detail page with its progress ring and the linked work rolling up into it.",
    canvas: <GoalDetailSurface />,
  },
];

function Breadth() {
  const tabs: SurfaceTab[] = VIEWS.map((view) => {
    const hub = tuesday.hubs.find((h) => h.id === view.hub);
    return {
      id: view.hub,
      label: hub?.label ?? view.hub,
      icon: <MkIcon name={hub?.icon ?? "SquareKanban"} size={16} />,
      note: view.note,
      frame: (
        <MarketingShell
          hub={view.hub}
          breadcrumb={view.breadcrumb}
          label={view.a11y}
          caption={null}
          sidebar={<MkSidebar hub={view.hub} />}
        >
          {view.canvas}
        </MarketingShell>
      ),
    };
  });

  return (
    <Section py="lg" variant="tint">
      <Container>
        <div className="mk-head">
          <p className="mk-eyebrow">One workspace</p>
          <h2 className="mk-head__h2">Seven products your team already pays for, in one</h2>
          <p className="mk-head__sub">
            Each of these is the shipped interface, not a picture of it. Pick one.
          </p>
        </div>
        <SurfaceTabs tabs={tabs} />
      </Container>
    </Section>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 4. The module grid
 *
 * A card grid, which the quiet register forbade and this one requires: it
 * is the only honest way to put eight hubs on one screen. Each card is a
 * link, because a module card that cannot be opened is an advertisement.
 *
 * The hue per hub comes from the brand set (yellow, blue, red, green) and
 * is the one place colour is spent on this page, which is also where the
 * rivals spend theirs.
 * ═══════════════════════════════════════════════════════════════════ */

const TILE: Record<string, { bg: string; fg: string }> = {
  work: { bg: "var(--os-blue-50)", fg: "var(--os-blue-700)" },
  planner: { bg: "#FFF4E5", fg: "#B25E02" },
  ai: { bg: "#F3EEFF", fg: "#5B3DC4" },
  talk: { bg: "#E8F8EF", fg: "#12734A" },
  teams: { bg: "#FFEFEF", fg: "#B42318" },
  docs: { bg: "var(--os-blue-50)", fg: "var(--os-blue-700)" },
  tables: { bg: "#E8F8EF", fg: "#12734A" },
  goals: { bg: "#FFF4E5", fg: "#B25E02" },
};

function Modules() {
  return (
    <Section py="lg">
      <Container>
        <div className="mk-head">
          <p className="mk-eyebrow">The platform</p>
          <h2 className="mk-head__h2">Everything a company runs on, under one login</h2>
          <p className="mk-head__sub">
            Eight hubs, one set of people, one set of permissions. Turn on the ones you need.
          </p>
        </div>

        <div className="mk-modules">
          {tuesday.hubs.map((hub) => {
            const tile = TILE[hub.id] ?? TILE.work;
            return (
              <Link
                className="mk-module"
                key={hub.id}
                href="/features"
                style={{ ["--tile-bg" as string]: tile.bg, ["--tile-fg" as string]: tile.fg }}
              >
                <span className="mk-module__tile">
                  <MkIcon name={hub.icon} size={19} />
                </span>
                <p className="mk-module__name">{hub.label}</p>
                <p className="mk-module__what">{hub.features}</p>
              </Link>
            );
          })}
        </div>
      </Container>
    </Section>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 5. Use-case rows
 *
 * The category's middle: alternating words and product, each row naming a
 * job rather than a feature. Three rows, not eight: the tab strip above
 * already carried breadth, and these carry depth.
 * ═══════════════════════════════════════════════════════════════════ */

const ROWS: Array<{
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  a11y: string;
  hub: string;
  breadcrumb: string[];
  canvas: ReactNode;
}> = [
  {
    eyebrow: "Run the work",
    title: "One task, seventeen ways to look at it",
    body: "A list for the person doing the work, a board for the stand-up, a calendar for the week, a timeline for the plan. Same tasks underneath, so nothing is ever entered twice.",
    points: [
      "List, board, calendar, timeline, Gantt, table and workload views",
      "Custom fields, custom statuses and per-list workflows",
      "Subtasks, checklists, dependencies and recurring work",
    ],
    a11y: "A project board in list view with tasks grouped by status.",
    hub: "work",
    breadcrumb: ["Work", "Onboarding"],
    canvas: <BoardListSurface />,
  },
  {
    eyebrow: "Keep the knowledge",
    title: "The process and the work are in the same place",
    body: "Write the SOP once and the steps become the tasks. When somebody changes how the work is done, the change lands where the work happens rather than in a document nobody reopens.",
    points: [
      "Docs, wikis, SOPs, policies, contracts, canvases and files",
      "A step in a procedure can create the task that carries it out",
      "Acknowledgements, so you know who has read the current version",
    ],
    a11y: "A step by step standard operating procedure document.",
    hub: "docs",
    breadcrumb: ["Docs", "Client onboarding"],
    canvas: <SopDocSurface />,
  },
  {
    eyebrow: "See where it stands",
    title: "Goals that read from the work, not from a status meeting",
    body: "Link a goal to the work that delivers it and the progress is a consequence of what actually moved. The number stops being somebody's estimate of the number.",
    points: [
      "OKRs, KRAs and KPIs with owners and cadences",
      "Progress rolls up from the linked tasks underneath",
      "Reviews, one-to-ones and kudos on the same records",
    ],
    a11y: "A goal detail page with a progress ring and the work rolling up into it.",
    hub: "goals",
    breadcrumb: ["Goals", "Q3"],
    canvas: <GoalDetailSurface />,
  },
];

function UseCases() {
  return (
    <Section py="lg" variant="tint">
      <Container>
        {ROWS.map((row, index) => (
          <div className={`mk-row${index % 2 === 1 ? " mk-row--flip" : ""}`} key={row.title}>
            <div>
              <p className="mk-eyebrow">{row.eyebrow}</p>
              <h3 className="mk-row__h3">{row.title}</h3>
              <p className="mk-row__body">{row.body}</p>
              <ul className="mk-row__list">
                {row.points.map((point) => (
                  <li key={point}>
                    <Check size={16} aria-hidden="true" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
            <div className="mk-row__art">
              <MarketingShell
                hub={row.hub}
                breadcrumb={row.breadcrumb}
                label={row.a11y}
                caption={null}
                sidebar={<MkSidebar hub={row.hub} />}
              >
                {row.canvas}
              </MarketingShell>
            </div>
          </div>
        ))}
      </Container>
    </Section>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 6. The enterprise table
 *
 * Rule 6: enterprise is proved with a boring table, not with adjectives.
 *
 * EVERY ROW HERE IS LIVE TODAY, and each one is the same claim /security
 * already makes, in the same words. What is deliberately ABSENT is just as
 * important: no SOC 2, no ISO 27001, no GDPR or DPDP badge, no SSO, no
 * SCIM, no data residency, no uptime or SLA number. flags.ts gates all of
 * those to false, a procurement team reads a row in a table as a
 * commitment, and an earlier build of this site shipped a fabricated
 * compliance claim. Nothing goes in this table that a reader could not
 * verify by opening an account.
 * ═══════════════════════════════════════════════════════════════════ */

const FACTS: Array<[string, string]> = [
  ["Multi-factor authentication", "Required at sign in, per workspace policy."],
  ["Session control", "Sessions expire on inactivity, and signing out everywhere ends every session on every device at once."],
  ["Brute-force lockout", "Repeated failed sign ins lock the account rather than letting a list of passwords be tried against it."],
  ["Password reset tokens", "Stored hashed, single use, and time limited."],
  ["Security activity log", "Sign ins, password changes, MFA changes and session revocations, readable by the account holder."],
  ["Access by role and scope", "Permissions resolve per space, per folder, per list and per board, and a guest sees only what they were given."],
];

function Enterprise() {
  return (
    <Section py="lg">
      <Container>
        <div className="mk-head">
          <p className="mk-eyebrow">Security</p>
          <h2 className="mk-head__h2">The account controls that ship today</h2>
          <p className="mk-head__sub">
            Only what is live and checkable by opening an account. Certifications and single sign-on
            are not on this list because they are not built yet, and we will not put a row in a table
            that a procurement team would read as a commitment.
          </p>
        </div>

        <div className="mk-facts-scroll">
          <table className="mk-facts">
            <thead>
              <tr>
                <th scope="col">Control</th>
                <th scope="col">What it does</th>
              </tr>
            </thead>
            <tbody>
              {FACTS.map(([name, what]) => (
                <tr key={name}>
                  <th scope="row">{name}</th>
                  <td>{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mk-tabpanel__note">
          <Link href="/security">Read the whole security page</Link>
        </p>
      </Container>
    </Section>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 7. Pricing strip
 *
 * The category's shape: a free floor, a highlighted middle, a quoted top.
 * The numbers come from data/pricing.json through the same helpers the
 * /pricing page uses, so the home page can never quote a stale price.
 * ═══════════════════════════════════════════════════════════════════ */

function Plans({ currency }: { currency: MarketingCurrency }) {
  const symbol = pricing.currencies.find((c) => c.code === currency)?.symbol ?? "$";

  return (
    <Section py="lg" variant="tint">
      <Container>
        <div className="mk-head">
          <p className="mk-eyebrow">Pricing</p>
          <h2 className="mk-head__h2">Start free, and stay free until it is worth paying for</h2>
        </div>

        <div className="mk-plans">
          {(["starter", "growth", "scale"] as const).map((id) => {
            const plan = tier(id);
            const perSeat = tierPerSeat(id, currency);
            const featured = id === "growth";
            return (
              <div className={`mk-plan${featured ? " mk-plan--featured" : ""}`} key={id}>
                {/* Always rendered, hidden when off, so the three cards keep
                    their rows on the same lines. See stack.css. */}
                <span className="mk-plan__flag" data-on={featured} aria-hidden={!featured}>
                  {featured ? "Most teams" : "."}
                </span>
                <p className="mk-plan__name">{plan.name}</p>
                <p className="mk-plan__price">
                  {perSeat === null ? plan.priceLabel : `${symbol}${perSeat}`}
                </p>
                <p className="mk-plan__sub">
                  {perSeat === null ? plan.priceSubLabel : plan.priceLabel}
                </p>
                <ul className="mk-plan__list">
                  {plan.bullets.map((bullet) => (
                    <li key={bullet}>
                      <Check size={15} aria-hidden="true" />
                      {bullet}
                    </li>
                  ))}
                </ul>
                {/* TierCta, not three identical ghost buttons. The pricing
                    data decides which tier is the recommended one and that
                    card gets the filled skin; the others stay ghost. It
                    also follows the site-wide trial-or-demo flag, so all
                    three swap together if the flag is flipped. */}
                <div className="mk-plan__cta">
                  <TierCta tierId={id} placement={`plans-${id}`} />
                </div>
              </div>
            );
          })}
        </div>
      </Container>
    </Section>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 8. Close
 * ═══════════════════════════════════════════════════════════════════ */

function Close() {
  return (
    <Section py="lg">
      <Container>
        <div className="mk-close-stack">
          <h2 className="mk-close-stack__h2">Put the whole company in one workspace</h2>
          <p className="mk-hero-stack__lede">
            Free for up to {starterSeatCap} people, with no card and no time limit.
          </p>
          <div className="mk-hero-stack__actions">
            <PrimaryCta placement="close" />
            <SecondaryCta placement="close" />
          </div>
        </div>
      </Container>
    </Section>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * The page
 * ═══════════════════════════════════════════════════════════════════ */

export function HomeStack({ currency }: { currency: MarketingCurrency }) {
  return (
    <div className="mk-stack">
      <Hero />
      <HonestRung />
      <Breadth />
      <Modules />
      <UseCases />
      <Enterprise />
      <Plans currency={currency} />
      <Close />
    </div>
  );
}
