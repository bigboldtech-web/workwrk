// The positioning sentence, and the gate on it.
//
// It lives in its own leaf module for the same reason flags.ts does: five
// consumers need it and they are not allowed to import each other.
// headline.ts reads config.ts, config.ts reads data/pricing.ts, and
// data/pricing.ts is one of the five, so putting this sentence in
// headline.ts would close a cycle. This module imports data/tuesday and
// nothing else.
//
// Why the sentence needs a gate at all:
//
// "Roles own SOPs. SOPs become tasks. Tasks move goals." is three
// mechanisms in nine words, and the Tuesday fixture marks all three of them
// unbuilt. Stop 1 is an SOP owned by a role (prisma `model SOP` has a kraId
// and no roleId). Stop 2 is the SOP step spawning the task with the owner
// resolved from the role (no SOP surface calls createBoardItem). Stop 5 is
// completing the task writing the KPI record that moves the goal (every
// KPIRecord in the repo comes from a person or an external door).
//
// And it is not one sentence in one place. It was the H1 subhead on both
// A/B variants, the home page meta description, the og:description, the
// WebSite node's description and the SoftwareApplication node's
// description. The single sentence the whole site is built on was the only
// sentence that never went through the gate every other sentence goes
// through: the spine, the beats, the wire labels, the trail, the receipt
// rows, the task caption and the thread pin all read `narrationFor` and its
// siblings.
//
// Both versions below make the same argument. The difference is the verb.
// LINKED is what the records do today; BECOMES is what the mechanisms will
// do. Ship stops 1, 2 and 5 and the stronger sentence turns on in all five
// places at once, which is why this is a function and not a string.

import { stopShipped } from "./data/tuesday";

/** What the site may say once the three mechanisms ship. */
export const SUB_MECHANISM =
  "Roles own SOPs. SOPs become tasks. Tasks move goals. One system, with no tabs in between.";

/** What is true today: the records exist and they are linked to each other. */
export const SUB_LINKED =
  "One set of linked records: the role, the process, the work, the goal. One system, with no tabs in between.";

/** The subhead, gated on the three stops it asserts. */
export function headlineSub(): string {
  return stopShipped(1) && stopShipped(2) && stopShipped(5) ? SUB_MECHANISM : SUB_LINKED;
}

/**
 * The same claim compressed for a structured-data description, where the
 * sentence is quoted back by a machine and the full stop count matters less
 * than the verb.
 */
export function positioningLine(): string {
  return `One system for people, processes, work and goals. ${headlineSub()}`;
}

/**
 * The site-wide defaults the MARKETING layout hands to every page that does
 * not set its own.
 *
 * Why they live here rather than being left to the root layout: the root
 * layout is shared with the product and the auth host, and its metadata is
 * still the pre-refresh positioning. Its keywords read "business operating
 * system, performance management software India, OKR software India, HR
 * operations India, SaaS for Indian SMBs" and its title reads "The operating
 * system for teams that mean business". Decision D25 retired that in favour
 * of a people and project management system, sold globally, priced in US
 * dollars by default with the currency a data decision.
 *
 * Only the home page overrode it, so thirty nine marketing routes shipped
 * the retired positioning in their keywords, and the marketing 404 shipped
 * it in its tab title. A layout-level default fixes all of them at once and
 * still loses to any page that sets its own, which most of them do.
 *
 * Changing the ROOT layout would reach outside this unit, so it is not
 * touched: the marketing group overrides what the marketing group serves.
 */
export const SITE_TITLE_DEFAULT = "WorkwrK: every task knows who owns it";

/** The template a child page's string title is poured into. */
export const SITE_TITLE_TEMPLATE = "%s · WorkwrK";

/** The description a marketing page inherits when it sets none. */
export function siteDescription(): string {
  return `${positioningLine()} A people and project management system for companies of 25 to 500.`;
}

/**
 * The keyword set, PPMS and global. No country is named: the site sells in
 * six currencies and D25 settled the geography as "any business".
 */
export const SITE_KEYWORDS: string[] = [
  "people and project management system",
  "work operating system",
  "SOP management software",
  "KPI tracking software",
  "OKR and goal tracking",
  "performance review software",
  "task and project management",
  "team directory and org chart",
  "employee recognition software",
  "workwrk",
];
