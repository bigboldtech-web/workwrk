// How far an automation reaches: never further than the person who made it
// (spec-ai-automation 1.4, "a workflow therefore never reaches further than
// its creator, and a demoted creator's workflows quietly stop being able to
// write"). The answers are the List gates', for the creator, live
// (access/legacy-reach.ts), which read the one node resolver.
//
//   READ   a trigger on a task in a List the creator cannot open does not run
//          their automation at all, so no notification, email or webhook ever
//          carries a private task's title to them or on their behalf.
//   WRITE  every action that changes, moves, archives, comments on or creates
//          a task checks the creator can make changes in that List (both ends
//          of a move), and fails the step with a sentence when they cannot.
//   PEOPLE a creator below manager (every Member may create since this stage)
//          only runs on performance events about themself, so no Member can
//          wire "when a review is completed, email me the score". The
//          Cashkr-era sales events never run a Member's automation.
//
// Owners and Admins reach everything, as they do in the product. A workflow
// with no creator on record (seeded before creators were stored) keeps the
// behaviour it always had; a creator no longer in the workspace reaches no
// List at all. When someone other than the creator published the live
// version, the run reaches only where BOTH could (narrowerAuthor).

import { legacyReachOf, type LegacyReach } from "@/lib/access/legacy-reach";

export type AutomationAuthor = LegacyReach;

/** Performance events whose subject is one person (payload.userId). */
const PERSON_EVENTS: ReadonlySet<string> = new Set(["kpi.recorded", "review.completed"]);

/** The Cashkr-era events: sales data a Member never had a surface for. */
const LEGACY_PREFIXES = ["lead.", "quote.", "pickup.", "payment."];

export function loadAuthor(organizationId: string, userId: string): Promise<AutomationAuthor | null> {
  return legacyReachOf(organizationId, userId);
}

/** Pure: may this creator's automation run on this kind of event at all. */
export function eventAllowedForAuthor(
  event: string,
  payload: Record<string, unknown>,
  author: Pick<AutomationAuthor, "userId" | "admin" | "manager"> | null,
): boolean {
  if (author?.admin || author?.manager) return true;
  if (LEGACY_PREFIXES.some((p) => event.startsWith(p))) return false;
  if (PERSON_EVENTS.has(event)) return !!author && payload.userId === author.userId;
  return true;
}

/**
 * The reach a run has when someone other than the creator published what
 * runs: the narrower of the two, so editing never borrows the creator's
 * reach. A manager who republishes an Admin's automation (any manager may
 * edit any automation) caps it at what the manager can open and change, so
 * they cannot wire an Admin's automation to copy a private List's task
 * titles to themself, or to move its tasks into their own List. Null when
 * either person is no longer in the workspace: the run then reaches no List
 * at all, as for a departed creator. The creator stays the run's person
 * (the PEOPLE rule and comments act as them).
 */
export function narrowerAuthor(creator: AutomationAuthor | null, publisher: AutomationAuthor | null): AutomationAuthor | null {
  if (!creator || !publisher) return null;
  if (creator.userId === publisher.userId) return creator;
  return {
    userId: creator.userId,
    admin: creator.admin && publisher.admin,
    manager: creator.manager && publisher.manager,
    canRead: async (boardId) => (await creator.canRead(boardId)) && (await publisher.canRead(boardId)),
    canWrite: async (boardId) => (await creator.canWrite(boardId)) && (await publisher.canWrite(boardId)),
  };
}

/**
 * The reach one run has, for every path that runs or re-runs an automation
 * (an event, a schedule, the retry cron, a manual Retry): the narrower of
 * everyone whose choice is in what runs. The creator; whoever published the
 * version that runs, or, for an older row that runs its draft, whoever last
 * saved that draft; and for a manual Retry the person who clicked it, since
 * the click makes the writes. The creator stays the run's person when there
 * is one. Undefined only for an older automation with nobody on record at
 * all, which keeps the behaviour it always had; null when any of them is no
 * longer in the workspace (the run then reaches no List).
 */
export async function runReach(
  load: (userId: string) => Promise<AutomationAuthor | null>,
  people: { creatorId: string | null; publisherId: string | null; retrierId?: string | null },
): Promise<AutomationAuthor | null | undefined> {
  const ids = [...new Set([people.creatorId, people.publisherId, people.retrierId].filter((x): x is string => !!x))];
  if (ids.length === 0) return undefined;
  let reach = await load(ids[0]);
  for (const id of ids.slice(1)) reach = narrowerAuthor(reach, await load(id));
  return reach;
}

/** May the creator open this List. */
export async function authorCanRead(author: AutomationAuthor | null, boardId: string): Promise<boolean> {
  return author ? author.canRead(boardId) : false;
}

/** May the creator change tasks in this List. */
export async function authorCanWrite(author: AutomationAuthor | null, boardId: string): Promise<boolean> {
  return author ? author.canWrite(boardId) : false;
}
