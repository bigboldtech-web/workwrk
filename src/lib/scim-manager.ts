// SCIM's manager attribute (docs/plans/workspace-status-2.md E9 i, step 7):
// the enterprise extension's `manager` on POST, PUT and PATCH of
// /api/scim/v2/Users sets THIS workspace's line for the person, for someone
// anchored here and for someone here through a membership alike, and every
// resource SCIM answers names that line back.
//
// WHAT THE VALUE IS. RFC 7643 4.3: `manager.value` is the `id` of the
// manager's SCIM resource. This service's SCIM ids are WorkwrK user ids
// (every resource it answers carries the account's id as `id`, and the
// identity provider links people by it), so the value is read as the
// manager's WorkwrK id, which is what Azure sends (it resolves the manager
// to the id this service gave it) and what Okta sends when its managerId
// holds that id. This service keeps no externalId: its list filter answers
// `externalId` by the address, so a value that is an address (Okta's
// managerId often holds the manager's login) is read the same way, as the
// address of someone with a seat here (seated-here.ts personHereByEmail:
// any case; a live seat first, then one deactivated here, so an old
// deactivated account never hides the live one; within each, the account
// anchored here first). Anything else (an employee number) names nobody
// here and is refused, in words.
//
// RESOLVED AT THE MANAGER'S SEAT HERE, under the rules every line write
// here follows (E4, E5): the manager holds a LIVE seat here (anchored here,
// or a membership here; managerCandidateIn with `live`, so someone this
// workspace deactivated through their membership is "deactivated", never
// "not here"), is not on the Agent tier here, is not the person, and closes
// no loop in THIS workspace's lines (wouldLoopIn, lineAbove at each seat
// here). All of it under the workspace's role lock, which the caller takes
// first, then the person's row lock, then the write through seat-writes.ts
// writeLineHere on the row that holds their seat here: the account for
// someone anchored here, the membership for anyone else. Another
// workspace's line is never read or written: B's identity provider setting
// Pat's manager to Dana writes Pat's B membership, and her A line to Max
// stays as A set it.
//
// THE IDENTITY RULE IS UNCHANGED (phase 1, shared-identity.ts): SCIM still
// never writes the name or address of an account another workspace shares.
// The manager line is not the account's: it is this workspace's own, and is
// written for a membership person as for anyone.
//
// A REFUSED MANAGER writes nothing of the line, and the rest of the request
// goes on (the names, the reactivation, the deprovision). One
// reporting_line_refused row in the Audit log says why in plain words,
// never naming someone who holds no seat here. A provider that pushes the
// same refused value again and again (a scheduled full sync) makes one row,
// not one per push: a refusal identical to the newest refusal logged for the
// person (the same value, the same reason, and the same line here when it
// was logged) is not written again, so any change of the line since, by
// whatever door (a bulk change and the Agent move log no row per person),
// logs the next one. A `remove` of the manager, or a null, clears this
// workspace's line under the same lock (nothing to check). The manager the
// person already has, sent again, is no change: nothing is checked, written
// or logged (as PATCH /api/users/[id] keeps it), and it takes no lock at all
// (scimManagerChanges, read before the role lock: the step 7 review L3), so
// a periodic push of an unchanged profile never queues on the workspace's
// role lock. A real change is checked again under the lock.
//
// A written line is logged as reporting_line_changed (actor the identity
// provider) and the person's open reviews follow it in the same
// transaction, to the first live Owner when no person acted, as SCIM's
// reactivation does (review-cycle.server.ts followReportingLine).
//
// A busy lock, a deadlock Postgres broke (40P01) or a transaction past its
// time wrote nothing: the routes answer the 503 an identity provider
// retries (scimManagerRetry), never a 500.
//
// Server only (prisma).

