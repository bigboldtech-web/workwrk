import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

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

    // Create user and mark invitation as accepted
    await prisma.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          email: invitation.email,
          passwordHash,
          firstName,
          lastName,
          organizationId: invitation.organizationId,
          accessLevel: invitation.accessLevel,
          departmentId: invitation.departmentId,
          roleId: invitation.roleId,
        },
      });

      await tx.invitation.update({
        where: { id: invitation.id },
        data: { accepted: true },
      });
    });

    return NextResponse.json({ message: "Account created successfully" }, { status: 201 });
  } catch (error: any) {
    console.error("Accept invite error:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
