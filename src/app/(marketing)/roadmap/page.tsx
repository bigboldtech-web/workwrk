// /roadmap, restored and rebuilt on the tokens.
//
// History, because the absence was confusing: this page existed, and commit
// b7c9d055 ("hard marketing/app host split + remove self-managed roadmap")
// deleted it on the way to an external roadmap service that never arrived.
// What that left was worse than either option: /roadmap kept being quoted
// as the public roadmap URL, the changelog kept a button pointing at it,
// and the path itself fell through the marketing group to the app's
// catch-all, so a visitor following a shared link landed on a login screen.
//
// So it is back, on the token layer rather than the ten hue one, with its
// board intact: four columns, a card per item, an area tag. What changed is
// the content. Every Done card is a thing a person can use today, and the
// three columns to the right of it say plainly that they are intent.
//
// The four columns are the capability this page has always had and they are
// kept. What is gone is the eight colour area palette: one accent, and the
// area tag is a quiet chip rather than a colour code nobody learned.

import type { Metadata } from "next";

import Link from "next/link";

import { mailboxes } from "@/components/marketing/config";
import "@/components/marketing/home/home.css";
import { Band, Claim, Close, Eyebrow, Headline, Line, Note, Page, Sub } from "@/components/marketing/iconic/iconic";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

export const metadata: Metadata = {
  title: "Roadmap",
  description:
    "What is live today and what is ahead, as a board. Done is shipped and usable now; everything to the right of it is intent rather than a commitment.",
  alternates: { canonical: "https://workwrk.com/roadmap" },
  openGraph: {
    images: [OG_DEFAULT_IMAGE],
    title: "Roadmap",
    description: "What is live today and what is ahead. Done means you can use it now.",
  },
  // The root layout's twitter:description still reads "Replaces 15 tools",
  // which collides with the fourteen this site counts everywhere else.
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: "What is live today and what is ahead. Done means you can use it now." },
};

type Col = "done" | "progress" | "next" | "backlog";

const COLS: readonly { key: Col; label: string; note: string }[] = [
  { key: "done", label: "Done", note: "Live today. Open the product and use it." },
  { key: "progress", label: "In progress", note: "Being built now. No date attached." },
  { key: "next", label: "Next up", note: "Decided, not started." },
  { key: "backlog", label: "Backlog", note: "Wanted. Not scheduled." },
];

type Area = "work" | "goals" | "teams" | "docs" | "tables" | "talk" | "ai" | "platform";

const AREA_LABEL: Record<Area, string> = {
  work: "Work",
  goals: "Goals",
  teams: "Teams",
  docs: "Docs",
  tables: "Tables",
  talk: "Talk",
  ai: "AI",
  platform: "Platform",
};

/**
 * The board.
 *
 * Rule for the Done column, and it is the only rule that matters on a
 * roadmap: a card is Done when a customer can do the thing. Not when the
 * code merged, not when the migration is written, not when it works for the
 * team that built it. Three cards were moved OUT of Done while this page was
 * being rebuilt, for exactly that reason, and they are in the columns to the
 * right where the rest of the site also says they are unbuilt.
 */