import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { liveOwnerIds, lockOrgRoles } from "@/lib/access/membership";
import { LOCKED_TX, retryAnswer } from "@/lib/access/org-roles-busy";
import { managerCandidateIn, wouldLoopIn } from "@/lib/access/manager-candidate";
import { personSeatIn, type PersonSeat } from "@/lib/access/acting-workspace";
import { peopleHereAmong, personHereByEmail } from "@/lib/access/seated-here";
import { lockPerson } from "@/lib/access/workspace-anchor";
import { seatRefOf, writeLineHere } from "@/lib/access/seat-writes";
import { seatIsLive } from "@/lib/access/workspace-status";
import { followReportingLine } from "@/lib/performance/review-cycle.server";
import { userToScim, type ScimManagerAsk, type ScimUser } from "@/lib/scim-mappers";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

/** The audit row of a manager the identity provider asked for and this workspace did not write. */
export const MANAGER_REFUSED = "reporting_line_refused";

/** Why the identity provider's manager was not written. */
export type ScimManagerRefusal = "not_here" | "agent" | "inactive" | "self" | "loop" | "removed";

export type ScimManagerOutcome =
  | { outcome: "written"; from: string | null; to: string | null }
  | { outcome: "unchanged" }
  | { outcome: "refused"; why: ScimManagerRefusal; said: string };

/** The longest asked value kept on a refusal's row (the provider's own value, for its admin to find the mapping). */
const ASKED_KEPT = 200;

/** Thrown when the row that held the seat no longer holds it at the write (never expected under the person's lock): nothing was written, and the provider retries. */
export class ScimSeatMoved extends Error {
  constructor() {
    super("Their seat in this workspace changed a moment ago, so their manager was not changed. Try again.");
    this.name = "ScimSeatMoved";
  }
}

/** The words of the 503 an identity provider retries, for an error a manager write may end with, or null for any other. */
export function scimManagerRetry(e: unknown): string | null {
  if (e instanceof ScimSeatMoved) return e.message;
  return retryAnswer(e)?.error ?? null;
}

function fullName(u: { firstName: string | null; lastName: string | null } | null | undefined, fallback: string): string {
  return `${u?.firstName ?? ""} ${u?.lastName ?? ""}`.trim() || fallback;
}

/** Why, in the plain words of the refusal's row. `manager` is named only for someone with a seat here. */
function refusalWords(why: ScimManagerRefusal, person: string, manager: string): string {
  switch (why) {
    case "not_here":
      return "that manager isn't anyone who works in this workspace";
    case "agent":
      return `${manager} is an Agent here, and an Agent can't be anyone's manager`;
    case "inactive":
      return `${manager} is deactivated here, and a deactivated person can't have reports`;
    case "self":
      return "a person can't be their own manager";
    case "loop":
      return `that would make a reporting loop, since ${person} already manages ${manager}, directly or further down`;
    case "removed":
      return `${person} was removed from this workspace`;
  }
}

/**
 * The manager's WorkwrK id a value names (see the header): the id itself,
 * or for an address, whoever holds a seat here with it: a live seat first,
 * then one deactivated here (so a lone deactivated match is refused as
 * deactivated, and an old deactivated twin never hides the live one: the
 * step 7 review L7). A removed seat never answers.
 */
async function managerNamed(organizationId: string, value: string, db: Db): Promise<string | null> {
  if (!value.includes("@")) return value;
  const live = await personHereByEmail(organizationId, value, "live", db);
  return (live ?? (await personHereByEmail(organizationId, value, "kept", db)))?.id ?? null;
}

/**
 * Whether the ask would change the person's line here at all, read before
 * any lock (the step 7 review L3): false when it names the manager the seat
 * here already holds, or clears a line already empty, or the person holds
 * no seat here (nothing of this workspace's to write). The routes then take
 * no role lock for the manager. A true answer is checked again, in full,
 * under the role lock (scimManagerHere).
 */
export async function scimManagerChanges(organizationId: string, userId: string, ask: ScimManagerAsk, db: Db = prisma): Promise<boolean> {
  const seat = await personSeatIn(organizationId, userId, db);
  if (!seat) return false;
  if (ask.kind === "clear") return seat.managerId !== null;
  const managerId = await managerNamed(organizationId, ask.value, db);
  return managerId === null || managerId !== seat.managerId;
}

