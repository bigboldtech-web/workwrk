// One invitation, made one way, for every door that invites a person to the
// workspace: Members (POST /api/invitations) and Ask AI's
// invite_person_with_role tool. Ask AI's tool used to write the row itself
// and skipped most of this: no email ever went out (while the tool said one
// had), the company-domain lock and the workspace's invitation expiry did not
// apply, and no seat was checked.
//
// In order: the level rule, the personal note, the address, the
// company-domain lock, the KRA and SOP ownership check, "already here", a
// live invitation blocks a second one (an expired one is renewed in place),
// the seat, then the email with the real expiry, the webhook and the audit
// row.
//
// The caller has already decided WHO may invite (the People create
// permission, read fresh from the database) and passes the actor's level as
// the database holds it now.
//
// Server-only.

import crypto from "crypto";
import type { Invitation } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { inviteDomainsOf, usersSettingsOf } from "@/lib/settings/org-policy";
import { isAgentOf, orgRoleOf } from "@/lib/access/org-role";
import { broadcastWebhook } from "@/lib/webhooks";
import { sendEmail } from "@/lib/email";
import { invitationTemplate } from "@/lib/email-templates";
import { logAuditEvent } from "@/lib/activity";
import { resolveInviteLevel } from "@/lib/access/invite-level";
import { alreadyInOrg } from "@/lib/auth/invite-facts.server";
import { lockWorkspaceSeats, seatsFor } from "@/lib/seats";

export interface InvitationRequest {
  organizationId: string;
  /** The inviter: their level as the database holds it now, their address (the domain lock's fallback) and name (for the email). */
  actor: { id: string; level: string; email?: string | null; name?: string };
  email: unknown;
  requestedLevel: unknown;
  departmentId?: unknown;
  roleId?: unknown;
  managerId?: unknown;
  officeId?: unknown;
  kraIds?: unknown;
  sopIds?: unknown;
  message?: unknown;
}

export type InvitationOutcome =
  | { ok: true; invitation: Omit<Invitation, "token"> }
  | { ok: false; status: number; error: string; code?: string };

