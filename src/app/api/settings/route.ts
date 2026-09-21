import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeEnabledModules } from "@/lib/module-keys";
import { logAuditEvent } from "@/lib/activity";
import {
  getReviewCadences,
  getBehavioralAnchors,
  validateScoreWeights,
  validateScoringBands,
} from "@/lib/review-cadence";
import { accessSettingsSchema, parseAccessSettings } from "@/lib/access/settings";
import { parseProcessSettings, processSettingsPatchSchema } from "@/lib/process-settings";
import { canManageProcess } from "@/lib/process-scope";

type SessionUser = { id: string; organizationId: string; accessLevel?: string };
/** Organization.settings is an untyped JSON blob; every section reads its own keys off it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SettingsBlob = Record<string, any>;

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const orgId = (session.user as SessionUser).organizationId;

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

    const settings = (org.settings as SettingsBlob | null) || {};

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
        companyProfile: settings.companyProfile || null,
        enabledModules: settings.enabledModules
          ? normalizeEnabledModules(settings.enabledModules)
          : ["people", "kra-kpi", "tasks", "sops", "reviews", "meetings", "checkins", "ai", "analytics"],
        businessType: settings.businessType || "",
        industry: settings.industry || "",
        teamSize: settings.teamSize || "",
        timezone: settings.timezone || "Asia/Kolkata",
        currency: settings.currency || "INR",
        fiscalYearStart: settings.fiscalYearStart || 4,
        language: settings.language || "en",
        reviewFrequency: settings.reviewFrequency || "QUARTERLY",
        scoreWeights: settings.scoreWeights || {
          kpi: 40, manager: 25, peer: 10, self: 5, sopCompliance: 20,
        },
        scoringBands: settings.scoringBands || [
          { label: "Exceptional", min: 90, max: 100, color: "green" },
          { label: "Good", min: 75, max: 89, color: "blue" },
          { label: "Meets Expectations", min: 60, max: 74, color: "lime" },
          { label: "Needs Improvement", min: 40, max: 59, color: "orange" },
          { label: "Underperforming", min: 0, max: 39, color: "red" },
        ],
        reviewCadences: getReviewCadences(settings),
        behavioralAnchors: getBehavioralAnchors(settings),
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
        // The ten access toggles (access-model-spec section 8), defaults
        // filled in, so a settings surface can render them without a
        // second parse.
        access: parseAccessSettings(settings.access),
        // The process taxonomies and acknowledgement defaults (Organize).
        // Seeding on first read happens in GET /api/settings/process.
        process: parseProcessSettings(settings.process).value,
      },
      usage: {
        users: org._count.users,
        sops: org._count.sops,
        aiQueries: org._count.aiQueries,
      },
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

    const accessLevel = (session.user as SessionUser).accessLevel ?? "";
    const orgId = (session.user as SessionUser).organizationId;
    const body = await req.json();
    const { section, data, companyProfile } = body;

    // The `process` section is the one OrgAction `manage_process` gates
    // (spec-process section 1: Owner, Admin, People team; never Guests or
    // Agents). The People team (HR) may write it; every other section keeps
    // the admin-only gate below. ONE rule, lib/process-scope canManageProcess,
    // shared with rename-category and rename-folder.
    if (section === "process") {
      if (!canManageProcess(session)) {
        return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
      }
    } else if (!["COMPANY_ADMIN", "SUPER_ADMIN", "C_LEVEL"].includes(accessLevel)) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    // Get current org and settings
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
    });

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const currentSettings = (org.settings as SettingsBlob | null) || {};

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
        const updateData: { name?: string; domain?: string | null; settings?: SettingsBlob } = {};
        if (data.name) updateData.name = data.name;
        if (data.domain !== undefined) updateData.domain = data.domain;

        // Also store extended general settings in JSON
        const generalSettings: SettingsBlob = {};
        if (data.timezone !== undefined) generalSettings.timezone = data.timezone;
        if (data.currency !== undefined) generalSettings.currency = data.currency;
        if (data.fiscalYearStart !== undefined) generalSettings.fiscalYearStart = data.fiscalYearStart;
        if (data.language !== undefined) generalSettings.language = data.language;
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

      case "scoring": {
        // Editable Scoring & reviews config (weights, bands, cadences,
        // behavioral anchors). Validate the numeric invariants so a bad
        // payload can't silently corrupt the composite-score engine.
        const scoring: SettingsBlob = {};
        if (data.reviewFrequency !== undefined) scoring.reviewFrequency = data.reviewFrequency;
        if (data.scoreWeights !== undefined) {
          const v = validateScoreWeights(data.scoreWeights);
          if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
          scoring.scoreWeights = data.scoreWeights;
        }
        if (data.scoringBands !== undefined) {
          const v = validateScoringBands(data.scoringBands);
          if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
          scoring.scoringBands = data.scoringBands;
        }
        if (data.reviewCadences !== undefined) scoring.reviewCadences = data.reviewCadences;
        if (data.behavioralAnchors !== undefined) {
          if (!Array.isArray(data.behavioralAnchors) || data.behavioralAnchors.length !== 5) {
            return NextResponse.json({ error: "behavioralAnchors must be 5 labels" }, { status: 400 });
          }
          scoring.behavioralAnchors = data.behavioralAnchors;
        }
        await prisma.organization.update({
          where: { id: orgId },
          data: { settings: { ...currentSettings, ...scoring } },
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
              enabledModules: normalizeEnabledModules(data.enabledModules),
            },
          },
        });
        break;
      }

      case "access": {
        // The access toggles (access-model-spec section 8). A partial patch
        // is merged over the stored values; every key is validated by the
        // same zod schema the gates parse with, so a bad value is a 400
        // here rather than a silent default inside a gate. Today the one
        // surface that writes it is the Public links row on the Access
        // settings page (toggle 10), which the public SOP and doc links
        // and the share dialogs read.
        const partial = accessSettingsSchema.partial().strict().safeParse(data ?? {});
        if (!partial.success) {
          return NextResponse.json({ error: "Invalid access settings" }, { status: 400 });
        }
        const merged = { ...parseAccessSettings(currentSettings.access), ...partial.data };
        await prisma.organization.update({
          where: { id: orgId },
          data: { settings: { ...currentSettings, access: merged } },
        });
        break;
      }

      case "process": {
        // spec-process section 2 `/sops/manage` (Organize): the policy
        // category list, the contract folder list and the three
        // acknowledgement defaults. Strict zod, so a stray key is a 400
        // that names it rather than a silent strip; a partial patch is
        // merged over the seeded value.
        const partial = processSettingsPatchSchema.safeParse(data ?? {});
        if (!partial.success) {
          const issue = partial.error.issues[0];
          return NextResponse.json({ error: `Invalid process settings${issue ? `: ${issue.path.join(".") || "body"} ${issue.message}` : ""}` }, { status: 400 });
        }
        const merged = { ...parseProcessSettings(currentSettings.process).value, ...partial.data };
        await prisma.organization.update({
          where: { id: orgId },
          data: { settings: { ...currentSettings, process: merged } },
        });
        break;
      }

      default:
        return NextResponse.json({ error: "Invalid section" }, { status: 400 });
    }

    // Audit-log every org-settings change. The section name + a list
    // of changed keys is enough for SOC 2 / compliance review; we
    // don't store the full body to avoid bloating ActivityLog with
    // large JSON blobs. The process section is audited under the name
    // spec-process section 2 gives it.
    logAuditEvent({
      type: section === "process" ? "settings.updated.process" : `settings.update.${section}`,
      actorId: (session.user as SessionUser).id,
      organizationId: orgId,
      description: `Updated org settings: ${section}`,
      targetType: "Organization",
      targetId: orgId,
      metadata: { section, keys: data && typeof data === "object" ? Object.keys(data) : [] },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Settings PATCH error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
