// SCIM deprovisioning (settings-architecture 5.9, access invariants 10 and
// 13): when the identity provider switches someone off (active:false, or
// DELETE), WorkwrK deactivates them AND hands their work over, unattended:
// to their manager, else to the first Owner. Nothing they owned is ever
// left orphaned, and the workspace is never left without an Owner.
//
//   last Owner      refused (SCIM 409) and written to the Audit log
//   another Owner   deactivated, but their work is NOT handed over
//                   unattended, and the audit row names who holds Owner now.
//                   An identity provider glitch (someone briefly unassigned
//                   from the app) must never move a leader's team and Spaces
//                   to whoever is the earliest Admin with no way back; a
//                   person hands an Owner's work over from Members, on
//                   purpose.
//   no recipient    refused (409): deactivating would orphan their work
//   otherwise       the seat here ends (below), then runHandover, one
//                   membership.changed row with actorType "scim"
//
// THIS WORKSPACE ONLY (docs/plans/workspace-status.md D14). The identity
// provider of a workspace speaks for that workspace's seat, never for the
// person's other workspaces. A deprovision ends the seat HERE through
// workspace-status.ts endSeat, as Members' Deactivate does:
//   D3  anchored here with a usable seat elsewhere: the account moves there,
//       this workspace keeps the deactivated seat on its membership
//   D4  anchored here with nowhere else: the account ends, its sessions
//       with it (the one case with an account-wide tokenVersion bump)
//   D5  here through a membership: that membership is deactivated, and
//       nothing else changes; the row is never deleted (D8)
// endSeat also revokes the API keys they made here (D15) and ends this
// address's open invitations here. Before, the member path deleted the
// membership and bumped the account's tokenVersion, signing the person out
// of their own company on every device, and the anchored path ended the
// account in every workspace.
//
// A report whose line another workspace relies on moves with the end itself,
// in its transaction, right before the seat is written (docs-found fixes
// batch 8, handover.server.ts moveReliedReportsAtEnd), to the same
// recipient, with that workspace's record of each, only when the ACCOUNT
// ends (D4): with D3 and D5 the person still manages that report there, so
// the line stays and the handover is this workspace's only (runHandover
// `leavesOnlyHere`, endSeatWould says which before anything is written).
// An Owner's reports stay with them, as their work does.
//
// The Owner checks and the end run under the workspace's role lock
// (lockOrgRoles), so a SCIM call racing an admin's role change can never
// leave the workspace with nobody.
//
// A handover that fails after the end committed is never lost: the end and
// a membership.handover_pending row commit TOGETHER, and a retry from the
// identity provider (it retries on the 500) finds the seat already
// deactivated with that row still the latest word, and finishes the handover
// then, this workspace's only when the row says so (`leavesOnlyHere`). The
// row stays in the Audit log if it never finishes. When the reports moved
// and the work did not (docs-found fixes batch 5), the moves are already in
// the Audit log (the handover writes one reporting_line_changed row each
// with them), and the answer is a 503 that says so, which the identity
// provider retries the same way. After a D3 move the person works here
// through the membership the move left, so the retry comes in through
// scimDeprovisionMember and finds that seat.
//
// Reactivation (active:true) restores the seat here through restoreSeat (the
// route, src/app/api/scim/v2/Users/[id]/route.ts), writes its own audit row
// (scimReactivated) and transfers nothing back: the row says so.
//
// SOMEONE WHO WORKS HERE THROUGH A MEMBERSHIP (docs-found fixes batch 7),
// anchored in another workspace: scimDeprovisionMember, the same steps on
// their membership seat (D5). Their reports here whose line another
// workspace relies on stay (they still manage them there), and their open
// reviews here go to the recipient. Their check-ins written here stay this
// workspace's, as a deactivated person's anchored here do
// (check-in-access.server.ts THE LEAVING): the seat is kept, and a
// reactivation brings them back with it.

import { prisma } from "@/lib/prisma";
import { endTeammateAccessFor } from "@/lib/agents/leaver-hooks";
import { followAccountEndLines, isHandoverWorkFailed, moveReliedReportsAtEnd, runHandover, type AccountEndLines } from "@/lib/people/handover.server";
import { isLiveOwner, liveAdminsOf, liveOwnerIds, lockOrgRoles, unattendedRecipient, wouldRemoveLastOwner } from "@/lib/access/membership";
import { isOrgRolesBusy, LOCKED_TX, ORG_ROLES_BUSY } from "@/lib/access/org-roles-busy";
import { personSeatIn } from "@/lib/access/acting-workspace";
import { endSeat, endSeatWould, SEAT_PLAN_CHANGED_WORDS, SeatPlanChanged, type SeatActor } from "@/lib/access/workspace-status";