export async function sendInvitation(req: InvitationRequest): Promise<InvitationOutcome> {
  const orgId = req.organizationId;

  // The level an invitation may carry (src/lib/access/invite-level.ts):
  // never WorkwrK staff, an Admin only from an Admin, and otherwise at or
  // below the inviter's own rung. It used to be stored as sent.
  const levelCheck = resolveInviteLevel(req.actor.level, req.requestedLevel);
  if (!levelCheck.ok) return { ok: false, status: levelCheck.status, error: levelCheck.error };
  const inviteLevel = levelCheck.level;

  // Optional personal note from the inviter, capped so the email stays sane.
  const personalMessage =
    typeof req.message === "string" && req.message.trim() ? req.message.trim().slice(0, 1000) : undefined;

  if (typeof req.email !== "string" || !req.email.includes("@")) {
    return { ok: false, status: 400, error: "Valid email is required" };
  }
  const email = req.email;

  // Company-domain lock (user rule 2026-08-27): everyone invited to a
  // workspace joins on the company's own email domain. The domain is
  // the org's stored one, falling back to the inviting admin's, so
  // an @cashkr.com admin can only invite @cashkr.com addresses.
  // Members > Invite rules (settings.users.allowedDomains) widens it with
  // more domains; the own domain always stays in (inviteDomainsOf), so
  // clearing the chips never opens the workspace to any address and adding
  // one never locks out the workspace's own.
  const orgDomainRow = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { domain: true, settings: true, name: true },
  });
  const rules = usersSettingsOf(orgDomainRow?.settings, orgDomainRow?.domain);
  const allowedDomains = inviteDomainsOf(orgDomainRow?.settings, orgDomainRow?.domain, req.actor.email ?? undefined);
  const inviteDomain = email.split("@")[1]?.toLowerCase() ?? "";
  if (allowedDomains.length > 0 && !allowedDomains.includes(inviteDomain)) {
    return { ok: false, status: 400, error: `Only ${allowedDomains.map((d) => `@${d}`).join(", ")} addresses can join this workspace` };
  }

  // Role-definition comes from the ROLE (user decision 2026-08-27):
  // attaching a role is enough, its KRAs and their published SOPs
  // seed automatically at acceptance. Explicit per-item picks remain
  // supported for API callers but are no longer required.
  const cleanKraIds: string[] = Array.isArray(req.kraIds) ? req.kraIds.filter((s): s is string => typeof s === "string") : [];
  const cleanSopIds: string[] = Array.isArray(req.sopIds) ? req.sopIds.filter((s): s is string => typeof s === "string") : [];
  // Cross-tenant safety: confirm every KRA/SOP id belongs to this org.
  if (cleanKraIds.length > 0) {
    const kraCount = await prisma.kRA.count({ where: { id: { in: cleanKraIds }, organizationId: orgId } });
    if (kraCount !== cleanKraIds.length) {
      return { ok: false, status: 400, error: "One or more selected KRAs don't belong to your organization." };
    }
  }
  if (cleanSopIds.length > 0) {
    const sopCount = await prisma.sOP.count({ where: { id: { in: cleanSopIds }, organizationId: orgId } });
    if (sopCount !== cleanSopIds.length) {
      return { ok: false, status: 400, error: "One or more selected SOPs don't belong to your organization." };
    }
  }

  // Already in this workspace, as their own account or as a membership
  // (someone who works in several is anchored in only one), any case of the
  // address: what /join refuses, so no invitation is made that it would
  // turn away.
  if ((await alreadyInOrg(email, orgId)).member) {
    return { ok: false, status: 400, error: "User already exists in your organization" };
  }

  // A live pending invitation blocks a second one (Resend it instead). An
  // EXPIRED one no longer does: it is the same person being invited again,
  // so the row is renewed in place with a new token, a new expiry and what
  // this invite asks for, instead of making the admin Revoke first. The
  // renewal is conditional on the row still being unaccepted and expired.
  const existingInvite = await prisma.invitation.findFirst({
    where: { email, organizationId: orgId, accepted: false },
  });
  const now = new Date();
  if (existingInvite && existingInvite.expiresAt >= now) {
    return { ok: false, status: 400, error: "Invitation already sent to this email. Resend it from Pending invites." };
  }

  const level = inviteLevel || "EMPLOYEE";
  const mirrorRole = orgRoleOf({ accessLevel: level });
  const id = (v: unknown) => (typeof v === "string" && v ? v : null);
  const fields = {
    accessLevel: level,
    // Phase 8 stage E: what the invite makes the person, in the four-role
    // vocabulary (the step-8 mirror; accept still applies accessLevel).
    orgRole: mirrorRole === "OWNER" ? ("ADMIN" as const) : mirrorRole,
    isAgent: isAgentOf(level),
    token: crypto.randomBytes(32).toString("hex"),
    // Members > Invite rules > Invitation expiry (default 7 days).
    expiresAt: new Date(now.getTime() + rules.inviteExpiryDays * 24 * 60 * 60 * 1000),
    departmentId: id(req.departmentId),
    roleId: id(req.roleId),
    managerId: id(req.managerId),
    officeId: id(req.officeId),
    kraIds: cleanKraIds,
    sopIds: cleanSopIds,
  };
  // The invitation takes a seat (src/lib/seats.ts): checked and taken in one
  // transaction under the workspace's lock, so two invitations at once
  // cannot both take the last seat. A renewed expired invitation takes one
  // too: while expired it held none.
  const placed = await prisma.$transaction(async (tx) => {
    await lockWorkspaceSeats(tx, orgId);
    const seats = await seatsFor(orgId, 1, tx);
    if (!seats.ok) return { kind: "refused", message: seats.message } as const;
    if (existingInvite) {
      const renewed = await tx.invitation.updateMany({
        where: { id: existingInvite.id, accepted: false, expiresAt: { lt: now } },
        data: fields,
      });
      if (renewed.count !== 1) return { kind: "taken" } as const;
      return { kind: "made", invitation: await tx.invitation.findUniqueOrThrow({ where: { id: existingInvite.id } }) } as const;
    }
    return { kind: "made", invitation: await tx.invitation.create({ data: { email, organizationId: orgId, ...fields } }) } as const;
  });
  if (placed.kind === "refused") return { ok: false, status: 403, error: placed.message, code: "seat_limit" };
  if (placed.kind === "taken") {
    return { ok: false, status: 400, error: "Invitation already sent to this email. Resend it from Pending invites." };
  }
  const invitation = placed.invitation;

  // The invitation email.
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const inviteLink = `${baseUrl}/join?token=${invitation.token}`;
  const { subject, html } = invitationTemplate({
    companyName: orgDomainRow?.name || "Your team",
    inviteLink,
    accessLevel: level,
    inviterName: req.actor.name || undefined,
    personalMessage,
    // The email says how long the link really works (Members > Invite rules).
    expiresInDays: rules.inviteExpiryDays,
  });
  try {
    await sendEmail({
      to: email,
      subject,
      html,
      template: "invitation",
      variables: { companyName: orgDomainRow?.name, inviteLink },
      organizationId: orgId,
      category: "invitation",
    });
  } catch (emailErr) {
    console.error("[Invitation] Email send failed:", emailErr);
  }

  broadcastWebhook({
    organizationId: orgId,
    event: "user_invited",
    payload: { email, accessLevel: level },
  });

  // Audit-log every invitation: adding a user is the most common
  // security-sensitive admin action and the one customers expect
  // to see in their access review reports.
  logAuditEvent({
    type: "user.invited",
    actorId: req.actor.id,
    organizationId: orgId,
    description: `Invited ${email} as ${level}`,
    targetId: invitation.id,
    targetType: "Invitation",
    // The personal message is kept here (Invitation has no column for it)
    // so /join can show the invitee what the inviter wrote.
    metadata: {
      email,
      accessLevel: level,
      departmentId: fields.departmentId,
      roleId: fields.roleId,
      officeId: fields.officeId,
      kraCount: cleanKraIds.length,
      sopCount: cleanSopIds.length,
      ...(personalMessage ? { message: personalMessage } : {}),
    },
  });

  // The raw token is the invitation: it goes to the invitee by email and
  // never back to the caller.
  const { token: _t, ...created } = invitation;
  void _t;
  return { ok: true, invitation: created };
}
