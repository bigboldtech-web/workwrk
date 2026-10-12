// "An Agent is never anyone's manager" (access 2.4, AGENT_TIER_BLURB) for
// the reporting lines that already say otherwise. Rule 6 (membership.ts)
// stops a manager becoming an Agent while anyone reports to them, but people
// who were Agents before it, and the reports and dotted lines they kept, are
// still stored. Nothing here rewrites them (docs-found fixes batch 3: no
// blind change of stored rows). Every read that grants reach asks here
// instead, so the stored line is read as the sentence promises:
//
//   An Agent's own reach   none. Their report tree is empty, they have no
//                          direct or dotted reports, and they are nobody's
//                          manager reviewer or approver (managesNobody).
//   Their solid reports    report, in effect, to the next person up the line
//                          who is no Agent (reporting-lines.ts
//                          effectiveManagerFrom), or to nobody. That person
//                          already reaches them through the tree.
//   Their dotted lines     count for nobody. A dotted line is a named extra
//                          relationship, so it is never handed up the line:
//                          that would give someone reach the line never gave.
//
// THE TIER THAT COUNTS is the one held in the workspace whose lines are read
// (acting-workspace.ts levelHeldIn), never the anchored row's level alone. A
// person anchored in another workspace (they switched, or accepted an
// invitation while signed in) keeps their reporting lines here, and a
// session on another device keeps acting here at the role their membership
// holds: a Manager here who is an Agent elsewhere keeps their team here, and
// an Agent here who is a Manager elsewhere manages nobody here (docs-found
// fixes batch 4).
//
// THE PEOPLE A LINE COUNTS are everyone who holds a level in the workspace
// (acting-workspace.ts levelsHeldFor: anchored here, or a membership here),
// never only the people anchored here (docs-found fixes batch 5): a report or
// a manager who last switched to another workspace, on any device, still
// works here and is still on these lines.
//
// An Admin sees the stored lines on the Members drawer and can move them
// (/api/users/[id]/agent-reports, the handover's own report routing).
//
// Kept inside src/lib/access because the tier is the engine's to read (the
// G7 lint rule). Server-only (prisma).

import type { AccessLevel, Prisma, PrismaClient } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { isAgentOf } from "./org-role";
import { levelHeldIn, levelsHeldFor, levelsHeldIn, lineKey, linesElsewhere } from "./acting-workspace";
import { agentIdsIn } from "./manager-candidate";
import { effectiveManagerFrom, type LineFacts } from "@/lib/people/reporting-lines";

type Db = PrismaClient | Prisma.TransactionClient;

/** How many rounds a walk through Agents reads before it stops (a chain of Agents longer than this is a data fault). */
const ROUNDS = 16;

/**
 * Does this person hold the Agent tier in this workspace? Then they manage
 * nobody here, whatever lines name them. The tier is the one held HERE
 * (levelHeldIn): their row's level where they are anchored here, their
 * membership's role where they work here from another workspace. Someone who
 * holds no level here is no Agent here: their stored line reads as stored,
 * as effectiveManagerFrom reads a manager it cannot find.
 */
export async function managesNobody(userId: string, organizationId: string, db: Db = prisma): Promise<boolean> {
  return isAgentOf(await levelHeldIn(userId, organizationId, undefined, db));
}

/** How many steps a walk up a line reads before it stops (reporting-lines.ts WALK_CAP: a longer line is a data fault). */
const WALK_STEPS = 64;

/** The fields every line read here takes from a person's row. */
const LINE_SELECT = { id: true, managerId: true, organizationId: true, accessLevel: true, status: true } as const;
type LineRow = { id: string; managerId: string | null; organizationId: string; accessLevel: AccessLevel; status: string };

/**
 * Of these rows, the people who hold a level in this workspace, with their
 * line facts at the tier held here (an Agent here, whatever their anchored
 * row says elsewhere). Someone who holds no level here is left out: they are
 * not on this workspace's lines.
 */
async function factsHere(organizationId: string, rows: readonly LineRow[], db: Db): Promise<Array<[string, LineFacts]>> {
  if (rows.length === 0) return [];
  const held = await levelsHeldFor(organizationId, rows, db);
  return rows
    .filter((r) => held.has(r.id))
    .map((r) => [r.id, { managerId: r.managerId, agent: isAgentOf(held.get(r.id)), inactive: r.status === "INACTIVE" }]);
}

/**
 * The line facts around one person, and no more (the handover's report plan,
 * docs-found fixes batch 4; it read every person in the workspace before,
 * under the role lock): `personId`'s live reports, and the walk up the line
 * from them and from each of `alsoFrom`, one small read per step. Who
 * manages whom, who holds the Agent tier here, who is deactivated. A removed
 * person, or one who holds no level in this workspace, is absent; someone
 * who works here through a membership is present (batch 5: before, a report
 * who had switched away was never moved, and a manager who had was skipped
 * on the walk up).
 */
