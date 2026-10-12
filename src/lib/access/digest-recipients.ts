// Who a manager digest of /api/email/send-reminders goes to, and which tasks
// it may name to them, as the engine reads both. Docs-found fixes batch 4.
//
// THE MANAGER. A line about a person goes to the manager they report to for
// every read that grants reach (manager-lines.ts effectiveManagersOf): their
// stored manager, or past an Agent the next person up who is none. The
// digests read the stored line as it stands, so an Agent who kept reports
// from before rule 6 got their people's overdue work by email every Monday,
// though an Agent is no one's manager. A manager who is removed, deactivated,
// holds no level in this workspace or holds the Agent tier here gets none,
// and nobody is their own manager.
//
// NEVER A GUEST. A Guest reads no one's people data here (person-access
// relationTo), so a digest naming a person's late work is not theirs to get,
// and a Guest manager gets none, whatever line still names them. Read as
// effectiveOrgRole reads it: a person anchored here whose stored org role is
// GUEST (the Guest invitation writes it; their level says Member), or a level
// that maps to no role. Docs-found fixes batch 6: such a manager was read as
// a Member, so their overdue digest named tasks on workspace-wide Lists a
// Guest cannot open. Worst case of skipping: a Guest set as someone's manager
// gets no Monday email, as a deactivated manager gets none. Worst case of
// sending: task titles reach an outsider by email. Read whatever the
// ACCESS_V2_TABLES switch says, as guests.ts anyGuestHere reads it: the
// column only ever narrows.
//
// SOMEONE WHO WORKS HERE THROUGH A MEMBERSHIP (anchored in another
// workspace) has a digest manager here too, read the same way: their stored
// manager, walked at the tier each manager holds here, never themselves,
// never someone who holds no level here, never an Agent (memberManagersOf).
// Docs-found fixes batch 5: effectiveManagersOf answers only for people
// anchored here, and the anchor is the last workspace a person switched to on
// any device (acting-workspace.ts), so an Acme employee who once opened a
// partner workspace lost Sam, her manager in Acme, from every Acme digest,
// and her late Acme work reached nobody. Telling Sam reveals nothing he can't
// open: every title is held to what he can open (WHAT THEY MAY READ, below,
// for a task; sop-access.ts sopsEachCanRead for a SOP).
// This pass is the digests' own, so effectiveManagersOf, which the reviewer,
// approver and weekly-review reads share, is unchanged.
//
// WHAT THEY MAY READ. A task's title reaches a manager only when they can
// open it in the app: Can view or more on its List (the node resolver), or
// they are one of its assignees. The team pages hold the same rule (a title
// on a List the viewer cannot open never leaks: team/members-work and
// team/person-work read only readableBoardsFor). listsEachCanRead answers
// for the (manager, List) pairs it is asked about over ONE world and one read
// of those managers' own rows on it, never a resolver call per task or per
// manager. It evaluates each manager on their own Lists only, and gives the
// event loop a turn between managers (docs-found fixes batch 5: it ran every
// manager against every List of a page, all at once, and read every person's
// rows on every Space of it, so a 3,000-manager workspace's Monday run could
// hold the web process for seconds per page).
//
// A SOP's title reaches a manager only when the SOP list and page would open
// it for them (sopsEachManagerCanRead: src/lib/sop-access.ts sopsEachCanRead,
// sopVisibilityWhere's rules for many managers in a few reads), at the level
// they hold here. Docs-found fixes batch 6: the overdue SOP digest had no
// read check, so a SOP in a restricted folder reached a person's manager by
// title.
//
// Server-only (prisma). Kept in src/lib/access: the tier and the member
// tables are the engine's to read (the G7 lint rule).

import type { Prisma, PrismaClient } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { effectiveManagerFrom, type LineFacts } from "@/lib/people/reporting-lines";
import { levelsHeldIn } from "./acting-workspace";
import { effectiveManagersOf } from "./manager-lines";
import { effectiveOrgRole, isAgentOf } from "./org-role";
import { NodeEvaluator, nodeCtxFromLevel, roleAtLeast, type NodeViewer } from "./node-rules";
import { grantsWithViewer, loadAllGrants, loadRows } from "./node-world";
import { RULE_1_DENIED_STATUSES } from "./resolve";

