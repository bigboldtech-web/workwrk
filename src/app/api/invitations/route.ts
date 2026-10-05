import { inviteDomainsOf, usersSettingsOf } from "@/lib/settings/org-policy";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";
import { sendEmail } from "@/lib/email";
import { invitationTemplate } from "@/lib/email-templates";
import { hasPermission } from "@/lib/api-helpers";
import { logAuditEvent } from "@/lib/activity";
import { levelForInviteRole, resolveInviteLevel } from "@/lib/access/invite-level";
import { sendInvitation } from "@/lib/people/send-invitation.server";
import { settingsDoorAllows } from "@/lib/access/settings-door";
import { freshWorkspaceActor } from "@/lib/access/workspace-admin";
import { inviteSender } from "@/lib/auth/invite-facts.server";
import { canEditSpace } from "@/lib/space";
import { lockWorkspaceSeats, seatsFor } from "@/lib/seats";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const viewer = session.user as { organizationId?: string; accessLevel?: string; email?: string | null };
    const orgId = viewer.organizationId;

    // ?rules=1: the invite rules every invite dialog starts from (Members >
    // Invite rules), for anyone who may invite (the same people.create cell
    // POST checks), so the topbar dialog and the Members dialog start on the
    // same default role and accept the same domains the server accepts.
    if (new URL(req.url).searchParams.get("rules") === "1") {
      if (!(await hasPermission(session, "people", "create"))) {
        return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
      }
      // hasPermission reads the session's level, re-checked only every five
      // minutes: a session the database no longer backs (a demotion's
      // tokenVersion bump, signed out elsewhere) is refused now, as POST is.
      const fresh = await freshWorkspaceActor(session);
      if (!fresh.ok) return NextResponse.json({ error: fresh.error, code: fresh.code }, { status: fresh.status });
      const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true, domain: true } });
      const rules = usersSettingsOf(org?.settings, org?.domain);
      return NextResponse.json(
        {
          allowedDomains: inviteDomainsOf(org?.settings, org?.domain, viewer.email),
          inviteDefaultRole: rules.inviteDefaultRole === "ADMIN" ? "ADMIN" : "MEMBER",
          inviteExpiryDays: rules.inviteExpiryDays,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    // The list names every invitee, their level and placement, so it is for
    // the people who manage invitations: the same people Settings > Members
    // (its one reader) admits, through the one door decision (the manager
    // tier today, the engine's page table once ACCESS_V2_RESOLVER is on). A
    // Member gets a 403, not a way to enumerate pending Admin invites. The
    // door re-reads the person from the database (settings-door.ts), so an
    // Admin demoted a moment ago is refused now too.
    if (!(await settingsDoorAllows("members", session))) {
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

    // The actor as the database has them NOW (freshWorkspaceActor): an
    // invitation outlives the session that sends it (seven days, and it can
    // carry Admin), so a person demoted a moment ago must not mint one on the
    // level their five-minute-old token still claims. The permission and the
    // level rule below both read the fresh level.
    const fresh = await freshWorkspaceActor(session);
    if (!fresh.ok) {
      return NextResponse.json({ error: fresh.error, code: fresh.code }, { status: fresh.status });
    }
    const freshSession = { ...session, user: { ...session.user, accessLevel: fresh.level } };
    const allowed = await hasPermission(freshSession, "people", "create");
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

    // Everything from the level rule to the audit row is the one invitation
    // path (src/lib/people/send-invitation.server.ts), shared with Ask AI.
    const inviter = session.user as { id: string; email?: string; firstName?: string; lastName?: string; name?: string | null };
    const inviterName = `${inviter.firstName ?? ""} ${inviter.lastName ?? ""}`.trim() || inviter.name || undefined;
    const outcome = await sendInvitation({
      organizationId: orgId,
      actor: { id: inviter.id, level: fresh.level, email: inviter.email, name: inviterName },
      email,
      requestedLevel,
      departmentId,
      roleId,
      managerId,
      officeId,
      kraIds,
      sopIds,
      message,
    });
    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error, ...(outcome.code ? { code: outcome.code } : {}) }, { status: outcome.status });
    }
    return NextResponse.json(outcome.invitation, { status: 201 });
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

const DAY_MS = 24 * 60 * 60 * 1000;

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
    select: { id: true, email: true, accessLevel: true, spaceId: true, organizationId: true, expiresAt: true },
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
  // A resent link lives as long as a new one: Members > Invite rules >
  // Invitation expiry (default 7 days), the same rule POST honours.
  const orgRules = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true, domain: true } });
  const expiryDays = usersSettingsOf(orgRules?.settings, orgRules?.domain).inviteExpiryDays;
  const expiresAt = new Date(Date.now() + expiryDays * DAY_MS);
  // An expired invitation held no seat; reviving it takes one, checked and
  // taken under the workspace's lock (src/lib/seats.ts). A live one keeps its.
  const revived = inv.expiresAt.getTime() < Date.now();
  const outcome = await prisma.$transaction(async (tx) => {
    if (revived) {
      await lockWorkspaceSeats(tx, orgId);
      const seats = await seatsFor(orgId, 1, tx);
      if (!seats.ok) return { refused: seats.message } as const;
    }
    const claimed = await tx.invitation.updateMany({
      where: { id: inv.id, organizationId: orgId, accepted: false },
      data: { token, expiresAt },
    });
    return { count: claimed.count } as const;
  });
  if ("refused" in outcome) return NextResponse.json({ error: outcome.refused, code: "seat_limit" }, { status: 403 });
  if (outcome.count !== 1) return NextResponse.json({ error: "This invitation was accepted or revoked." }, { status: 404 });

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
    expiresInDays: expiryDays,
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
