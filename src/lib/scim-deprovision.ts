// SCIM deprovisioning (settings-architecture 5.9, access invariants 10 and
// 13): when the identity provider switches someone off (active:false, or
// DELETE), WorkwrK deactivates them AND hands their work over, unattended:
// to their manager, else to the first Owner. Nothing they owned is ever
// left orphaned, and the workspace is never left without an Owner.
//
//   last Owner      refused (SCIM 409) and written to the Audit log
//   another Owner   deactivated (every session ends: the security need), but
//                   their work is NOT handed over unattended, and the audit
//                   row names who holds Owner now. An identity provider
//                   glitch (someone briefly unassigned from the app) must
//                   never move a leader's team and Spaces to whoever is the
//                   earliest Admin with no way back; a person hands an
//                   Owner's work over from Members, on purpose.
//   no recipient    refused (409): deactivating would orphan their work
//   otherwise       status INACTIVE and a tokenVersion bump (every session
//                   ends on its next check), then runHandover, one
//                   membership.changed row with actorType "scim"
//
// A report whose line another workspace relies on moves with the
// deactivation itself, in its transaction, right before status is written
// (docs-found fixes batch 8, handover.server.ts moveReliedReportsAtEnd), to
// the same recipient, with that workspace's record of each: the
// deactivation ends the account there too. Since batch 9 that step moves
// every report still listed under them, so their other reports move with
// the deactivation too, never left under it for a moment, and the handover
// that follows moves their open tasks and Spaces, Folders and Lists. An
// Owner's reports stay with them, as their work does.
//
// The Owner checks and the deactivation run under the workspace's role lock
// (lockOrgRoles), so a SCIM call racing an admin's role change can never
// leave the workspace with nobody.
//
// A handover that fails after the deactivation committed is never lost: the
// deactivation and a membership.handover_pending row commit TOGETHER, and a
// retry from the identity provider (it retries on the 500) finds the person
// already INACTIVE with that row still the latest word, and finishes the
// handover then. The row stays in the Audit log if it never finishes.
// When the reports moved and the work did not (docs-found fixes batch 5),
// the moves are already in the Audit log (the handover writes one
// reporting_line_changed row each with them), and the answer is a 503 that
// says so, which the identity provider retries the same way.
//
// Reactivation (active:true) restores the row, writes its own audit row
// (scimReactivated) and transfers nothing back: the row says so.
//
// SOMEONE WHO WORKS HERE THROUGH A MEMBERSHIP (docs-found fixes batch 7),
// anchored in another workspace: scimDeprovisionMember. Their status and
// deletedAt are one column each, read by every workspace they belong to, so
// this workspace's identity provider never deactivates them: that would
// switch them off in their own company too. It ends their membership HERE
// (their sessions end on their next check, a tokenVersion bump, as a
// deactivation's do) and hands their work here over, unattended, as above:
// the same Owner rules, the same pending row first, the same resume on a
// retry. Their reports here whose line another workspace relies on stay
// (they still manage them there; runHandover `leavesOnlyHere`), and their
// open reviews here go to the recipient. Before, the identity provider could
// never find them (SCIM GET read only people anchored here) while POST
// answered 409 for them, so it could never deprovision them at all.

import { prisma } from "@/lib/prisma";
import { endTeammateAccessFor } from "@/lib/agents/leaver-hooks";
import { followAccountEndLines, isHandoverWorkFailed, moveReliedReportsAtEnd, runHandover, type AccountEndLines } from "@/lib/people/handover.server";
import { isLiveOwner, liveAdminsOf, liveOwnerIds, lockOrgRoles, unattendedRecipient, wouldRemoveLastOwner } from "@/lib/access/membership";
import { isOrgRolesBusy, LOCKED_TX, ORG_ROLES_BUSY } from "@/lib/access/org-roles-busy";
import { homeAfterRemoval, reanchorUser } from "@/lib/access/workspace-anchor";

export type DeprovisionOutcome =
  | { ok: true; alreadyInactive: boolean; recipientId: string | null }
  | { ok: false; status: 409 | 503; error: string };

/**
 * The role lock was busy (membership.ts lockOrgRoles): 503, which an
 * identity provider retries. Before the deactivation nothing was written;
 * after it, the pending row stays the latest word and the retry finishes
 * the handover (resumePendingHandover).
 */