const ITEMS: readonly { col: Col; area: Area; title: string; body: string }[] = [
  // ── Done ──────────────────────────────────────────────────────────────
  { col: "done", area: "work", title: "Spaces, folders, lists and boards", body: "The structure the rest of the product hangs from." },
  { col: "done", area: "work", title: "Every view, saved and named", body: "List, board, table, calendar, gantt, timeline, workload, gallery, each with its own grouping, filters, sort and columns." },
  { col: "done", area: "work", title: "Custom fields and per list statuses", body: "Thirty field types, and a status set that belongs to the list rather than to the product." },
  { col: "done", area: "work", title: "Subtasks, checklists, priority, tags", body: "With bulk actions, drag to reorder and drag to reschedule." },
  { col: "done", area: "work", title: "Dates, repeats, reminders and time", body: "Recurrence that rolls forward on completion, a reminder that fires, and a timer on the task." },
  { col: "done", area: "docs", title: "Docs and the block editor", body: "Full screen editing with version history." },
  { col: "done", area: "docs", title: "SOPs: four kinds, with acknowledgement", body: "Written, step, checklist and capture, each with the editor that suits it and a compliance view." },
  { col: "done", area: "docs", title: "Policies and contracts", body: "Their own acknowledgement ledger, and clauses on the contract." },
  { col: "done", area: "docs", title: "Canvas, our own whiteboard engine", body: "Autosave, version history, and diagrams generated from a description." },
  { col: "done", area: "tables", title: "The sheet engine", body: "Formulas, data validation, link, lookup and rollup columns, named views and a gallery." },
  { col: "done", area: "goals", title: "Goals and OKRs, with rollup", body: "Company, team and personal, cascading, with progress computed rather than typed." },
  { col: "done", area: "goals", title: "The on track verdict", body: "Derived the same way for every goal, from progress against time elapsed." },
  { col: "done", area: "goals", title: "The effort panel", body: "The linked work that is actually moving a goal, collected without anyone attaching it." },
  { col: "done", area: "goals", title: "KRAs and KPIs", body: "Result areas on the role, weighted, each naming the measure behind it." },
  { col: "done", area: "teams", title: "Directory, org chart and roles", body: "Departments, offices, the reporting tree including dotted lines, and a role definition page." },
  { col: "done", area: "teams", title: "Review cycles", body: "Self, manager and peer input, weighted scoring, and the KPI and acknowledgement records already on the timeline." },
  { col: "done", area: "teams", title: "Kudos against your own values", body: "The tags are the company values from your identity settings." },
  { col: "done", area: "talk", title: "Channels, threads and calls", body: "With reactions, mentions, attachments and search." },
  { col: "done", area: "ai", title: "One Ask, on every page", body: "Reading the workspace's own people, roles, measures, processes and reviews." },
  { col: "done", area: "platform", title: "Sign-in hardening and two step verification", body: "Lockout, hashed reset tokens, password policy, idle expiry, real sign-out, and two step verification at login." },
  { col: "done", area: "platform", title: "Additive access at every level", body: "Share a space, folder, list, board or doc; a grant adds reach and never narrows it. Assigning a task grants it." },
  { col: "done", area: "platform", title: "One token layer and one page frame", body: "Colour, type, spacing and radius decided once, and the navy rail, top bar, sidebar and page header shared by every page." },
  { col: "done", area: "platform", title: "Eight hubs on the rail", body: "About twenty five icons folded into eight, with every link kept." },
  { col: "done", area: "platform", title: "Template Center", body: "Save and apply task, list, space, folder, doc, view and whiteboard templates." },
  { col: "done", area: "platform", title: "Notifications and reminders", body: "A live bell, persistent reminders and an email path." },
  { col: "done", area: "platform", title: "A v1 REST API", body: "People, tasks, processes, result areas, KPIs, readings and recognitions, with an OpenAPI document." },

  // ── In progress ───────────────────────────────────────────────────────
  { col: "progress", area: "platform", title: "The interface refresh, phase by phase", body: "The frame, Work and Knowledge have landed. The remaining surfaces follow." },
  { col: "progress", area: "platform", title: "The new access model", body: "Four roles and one resolver, running inert beside the current ladder while a parity job compares every answer." },
  { col: "progress", area: "docs", title: "An SOP step that creates the task", body: "With the owner resolved from the role that owns the process. This is the mechanism the Tuesday story marks as unbuilt." },
  { col: "progress", area: "tables", title: "More of the spreadsheet function set", body: "Closing the gap with what people expect a sheet to do." },

  // ── Next up ───────────────────────────────────────────────────────────
  { col: "next", area: "goals", title: "A completed task writing a KPI reading", body: "Today every reading comes from a person or the API, so the ring does not move by itself." },
  { col: "next", area: "ai", title: "Source chips on an answer", body: "The records the Ask actually read, shown beside the answer." },
  { col: "next", area: "ai", title: "Per person scoping on the Ask", body: "Retrieval is filtered by organisation today. It needs to be filtered by the person asking." },
  { col: "next", area: "teams", title: "Kudos as review evidence", body: "Recognition landing on the cycle rather than being read alongside it." },
  { col: "next", area: "work", title: "The connection trail on a task", body: "Everything a task touched, in order, as a product surface rather than a story." },
  { col: "next", area: "platform", title: "Guided first run", body: "Mission, values, the first goals and the first invitations, in one pass." },
  // THE ONE ITEM ON THIS BOARD THE REST OF THE SITE ARGUES WITH, so it says
  // how the argument is settled rather than leaving a reader to find it.
  //
  // Eleven CTAs, /pricing, /compare, /faq and /demo all describe a free
  // self-serve signup in the present tense, and this card said the thing
  // they point at was "decided, not started". Both were true statements
  // about different days, which is the worst kind of contradiction to
  // publish: a visitor cannot tell which one is about today.
  //
  // The mechanism that settles it already ships. `ctaPrimary` reads
  // NEXT_PUBLIC_MARKETING_CTA, and setting it to "demo" turns every Start
  // free on the site into Book a demo, in one place, with no copy edit.
  // Concept 7.1 puts it exactly this way: "if self-serve signup is not live
  // at launch, Start free and Book a demo swap roles everywhere".
  {
    col: "next",
    area: "platform",
    title: "Self-serve signup",
    body:
      "Starting a workspace without talking to anybody. It is the launch gate for this site: every Start free points at it, and until it answers, one setting turns all eleven of them into Book a demo.",
  },

  // ── Backlog ───────────────────────────────────────────────────────────
  { col: "backlog", area: "platform", title: "The automation hub", body: "Event driven workflows, once enough of the product emits events worth reacting to." },
  { col: "backlog", area: "platform", title: "Third party connectors", body: "Demand driven. We build one when the same one is asked for repeatedly, and none ships today." },
  { col: "backlog", area: "platform", title: "Single sign-on and provisioning", body: "Wanted by larger buyers. Not started, and not claimed anywhere else on this site." },
  { col: "backlog", area: "docs", title: "Real time multiplayer on the canvas", body: "Co-editing over the Talk transport." },
  { col: "backlog", area: "ai", title: "A per person performance manager", body: "Designed, deferred until the delivery record underneath it is solid." },
  { col: "backlog", area: "platform", title: "Native mobile apps", body: "Beyond the responsive web. There is no app in a store today." },
];

