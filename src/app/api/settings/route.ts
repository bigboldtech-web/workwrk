import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const orgId = (session.user as any).organizationId;

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        name: true,
        slug: true,
        domain: true,
        logo: true,
        plan: true,
        status: true,
        settings: true,
        _count: {
          select: {
            users: true,
            sops: true,
            aiQueries: true,
          },
        },
      },
    });

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const settings = (org.settings as any) || {};

    return NextResponse.json({
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        domain: org.domain,
        logo: org.logo,
        plan: org.plan,
        status: org.status,
      },
      settings: {
        enabledModules: settings.enabledModules || [
          "people", "kra-kpi", "tasks", "sops", "reviews", "meetings", "checkins", "ai", "analytics",
        ],
        businessType: settings.businessType || "",
        industry: settings.industry || "",
        teamSize: settings.teamSize || "",
        timezone: settings.timezone || "Asia/Kolkata",
        currency: settings.currency || "INR",
        fiscalYearStart: settings.fiscalYearStart || 4,
        reviewFrequency: settings.reviewFrequency || "QUARTERLY",
        scoreWeights: settings.scoreWeights || {
          kpi: 40, manager: 25, peer: 10, self: 5, sopCompliance: 20,
        },
        scoringBands: settings.scoringBands || [
          { label: "Exceptional", min: 90, max: 100, color: "green" },
          { label: "Good", min: 75, max: 89, color: "blue" },
          { label: "Meets Expectations", min: 60, max: 74, color: "purple" },
          { label: "Needs Improvement", min: 40, max: 59, color: "orange" },
          { label: "Underperforming", min: 0, max: 39, color: "red" },
        ],
        notifications: settings.notifications || {
          kraAssigned: true,
          kpiUpdate: true,
          reviewDue: true,
          sopUpdate: true,
          checkInReminder: true,
          kudosReceived: true,
          emailEnabled: true,
          reminderFrequency: "daily",
        },
        security: settings.security || {
          minPasswordLength: 8,
          requireUppercase: true,
          requireNumbers: true,
          sessionTimeout: 30,
          twoFactorEnabled: false,
        },
      },
      usage: {
        users: org._count.users,
        sops: org._count.sops,
        aiQueries: org._count.aiQueries,
      },
    }, {
      headers: { "Cache-Control": "private, max-age=120, stale-while-revalidate=300" },
    });
  } catch (error) {
    console.error("Settings GET error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const accessLevel = (session.user as any).accessLevel;
    if (!["COMPANY_ADMIN", "SUPER_ADMIN", "C_LEVEL"].includes(accessLevel)) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const orgId = (session.user as any).organizationId;
    const body = await req.json();
    const { section, data, companyProfile } = body;

    // Get current org and settings
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
    });

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const currentSettings = (org.settings as any) || {};

    // Handle company profile update directly
    if (companyProfile) {
      await prisma.organization.update({
        where: { id: orgId },
        data: {
          settings: { ...currentSettings, companyProfile },
        },
      });
      return NextResponse.json({ success: true });
    }

    switch (section) {
      case "general": {
        const updateData: any = {};
        if (data.name) updateData.name = data.name;
        if (data.domain !== undefined) updateData.domain = data.domain;

        // Also store extended general settings in JSON
        const generalSettings: any = {};
        if (data.timezone !== undefined) generalSettings.timezone = data.timezone;
        if (data.currency !== undefined) generalSettings.currency = data.currency;
        if (data.fiscalYearStart !== undefined) generalSettings.fiscalYearStart = data.fiscalYearStart;
        if (data.reviewFrequency !== undefined) generalSettings.reviewFrequency = data.reviewFrequency;
        if (data.scoreWeights !== undefined) generalSettings.scoreWeights = data.scoreWeights;
        if (data.scoringBands !== undefined) generalSettings.scoringBands = data.scoringBands;

        if (Object.keys(generalSettings).length > 0) {
          updateData.settings = { ...currentSettings, ...generalSettings };
        }

        await prisma.organization.update({
          where: { id: orgId },
          data: updateData,
        });
        break;
      }

      case "notifications": {
        await prisma.organization.update({
          where: { id: orgId },
          data: {
            settings: {
              ...currentSettings,
              notifications: data,
            },
          },
        });
        break;
      }

      case "security": {
        await prisma.organization.update({
          where: { id: orgId },
          data: {
            settings: {
              ...currentSettings,
              security: data,
            },
          },
        });
        break;
      }

      case "modules": {
        await prisma.organization.update({
          where: { id: orgId },
          data: {
            settings: {
              ...currentSettings,
              enabledModules: data.enabledModules,
            },
          },
        });
        break;
      }

      default:
        return NextResponse.json({ error: "Invalid section" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Settings PATCH error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