export async function scimDeprovision(organizationId: string, userId: string): Promise<DeprovisionOutcome> {
  try {
    return await deprovision(organizationId, userId);
  } catch (e) {
    if (isOrgRolesBusy(e)) return { ok: false, status: 503, error: ORG_ROLES_BUSY };
    // Deactivated, and the reports moved; their work did not. The pending row
    // stays the latest word, so the retry moves the rest.
    if (isHandoverWorkFailed(e)) return { ok: false, status: 503, error: `This person is deactivated. ${e.message}` };
    throw e;
  }
}

async function deprovision(organizationId: string, userId: string): Promise<DeprovisionOutcome> {
  const person = await prisma.user.findFirst({ where: { id: userId, organizationId }, select: { id: true, status: true, firstName: true, lastName: true } });
  if (!person) return { ok: false, status: 409, error: "User not found" };
  const name = `${person.firstName} ${person.lastName}`.trim();
  if (person.status === "INACTIVE") return resumePendingHandover(organizationId, userId, name);

  // ANCHORED HERE BUT ALSO BELONGS ELSEWHERE (launch audit, 2026-10-31): the
  // anchor is only where the person last was, and status lives on the
  // account, so deactivating them here switched them off in their own
  // company too. Their account moves to that workspace first (the removal
  // rule, homeAfterRemoval), and then they leave only here, exactly as
  // someone anchored elsewhere does (scimDeprovisionMember: the same Owner
  // rules, handover and pending row). The last Owner here is not moved: the
  // path below refuses them as before.
  const movedHome = await prisma.$transaction(async (tx) => {
    await lockOrgRoles(tx, organizationId);
    if (await wouldRemoveLastOwner(organizationId, userId, tx)) return false;
    const to = await homeAfterRemoval(userId, organizationId, tx);
    if (!to) return false;
    return reanchorUser({ userId, to }, tx);
  }, LOCKED_TX);
  if (movedHome) return deprovisionMember(organizationId, userId);

  type Gate = { kind: "last_owner" } | { kind: "no_recipient" } | { kind: "owner"; ownersNow: string[] } | { kind: "member"; recipientId: string; endLines: AccountEndLines };
  const gate: Gate = await prisma.$transaction(async (tx) => {
    await lockOrgRoles(tx, organizationId);
    if (await wouldRemoveLastOwner(organizationId, userId, tx)) return { kind: "last_owner" as const };
    const owner = await isLiveOwner(organizationId, userId, tx);
    const recipientId = owner ? null : await unattendedRecipient(organizationId, userId, tx);
    if (!owner && !recipientId) return { kind: "no_recipient" as const };
    // The reports move with the deactivation, never after it in a step that
    // might not run (batch 8: those whose line another workspace relies on;
    // batch 9: every report still listed under them), right before status is
    // written. An Owner's stay with them.
    const endLines = owner
      ? null
      : await moveReliedReportsAtEnd(tx, { organizationId, leaverId: userId, recipientId, actorId: null, actorType: "scim", actorLabel: "Identity provider", ends: "deactivated" });
    await tx.user.update({ where: { id: userId }, data: { status: "INACTIVE", tokenVersion: { increment: 1 } } });
    if (owner) {
      const admins = await liveAdminsOf(tx, organizationId);
      const ids = await liveOwnerIds(organizationId, tx);
      const names = ids.map((id) => {
        const a = admins.find((x) => x.id === id);
        return a ? `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim() : id;
      });
      return { kind: "owner" as const, ownersNow: names };
    }
    // Committed WITH the deactivation, so a handover that fails below is
    // finished by the identity provider's retry (resumePendingHandover).
    await tx.activityLog.create({
      data: {
        type: PENDING,
        actorId: null,
        actorType: "scim",
        actorLabel: "Identity provider",
        organizationId,
        description: `Your identity provider deactivated ${name}. Their work is being handed over.`,
        targetType: "user",
        targetId: userId,
        severity: "warning",
        metadata: { recipientId },
      },
    });
    return { kind: "member" as const, recipientId: recipientId as string, endLines: endLines as AccountEndLines };
  }, LOCKED_TX);

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
      },
    });
    return { ok: false, status: 409, error: "This is the workspace's last Owner. Make someone else an Owner in WorkwrK first." };
  }
  if (gate.kind === "no_recipient") return { ok: false, status: 409, error: "Nobody can receive this person's work. Add an Owner in WorkwrK first." };

  // Deactivated: their Google stops serving their AI teammates here, and
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
        description: `Your identity provider deactivated ${name}, an Owner. Owner is now held by ${gate.ownersNow.join(", ")}. Their work stays with them: hand it over from Members when you are sure they have left.`,
        targetType: "user",
        targetId: userId,
        severity: "critical",
        oldValue: { status: person.status },
        newValue: { status: "INACTIVE" },
        metadata: { owner: true, handover: false },
      },
    });
    return { ok: true, alreadyInactive: false, recipientId: null };
  }

  // Open reviews follow the reports the deactivation moved, whatever the
  // handover does next.
  await followAccountEndLines(organizationId, gate.endLines, gate.recipientId);
  await finishHandover(organizationId, userId, name, gate.recipientId, person.status, gate.endLines);
  return { ok: true, alreadyInactive: false, recipientId: gate.recipientId };
}

const PENDING = "membership.handover_pending";

/** The rows that say where an identity provider's deprovisioning of this person stands here. */
const DEPROVISION_ROWS = [PENDING, "membership.changed", "membership.refused"];

/**
 * The person is INACTIVE already. When the latest identity-provider row about
 * them is a pending handover (the deactivation committed, the handover did
 * not), finish it now, to their manager or the first Owner as they are today.
 * Otherwise there is nothing to do: a deactivation from Members, or a finished
 * handover, is never redone.
 */
async function resumePendingHandover(organizationId: string, userId: string, name: string): Promise<DeprovisionOutcome> {
  const last = await prisma.activityLog.findFirst({
    where: { organizationId, targetType: "user", targetId: userId, actorType: "scim", type: { in: DEPROVISION_ROWS } },
    orderBy: { createdAt: "desc" },
    select: { type: true },
  });
  if (last?.type !== PENDING) return { ok: true, alreadyInactive: true, recipientId: null };
  const recipientId = await unattendedRecipient(organizationId, userId);
  if (!recipientId) return { ok: false, status: 409, error: "Nobody can receive this person's work. Add an Owner in WorkwrK first." };
  await finishHandover(organizationId, userId, name, recipientId, "ACTIVE");
  return { ok: true, alreadyInactive: true, recipientId };
}

/**
 * The audit row's words for moved reports who also reported to the leaver in
 * another workspace (batch 7): a deactivation is every workspace's, so they
 * moved too (with the deactivation itself, batch 8), and that workspace's
 * Audit log records it.
 */
function alsoElsewhereSaid(n: number): string {
  if (n === 0) return "";
  return ` ${n} of their reports also reported to them in another workspace, whose Audit log records the move.`;
}

/**
 * The handover after the deactivation, and its one row. `endLines` is what
 * the deactivation moved itself (batch 8), counted in the row with the rest;
 * a resumed handover has none to add (those rows are in the Audit log).
 */
async function finishHandover(organizationId: string, userId: string, name: string, recipientId: string, oldStatus: string, endLines?: AccountEndLines): Promise<void> {
  let result: Awaited<ReturnType<typeof runHandover>>;
  try {
    result = await runHandover({ organizationId, fromId: userId, toId: recipientId, actorId: null, actorType: "scim", actorLabel: "Identity provider" });
  } catch (e) {
    // The pending row stays the latest word, so the identity provider's
    // retry of this call finishes the handover. The error goes back to it.
    console.error("SCIM handover failed; the next retry resumes it", e);
    throw e;
  }
  const recipient = await prisma.user.findUnique({ where: { id: recipientId }, select: { firstName: true, lastName: true } });
  const reports = result.reportsReassigned + (endLines?.reportsReassigned ?? 0);
  const alsoElsewhere = result.reportsAlsoElsewhere.length + (endLines?.reportsAlsoElsewhere.length ?? 0);
  await prisma.activityLog.create({
    data: {
      type: "membership.changed",
      actorId: null,
      actorType: "scim",
      actorLabel: "Identity provider",
      organizationId,
      description: `Your identity provider deactivated ${name}. ${result.tasksReassigned} open tasks, ${reports} direct reports and ${result.containersReassigned} Spaces, Folders and Lists went to ${recipient ? `${recipient.firstName} ${recipient.lastName}`.trim() : "their manager"}.${alsoElsewhereSaid(alsoElsewhere)}`,
      targetType: "user",
      targetId: userId,
      severity: "warning",
      oldValue: { status: oldStatus },
      newValue: { status: "INACTIVE" },
      metadata: {
        recipientId,
        ...result,
        reportsReassigned: reports,
        reportsRehomed: result.reportsRehomed.length + (endLines?.reportsRehomed.length ?? 0),
        reportsStaying: result.reportsStaying.length,
        reportsAtAccountEnd: result.reportsAtAccountEnd.length,
        reportsAlsoElsewhere: alsoElsewhere,
      },
    },
  });
}

// ── Someone who works here through a membership (batch 7) ───────────

/**
 * Where an identity provider's deprovisioning of someone who worked here
 * through a membership stands, once the membership is gone: "pending" (their
 * membership ended, their work here is not handed over yet), "done", or null
 * when it never deprovisioned them here. A retry of a deprovision finds them
 * by this, so it finishes the handover or answers a harmless success, as it
 * does for a person anchored here.
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

/** scimDeprovision for someone who works here through a membership: their membership here ends, their account stays (see the header). */
export async function scimDeprovisionMember(organizationId: string, userId: string): Promise<DeprovisionOutcome> {
  try {
    return await deprovisionMember(organizationId, userId);
  } catch (e) {
    if (isOrgRolesBusy(e)) return { ok: false, status: 503, error: ORG_ROLES_BUSY };
    if (isHandoverWorkFailed(e)) return { ok: false, status: 503, error: `This person no longer works in this workspace. ${e.message}` };
    throw e;
  }
}

async function deprovisionMember(organizationId: string, userId: string): Promise<DeprovisionOutcome> {
  const person = await prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true, organizationId: true, firstName: true, lastName: true } });
  if (!person || person.organizationId === organizationId) return { ok: false, status: 409, error: "User not found" };
  const name = `${person.firstName} ${person.lastName}`.trim();

  type Gate = { kind: "gone" } | { kind: "last_owner" } | { kind: "no_recipient" } | { kind: "owner"; ownersNow: string[] } | { kind: "member"; recipientId: string };
  // LOCKED_TX (batch 9), as the anchored path: the role lock's wait, then the
  // membership's delete (which waits, with no bound of its own, for a
  // check-in POST holding the row's key share), the null-out and the account
  // write did not always fit Prisma's default of 5 seconds, and its timeout
  // answered the identity provider 500.
  const gate: Gate = await prisma.$transaction(async (tx) => {
    await lockOrgRoles(tx, organizationId);
    const held = await tx.organizationMembership.findUnique({ where: { userId_organizationId: { userId, organizationId } }, select: { id: true } });
    if (!held) {
      // Ended already, perhaps by the build before batch 8, which ended a
      // membership without the null-out below; a retry from the identity
      // provider comes here. Their check-ins of this workspace become theirs
      // alone now, under the same lock, while no membership and no anchor
      // remains here (batch 9). It only ever narrows, and doing it twice
      // changes nothing.
      const anchor = await tx.user.findUnique({ where: { id: userId }, select: { organizationId: true } });
      if (anchor && anchor.organizationId !== organizationId) {
        await tx.checkIn.updateMany({ where: { userId, organizationId }, data: { organizationId: null } });
      }
      return { kind: "gone" as const };
    }
    if (await wouldRemoveLastOwner(organizationId, userId, tx)) return { kind: "last_owner" as const };
    const owner = await isLiveOwner(organizationId, userId, tx);
    const recipientId = owner ? null : await unattendedRecipient(organizationId, userId, tx);
    if (!owner && !recipientId) return { kind: "no_recipient" as const };
    // Their membership here ends, their account does not: every session
    // ends on its next check (the security need), and a new sign-in acts in
    // the workspaces they still belong to.
    await tx.organizationMembership.delete({ where: { id: held.id } });
    // Their check-ins written here become theirs alone, with the membership's
    // end, never decided again (check-in-access.server.ts THE LEAVING). After
    // the delete, so a check-in POST that held the membership commits first
    // and is read here too.
    await tx.checkIn.updateMany({ where: { userId, organizationId }, data: { organizationId: null } });
    await tx.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
    if (owner) {
      const admins = await liveAdminsOf(tx, organizationId);
      const ids = await liveOwnerIds(organizationId, tx);
      return { kind: "owner" as const, ownersNow: ids.map((id) => { const a = admins.find((x) => x.id === id); return a ? `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim() : id; }) };
    }
    // Committed WITH the membership's end, so a handover that fails below is
    // finished by the identity provider's retry (formerMemberDeprovision).
    await tx.activityLog.create({
      data: {
        type: PENDING,
        actorId: null,
        actorType: "scim",
        actorLabel: "Identity provider",
        organizationId,
        description: `Your identity provider removed ${name} from this workspace. Their work here is being handed over.`,
        targetType: "user",
        targetId: userId,
        severity: "warning",
        metadata: { recipientId, member: true },
      },
    });
    return { kind: "member" as const, recipientId: recipientId as string };
  }, LOCKED_TX);

  if (gate.kind === "gone") {
    // Ended already: finish a handover a failure left, else nothing to do.
    const state = await formerMemberDeprovision(organizationId, userId);
    if (state !== "pending") return { ok: true, alreadyInactive: true, recipientId: null };
    const recipientId = await unattendedRecipient(organizationId, userId);
    if (!recipientId) return { ok: false, status: 409, error: "Nobody can receive this person's work. Add an Owner in WorkwrK first." };
    await finishMemberHandover(organizationId, userId, name, recipientId);
    return { ok: true, alreadyInactive: true, recipientId };
  }
  if (gate.kind === "last_owner") {
    await prisma.activityLog.create({
      data: {
        type: "membership.refused",
        actorId: null,
        actorType: "scim",
        actorLabel: "Identity provider",
        organizationId,
        description: `Your identity provider tried to remove ${name}, the workspace's last Owner, from this workspace. Refused: make someone else an Owner first.`,
        targetType: "user",
        targetId: userId,
        severity: "critical",
        metadata: { member: true },
      },
    });
    return { ok: false, status: 409, error: "This is the workspace's last Owner. Make someone else an Owner in WorkwrK first." };
  }
  if (gate.kind === "no_recipient") return { ok: false, status: 409, error: "Nobody can receive this person's work. Add an Owner in WorkwrK first." };

  // Their AI teammates' Google and browsers here end, as on any leaving.
  await endTeammateAccessFor(organizationId, [userId], "left", null).catch((e) => {
    console.error(`[connectors] SCIM membership end hook failed: ${e instanceof Error ? e.message.split("\n").pop() : String(e)}`);
  });

  if (gate.kind === "owner") {
    await prisma.activityLog.create({
      data: {
        type: "membership.changed",
        actorId: null,
        actorType: "scim",
        actorLabel: "Identity provider",
        organizationId,
        description: `Your identity provider removed ${name}, an Owner, from this workspace. Owner is now held by ${gate.ownersNow.join(", ")}. Their Spaces, Folders, Lists and open tasks here stay in their name, as for an Owner it deactivates.`,
        targetType: "user",
        targetId: userId,
        severity: "critical",
        metadata: { owner: true, handover: false, member: true },
      },
    });
    return { ok: true, alreadyInactive: false, recipientId: null };
  }

  await finishMemberHandover(organizationId, userId, name, gate.recipientId);
  return { ok: true, alreadyInactive: false, recipientId: gate.recipientId };
}

