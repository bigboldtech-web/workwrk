import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { settings: true },
    });

    const settings = (org?.settings as any) || {};
    return NextResponse.json({
      setupCompleted: !!settings.setupCompleted,
      settings,
    });
  } catch (error) {
    console.error("Setup GET error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const orgId = (session.user as any).organizationId;
    const body = await req.json();

    const {
      businessType,
      industry,
      useCase,
      teamSize,
      enabledModules,
      departments,
      customDepartments,
      invites,
    } = body;

    // Update organization settings
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        settings: {
          setupCompleted: true,
          setupCompletedAt: new Date().toISOString(),
          businessType,
          industry,
          useCase,
          teamSize,
          enabledModules,
        },
      },
    });

    // Sync departments: disable unchecked default ones, create custom ones
    const enabledDeptNames = (departments || [])
      .filter((d: any) => d.enabled)
      .map((d: any) => d.name);

    // Get existing departments
    const existingDepts = await prisma.department.findMany({
      where: { organizationId: orgId },
    });

    const existingDeptNames = existingDepts.map((d) => d.name);

    // Delete default departments that were unchecked (only if they have no members)
    const defaultNames = ["Engineering", "Sales", "Marketing", "Operations", "HR", "Finance"];
    for (const dept of existingDepts) {
      if (defaultNames.includes(dept.name) && !enabledDeptNames.includes(dept.name)) {
        // Check if department has members
        const memberCount = await prisma.user.count({
          where: { departmentId: dept.id },
        });
        if (memberCount === 0) {
          await prisma.department.delete({ where: { id: dept.id } });
        }
      }
    }

    // Update existing departments with colors/descriptions
    for (const deptData of (departments || []).filter((d: any) => d.enabled)) {
      const existing = existingDepts.find((d) => d.name === deptData.name);
      if (existing) {
        await prisma.department.update({
          where: { id: existing.id },
          data: {
            color: deptData.color || existing.color,
            description: deptData.description || existing.description,
          },
        });
      }
    }

    // Create custom departments
    for (const dept of customDepartments || []) {
      if (dept.name && !existingDeptNames.includes(dept.name)) {
        await prisma.department.create({
          data: {
            name: dept.name,
            color: dept.color,
            description: dept.description,
            organizationId: orgId,
          },
        });
      }
    }

    // Send invitations
    const validInvites = (invites || []).filter(
      (inv: any) => inv.email && inv.email.includes("@")
    );

    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } });
    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

    for (const invite of validInvites) {
      // Check if user already exists
      const existingUser = await prisma.user.findFirst({
        where: { email: invite.email, organizationId: orgId },
      });
      if (existingUser) continue;

      // Check if invitation already exists
      const existingInvite = await prisma.invitation.findFirst({
        where: {
          email: invite.email,
          organizationId: orgId,
          accepted: false,
        },
      });
      if (existingInvite) continue;

      const invitation = await prisma.invitation.create({
        data: {
          email: invite.email,
          accessLevel: invite.role || "EMPLOYEE",
          token: crypto.randomBytes(32).toString("hex"),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
          organizationId: orgId,
        },
      });

      // Send invitation email
      const inviteLink = `${baseUrl}/register?token=${invitation.token}`;
      const { subject, html } = invitationTemplate({
        companyName: org?.name || "Your team",
        inviteLink,
        accessLevel: invite.role || "EMPLOYEE",
      });

      sendEmail({
        to: invite.email,
        subject,
        html,
        template: "invitation",
        variables: { companyName: org?.name, inviteLink },
        organizationId: orgId,
        category: "invitation",
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Setup POST error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
