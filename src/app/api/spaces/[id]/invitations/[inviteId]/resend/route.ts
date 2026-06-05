// POST /api/spaces/[id]/invitations/[inviteId]/resend — re-fire the
// invitation email without rotating the token. The existing accept
// URL stays valid until expiry.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canEditSpace, getSpaceForReader } from "@/lib/space";
import { sendEmail } from "@/lib/email";
import { invitationTemplate } from "@/lib/email-templates";

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

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; inviteId: string }> },
) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id: spaceId, inviteId } = await params;

  const space = await getSpaceForReader(spaceId, c.userId, c.accessLevel);
  if (!space || space.organizationId !== c.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const canEdit = await canEditSpace(spaceId, c.userId, c.accessLevel);
  if (!canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const invitation = await prisma.invitation.findFirst({
    where: { id: inviteId, organizationId: c.organizationId, spaceId, accepted: false },
    select: { id: true, email: true, token: true, expiresAt: true },
  });
  if (!invitation) {
    return NextResponse.json({ error: "Invitation not found or already accepted" }, { status: 404 });
  }
  if (invitation.expiresAt < new Date()) {
    return NextResponse.json({ error: "Invitation has expired — send a new one" }, { status: 400 });
  }

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const inviteUrl = `${baseUrl}/register?token=${invitation.token}`;
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
      to: invitation.email,
      subject,
      html,
      template: "invitation-space-resend",
      variables: { companyName: org?.name, inviteLink: inviteUrl, spaceId },
      organizationId: c.organizationId,
      category: "invitation",
    });
  } catch (err) {
    console.error("[SpaceInvitation] resend failed:", err);
    return NextResponse.json({ error: "Email could not be sent — share the link manually" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, inviteUrl });
}
