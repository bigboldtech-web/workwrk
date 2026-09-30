import { usersSettingsOf } from "@/lib/settings/org-policy";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { broadcastWebhook } from "@/lib/webhooks";
import crypto from "crypto";
import { sendEmail } from "@/lib/email";
import { invitationTemplate } from "@/lib/email-templates";
import { hasPermission } from "@/lib/api-helpers";
import { logAuditEvent } from "@/lib/activity";
import { levelForInviteRole, resolveInviteLevel } from "@/lib/access/invite-level";
import { legacyIsManagerLevel } from "@/lib/access/legacy-levels";
import { inviteSender } from "@/lib/auth/invite-facts.server";
import { canEditSpace } from "@/lib/space";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const viewer = session.user as { organizationId?: string; accessLevel?: string };
    const orgId = viewer.organizationId;
    // The list names every invitee, their level and placement, so it is for
    // the people who manage invitations: the manager tier, the same people
    // Settings > Members (its one reader) admits. A Member gets a 403, not a
    // way to enumerate pending Admin invites.
    if (!legacyIsManagerLevel(viewer.accessLevel)) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const invitations = await prisma.invitation.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
    });

    // The raw token is the invitation: whoever holds it can accept it with a
    // password of their choosing. It goes to the invitee by email and never
    // back out of this list (any signed-in member can read it), so a pending
    // Admin invite cannot be lifted and accepted by someone else.
    return NextResponse.json(invitations.map(({ token: _token, ...rest }) => { void _token; return rest; }));
  } catch (error) {
    console.error("Invitations GET error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const orgId = (session.user as { organizationId: string }).organizationId;

    const allowed = await hasPermission(session, "people", "create");
    if (!allowed) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const { email, accessLevel: levelField, role: roleField, isAgent, departmentId, roleId, managerId, officeId, kraIds, sopIds, message } = await req.json();

    // The setup wizard asks in the four-role words ({ role, isAgent }); the
    // Members page and API callers still send a level. Either way the level
    // rule below decides.
    let requestedLevel: unknown = levelField;
    if (levelField === undefined && roleField !== undefined) {
      const mapped = levelForInviteRole(roleField, isAgent);
      if (!mapped.ok) return NextResponse.json({ error: mapped.error }, { status: mapped.status });
      requestedLevel = mapped.level;
    }

    // The level an invitation may carry (src/lib/access/invite-level.ts):
    // never WorkwrK staff, an Admin only from an Admin, and otherwise at or
    // below the inviter's own rung. It used to be stored as sent.
    const levelCheck = resolveInviteLevel((session.user as { accessLevel?: string }).accessLevel, requestedLevel);
    if (!levelCheck.ok) {
      return NextResponse.json({ error: levelCheck.error }, { status: levelCheck.status });
    }
    const inviteLevel = levelCheck.level;

    // Optional personal note from the inviter — capped so the email stays sane.
    const personalMessage =
      typeof message === "string" && message.trim() ? message.trim().slice(0, 1000) : undefined;

    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
    }

    // Company-domain lock (user rule 2026-08-27): everyone invited to a
    // workspace joins on the company's own email domain. The domain is
    // the org's stored one, falling back to the inviting admin's — so
    // an @cashkr.com admin can only invite @cashkr.com addresses.
    // Members > Invite rules (settings.users.allowedDomains) widens it to a
    // list; an empty list keeps the rule above, so clearing the chips never
    // opens the workspace to any address.
    const orgDomainRow = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { domain: true, settings: true },
    });
    const inviterEmail = (session.user as { email?: string }).email;
    const rules = usersSettingsOf(orgDomainRow?.settings, orgDomainRow?.domain);
    const fallbackDomain = (orgDomainRow?.domain?.trim() || inviterEmail?.split("@")[1] || "").toLowerCase();
    const allowedDomains = rules.allowedDomains.length > 0 ? rules.allowedDomains : fallbackDomain ? [fallbackDomain] : [];
    const inviteDomain = String(email).split("@")[1]?.toLowerCase() ?? "";
    if (allowedDomains.length > 0 && !allowedDomains.includes(inviteDomain)) {
      return NextResponse.json(
        { error: `Only ${allowedDomains.map((d) => `@${d}`).join(", ")} addresses can join this workspace` },
        { status: 400 },
      );
    }

    // Role-definition comes from the ROLE (user decision 2026-08-27):
    // attaching a role is enough — its KRAs and their published SOPs
    // seed automatically at acceptance. Explicit per-item picks remain
    // supported for API callers but are no longer required.
    const cleanKraIds: string[] = Array.isArray(kraIds) ? kraIds.filter((s) => typeof s === "string") : [];
    const cleanSopIds: string[] = Array.isArray(sopIds) ? sopIds.filter((s) => typeof s === "string") : [];
    // Cross-tenant safety: confirm every KRA/SOP id belongs to this org.
    if (cleanKraIds.length > 0) {
      const kraCount = await prisma.kRA.count({ where: { id: { in: cleanKraIds }, organizationId: orgId } });
      if (kraCount !== cleanKraIds.length) {
        return NextResponse.json({ error: "One or more selected KRAs don't belong to your organization." }, { status: 400 });
      }
    }
    if (cleanSopIds.length > 0) {
      const sopCount = await prisma.sOP.count({ where: { id: { in: cleanSopIds }, organizationId: orgId } });
      if (sopCount !== cleanSopIds.length) {
        return NextResponse.json({ error: "One or more selected SOPs don't belong to your organization." }, { status: 400 });
      }
    }

    // Check if user already exists in org
    const existingUser = await prisma.user.findFirst({
      where: { email, organizationId: orgId },
    });
    if (existingUser) {
      return NextResponse.json({ error: "User already exists in your organization" }, { status: 400 });
    }

    // Check if invitation already pending
    const existingInvite = await prisma.invitation.findFirst({
      where: { email, organizationId: orgId, accepted: false },
    });
    // A live pending invitation blocks a second one (Resend it instead). An
    // EXPIRED one no longer does: it is the same person being invited again,
    // so the row is renewed in place with a new token, a new week and what
    // this invite asks for, instead of making the admin Revoke first. The
    // renewal is conditional on the row still being unaccepted and expired.
    const now = new Date();
    if (existingInvite && existingInvite.expiresAt >= now) {
      return NextResponse.json({ error: "Invitation already sent to this email. Resend it from Pending invites." }, { status: 400 });
    }

    const fields = {
      accessLevel: inviteLevel || "EMPLOYEE",
      token: crypto.randomBytes(32).toString("hex"),
      // Members > Invite rules > Invitation expiry (default 7 days).
      expiresAt: new Date(now.getTime() + rules.inviteExpiryDays * 24 * 60 * 60 * 1000),
      departmentId: departmentId || null,
      roleId: roleId || null,
      managerId: managerId || null,
      officeId: officeId || null,
      kraIds: cleanKraIds,
      sopIds: cleanSopIds,
    };
    let invitation;
    if (existingInvite) {
      const renewed = await prisma.invitation.updateMany({
        where: { id: existingInvite.id, accepted: false, expiresAt: { lt: now } },
        data: fields,
      });
      if (renewed.count !== 1) {
        return NextResponse.json({ error: "Invitation already sent to this email. Resend it from Pending invites." }, { status: 400 });
      }
      invitation = await prisma.invitation.findUniqueOrThrow({ where: { id: existingInvite.id } });
    } else {
      invitation = await prisma.invitation.create({
        data: { email, organizationId: orgId, ...fields },
      });
    }

    // Send invitation email
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } });
    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
    const inviteLink = `${baseUrl}/join?token=${invitation.token}`;
    const inviter = session.user as { firstName?: string; lastName?: string; name?: string | null };
    const inviterName = `${inviter.firstName ?? ""} ${inviter.lastName ?? ""}`.trim() || inviter.name || undefined;
    const { subject, html } = invitationTemplate({
      companyName: org?.name || "Your team",
      inviteLink,
      accessLevel: inviteLevel || "EMPLOYEE",
      inviterName,
      personalMessage,
    });

    try {
      await sendEmail({
        to: email,
        subject,
        html,
        template: "invitation",
        variables: { companyName: org?.name, inviteLink },
        organizationId: orgId,
        category: "invitation",
      });
    } catch (emailErr) {
      console.error("[Invitation] Email send failed:", emailErr);
    }

    broadcastWebhook({
      organizationId: orgId,
      event: "user_invited",
      payload: { email, accessLevel: inviteLevel || "EMPLOYEE" },
    });

    // Audit-log every invitation — adding a user is the most common
    // security-sensitive admin action and the one customers expect
    // to see in their access review reports.
    logAuditEvent({
      type: "user.invited",
      actorId: (session.user as { id: string }).id,
      organizationId: orgId,
      description: `Invited ${email} as ${inviteLevel || "EMPLOYEE"}`,
      targetId: invitation.id,
      targetType: "Invitation",
      // The personal message is kept here (Invitation has no column for it)
      // so /join can show the invitee what the inviter wrote.
      metadata: { email, accessLevel: inviteLevel || "EMPLOYEE", departmentId, roleId, officeId, kraCount: cleanKraIds.length, sopCount: cleanSopIds.length, ...(personalMessage ? { message: personalMessage } : {}) },
    });

    // The raw token is the invitation (see GET): it goes to the invitee by
    // email and never back to the caller.
    const { token: _t, ...created } = invitation;
    void _t;
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error("Invitations POST error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const orgId = (session.user as { organizationId: string }).organizationId;

    const allowed = await hasPermission(session, "people", "create");
    if (!allowed) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const { id } = await req.json();

    if (!id) {
      return NextResponse.json({ error: "Invitation ID is required" }, { status: 400 });
    }

    // Verify invitation belongs to this org
    const invitation = await prisma.invitation.findFirst({
      where: { id, organizationId: orgId },
    });

    if (!invitation) {
      return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
    }

    if (invitation.accepted) {
      return NextResponse.json({ error: "Cannot delete an accepted invitation" }, { status: 400 });
    }

    await prisma.invitation.delete({ where: { id } });

    logAuditEvent({
      type: "user.invitation.revoked",
      actorId: (session.user as { id: string }).id,
      organizationId: orgId,
      description: `Revoked invitation for ${invitation.email}`,
      targetId: id,
      targetType: "Invitation",
      metadata: { email: invitation.email },
    });

    return NextResponse.json({ message: "Invitation cancelled" });
  } catch (error) {
    console.error("Invitations DELETE error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// PATCH /api/invitations { id, resend: true }: Resend
//
// Resend lives on Workspace settings > Members > Pending invites, which is
// where the "Invitation needs resending" Inbox row (request-resend) sends the
// inviter and the admins. An expired invitation is the usual case: the old
// row blocked a fresh invite ("Invitation already sent"), so before this the
// only way through was Revoke and invite again.
//
// Who may resend: whoever may invite (people.create, the same gate as POST
// and DELETE /api/invitations), plus, for an invitation to a Space, whoever
// can edit that Space (the Space share dialog's own rule). The level rule is
// applied again, so a person below Admin can never resend an Admin
// invitation they could not have sent.
//
// A resend ROTATES the token and gives the invitation seven more days: the
// link in the old email stops working, so a copy that leaked (a forwarded
// email) cannot be accepted after the real person asked for a new one. The
// rotation is a conditional update on accepted=false, so an invitation
// accepted a moment earlier is never revived.

const RESEND_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  const viewer = session?.user as { id?: string; organizationId?: string; accessLevel?: string; firstName?: string; lastName?: string; name?: string | null } | undefined;
  if (!viewer?.id || !viewer.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = viewer.organizationId;
  const reqBody = (await req.json().catch(() => null)) as { id?: unknown; resend?: unknown } | null;
  const id = typeof reqBody?.id === "string" ? reqBody.id : "";
  if (!id || reqBody?.resend !== true) return NextResponse.json({ error: "Send { id, resend: true }." }, { status: 400 });

  const inv = await prisma.invitation.findFirst({
    where: { id, organizationId: orgId, accepted: false },
    select: { id: true, email: true, accessLevel: true, spaceId: true, organizationId: true },
  });
  if (!inv) return NextResponse.json({ error: "This invitation was accepted or revoked." }, { status: 404 });

  const mayInvite = await hasPermission(session, "people", "create");
  const maySpace = !mayInvite && inv.spaceId ? await canEditSpace(inv.spaceId, viewer.id, viewer.accessLevel ?? "EMPLOYEE") : false;
  if (!mayInvite && !maySpace) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  if (!inv.spaceId) {
    const level = resolveInviteLevel(viewer.accessLevel, inv.accessLevel);
    if (!level.ok) return NextResponse.json({ error: level.error }, { status: level.status });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + RESEND_WEEK_MS);
  const claimed = await prisma.invitation.updateMany({
    where: { id: inv.id, organizationId: orgId, accepted: false },
    data: { token, expiresAt },
  });
  if (claimed.count !== 1) return NextResponse.json({ error: "This invitation was accepted or revoked." }, { status: 404 });

  const [org, sender] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
    inviteSender(inv),
  ]);
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const inviteLink = `${baseUrl}/join?token=${token}`;
  const resender = `${viewer.firstName ?? ""} ${viewer.lastName ?? ""}`.trim() || viewer.name || undefined;
  const { subject, html } = invitationTemplate({
    companyName: org?.name || "Your team",
    inviteLink,
    accessLevel: inv.accessLevel,
    inviterName: sender.inviterName ?? resender,
    personalMessage: sender.message ?? undefined,
  });
  try {
    await sendEmail({
      to: inv.email,
      subject,
      html,
      template: "invitation",
      variables: { companyName: org?.name },
      organizationId: orgId,
      category: "invitation",
    });
  } catch (err) {
    console.error("[Invitation] resend email failed:", err);
    return NextResponse.json({ error: "The new link was made but the email did not go out. Try Resend again." }, { status: 502 });
  }

  logAuditEvent({
    type: "user.invitation_resent",
    actorId: viewer.id,
    organizationId: orgId,
    description: `Resent the invitation to ${inv.email}`,
    targetId: inv.id,
    targetType: "Invitation",
    metadata: { email: inv.email, accessLevel: inv.accessLevel, expiresAt: expiresAt.toISOString() },
  });

  return NextResponse.json({ ok: true, id: inv.id, expiresAt: expiresAt.toISOString() });
}