export async function lineFactsAround(organizationId: string, personId: string, alsoFrom: readonly string[], db: Db = prisma): Promise<Map<string, LineFacts>> {
  const facts = new Map<string, LineFacts>();
  const reports = await db.user.findMany({ where: { managerId: personId, deletedAt: null }, select: LINE_SELECT });
  for (const [id, f] of await factsHere(organizationId, reports, db)) facts.set(id, f);
  const walked = new Set<string>();
  let wave = [...new Set([personId, ...alsoFrom])];
  for (let step = 0; step < WALK_STEPS && wave.length; step += 1) {
    const unknown = wave.filter((uid) => !facts.has(uid));
    if (unknown.length) {
      const rows = await db.user.findMany({ where: { id: { in: unknown }, deletedAt: null }, select: LINE_SELECT });
      for (const [id, f] of await factsHere(organizationId, rows, db)) facts.set(id, f);
    }
    for (const uid of wave) walked.add(uid);
    wave = [...new Set(wave.map((uid) => facts.get(uid)?.managerId).filter((m): m is string => !!m && !walked.has(m)))];
  }
  return facts;
}

/**
 * Of these people, the ones who hold a level in this workspace and are not
 * removed (batch 5): the reports a line counts, whichever workspace each was
 * last anchored to.
 */
export async function liveHereAmong(organizationId: string, ids: readonly string[], db: Db = prisma): Promise<Set<string>> {
  const want = [...new Set(ids)].filter(Boolean);
  if (want.length === 0) return new Set();
  const rows = await db.user.findMany({ where: { id: { in: want }, deletedAt: null }, select: { id: true, organizationId: true, accessLevel: true } });
  return new Set((await levelsHeldFor(organizationId, rows, db)).keys());
}

/**
 * The manager each of these people reports to for every read that grants
 * reach (effectiveManagerFrom): their stored manager, or past an Agent the
 * next person up who is none, or null. Never the person themselves (a loop
 * back through an Agent, or a stored self-line), and never someone who holds
 * no level in this workspace: a person who joined here from another
 * workspace while signed in keeps that workspace's manager on their row,
 * and that manager is nobody's reviewer, approver or weekly-review manager
 * here. People who hold no level in this workspace are left out of the
 * answer; someone who works here through a membership is in it (batch 5).
 * Reads only the managers it walks through, at the tier each holds here: a
 * manager anchored elsewhere who works here through a membership is walked
 * at that membership's role.
 */