export default function RoadmapPage() {
  const shipped = ITEMS.filter((i) => i.col === "done").length;

  return (
    <Page>
      <Band air="hero" labelledBy="road-h1" still>
        <Eyebrow>Roadmap</Eyebrow>
        <Claim id="road-h1">What is live. What is not.</Claim>
        <Sub>
          {shipped} things on this board are usable today, and the further right a card sits the less of a commitment
          it is.
        </Sub>
      </Band>

      {/* The board is this page's one object, so it keeps its own sheet: a
          four column board is what a roadmap IS, and redrawing it as a stack
          of names would be the site deciding it knows better than the thing
          it is describing. Everything around it is the kit. */}
      <Band ground="quiet" labelledBy="road-board">
        <Eyebrow>The board</Eyebrow>
        <Headline id="road-board">Four columns, one promise.</Headline>
        <Line>Nothing moves into Done until a customer can do the thing.</Line>
        <div className="mk-roadmap" style={{ marginTop: 44, textAlign: "start" }}>
          {COLS.map((col) => {
            const cards = ITEMS.filter((i) => i.col === col.key);
            return (
              <div key={col.key} className="mk-roadmap__col">
                <div className="mk-roadmap__head">
                  <h3 className="mk-roadmap__title">{col.label}</h3>
                  <span className="mk-roadmap__count">{cards.length}</span>
                </div>
                <p className="mk-roadmap__note">{col.note}</p>
                <ul className="mk-roadmap__list">
                  {cards.map((item) => (
                    <li key={item.title} className="mk-roadmap__card">
                      <p className="mk-roadmap__card-title">{item.title}</p>
                      <p className="mk-roadmap__card-body">{item.body}</p>
                      <span className="mk-roadmap__area">{AREA_LABEL[item.area]}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        <Note>
          Everything else is intent and moves as we learn, so please do not buy this product for a card that is not in
          the first column. If something you need is missing, write to{" "}
          <a className="ic-a mk-focus" href={`mailto:${mailboxes.general}`}>
            {mailboxes.general}
          </a>
          . What shipped, with dates, is on the{" "}
          <Link className="ic-a mk-focus" href="/changelog" data-cta="roadmap-changelog">
            changelog
          </Link>
          .
        </Note>
      </Band>

      <Close headline="Start with what is live." placement="roadmap-close" />
    </Page>
  );
}
