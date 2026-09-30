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
// The Owner checks and the deactivation run under the workspace's role lock
// (lockOrgRoles), so a SCIM call racing an admin's role change can never
// leave the workspace with nobody.
//
// Reactivation (active:true) restores the row, writes its own audit row
// (scimReactivated) and transfers nothing back: the row says so.

import { prisma } from "@/lib/prisma";
import { runHandover } from "@/lib/people/handover.server";
import { isLiveOwner, liveAdminsOf, liveOwnerIds, lockOrgRoles, unattendedRecipient, wouldRemoveLastOwner } from "@/lib/access/membership";

export type DeprovisionOutcome =
  | { ok: true; alreadyInactive: boolean; recipientId: string | null }
  | { ok: false; status: 409; error: string };

export async function scimDeprovision(organizationId: string, userId: string): Promise<DeprovisionOutcome> {
  const person = await prisma.user.findFirst({ where: { id: userId, organizationId }, select: { id: true, status: true, firstName: true, lastName: true } });
  if (!person) return { ok: false, status: 409, error: "User not found" };
  if (person.status === "INACTIVE") return { ok: true, alreadyInactive: true, recipientId: null };
  const name = `${person.firstName} ${person.lastName}`.trim();

  type Gate = { kind: "last_owner" } | { kind: "no_recipient" } | { kind: "owner"; ownersNow: string[] } | { kind: "member"; recipientId: string };
  const gate: Gate = await prisma.$transaction(async (tx) => {
    await lockOrgRoles(tx, organizationId);
    if (await wouldRemoveLastOwner(organizationId, userId, tx)) return { kind: "last_owner" as const };
    const owner = await isLiveOwner(organizationId, userId, tx);
    const recipientId = owner ? null : await unattendedRecipient(organizationId, userId, tx);
    if (!owner && !recipientId) return { kind: "no_recipient" as const };
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
    return { kind: "member" as const, recipientId: recipientId as string };
  });

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

  const recipientId = gate.recipientId;
  const result = await runHandover({ organizationId, fromId: userId, toId: recipientId, actorId: null });
  const recipient = await prisma.user.findUnique({ where: { id: recipientId }, select: { firstName: true, lastName: true } });
  await prisma.activityLog.create({
    data: {
      type: "membership.changed",
      actorId: null,
      actorType: "scim",
      actorLabel: "Identity provider",
      organizationId,
      description: `Your identity provider deactivated ${name}. ${result.tasksReassigned} open tasks, ${result.reportsReassigned} direct reports and ${result.containersReassigned} Spaces, Folders and Lists went to ${recipient ? `${recipient.firstName} ${recipient.lastName}`.trim() : "their manager"}.`,
      targetType: "user",
      targetId: userId,
      severity: "warning",
      oldValue: { status: person.status },
      newValue: { status: "INACTIVE" },
      metadata: { recipientId, ...result, reportsRehomed: result.reportsRehomed.length },
    },
  });
  return { ok: true, alreadyInactive: false, recipientId };
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
