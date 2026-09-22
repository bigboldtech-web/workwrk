// The /compare data (marketing-concept.md section 5 and 12 Phase 4 item 19).
//
// It lives under the route rather than in src/components/marketing for one
// specific reason: the marketing copy checker allows a competitor name on
// paths matching /compare/ and nowhere else. Putting these strings in a
// shared component directory would put the site's only vendor names outside
// the one place the rule permits them, and the rule would have to grow an
// exemption to accommodate a file that did not have to be there.
//
// THE DISCIPLINE, which the index page already stated and this file now
// enforces for four pages instead of one:
//
//   Nothing in a competitor column is a claim about their product beyond
//   the category a team buys it for. We do not summarise someone else's
//   feature list, we do not tick capabilities on their behalf, and there is
//   no logo anywhere. What each entry carries is: what it is bought for,
//   what we do instead, and the case where it is the better answer.
//
//   Every row about US is checkable by opening ours, and the numbers come
//   from the pricing source rather than being typed.
//
//   "Leaves disconnected" is a statement about a STACK, not about a vendor.
//   A dedicated work management tool is not deficient for having no KRA
//   model; it is a work management tool. The claim is that the records live
//   in a different product, or in nobody's, and that is the thing this
//   site's whole argument is about.

import { moduleNames } from "@/components/marketing/config";
import { starterSeatCap, tier } from "@/components/marketing/data/pricing";

const GROWTH = tier("growth");

/* ═══════════════════════════════════════════════════════════════════
 * The rows about us.
 * ═══════════════════════════════════════════════════════════════════ */

/** Every one is checkable in the product or in the price list. */
export const FACTS: Array<[string, string]> = [
  ["What it is", `One people and project management system: ${moduleNames.length} blocks on one data model.`],
  ["What it is not", "Not payroll, not benefits, not a CRM, not a helpdesk, not finance."],
  ["Free tier", `Yes, up to ${starterSeatCap} people, with no card and no time limit.`],
  ["Listed price", `${GROWTH.name} is listed per member per month. Quotes start above ${GROWTH.seatCap} people.`],
  ["Currencies", "Authored per currency in USD, INR, AED, SGD, GBP and EUR, not converted from a rate."],
  // "None" was flatly untrue on the one page that promises "the rows about
  // us are the ones you can check by opening ours". CSV import ships: a
  // table reads a spreadsheet, a people list reads one, and there is an
  // Imports surface in the product. What does NOT exist is an importer that
  // reads another product's data, which is the thing a buyer is asking
  // about, so the row says both halves instead of rounding to the shorter
  // and wronger one.
  [
    "Importers",
    "CSV into a table and into a people list. No importer reads another product's data for you, so you bring one team at a time and cancel each old subscription on its renewal date.",
  ],
  ["Third party connectors", "None ship today. We will name one here when it does."],
  ["Certifications", "None held yet. The security page says so in the same words."],
  ["Export", "On every tier, including the free one, any time."],
];

/* ═══════════════════════════════════════════════════════════════════
 * The categories, and the four with pages of their own.
 * ═══════════════════════════════════════════════════════════════════ */

export interface CompareEntry {
  /** The URL segment, when this entry has a page. Null keeps it to the index. */
  slug: string | null;
  name: string;
  boughtFor: string;
  ours: string;
  theirs: string;
  /**
   * The records a stack built on this category leaves somewhere else, by
   * node id in connect-graph.ts. The page reads the node labels from the
   * graph, so a record cannot be named here that is not on the map.
   */
  disconnected: string[];
  /** One sentence introducing that list, in the stack's own terms. */
  disconnectedLede: string;
}

export const COMPARE_ENTRIES: CompareEntry[] = [
  {
    slug: "workday",
    name: "Workday",
    boughtFor: "Enterprise HR, payroll and multi entity finance.",
    ours: `We are a people and project management system for SMB and mid market teams: roles, KRAs, KPIs, SOPs, tasks, goals and reviews on one data model, at ${GROWTH.name} prices that are listed rather than quoted.`,
    theirs:
      "If you need regulated payroll, benefits administration or a multi entity general ledger, that is their product and it is not ours. We do not run payroll and we are not planning to.",
    disconnected: ["task", "sop", "doc", "channel", "table-row"],
    disconnectedLede:
      "An HR system of record holds the people. The work chassis sits in a different set of products, which is why the review cycle arrives without the evidence on it and somebody spends a week collecting it.",
  },
  {
    slug: null,
    name: "BambooHR",
    boughtFor: "HR administration: records, leave, onboarding paperwork.",
    ours: "We carry the operating layer above the records: the role that owns a process, the KRA that role is measured on, the SOP the work follows and the goal it moves.",
    theirs: "If what you need is US payroll and leave administration, pair it with us or use it alone. We do not do either.",
    disconnected: ["task", "sop", "kra", "kpi", "goal"],
    disconnectedLede:
      "HR administration holds the employment record. What the person is accountable for, and the work that proves it, is somewhere else.",
  },
  {
    slug: null,
    name: "Lattice",
    boughtFor: "Performance reviews, one to ones and engagement surveys.",
    ours: "Reviews here sit on the same data as the work: the KPI records and the KRA result are already on the timeline, because the tasks that moved them are in the same system.",
    theirs: "If you want performance reviews alone, on top of a stack you are keeping, a dedicated review tool is a smaller thing to buy and to learn.",
    disconnected: ["task", "sop", "doc", "table-row"],
    disconnectedLede:
      "A review tool holds the cycle and the ratings. The work that earned them is in the stack next door, so the evidence is pasted in rather than read.",
  },
  {
    slug: "clickup",
    name: "ClickUp",
    boughtFor: "Project and task management, with a lot of configuration.",
    ours: `Tasks are one of ${moduleNames.length} blocks. The difference is what a task is attached to: a role that owns it, an SOP that governs it, a KPI it moves.`,
    theirs: "If you only need task and project management and you already have the rest, a dedicated tool will be quicker to learn.",
    disconnected: ["role", "kra", "kpi", "review", "kudos"],
    disconnectedLede:
      "A work management tool holds the task. Who is accountable for the outcome, what they are measured on and what the quarter concluded live in the people half of the stack, and the two are joined by a spreadsheet.",
  },
  {
    slug: "monday",
    name: "Monday.com",
    boughtFor: "Work management boards, with per team automations and views.",
    ours: `Tasks are one of ${moduleNames.length} blocks on one data model, and the people half is not a separate purchase: the role, the KRA, the KPI and the review are the same records the work is attached to.`,
    theirs:
      "If a configurable board per team is the whole job, and the people side already has an owner elsewhere, a dedicated work management tool is a smaller thing to run.",
    disconnected: ["role", "kra", "kpi", "review", "kudos"],
    disconnectedLede:
      "A board holds the work. The role that owns it, what that role is measured on, and the review that reads the result are in the people half of the stack, so the connection between them is a meeting.",
  },
];

export function compareEntry(slug: string): CompareEntry | undefined {
  return COMPARE_ENTRIES.find((e) => e.slug === slug);
}

/** The slugs with a page. `generateStaticParams` and the sitemap read this. */
export const COMPARE_SLUGS: string[] = COMPARE_ENTRIES.filter((e) => e.slug !== null).map((e) => e.slug as string);