async function finishMemberHandover(organizationId: string, userId: string, name: string, recipientId: string): Promise<void> {
  let result: Awaited<ReturnType<typeof runHandover>>;
  try {
    result = await runHandover({ organizationId, fromId: userId, toId: recipientId, actorId: null, actorType: "scim", actorLabel: "Identity provider", leavesOnlyHere: true });
  } catch (e) {
    console.error("SCIM membership handover failed; the next retry resumes it", e);
    throw e;
  }
  const recipient = await prisma.user.findUnique({ where: { id: recipientId }, select: { firstName: true, lastName: true } });
  const n = result.reportsStaying.length;
  await prisma.activityLog.create({
    data: {
      type: "membership.changed",
      actorId: null,
      actorType: "scim",
      actorLabel: "Identity provider",
      organizationId,
      description: `Your identity provider removed ${name} from this workspace. ${result.tasksReassigned} open tasks, ${result.reportsReassigned} direct reports and ${result.containersReassigned} Spaces, Folders and Lists went to ${recipient ? `${recipient.firstName} ${recipient.lastName}`.trim() : "the first Owner"}.${n ? ` ${n} direct ${n === 1 ? "report stays" : "reports stay"} listed under them: another workspace they both work in relies on ${n === 1 ? "that line" : "those lines"}, and their open reviews here went to the same person.` : ""}`,
      targetType: "user",
      targetId: userId,
      severity: "warning",
      metadata: { recipientId, member: true, ...result, reportsRehomed: result.reportsRehomed.length, reportsStaying: n, reportsAlsoElsewhere: result.reportsAlsoElsewhere.length },
    },
  });
}

/**
 * The identity provider switched someone back on. The row is written so the
 * Audit log shows both halves; nothing handed over on deactivation moves back
 * on its own, and the row says so.
 */
export async function scimReactivated(organizationId: string, userId: string): Promise<void> {
  const person = await prisma.user.findFirst({ where: { id: userId, organizationId }, select: { firstName: true, lastName: true } });
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
