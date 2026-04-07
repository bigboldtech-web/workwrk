import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";
import { sendEmail } from "@/lib/email";
import { welcomeTemplate } from "@/lib/email-templates";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { organizationName, firstName, lastName, email, password } = body;

    if (!organizationName || !firstName || !lastName || !email || !password) {
      return NextResponse.json(
        { error: "All fields are required" },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    // Check if org slug already exists
    let slug = slugify(organizationName);
    const existingOrg = await prisma.organization.findUnique({ where: { slug } });
    if (existingOrg) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }

    // Check if user already exists in any org with this email
    const existingUser = await prisma.user.findFirst({
      where: { email },
    });
    if (existingUser) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Create organization and admin user in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: organizationName,
          slug,
          status: "TRIAL",
        },
      });

      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          firstName,
          lastName,
          organizationId: organization.id,
          accessLevel: "COMPANY_ADMIN",
        },
      });

      // Create default departments
      const defaultDepts = ["Engineering", "Sales", "Marketing", "Operations", "HR", "Finance"];
      for (const deptName of defaultDepts) {
        await tx.department.create({
          data: {
            name: deptName,
            organizationId: organization.id,
          },
        });
      }

      return { organization, user };
    });

    // Send welcome email
    try {
      const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
      const { subject, html } = welcomeTemplate({
        firstName,
        organizationName,
        loginLink: `${baseUrl}/login`,
      });
      await sendEmail({
        to: email,
        subject,
        html,
        template: "welcome",
        variables: { firstName, organizationName },
        organizationId: result.organization.id,
        category: "invitation",
      });
    } catch (emailErr) {
      console.error("[Register] Welcome email failed:", emailErr);
    }

    return NextResponse.json(
      {
        message: "Account created successfully",
        organizationId: result.organization.id,
        userId: result.user.id,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