type Db = PrismaClient | Prisma.TransactionClient;

/** How many rounds a walk through Agents reads (manager-lines.ts ROUNDS: a longer chain of Agents is a data fault). */
const ROUNDS = 16;

export interface DigestManager {
  id: string;
  email: string;
  firstName: string;
  /** How the engine reads them in this workspace, for listsEachCanRead. */
  viewer: NodeViewer;
  /** The level they hold in this workspace, for sopsEachCanRead. */
  accessLevel: string;
}

/**
 * The digest manager of each of these people (THE MANAGER, above). People
 * with none are absent from the answer.
 */
export async function digestManagersOf(organizationId: string, personIds: readonly string[], db: Db = prisma): Promise<Map<string, DigestManager>> {
  const out = new Map<string, DigestManager>();
  const effective = new Map(await effectiveManagersOf(organizationId, personIds, db));
  // Everyone effectiveManagersOf left out is not anchored here: a live
  // member here is answered the same way (SOMEONE WHO WORKS HERE THROUGH A
  // MEMBERSHIP, above).
  const rest = [...new Set(personIds)].filter((id) => id && !effective.has(id));
  for (const [id, m] of await memberManagersOf(organizationId, rest, db)) effective.set(id, m);
  const ids = [...new Set([...effective.values()].filter((m): m is string => !!m))];
  if (ids.length === 0) return out;
  const rows = await db.user.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, email: true, firstName: true, status: true, organizationId: true, accessLevel: true, orgRole: true },
  });
  // The level each holds HERE: their own where they are anchored here, the
  // membership's role where they work here from another workspace.
  const elsewhere = rows.filter((r) => r.organizationId !== organizationId).map((r) => r.id);
  const held = elsewhere.length
    ? new Map((await db.organizationMembership.findMany({ where: { organizationId, userId: { in: elsewhere } }, select: { userId: true, role: true } })).map((m) => [m.userId, m.role as string]))
    : new Map<string, string>();
  const managers = new Map<string, DigestManager>();
  for (const r of rows) {
    const anchoredHere = r.organizationId === organizationId;
    const level = anchoredHere ? r.accessLevel : held.get(r.id);
    if (!level || isAgentOf(level) || RULE_1_DENIED_STATUSES.has(String(r.status))) continue;
    // NEVER A GUEST (above): the stored column is this workspace's only where they are anchored here.
    if (effectiveOrgRole(level, false, anchoredHere ? r.orgRole : null) === "GUEST") continue;
    const ctx = nodeCtxFromLevel(r.id, organizationId, level);
    managers.set(r.id, {
      id: r.id,
      email: r.email,
      firstName: r.firstName,
      viewer: { userId: ctx.userId, orgAdmin: ctx.orgAdmin, orgGuest: ctx.orgGuest, isAgent: ctx.isAgent, denied: false },
      accessLevel: String(level),
    });
  }
  for (const [personId, managerId] of effective) {
    const m = managerId && managerId !== personId ? managers.get(managerId) : undefined;
    if (m) out.set(personId, m);
  }
  return out;
}

/**
 * The manager each of these people reports to here, for the ones who are
 * live members here and anchored in another workspace: their stored
 * manager, walked past an Agent to the next person up who is none, at the
 * tier each manager holds HERE (their row's level where anchored here, the
 * membership's role where they work here from elsewhere): the walk
 * effectiveManagersOf runs for the people anchored here. Never the person
 * themselves, and never someone who holds no level here. Anyone else (no
 * membership here, removed, deactivated) is absent.
 */
