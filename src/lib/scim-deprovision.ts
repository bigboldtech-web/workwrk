// SCIM deprovisioning (settings-architecture 5.9, access invariants 10 and
// 13): when the identity provider switches someone off (active:false, or
// DELETE), WorkwrK deactivates them AND hands their work over, unattended:
// to their manager, else to the first Owner. Nothing they owned is ever
// left orphaned, and the workspace is never left without an Owner.
//
//   last Owner      refused (SCIM 409) and written to the Audit log
//   no recipient    refused (409): deactivating would orphan their work
//   otherwise       runHandover, then status INACTIVE and a tokenVersion bump
//                   (every session ends on its next check), one
//                   membership.changed row with actorType "scim"
//
// Reactivation (active:true) restores the row and transfers nothing back.

import { prisma } from "@/lib/prisma";
import { runHandover, unattendedRecipient, wouldRemoveLastOwner } from "@/lib/people/handover.server";

export type DeprovisionOutcome =
  | { ok: true; alreadyInactive: boolean; recipientId: string | null }
  | { ok: false; status: 409; error: string };

export async function scimDeprovision(organizationId: string, userId: string): Promise<DeprovisionOutcome> {
  const person = await prisma.user.findFirst({ where: { id: userId, organizationId }, select: { id: true, status: true, firstName: true, lastName: true } });
  if (!person) return { ok: false, status: 409, error: "User not found" };
  if (person.status === "INACTIVE") return { ok: true, alreadyInactive: true, recipientId: null };
  const name = `${person.firstName} ${person.lastName}`.trim();

  if (await wouldRemoveLastOwner(organizationId, userId)) {
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

  const recipientId = await unattendedRecipient(organizationId, userId);
  if (!recipientId) return { ok: false, status: 409, error: "Nobody can receive this person's work. Add an Owner in WorkwrK first." };

  const result = await runHandover({ organizationId, fromId: userId, toId: recipientId, actorId: null });
  await prisma.user.update({ where: { id: userId }, data: { status: "INACTIVE", tokenVersion: { increment: 1 } } });
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
