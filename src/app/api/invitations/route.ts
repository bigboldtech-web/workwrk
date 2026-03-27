import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { broadcastWebhook } from "@/lib/webhooks";
import crypto from "crypto";
import { sendEmail } from "@/lib/email";
import { invitationTemplate } from "@/lib/email-templates";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const orgId = (session.user as any).organizationId;

    const invitations = await prisma.invitation.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(invitations);
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

    const orgId = (session.user as any).organizationId;
    const accessLevel = (session.user as any).accessLevel;

    if (!["COMPANY_ADMIN", "SUPER_ADMIN", "HR", "C_LEVEL"].includes(accessLevel)) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const { email, accessLevel: inviteLevel, departmentId, roleId } = await req.json();

    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
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
    if (existingInvite) {
      return NextResponse.json({ error: "Invitation already sent to this email" }, { status: 400 });
    }

    const invitation = await prisma.invitation.create({
      data: {
        email,
        accessLevel: inviteLevel || "EMPLOYEE",
        token: crypto.randomBytes(32).toString("hex"),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        organizationId: orgId,
        departmentId: departmentId || null,
        roleId: roleId || null,
      },
    });

    // Send invitation email
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } });
    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
    const inviteLink = `${baseUrl}/register?token=${invitation.token}`;
    const { subject, html } = invitationTemplate({
      companyName: org?.name || "Your team",
      inviteLink,
      accessLevel: inviteLevel || "EMPLOYEE",
    });

    sendEmail({
      to: email,
      subject,
      html,
      template: "invitation",
      variables: { companyName: org?.name, inviteLink },
      organizationId: orgId,
      category: "invitation",
    });

    broadcastWebhook({
      organizationId: orgId,
      event: "user_invited",
      payload: { email, accessLevel: inviteLevel || "EMPLOYEE" },
    });

    return NextResponse.json(invitation, { status: 201 });
  } catch (error) {
    console.error("Invitations POST error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