async function memberManagersOf(organizationId: string, ids: readonly string[], db: Db): Promise<Map<string, string | null>> {
  if (ids.length === 0) return new Map();
  const people = await db.user.findMany({
    where: {
      id: { in: [...ids] },
      organizationId: { not: organizationId },
      deletedAt: null,
      status: { not: "INACTIVE" },
      organizationMemberships: { some: { organizationId } },
    },
    select: { id: true, managerId: true },
  });
  const facts = new Map<string, LineFacts>();
  const foreign = new Set<string>();
  let frontier = [...new Set(people.map((p) => p.managerId).filter((m): m is string => !!m))];
  for (let round = 0; round < ROUNDS && frontier.length; round += 1) {
    const got = await db.user.findMany({ where: { id: { in: frontier }, deletedAt: null }, select: { id: true, managerId: true, status: true } });
    const levels = await levelsHeldIn(organizationId, got.map((g) => g.id), db);
    const walked: string[] = [];
    for (const g of got) {
      const level = levels.get(g.id);
      if (level === undefined) {
        foreign.add(g.id); // holds nothing here: never a manager here
        continue;
      }
      facts.set(g.id, { managerId: g.managerId, agent: isAgentOf(level), inactive: g.status === "INACTIVE" });
      walked.push(g.id);
    }
    frontier = [...new Set(walked.map((id) => facts.get(id)!).filter((f) => f.agent && f.managerId && !facts.has(f.managerId)).map((f) => f.managerId as string))];
  }
  return new Map(people.map((p) => {
    const m = effectiveManagerFrom(p.managerId, facts, p.id);
    return [p.id, m && foreign.has(m) ? null : m];
  }));
}

/** One question for sopsEachManagerCanRead: may this digest manager open this SOP? */
export interface SopReadAskOfManager {
  manager: DigestManager;
  sopId: string;
}

/**
 * For each digest manager asked about, the ids of the SOPs asked for them
 * that they can open (WHAT THEY MAY READ, above): sop-access.ts
 * sopsEachCanRead at the level each holds in this workspace. Loaded on use,
 * so the engine's other readers never load the SOP rules.
 */
export async function sopsEachManagerCanRead(organizationId: string, asks: Iterable<SopReadAskOfManager>): Promise<Map<string, Set<string>>> {
  const { sopsEachCanRead } = await import("@/lib/sop-access");
  return sopsEachCanRead(organizationId, [...asks].map((a) => ({ reader: { id: a.manager.id, accessLevel: a.manager.accessLevel }, sopId: a.sopId })));
}

/** One question for listsEachCanRead: may this viewer open this List? */
export interface ListReadAsk {
  viewer: NodeViewer;
  listId: string;
}

/** Give the event loop a turn, so a long page of managers never holds every other request on the node. */
const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * For each viewer asked about, the ids of the Lists asked for them that
 * they hold at least Can view on: one world for every List asked, one read
 * of the asked viewers' own rows on it, and each viewer evaluated on their
 * own Lists only, with a turn for the event loop between viewers. A List in
 * another workspace is none. Every answer is an asked pair, so a caller that
 * keeps each one (send-reminders keeps them per workspace run) never asks
 * for the same pair twice.
 */
export async function listsEachCanRead(organizationId: string, asks: Iterable<ListReadAsk>): Promise<Map<string, Set<string>>> {
  const byViewer = new Map<string, { viewer: NodeViewer; lists: Set<string> }>();
  for (const a of asks) {
    if (!a.listId || !a.viewer?.userId) continue;
    const e = byViewer.get(a.viewer.userId) ?? { viewer: a.viewer, lists: new Set<string>() };
    e.lists.add(a.listId);
    byViewer.set(a.viewer.userId, e);
  }
  const out = new Map<string, Set<string>>([...byViewer.keys()].map((id) => [id, new Set<string>()]));
  const asked = [...byViewer.values()].filter((e) => !e.viewer.denied);
  if (asked.length === 0) return out;
  const lists = [...new Set(asked.flatMap((e) => [...e.lists]))];
  const rows = await loadRows(organizationId, { lists });
  const all = await loadAllGrants(rows, { userIds: asked.map((e) => e.viewer.userId) });
  for (let i = 0; i < asked.length; i += 1) {
    if (i > 0) await yieldToLoop();
    const { viewer, lists: theirs } = asked[i];
    const ev = new NodeEvaluator(rows, grantsWithViewer(viewer, all.get(viewer.userId)));
    const mine = out.get(viewer.userId) as Set<string>;
    for (const id of theirs) if (roleAtLeast(ev.effective({ kind: "list", id }).role, "VIEW")) mine.add(id);
  }
  return out;
}
