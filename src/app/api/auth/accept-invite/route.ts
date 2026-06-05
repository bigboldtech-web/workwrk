import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { sendEmail } from "@/lib/email";
import { welcomeTemplate } from "@/lib/email-templates";

// GET: Fetch invitation details by token
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Token is required" }, { status: 400 });
  }

  const invitation = await prisma.invitation.findUnique({
    where: { token },
    include: {
      organization: { select: { name: true } },
    },
  });

  if (!invitation) {
    return NextResponse.json({ error: "Invalid invitation link" }, { status: 404 });
  }

  if (invitation.accepted) {
    return NextResponse.json({ error: "This invitation has already been used" }, { status: 400 });
  }

  if (invitation.expiresAt < new Date()) {
    return NextResponse.json({ error: "This invitation has expired. Please ask your admin to resend it." }, { status: 400 });
  }

  return NextResponse.json({
    email: invitation.email,
    organizationName: invitation.organization.name,
    accessLevel: invitation.accessLevel,
  });
}

// POST: Accept invitation and create user account
export async function POST(req: Request) {
  try {
    const { token, firstName, lastName, password } = await req.json();

    if (!token || !firstName || !lastName || !password) {
      return NextResponse.json({ error: "All fields are required" }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const invitation = await prisma.invitation.findUnique({
      where: { token },
    });

    if (!invitation) {
      return NextResponse.json({ error: "Invalid invitation link" }, { status: 404 });
    }

    if (invitation.accepted) {
      return NextResponse.json({ error: "This invitation has already been used" }, { status: 400 });
    }

    if (invitation.expiresAt < new Date()) {
      return NextResponse.json({ error: "This invitation has expired" }, { status: 400 });
    }

    // Check if user already exists in this org
    const existingUser = await prisma.user.findFirst({
      where: { email: invitation.email, organizationId: invitation.organizationId },
    });

    if (existingUser) {
      return NextResponse.json({ error: "An account with this email already exists in this organization" }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Create user + materialize their KRA/SOP assignments + (if the
    // invite carried a spaceId) drop them straight into that Space, all
    // in one transaction so a partial signup can never leave a user
    // without their role definition.
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: invitation.email,
          passwordHash,
          firstName,
          lastName,
          organizationId: invitation.organizationId,
          accessLevel: invitation.accessLevel,
          departmentId: invitation.departmentId,
          roleId: invitation.roleId,
          managerId: invitation.managerId,
          officeId: invitation.officeId,
        },
      });

      // Role-definition fan-out. KRAs and SOPs were chosen by the
      // inviting admin and stamped on the Invitation; we materialize
      // them as assignment rows here. Even weighting across KRAs
      // (admin can rebalance later from /kra-kpi). SOPs default to
      // mandatory acknowledgement.
      if (invitation.kraIds.length > 0) {
        const weight = Math.round((100 / invitation.kraIds.length) * 100) / 100;
        await tx.kRAAssignment.createMany({
          data: invitation.kraIds.map((kraId) => ({
            userId: user.id,
            kraId,
            weightage: weight,
            period: "ongoing",
            status: "ACTIVE" as const,
          })),
          skipDuplicates: true,
        });
      }
      if (invitation.sopIds.length > 0) {
        // SOP step count lives inside SOP.content (a JSON blob), not a
        // separate relation — we leave stepsTotal at 0 and let the
        // first acknowledgement update it from the content shape.
        await tx.sOPAssignment.createMany({
          data: invitation.sopIds.map((sopId) => ({
            userId: user.id,
            sopId,
            status: "ASSIGNED" as const,
            mandatory: true,
          })),
          skipDuplicates: true,
        });
      }

      // 🆕 Phase 18 — Space-targeted invite. Drop the new user into
      // the Space they were invited to with the role the admin chose.
      if (invitation.spaceId) {
        await tx.spaceMember.upsert({
          where: { spaceId_userId: { spaceId: invitation.spaceId, userId: user.id } },
          create: {
            spaceId: invitation.spaceId,
            userId: user.id,
            role: invitation.spaceRole ?? "MEMBER",
          },
          update: {},
        });
      }

      await tx.invitation.update({
        where: { id: invitation.id },
        data: { accepted: true },
      });
    });

    // Send welcome email
    try {
      const org = await prisma.organization.findUnique({
        where: { id: invitation.organizationId },
        select: { name: true },
      });
      const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
      const { subject, html } = welcomeTemplate({
        firstName,
        organizationName: org?.name || "your team",
        loginLink: `${baseUrl}/login`,
      });
      await sendEmail({
        to: invitation.email,
        subject,
        html,
        template: "welcome",
        variables: { firstName, organizationName: org?.name },
        organizationId: invitation.organizationId,
        category: "invitation",
      });
    } catch (emailErr) {
      console.error("[AcceptInvite] Welcome email failed:", emailErr);
    }

    return NextResponse.json({ message: "Account created successfully" }, { status: 201 });
  } catch (error) {
    console.error("Accept invite error:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