/** Who ends a seat for the identity provider, on the rows endSeat writes (the API keys it revokes). */
const SCIM_ACTOR: SeatActor = { id: null, type: "scim", label: "Identity provider" };

export type DeprovisionOutcome =
  | { ok: true; alreadyInactive: boolean; recipientId: string | null }
  | { ok: false; status: 409 | 503; error: string };

/** Which door the identity provider came in by: the person is anchored here, or works here through a membership. */
type Door = "anchor" | "membership";

/** The errors a deprovision answers with a 503 the identity provider retries, or null. */
function retryable(e: unknown, said: string): DeprovisionOutcome | null {
  if (isOrgRolesBusy(e)) return { ok: false, status: 503, error: ORG_ROLES_BUSY };
  // Their workspaces changed between the plan and the write (endSeat's
  // `expect`): nothing was written, the moved lines rolled back.
  if (e instanceof SeatPlanChanged) return { ok: false, status: 503, error: SEAT_PLAN_CHANGED_WORDS };
  // Deactivated, and the reports moved; their work did not. The pending row
  // stays the latest word, so the retry moves the rest.
  if (isHandoverWorkFailed(e)) return { ok: false, status: 503, error: `${said} ${e.message}` };
  return null;
}

/**
 * The role lock was busy (membership.ts lockOrgRoles): 503, which an
 * identity provider retries. Before the end nothing was written; after it,
 * the pending row stays the latest word and the retry finishes the handover
 * (resumePendingHandover).
 */
export async function scimDeprovision(organizationId: string, userId: string): Promise<DeprovisionOutcome> {
  try {
    return await deprovisionSeat(organizationId, userId, "anchor");
  } catch (e) {
    const out = retryable(e, "This person is deactivated.");
    if (out) return out;
    throw e;
  }
}

const PENDING = "membership.handover_pending";

/** The rows that say where an identity provider's deprovisioning of this person stands here. */
const DEPROVISION_ROWS = [PENDING, "membership.changed", "membership.refused"];

/** What the pending row keeps for a retry: who takes the work, whether this workspace's handover only, and whether they were here through a membership. */
type PendingFacts = { recipientId?: string | null; leavesOnlyHere?: boolean; member?: boolean };

/**
 * Ends the seat here of someone the identity provider switched off (see the
 * header), whichever row holds it: the account where they are anchored here
 * ("anchor"), or their membership here ("membership"). `asked` is the door
 * the route found them by; the seat they hold here now decides (L4).
 */