/**
 * Applies the identity provider's manager to this person's seat HERE (see
 * the header), inside the caller's transaction. The caller has taken this
 * workspace's role lock (membership.ts lockOrgRoles) before any person's
 * row lock; this takes the person's, then reads their seat here, so the
 * row written is the one that holds it. A refusal is answered, never
 * thrown, with its audit row written: the caller's other writes stand.
 */
export async function scimManagerHere(tx: Tx, organizationId: string, userId: string, ask: ScimManagerAsk): Promise<ScimManagerOutcome> {
  await lockPerson(tx, userId);
  const account = await tx.user.findUnique({ where: { id: userId }, select: { id: true, organizationId: true, firstName: true, lastName: true } });
  const seat = account ? await personSeatIn(organizationId, userId, tx) : null;
  // No seat here at all: nothing of this workspace's to write (the routes answer them as unknown).
  if (!account || !seat) return { outcome: "unchanged" };
  const before = seat.managerId;
  const person = fullName(account, "This person");

  let next: string | null = null;
  let managerId: string | null = null;
  let refusal: ScimManagerRefusal | null = null;
  if (ask.kind === "clear") {
    if (before === null) return { outcome: "unchanged" };
    if (seat.removedAt) refusal = "removed";
  } else {
    managerId = await managerNamed(organizationId, ask.value, tx);
    if (managerId === userId) refusal = "self";
    // The manager they already have, sent again: kept as it is, never re-checked (see the header).
    else if (managerId !== null && managerId === before) return { outcome: "unchanged" };
    else if (seat.removedAt) refusal = "removed";
    else {
      const candidate = managerId ? await managerCandidateIn(organizationId, managerId, { db: tx, live: true }) : "not_found";
      if (candidate === "not_found") refusal = "not_here";
      else if (candidate === "agent_cannot_manage") refusal = "agent";
      else if (candidate === "inactive") refusal = "inactive";
      // This workspace's lines only (E5), under the role lock the caller holds.
      else if (managerId && (await wouldLoopIn(organizationId, userId, managerId, tx))) refusal = "loop";
      else next = managerId;
    }
  }

  if (refusal) {
    // Named only when they hold a seat here: "not_here" never names anyone (batch 7).
    const named = refusal === "agent" || refusal === "inactive" || refusal === "loop";
    const manager = named && managerId ? fullName(await tx.user.findUnique({ where: { id: managerId }, select: { firstName: true, lastName: true } }), "that person") : "";
    // A refused clear says it was not cleared (the step 7 review L8).
    const said = `The identity provider's manager for ${person} was not ${ask.kind === "clear" ? "cleared" : "set"}: ${refusalWords(refusal, person, manager)}. Their manager here is unchanged.`;
    await logRefusal(tx, organizationId, userId, { asked: ask.kind === "set" ? ask.value.slice(0, ASKED_KEPT) : null, reason: refusal, before, said });
    return { outcome: "refused", why: refusal, said };
  }

  // On the row that holds the seat here, as read under the person's lock.
  if (!(await writeLineHere(tx, seatRefOf(organizationId, account), next))) throw new ScimSeatMoved();
  await tx.activityLog.create({
    data: {
      type: "reporting_line_changed",
      actorId: null,
      actorType: "scim",
      actorLabel: "Identity provider",
      organizationId,
      description: next ? `Changed who ${person} reports to` : `Cleared who ${person} reports to`,
      targetType: "user",
      targetId: userId,
      severity: "info",
      oldValue: { managerId: before },
      newValue: { managerId: next },
      metadata: { scim: true },
    },
  });
  // Open reviews follow the new line. No person acted, so a review with no
  // manager to go to goes to the first Owner (as SCIM's reactivation does).
  const owner = (await liveOwnerIds(organizationId, tx))[0];
  if (owner) await followReportingLine(organizationId, [userId], owner, tx);
  return { outcome: "written", from: before, to: next };
}

