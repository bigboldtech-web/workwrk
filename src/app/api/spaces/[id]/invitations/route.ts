// POST /api/spaces/[id]/invitations
//
// Space-scoped invite-by-email. Differs from /api/invitations (org-wide
// hire onboarding) in two ways:
//   1. No KRA/SOP gate — joining a Space is a lighter intent than full
//      org-onboarding. A new hire still goes through the org flow.
//   2. Carries spaceId + spaceRole. accept-invite POST reads these and
//      creates a SpaceMember row at the end of the user-creation tx.
//
// Auth: caller must be OWNER/ADMIN of the target Space (canEditSpace).
//
// Returns: { invitation: { token, expiresAt }, inviteUrl }. Email is
// sent if a template + sender are configured; the inviteUrl is also
// returned so the caller can copy/paste it manually.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import crypto from "crypto";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canEditSpace, getSpaceForReader } from "@/lib/space";
import { sendEmail } from "@/lib/email";
import { invitationTemplate } from "@/lib/email-templates";
import { recordSpaceInvite } from "@/lib/access/grants";
import { alreadyInOrg } from "@/lib/auth/invite-facts.server";

const schema = z.object({
  email: z.string().email(),
  spaceRole: z.enum(["OWNER", "ADMIN", "MEMBER", "GUEST"]).default("MEMBER"),
});

async function ctx() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const u = session.user as { id?: string; accessLevel?: string; organizationId?: string };
  if (!u.id || !u.organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId: u.id, accessLevel: u.accessLevel ?? "EMPLOYEE", organizationId: u.organizationId };
}

// GET /api/spaces/[id]/invitations — list pending (unaccepted, unexpired)
// invitations for the Space. Used by the ShareDialog's "Invite" tab to
// show admins who they've already invited.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id: spaceId } = await params;

  const space = await getSpaceForReader(spaceId, c.userId, c.accessLevel);
  if (!space || space.organizationId !== c.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const canEdit = await canEditSpace(spaceId, c.userId, c.accessLevel);
  if (!canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const rows = await prisma.invitation.findMany({
    where: {
      organizationId: c.organizationId,
      spaceId,
      accepted: false,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      spaceRole: true,
      token: true,
      createdAt: true,
      expiresAt: true,
    },
  });

  return NextResponse.json({
    invitations: rows.map((r) => ({
      id: r.id,
      email: r.email,
      spaceRole: r.spaceRole,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      inviteUrl: `${baseUrl}/join?token=${r.token}`,
    })),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id: spaceId } = await params;

  const space = await getSpaceForReader(spaceId, c.userId, c.accessLevel);
  if (!space || space.organizationId !== c.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const canEdit = await canEditSpace(spaceId, c.userId, c.accessLevel);
  if (!canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const email = parsed.data.email.toLowerCase();

  // Already in the workspace, as their own account or as a membership
  // (someone who works in several is anchored in only one), deactivated or
  // not: /join refuses every one of them, so no invitation is made for them.
  const inOrg = await alreadyInOrg(email, c.organizationId);
  if (inOrg.member) {
    return NextResponse.json(
      {
        error: inOrg.removed
          ? "This person was removed from your workspace. An Owner, an Admin or the People team can restore them from Directory, Removed, then add them to the Space."
          : inOrg.inactive
            ? "This person is deactivated in your workspace. An Owner or Admin can reactivate them in Settings, Members, then add them to the Space."
            : inOrg.elsewhere
              ? "This person is in your workspace but is working in another one right now, so the People tab cannot list them yet. Once they switch to this workspace, add them from the People tab."
              : "This person is already in your workspace. Add them to the Space from the People tab instead.",
      },
      { status: 400 },
    );
  }

  // De-dupe pending invitations for the same (email, space).
  const existingInvite = await prisma.invitation.findFirst({
    where: {
      email,
      organizationId: c.organizationId,
      spaceId,
      accepted: false,
      expiresAt: { gt: new Date() },
    },
    select: { id: true, token: true, expiresAt: true },
  });

  // A new invitation and its security activity row land together: the row
  // is what credits the sender when the invitee accepts (A7).
  const invitation = existingInvite
    ? existingInvite
    : await prisma.$transaction(async (tx) => {
        const created = await tx.invitation.create({
          data: {
            email,
            accessLevel: "EMPLOYEE",
            token: crypto.randomBytes(32).toString("hex"),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            organizationId: c.organizationId,
            spaceId,
            spaceRole: parsed.data.spaceRole,
          },
          select: { id: true, token: true, expiresAt: true },
        });
        await recordSpaceInvite(tx, {
          actorId: c.userId,
          organizationId: c.organizationId,
          spaceId,
          invitationId: created.id,
          email,
          role: parsed.data.spaceRole,
        });
        return created;
      });

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const inviteUrl = `${baseUrl}/join?token=${invitation.token}`;

  // Fire-and-forget email — the inviteUrl is still returned so the
  // caller can copy/paste if email delivery is misconfigured.
  const org = await prisma.organization.findUnique({
    where: { id: c.organizationId },
    select: { name: true },
  });
  try {
    const { subject, html } = invitationTemplate({
      companyName: org?.name ?? "Your team",
      inviteLink: inviteUrl,
      accessLevel: "EMPLOYEE",
    });
    await sendEmail({
      to: email,
      subject,
      html,
      template: "invitation-space",
      variables: { companyName: org?.name, inviteLink: inviteUrl, spaceId },
      organizationId: c.organizationId,
      category: "invitation",
    });
  } catch (err) {
    console.error("[SpaceInvitation] email send failed:", err);
  }

  return NextResponse.json(
    { invitation, inviteUrl, reused: Boolean(existingInvite) },
    { status: existingInvite ? 200 : 201 },
  );
}