async function deprovisionSeat(organizationId: string, userId: string, asked: Door): Promise<DeprovisionOutcome> {
  const person = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, organizationId: true, firstName: true, lastName: true } });
  if (!person) return { ok: false, status: 409, error: "User not found" };
  const name = `${person.firstName} ${person.lastName}`.trim();
  // The door the route found them by is a hint: a switch landing a moment
  // before (or a D3 move) changes which row holds their seat here. Both
  // doors end the same seat through endSeat, so the person is looked up once
  // more by the seat they hold here now (the step 4 review L4: a fired
  // contractor's deprovision never fails on a race, and some identity
  // providers never retry a 409).
  const seat = await personSeatIn(organizationId, userId);
  const door: Door = seat ? seat.kind : asked;
  if (!seat) return door === "membership" ? formerMember(organizationId, userId, name) : { ok: false, status: 409, error: "User not found" };
  // Ended here already (deactivated or removed): finish a handover a
  // failure left, else nothing to do.
  if (seat.status === "INACTIVE" || seat.removedAt) return resumePendingHandover(organizationId, userId, name);

  type Gate =
    | { kind: "gone" }
    | { kind: "last_owner" }
    | { kind: "no_recipient" }
    | { kind: "owner"; ownersNow: string[]; leavesOnlyHere: boolean }
    | { kind: "member"; recipientId: string; endLines: AccountEndLines | null; leavesOnlyHere: boolean };
  const gate: Gate = await prisma.$transaction(async (tx): Promise<Gate> => {
    await lockOrgRoles(tx, organizationId);
    if (await wouldRemoveLastOwner(organizationId, userId, tx)) return { kind: "last_owner" };
    const owner = await isLiveOwner(organizationId, userId, tx);
    const recipientId = owner ? null : await unattendedRecipient(organizationId, userId, tx);
    if (!owner && !recipientId) return { kind: "no_recipient" };
    // What the end will be, under the person's row lock (endSeatWould): the
    // reports another workspace relies on move only when the account ends.
    const will = await endSeatWould(tx, { userId, organizationId, kind: "deactivated" });
    // Ended a moment ago by someone else: the retry path answers.
    if (will === "already_ended" || will === "not_here") return { kind: "gone" };
    const leavesOnlyHere = will !== "account_ended";
    // The reports move with the end, never after it in a step that might not
    // run (batch 8), right before the seat is written. An Owner's stay.
    const endLines = owner || leavesOnlyHere
      ? null
      : await moveReliedReportsAtEnd(tx, { organizationId, leaverId: userId, recipientId, actorId: null, actorType: "scim", actorLabel: "Identity provider", ends: "deactivated" });
    // The end planned is the end written (SeatPlanChanged otherwise, retried).
    await endSeat(tx, { userId, organizationId, kind: "deactivated", actor: SCIM_ACTOR, expect: will });
    if (owner) {
      const admins = await liveAdminsOf(tx, organizationId);
      const ids = await liveOwnerIds(organizationId, tx);
      return { kind: "owner", leavesOnlyHere, ownersNow: ids.map((id) => { const a = admins.find((x) => x.id === id); return a ? `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim() : id; }) };
    }
    // Committed WITH the end, so a handover that fails below is finished by
    // the identity provider's retry (resumePendingHandover).
    const facts: PendingFacts = { recipientId, leavesOnlyHere, ...(door === "membership" ? { member: true } : {}) };
    await tx.activityLog.create({
      data: {
        type: PENDING,
        actorId: null,
        actorType: "scim",
        actorLabel: "Identity provider",
        organizationId,
        description: `Your identity provider deactivated ${name}${leavesOnlyHere ? " in this workspace" : ""}. Their work here is being handed over.`,
        targetType: "user",
        targetId: userId,
        severity: "warning",
        metadata: facts,
      },
    });
    return { kind: "member", recipientId: recipientId as string, endLines, leavesOnlyHere };
  }, LOCKED_TX);

  if (gate.kind === "gone") return resumePendingHandover(organizationId, userId, name);
  if (gate.kind === "last_owner") {
    await prisma.activityLog.create({
      data: {
        type: "membership.refused",
        actorId: null,
        actorType: "scim",
        actorLabel: "Identity provider",
        organizationId,
        description: `Your identity provider tried to deactivate ${name}, the workspace's last Owner. Refused: make someone else an Owner first.`,
        targetType: "user",
        targetId: userId,
        severity: "critical",
        ...(door === "membership" ? { metadata: { member: true } } : {}),
      },
    });
    return { ok: false, status: 409, error: "This is the workspace's last Owner. Make someone else an Owner in WorkwrK first." };
  }
  if (gate.kind === "no_recipient") return { ok: false, status: 409, error: "Nobody can receive this person's work. Add an Owner in WorkwrK first." };

  // Deactivated here: their Google stops serving their AI teammates here, and
  // Google is told (docs/plans/ai-teammates-phase3.md Decision 20). Never
  // failing the call: the cron sweep ends any this misses.
  // Their teammates' browsers close too (docs/plans/ai-teammates-phase4.md Decision 27).
  await endTeammateAccessFor(organizationId, [userId], "deactivated", null).catch((e) => {
    console.error(`[connectors] SCIM deactivation hook failed: ${e instanceof Error ? e.message.split("\n").pop() : String(e)}`);
  });

  if (gate.kind === "owner") {
    await prisma.activityLog.create({
      data: {
        type: "membership.changed",
        actorId: null,
        actorType: "scim",
        actorLabel: "Identity provider",
        organizationId,
        description: `Your identity provider deactivated ${name}${gate.leavesOnlyHere ? " in this workspace" : ""}, an Owner. Owner is now held by ${gate.ownersNow.join(", ")}. Their work stays with them: hand it over from Members when you are sure they have left.`,
        targetType: "user",
        targetId: userId,
        severity: "critical",
        oldValue: { status: seat.status },
        newValue: { status: "INACTIVE" },
        metadata: { owner: true, handover: false, ...(door === "membership" ? { member: true } : {}) },
      },
    });
    return { ok: true, alreadyInactive: false, recipientId: null };
  }

  // Open reviews follow the reports the end moved, whatever the handover
  // does next.
  if (gate.endLines) await followAccountEndLines(organizationId, gate.endLines, gate.recipientId);
  await finishHandover(organizationId, userId, name, gate.recipientId, seat.status, { endLines: gate.endLines ?? undefined, leavesOnlyHere: gate.leavesOnlyHere, member: door === "membership" });
  return { ok: true, alreadyInactive: false, recipientId: gate.recipientId };
}

/**
 * The seat here is deactivated or removed already. When the latest
 * identity-provider row about them is a pending handover (the end committed,
 * the handover did not), finish it now, to their manager or the first Owner
 * as they are today, this workspace's only when the row says so. Otherwise
 * there is nothing to do: a deactivation from Members, or a finished
 * handover, is never redone.
 */
async function resumePendingHandover(organizationId: string, userId: string, name: string): Promise<DeprovisionOutcome> {
  const last = await prisma.activityLog.findFirst({
    where: { organizationId, targetType: "user", targetId: userId, actorType: "scim", type: { in: DEPROVISION_ROWS } },
    orderBy: { createdAt: "desc" },
    select: { type: true, metadata: true },
  });
  if (last?.type !== PENDING) return { ok: true, alreadyInactive: true, recipientId: null };
  const facts = (last.metadata ?? {}) as PendingFacts;
  const recipientId = await unattendedRecipient(organizationId, userId);
  if (!recipientId) return { ok: false, status: 409, error: "Nobody can receive this person's work. Add an Owner in WorkwrK first." };
  // A row from before this workspace's own end (step 4): a member's was this
  // workspace's only, an anchored person's every workspace's.
  const member = facts.member === true;
  await finishHandover(organizationId, userId, name, recipientId, "ACTIVE", { leavesOnlyHere: facts.leavesOnlyHere ?? member, member });
  return { ok: true, alreadyInactive: true, recipientId };
}

/**
 * The audit row's words for moved reports who also reported to the leaver in
 * another workspace (batch 7): when the account ends, those lines move with
 * it (batch 8), and that workspace's Audit log records it.
 */
function alsoElsewhereSaid(n: number): string {
  if (n === 0) return "";
  return ` ${n} of their reports also reported to them in another workspace, whose Audit log records the move.`;
}

/** The audit row's words for reports whose line another workspace relies on, which stay (a handover of this workspace only). */
function stayingSaid(n: number): string {
  if (n === 0) return "";
  return ` ${n} direct ${n === 1 ? "report stays" : "reports stay"} listed under them: another workspace they both work in relies on ${n === 1 ? "that line" : "those lines"}, and their open reviews here went to the same person.`;
}

/**
 * The handover after the end, and its one row. `endLines` is what the end
 * moved itself (batch 8, D4 only), counted in the row with the rest; a
 * resumed handover has none to add (those rows are in the Audit log).
 * `leavesOnlyHere`: the account still works elsewhere (D3, D5), so the lines
 * another workspace relies on stay (runHandover `leavesOnlyHere`).
 */
async function finishHandover(
  organizationId: string,
  userId: string,
  name: string,
  recipientId: string,
  oldStatus: string,
  o: { endLines?: AccountEndLines; leavesOnlyHere: boolean; member: boolean },
): Promise<void> {
  let result: Awaited<ReturnType<typeof runHandover>>;
  try {
    result = await runHandover({ organizationId, fromId: userId, toId: recipientId, actorId: null, actorType: "scim", actorLabel: "Identity provider", ...(o.leavesOnlyHere ? { leavesOnlyHere: true } : {}) });
  } catch (e) {
    // The pending row stays the latest word, so the identity provider's
    // retry of this call finishes the handover. The error goes back to it.
    console.error("SCIM handover failed; the next retry resumes it", e);
    throw e;
  }
  const recipient = await prisma.user.findUnique({ where: { id: recipientId }, select: { firstName: true, lastName: true } });
  const reports = result.reportsReassigned + (o.endLines?.reportsReassigned ?? 0);
  const alsoElsewhere = result.reportsAlsoElsewhere.length + (o.endLines?.reportsAlsoElsewhere.length ?? 0);
  const staying = result.reportsStaying.length;
  const to = recipient ? `${recipient.firstName} ${recipient.lastName}`.trim() : "their manager";
  await prisma.activityLog.create({
    data: {
      type: "membership.changed",
      actorId: null,
      actorType: "scim",
      actorLabel: "Identity provider",
      organizationId,
      description: `Your identity provider deactivated ${name}${o.leavesOnlyHere ? " in this workspace" : ""}. ${result.tasksReassigned} open tasks, ${reports} direct reports and ${result.containersReassigned} Spaces, Folders and Lists went to ${to}.${o.leavesOnlyHere ? stayingSaid(staying) : alsoElsewhereSaid(alsoElsewhere)}`,
      targetType: "user",
      targetId: userId,
      severity: "warning",
      oldValue: { status: oldStatus },
      newValue: { status: "INACTIVE" },
      metadata: {
        recipientId,
        ...result,
        reportsReassigned: reports,
        reportsRehomed: result.reportsRehomed.length + (o.endLines?.reportsRehomed.length ?? 0),
        reportsStaying: staying,
        reportsAtAccountEnd: result.reportsAtAccountEnd.length,
        reportsAlsoElsewhere: alsoElsewhere,
        leavesOnlyHere: o.leavesOnlyHere,
        ...(o.member ? { member: true } : {}),
      },
    },
  });
}

// ── Someone who works here through a membership (batch 7) ───────────

/**
 * Where an identity provider's deprovisioning of someone who worked here
 * through a membership stands, once the membership ROW is gone (a delete by
 * the code before step 4 of docs/plans/workspace-status.md; nothing deletes
 * one now but a hard delete): "pending" (their work here is not handed over
 * yet), "done", or null when it never deprovisioned them here. A retry of a
 * deprovision finds them by this, so it finishes the handover or answers a
 * harmless success.
 */
export async function formerMemberDeprovision(organizationId: string, userId: string): Promise<"pending" | "done" | null> {
  const last = await prisma.activityLog.findFirst({
    where: { organizationId, targetType: "user", targetId: userId, actorType: "scim", type: { in: DEPROVISION_ROWS } },
    orderBy: { createdAt: "desc" },
    select: { type: true, metadata: true },
  });
  if (!last || (last.metadata as { member?: unknown } | null)?.member !== true) return null;
  return last.type === PENDING ? "pending" : "done";
}

/** scimDeprovision for someone who works here through a membership: their membership seat here ends (D5), their account stays (see the header). */
export async function scimDeprovisionMember(organizationId: string, userId: string): Promise<DeprovisionOutcome> {
  try {
    return await deprovisionSeat(organizationId, userId, "membership");
  } catch (e) {
    const out = retryable(e, "This person is deactivated in this workspace.");
    if (out) return out;
    throw e;
  }
}

/**
 * Old data: a membership row an earlier build deleted. Under the role lock,
 * while no membership and no anchor remains here, their check-ins of this
 * workspace become theirs alone (batch 9: the build before batch 8 ended a
 * membership without that), which only ever narrows and changes nothing
 * twice. Then a pending handover is finished, else nothing to do.
 */
async function formerMember(organizationId: string, userId: string, name: string): Promise<DeprovisionOutcome> {
  await prisma.$transaction(async (tx) => {
    await lockOrgRoles(tx, organizationId);
    const anchor = await tx.user.findUnique({ where: { id: userId }, select: { organizationId: true } });
    const held = await tx.organizationMembership.findUnique({ where: { userId_organizationId: { userId, organizationId } }, select: { userId: true } });
    if (anchor && anchor.organizationId !== organizationId && !held) {
      await tx.checkIn.updateMany({ where: { userId, organizationId }, data: { organizationId: null } });
    }
  }, LOCKED_TX);
  const state = await formerMemberDeprovision(organizationId, userId);
  if (state !== "pending") return { ok: true, alreadyInactive: true, recipientId: null };
  const recipientId = await unattendedRecipient(organizationId, userId);
  if (!recipientId) return { ok: false, status: 409, error: "Nobody can receive this person's work. Add an Owner in WorkwrK first." };
  await finishHandover(organizationId, userId, name, recipientId, "ACTIVE", { leavesOnlyHere: true, member: true });
  return { ok: true, alreadyInactive: true, recipientId };
}

/**
 * The identity provider switched someone back on here (their seat here was
 * restored through restoreSeat). The row is written so the Audit log shows
 * both halves; nothing handed over on deactivation moves back on its own,
 * and the row says so.
 */
export async function scimReactivated(organizationId: string, userId: string): Promise<void> {
  // By id: someone here through a membership is reactivated here too (D14).
  const person = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } });
  const name = person ? `${person.firstName} ${person.lastName}`.trim() : "someone";
  await prisma.activityLog.create({
    data: {
      type: "membership.changed",
      actorId: null,
      actorType: "scim",
      actorLabel: "Identity provider",
      organizationId,
      description: `Your identity provider reactivated ${name}. Anything handed over when they were deactivated stays where it went.`,
      targetType: "user",
      targetId: userId,
      severity: "info",
      oldValue: { status: "INACTIVE" },
      newValue: { status: "ACTIVE" },
    },
  });
}