/** A stored JSON value as an object, or null. */
function objectOf(v: Prisma.JsonValue | null | undefined): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * The refusal's row, unless the newest refusal logged for the person here
 * is this same one: the same asked value, the same reason, and the same
 * line here when it was logged (its oldValue). A provider that pushes it on
 * every sync makes one row; once the line changed, by whatever door (a
 * bulk change and the Agent move log no row per person: the step 7 review
 * L1), the next push logs again. Read by the person's own rows
 * ("ActivityLog_userTarget_targetId_createdAt_idx"), newest first.
 */
async function logRefusal(
  tx: Tx,
  organizationId: string,
  userId: string,
  r: { asked: string | null; reason: ScimManagerRefusal; before: string | null; said: string },
): Promise<void> {
  const newest = await tx.activityLog.findFirst({
    where: { targetType: "user", targetId: userId, organizationId, type: MANAGER_REFUSED },
    orderBy: { createdAt: "desc" },
    select: { metadata: true, oldValue: true },
  });
  const was = objectOf(newest?.metadata);
  const line = objectOf(newest?.oldValue);
  if (was && line && was.asked === r.asked && was.reason === r.reason && (line.managerId ?? null) === r.before) return;
  await tx.activityLog.create({
    data: {
      type: MANAGER_REFUSED,
      actorId: null,
      actorType: "scim",
      actorLabel: "Identity provider",
      organizationId,
      description: r.said,
      targetType: "user",
      targetId: userId,
      severity: "warning",
      oldValue: { managerId: r.before },
      metadata: { scim: true, asked: r.asked, reason: r.reason },
    },
  });
}

export type ScimManagerResult = { ok: true; outcome: ScimManagerOutcome } | { ok: false; status: 503; error: string };

/**
 * scimManagerHere in a transaction of its own, under this workspace's role
 * lock: for a request whose other writes are already done (a membership
 * person's push, after a deprovision). An ask that changes nothing takes no
 * lock (scimManagerChanges). A busy lock or a deadlock is the 503 the
 * identity provider retries; the retry finds the rest already written.
 */
export async function scimSetManager(organizationId: string, userId: string, ask: ScimManagerAsk): Promise<ScimManagerResult> {
  // No change, no lock (the step 7 review L3).
  if (!(await scimManagerChanges(organizationId, userId, ask))) return { ok: true, outcome: { outcome: "unchanged" } };
  try {
    const outcome = await prisma.$transaction(async (tx) => {
      await lockOrgRoles(tx, organizationId);
      return scimManagerHere(tx, organizationId, userId, ask);
    }, LOCKED_TX);
    return { ok: true, outcome };
  } catch (e) {
    const retry = scimManagerRetry(e);
    if (retry) return { ok: false, status: 503, error: retry };
    throw e;
  }
}

/**
 * The managers among these ids who hold a seat here (kept: not removed,
 * either kind), each with the name a resource answers: the people a
 * resource may name as someone's manager here (named-here.ts's rule, step
 * 3). Two reads at most.
 */
export async function managersShownHere(organizationId: string, ids: readonly (string | null | undefined)[], db: Db = prisma): Promise<Map<string, { id: string; displayName: string }>> {
  const people = await peopleHereAmong(organizationId, ids, "kept", db);
  return new Map([...people].map(([id, p]) => [id, { id, displayName: fullName(p, p.email) }]));
}

/**
 * The resource SCIM answers for this person here: `active` from the seat
 * here (D14), and the enterprise manager from the line that seat holds,
 * named only while that manager holds a seat here (for someone anchored
 * here the account's line, for anyone else their membership's: never
 * another workspace's).
 */
export async function scimUserHere(
  organizationId: string,
  row: { id: string; email: string; firstName: string; lastName: string; status: unknown; createdAt: Date; updatedAt: Date },
  seat: PersonSeat | null,
  db: Db = prisma,
): Promise<ScimUser> {
  const line = seat?.managerId ?? null;
  const manager = line ? (await managersShownHere(organizationId, [line], db)).get(line) ?? null : null;
  return userToScim({ id: row.id, email: row.email, firstName: row.firstName, lastName: row.lastName, status: String(row.status), createdAt: row.createdAt, updatedAt: row.updatedAt, externalId: null, active: !!seat && seatIsLive(seat), manager });
}