export async function effectiveManagersOf(organizationId: string, userIds: readonly string[], db: Db = prisma): Promise<Map<string, string | null>> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return new Map();
  const rows = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, managerId: true, organizationId: true, accessLevel: true } });
  const here = await levelsHeldFor(organizationId, rows, db);
  const people = rows.filter((r) => here.has(r.id));
  const facts = new Map<string, LineFacts>();
  const foreign = new Set<string>();
  let frontier = [...new Set(people.map((p) => p.managerId).filter((m): m is string => !!m))];
  for (let round = 0; round < ROUNDS && frontier.length; round += 1) {
    const got = await db.user.findMany({
      where: { id: { in: frontier }, deletedAt: null },
      select: { id: true, managerId: true, accessLevel: true, status: true, organizationId: true },
    });
    const elsewhere = got.filter((g) => g.organizationId !== organizationId).map((g) => g.id);
    const heldThere = elsewhere.length ? await levelsHeldIn(organizationId, elsewhere, db) : new Map<string, string>();
    const walked: string[] = [];
    for (const g of got) {
      const level = g.organizationId === organizationId ? g.accessLevel : heldThere.get(g.id);
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

/** One person's manager for every read that grants reach (effectiveManagersOf). */
export async function effectiveManagerOf(organizationId: string, userId: string, db: Db = prisma): Promise<string | null> {
  return (await effectiveManagersOf(organizationId, [userId], db)).get(userId) ?? null;
}

/**
 * The people whose manager, read that way, is `managerId`: their stored
 * reports, and the reports of any Agent among them (through Agents, any
 * depth). Nobody for an Agent. Removed people are left out, as the stored
 * direct-report reads always did.
 */
export async function effectiveDirectReportIds(organizationId: string, managerId: string, db: Db = prisma): Promise<string[]> {
  if (await managesNobody(managerId, organizationId, db)) return [];
  const out = new Set<string>();
  const walked = new Set<string>([managerId]);
  let frontier = [managerId];
  for (let round = 0; round < ROUNDS && frontier.length; round += 1) {
    const rows = await db.user.findMany({
      where: { managerId: { in: frontier }, deletedAt: null },
      select: LINE_SELECT,
    });
    const next: string[] = [];
    for (const [id, k] of await factsHere(organizationId, rows, db)) {
      if (id === managerId) continue;
      out.add(id);
      if (k.agent && !walked.has(id)) {
        walked.add(id);
        next.push(id);
      }
    }
    frontier = next;
  }
  return [...out];
}

/**
 * Walk down stored lines from `seeds` (person to the owner they count for),
 * one read per round: every stored report of a seed counts for that seed's
 * owner, and a report on the Agent tier is walked through to their own
 * reports for the same owner (an Agent manages nobody). Removed people and
 * people who hold no level here are left out; people who work here through a
 * membership are walked (batch 5).
 */
async function walkThroughAgents(organizationId: string, seeds: ReadonlyMap<string, string>, db: Db): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  const walked = new Set<string>(seeds.keys());
  let frontier = new Map(seeds);
  for (let round = 0; round < ROUNDS && frontier.size; round += 1) {
    const rows = await db.user.findMany({
      where: { managerId: { in: [...frontier.keys()] }, deletedAt: null },
      select: LINE_SELECT,
    });
    const next = new Map<string, string>();
    for (const [id, k] of await factsHere(organizationId, rows, db)) {
      const owner = k.managerId ? frontier.get(k.managerId) : undefined;
      if (owner === undefined || id === owner) continue;
      const set = out.get(owner) ?? new Set<string>();
      set.add(id);
      out.set(owner, set);
      if (k.agent && !walked.has(id)) {
        walked.add(id);
        next.set(id, owner);
      }
    }
    frontier = next;
  }
  return out;
}

/**
 * effectiveDirectReportIds for many managers at once: each one's stored
 * reports plus the people listed under an Agent among them, any depth of
 * Agents. Nobody for a manager on the Agent tier in this workspace.
 */
export async function effectiveReportsOfMany(organizationId: string, managerIds: readonly string[], db: Db = prisma): Promise<Map<string, string[]>> {
  const ids = [...new Set(managerIds)].filter(Boolean);
  const agents = await agentIdsIn(organizationId, ids, db);
  const seeds = new Map(ids.filter((id) => !agents.has(id)).map((id) => [id, id] as const));
  const walked = await walkThroughAgents(organizationId, seeds, db);
  return new Map(ids.map((id) => [id, [...(walked.get(id) ?? [])]]));
}

/**
 * The people listed under these Agents, through Agents at any depth. With
 * no manager above the Agents they report, in effect, to nobody, so a view
 * of the top of the organization (the Sub-teams page for the People team
 * and Admin) shows them there, never under the Agent.
 */
export async function listedUnderAgents(organizationId: string, agentIds: readonly string[], db: Db = prisma): Promise<string[]> {
  const seeds = new Map([...new Set(agentIds)].filter(Boolean).map((id) => [id, ""] as const));
  return [...((await walkThroughAgents(organizationId, seeds, db)).get("") ?? [])];
}

/**
 * The people listed under an Agent's direct reports (the "lifted" part of
 * effectiveDirectReportIds): reports of `managerId`'s Agent reports, at any
 * depth of Agents. Empty for an Agent or someone with no Agent reports.
 */
export async function reportsThroughAgents(organizationId: string, managerId: string, db: Db = prisma): Promise<string[]> {
  const all = await effectiveDirectReportIds(organizationId, managerId, db);
  if (all.length === 0) return [];
  // Their own stored reports, wherever each is anchored: only who is listed
  // under an Agent below them is kept (`all` holds only people here).
  const stored = await db.user.findMany({ where: { managerId, deletedAt: null }, select: { id: true } });
  const own = new Set(stored.map((s) => s.id));
  return all.filter((id) => !own.has(id));
}

/**
 * The dotted reports that count for `managerId`: none for an Agent, else
 * every person who has a dotted line to them, holds a level in this
 * workspace and is not removed.
 */
export async function countedDottedReportIds(organizationId: string, managerId: string, db: Db = prisma): Promise<string[]> {
  if (await managesNobody(managerId, organizationId, db)) return [];
  const rows = await db.userDottedLine.findMany({ where: { managerId, user: { deletedAt: null } }, select: { userId: true } });
  const ids = [...new Set(rows.map((r) => r.userId))].filter((id) => id !== managerId);
  const here = await liveHereAmong(organizationId, ids, db);
  return ids.filter((id) => here.has(id));
}

/**
 * The dotted-line managers of `userId` who count: people who hold a level in
 * this workspace that is not the Agent tier (levelsHeldIn), and are not
 * removed.
 */
export async function countedDottedManagerIds(organizationId: string, userId: string, db: Db = prisma): Promise<string[]> {
  const rows = await db.userDottedLine.findMany({
    where: { userId, manager: { deletedAt: null } },
    select: { managerId: true },
  });
  const ids = [...new Set(rows.map((r) => r.managerId))];
  if (ids.length === 0) return [];
  const held = await levelsHeldIn(organizationId, ids, db);
  return ids.filter((id) => held.has(id) && !isAgentOf(held.get(id)));
}

/**
 * The stored approvers among `approverIds` whose stamp gives nothing: those
 * who hold the Agent tier in this workspace. A timesheet whose approver was
 * named before rule 6 waits for the people the subject reports to, as an
 * unclaimed one does (the Approvals queue, timesheets/[id]).
 */
export async function agentApproverIds(organizationId: string, approverIds: readonly (string | null)[], db: Db = prisma): Promise<string[]> {
  return [...(await agentIdsIn(organizationId, approverIds.filter((x): x is string => !!x), db))];
}

/**
 * What an Admin is shown for an Agent who still has people listed under them
 * (the Members drawer): live solid reports and live dotted reports, each
 * person once per kind. Zeros for anyone who is no Agent.
 */
export async function agentStoredReports(organizationId: string, agentId: string, db: Db = prisma): Promise<{ solid: number; dotted: number }> {
  if (!(await managesNobody(agentId, organizationId, db))) return { solid: 0, dotted: 0 };
  return (await agentsWithStoredReports(organizationId, [agentId], db)).get(agentId) ?? { solid: 0, dotted: 0 };
}

/** The Agents among these people who still have live solid or dotted reports, with how many of each. */
export async function agentsWithStoredReports(
  organizationId: string,
  ids: readonly string[],
  db: Db = prisma,
): Promise<Map<string, { solid: number; dotted: number }>> {
  const agentIds = [...(await agentIdsIn(organizationId, ids, db))];
  if (agentIds.length === 0) return new Map();
  // The live people listed under them who hold a level here, each once per
  // kind (batch 5: the people anchored here alone missed anyone who had
  // switched away, so the drawer offered no move for them).
  const [solid, dotted] = await Promise.all([
    db.user.findMany({ where: { managerId: { in: agentIds }, deletedAt: null }, select: { id: true, managerId: true } }),
    db.userDottedLine.findMany({ where: { managerId: { in: agentIds }, user: { deletedAt: null } }, select: { userId: true, managerId: true } }),
  ]);
  const here = await liveHereAmong(organizationId, [...solid.map((u) => u.id), ...dotted.map((d) => d.userId)], db);
  const out = new Map<string, { solid: number; dotted: number }>();
  const bump = (agent: string, kind: "solid" | "dotted", person: string, seen: Set<string>) => {
    const key = `${agent}\n${person}`;
    if (person === agent || !here.has(person) || seen.has(key)) return;
    seen.add(key);
    const cur = out.get(agent) ?? { solid: 0, dotted: 0 };
    cur[kind] += 1;
    out.set(agent, cur);
  };
  const seenSolid = new Set<string>();
  const seenDotted = new Set<string>();
  for (const u of solid) if (u.managerId) bump(u.managerId, "solid", u.id, seenSolid);
  for (const d of dotted) bump(d.managerId, "dotted", d.userId, seenDotted);
  return out;
}

/**
 * A person's dotted lines that are another workspace's, by manager
 * (acting-workspace.ts linesElsewhere, docs-found fixes batch 6): the
 * manager holds no level here and holds one in another workspace the person
 * works in, or holds the Agent tier here (the line counts for nobody here)
 * and is no Agent in another workspace the person works in, where the line
 * counts. A UserDottedLine is one row every workspace the person belongs to
 * reads, so this workspace never checks, replaces or deletes these
 * (PUT /api/users/[id]/dotted-lines).
 */
export async function othersDottedLines(organizationId: string, userId: string, db: Db = prisma): Promise<Set<string>> {
  const rows = await db.userDottedLine.findMany({ where: { userId }, select: { managerId: true } });
  const managers = [...new Set(rows.map((r) => r.managerId))];
  if (managers.length === 0) return new Set();
  const [held, there] = await Promise.all([
    levelsHeldIn(organizationId, managers, db),
    linesElsewhere(organizationId, managers.map((managerId) => ({ personId: userId, managerId })), db),
  ]);
  return new Set(managers.filter((managerId) => {
    const level = held.get(managerId);
    const elsewhere = there.get(lineKey({ personId: userId, managerId }));
    return level === undefined ? !!elsewhere : isAgentOf(level) && elsewhere === "relied";
  }));
}
