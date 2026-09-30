import { policyFromOrgSettings } from "@/lib/password-policy";
import { auditKeyWords } from "@/lib/audit-families";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeEnabledModules } from "@/lib/module-keys";
import { logAuditEvent } from "@/lib/activity";
import {
  getReviewCadences,
  getBehavioralAnchors,
  getScoringBands,
  validateScoreWeights,
  validateScoringBands,
} from "@/lib/review-cadence";
import { accessSettingsSchema, parseAccessSettings } from "@/lib/access/settings";
import { parseProcessSettings, processSettingsPatchSchema } from "@/lib/process-settings";
import { writeOrgSettingsKeys } from "@/lib/org-settings-write";
import { canManageProcess } from "@/lib/process-scope";
import { settingsDoorAllows } from "@/lib/access/settings-door";
import { scoringWriteAllowed, sessionScoringWriteAllowed } from "@/lib/access/settings-legacy";
import { delegateOn } from "@/lib/access/flags";
import { orgCurrencyFromSettings } from "@/lib/org/org-currency";
import {
  cultureSectionSchema,
  describeIssue,
  generalSectionSchema,
  parseSettingsEnvelope,
  consoleSectionSchema,
  scoringSectionSchema,
  securitySectionSchema,
  profileSectionSchema,
  localeSectionSchema,
  workSectionSchema,
  usersSectionSchema,
  retentionSectionSchema,
  dataSectionSchema,
} from "@/lib/settings/org-settings-sections";
import {
  dataSettingsOf,
  localeSettingsOf,
  normalizeDomain,
  retentionOf,
  scoreWeightsOf,
  signInPolicyOf,
  usersSettingsOf,
  workSettingsOf,
} from "@/lib/settings/org-policy";
import { freshMayManageOwnerPage, freshWorkspaceActor, sessionIsSettingsReader, sessionIsWorkspaceAdmin, sessionIsWorkspaceOwner, sessionMayManageOwnerPage } from "@/lib/access/workspace-admin";
import { nextConsole, readConsole } from "@/lib/setup/console-state";

type SessionUser = { id: string; organizationId: string };
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

    const body = {
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
        // ONE fallback for an unset currency, shared with GET /api/boot (and
        // through it Assets, the asset dialog and the marketing importer).
        // This line used to say "INR" while boot said USD, so Settings >
        // Locale showed rupees for an org whose register priced in dollars.
        currency: orgCurrencyFromSettings(settings),
        // A number, whatever was stored ("04-01" from the old Locale page
        // migrates on read, settings spec section 4).
        fiscalYearStart: localeSettingsOf(settings).fiscalYearStart,
        language: settings.language || "en",
        reviewFrequency: settings.reviewFrequency || "QUARTERLY",
        // The four weights the page edits and the review cycle reads; the
        // older five-key default is migrated on read (org-policy.ts).
        scoreWeights: scoreWeightsOf(settings),
        // The bands the review engine actually uses (getScoringBands: the
        // stored list, else DEFAULT_SCORING_BANDS), never a second default.
        scoringBands: getScoringBands(settings),
        reviewCadences: getReviewCadences(settings),
        behavioralAnchors: getBehavioralAnchors(settings),
        // `notifications` (org defaults) is retired: no UI and no reader
        // (settings-architecture open decision 6). The stored object stays in
        // Organization.settings untouched; it is only no longer served.
        security: settings.security || {
          minPasswordLength: 8,
          requireUppercase: true,
          requireNumbers: true,
          sessionTimeout: 30,
          twoFactorEnabled: false,
        },
        // The normalized Workspace settings values, defaults filled in
        // (src/lib/settings/org-policy.ts): the pages render these, never
        // the raw blob, so a missing key reads as today's behaviour.
        signIn: signInPolicyOf(settings),
        // The older "two-factor required" key, which nothing enforces
        // (security-policy.ts), so the Security page can say so.
        signInLegacy: { twoFactorEnabled: (settings.security as { twoFactorEnabled?: unknown } | undefined)?.twoFactorEnabled === true },
        locale: localeSettingsOf(settings, orgCurrencyFromSettings(settings)),
        work: workSettingsOf(settings),
        users: usersSettingsOf(settings, org.domain),
        retention: retentionOf(settings),
        data: dataSettingsOf(settings),
        // The ten access toggles (access-model-spec section 8), defaults
        // filled in, so a settings surface can render them without a
        // second parse.
        access: parseAccessSettings(settings.access),
        // The process taxonomies and acknowledgement defaults (Organize).
        // Seeding on first read happens in GET /api/settings/process.
        process: parseProcessSettings(settings.process).value,
        // The first-run console (step to resume at, Finish and Finish
        // later), with the old setupCompleted boolean read as completed.
        console: readConsole(settings),
      },
      usage: {
        users: org._count.users,
        sops: org._count.sops,
        aiQueries: org._count.aiQueries,
      },
    };

    // Below the manager tier (Member, Agent, Guest) the body narrows to what
    // a member's own surfaces read (settings-architecture 9.2): the org's
    // public fields, companyProfile, modules, locale, the scoring labels a
    // person's own review shows, the password rules summary (My settings >
    // Security) and usage (the workspace menu). The access toggles, the
    // process taxonomies' admin config, the org's business profile and the
    // stored session fields stay with the doors that edit them.
    // A reader the one door decision admits (the People team under the
    // engine gate) reads the full blob as the manager tier does today.
    if (
      !sessionIsSettingsReader(session) &&
      !(await settingsDoorAllows("access", session)) &&
      !(await settingsDoorAllows("scoring", session))
    ) {
      const { access: _access, process: _process, businessType: _b, industry: _i, teamSize: _t, security, signIn: _si, signInLegacy: _sl, users: _u, retention: _r, data: _d, work: _w, ...rest } = body.settings;
      void _access; void _process; void _b; void _i; void _t; void _si; void _sl; void _u; void _r; void _d; void _w;
      void security;
      // The rules as enforced (password-policy.ts, defaults filled in), not
      // the raw blob: after a partial Security save the raw blob can lack a
      // key the checklist then reads as off.
      const sec = policyFromOrgSettings(settings);
      return NextResponse.json({
        ...body,
        settings: {
          ...rest,
          security: { minPasswordLength: sec.minPasswordLength, requireUppercase: sec.requireUppercase, requireNumbers: sec.requireNumbers, requireSymbol: sec.requireSymbol },
        },
      });
    }
    // Who is asking, for the Owner-only rows (Danger zone, Security):
    // answered by the one rule in src/lib/access/workspace-admin.ts.
    const admin = sessionIsWorkspaceAdmin(session);
    const viewer = {
      isOwner: admin ? await sessionIsWorkspaceOwner(session) : false,
      mayManageOwnerPages: admin ? await sessionMayManageOwnerPage(session) : false,
      // The scoring section's own write rule (PATCH below), one function.
      canEditScoring: sessionScoringWriteAllowed(session, { admin, engineDoor: delegateOn("settings") }),
    };
    return NextResponse.json({ ...body, viewer });
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

    const orgId = (session.user as SessionUser).organizationId;
    const body = await req.json().catch(() => null);

    // One envelope, strict (src/lib/settings/org-settings-sections.ts): the
    // section decides the gate, and nothing else in the body can ride along
    // under it. Identity's legacy top-level `companyProfile` is the
    // `culture` section and takes the admin gate, which closes the
    // { section: "process", companyProfile } bypass.
    const envelope = parseSettingsEnvelope(body);
    if (envelope.kind === "error") {
      return NextResponse.json({ error: envelope.error, ...(envelope.retired ? { retired: true } : {}) }, { status: envelope.status });
    }
    const { section } = envelope;
    const data = envelope.data;

    // Every workspace setting is a write about the whole workspace: the
    // actor is re-read from the database, so an Admin demoted a moment ago
    // (or signed out elsewhere) is refused now, not in five minutes.
    const fresh = await freshWorkspaceActor(session);
    if (!fresh.ok) return NextResponse.json({ error: fresh.error, code: fresh.code }, { status: fresh.status });

    // The `process` section is the one OrgAction `manage_process` gates
    // (spec-process section 1: Owner, Admin, People team; never Guests or
    // Agents). The People team (HR) may write it; every other section keeps
    // the admin gate below. ONE rule, lib/process-scope canManageProcess,
    // shared with rename-category and rename-folder.
    if (section === "process") {
      if (!canManageProcess(session)) {
        return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
      }
    } else if (section === "scoring") {
      // Scoring is the one other section a non-admin could save from its
      // page yesterday (the manager-tier Scoring page, C_LEVEL writes), so it
      // keeps that reach while today's door table decides; once the engine's
      // door decides, the write follows the page to Owners and Admins
      // (scoringWriteAllowed, access-model-spec 10.1).
      if (!scoringWriteAllowed(fresh.level, { admin: fresh.admin, engineDoor: delegateOn("settings") })) {
        return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
      }
    } else if (section === "security" || section === "retention") {
      // Owner pages (settings spec 5.9 and 5.10: the sign-in policy, and the
      // purge windows that delete data). Every Admin until the Owner and
      // Admin split is approved (SETTINGS_OWNER_SPLIT, default OFF).
      // An Admin holding the Security scope edits the sign-in policy too
      // (spec 6.6); retention stays the Owner's.
      if (!freshMayManageOwnerPage(fresh, section === "security" ? "security" : undefined)) {
        return NextResponse.json({ error: "Only workspace Owners can change this" }, { status: 403 });
      }
    } else if (!fresh.admin) {
      // general, culture, security, access: Admin only (settings-architecture
      // 9.2; Owner for security once SETTINGS_OWNER_SPLIT is on). The pages
      // that write them (Identity, Locale, Access) were admin-gated already,
      // so C_LEVEL loses no reach it had from the product, only the raw API.
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
    // Every section below writes ONLY its own top-level keys of the shared
    // settings column, in one statement (src/lib/org-settings-write.ts), so a
    // save here never erases a key another writer changed a moment before
    // (a doc's sharing, branding, the access model). A section that merges
    // inside its key still reads that key from currentSettings.
    let changedKeys: string[] = [];

    switch (section) {
      case "general": {
        const parsed = generalSectionSchema.safeParse(data);
        if (!parsed.success) return NextResponse.json({ error: describeIssue(parsed.error, "general"), issues: parsed.error.issues }, { status: 400 });
        const d = parsed.data;
        if (d.scoreWeights !== undefined) {
          const v = validateScoreWeights(d.scoreWeights);
          if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
        }
        if (d.scoringBands !== undefined) {
          const v = validateScoringBands(d.scoringBands);
          if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
        }
        const updateData: { name?: string; domain?: string | null } = {};
        if (d.name !== undefined) updateData.name = d.name;
        if (d.domain !== undefined) updateData.domain = d.domain === "" ? null : d.domain;

        // Also store extended general settings in JSON
        const generalSettings: SettingsBlob = {};
        for (const k of ["timezone", "currency", "fiscalYearStart", "language", "reviewFrequency", "scoreWeights", "scoringBands", "businessType", "teamSize"] as const) {
          if (d[k] !== undefined) generalSettings[k] = k === "currency" ? String(d[k]).toUpperCase() : d[k];
        }

        await prisma.$transaction(async (tx) => {
          if (Object.keys(updateData).length > 0) {
            await tx.organization.update({ where: { id: orgId }, data: updateData });
          }
          if (Object.keys(generalSettings).length > 0) await writeOrgSettingsKeys(orgId, generalSettings, tx);
        });
        changedKeys = Object.keys(d);
        break;
      }

      case "culture": {
        // Merged over the stored profile, so a save that does not send a key
        // (Identity never sends `splash`) keeps it instead of erasing it.
        const parsed = cultureSectionSchema.safeParse(data);
        if (!parsed.success) return NextResponse.json({ error: describeIssue(parsed.error, "culture"), issues: parsed.error.issues }, { status: 400 });
        const current = currentSettings.companyProfile && typeof currentSettings.companyProfile === "object" ? currentSettings.companyProfile : {};
        await writeOrgSettingsKeys(orgId, { companyProfile: { ...current, ...parsed.data } });
        changedKeys = Object.keys(parsed.data);
        break;
      }

      case "profile": {
        // Identity & culture > Profile: ONE request for the whole tab.
        const parsed = profileSectionSchema.safeParse(data);
        if (!parsed.success) return NextResponse.json({ error: describeIssue(parsed.error, "profile"), issues: parsed.error.issues }, { status: 400 });
        const d = parsed.data;
        const orgPatch: { name?: string; domain?: string | null } = {};
        if (d.name !== undefined) orgPatch.name = d.name;
        if (d.domain !== undefined) orgPatch.domain = d.domain === null || d.domain === "" ? null : normalizeDomain(d.domain);
        const keys: SettingsBlob = {};
        for (const k of ["industry", "businessType", "teamSize"] as const) if (d[k] !== undefined) keys[k] = d[k];
        // The AI prompt block reads companyProfile.industry before
        // settings.industry (api/kras/ai-generate), so both move together.
        if (d.industry !== undefined) {
          const cp = currentSettings.companyProfile && typeof currentSettings.companyProfile === "object" ? currentSettings.companyProfile : {};
          keys.companyProfile = { ...cp, industry: d.industry };
        }
        await prisma.$transaction(async (tx) => {
          if (Object.keys(orgPatch).length > 0) await tx.organization.update({ where: { id: orgId }, data: orgPatch });
          if (Object.keys(keys).length > 0) await writeOrgSettingsKeys(orgId, keys, tx);
        });
        changedKeys = Object.keys(d);
        break;
      }

      case "locale": {
        // Locale & work week. The fiscal month is written as a NUMBER; the
        // "MM-01" string writer is gone and old values migrate on read.
        const parsed = localeSectionSchema.safeParse(data);
        if (!parsed.success) return NextResponse.json({ error: describeIssue(parsed.error, "locale"), issues: parsed.error.issues }, { status: 400 });
        const d = parsed.data;
        const keys: SettingsBlob = {};
        if (d.timezone !== undefined) keys.timezone = d.timezone;
        if (d.currency !== undefined) keys.currency = d.currency.toUpperCase();
        if (d.fiscalYearStart !== undefined) keys.fiscalYearStart = d.fiscalYearStart;
        if (d.language !== undefined) keys.language = d.language;
        if (d.weekStart !== undefined || d.dateFormat !== undefined || d.timeFormat !== undefined) {
          const cur = currentSettings.locale && typeof currentSettings.locale === "object" ? currentSettings.locale : {};
          keys.locale = {
            ...cur,
            ...(d.weekStart !== undefined ? { weekStart: d.weekStart } : {}),
            ...(d.dateFormat !== undefined ? { dateFormat: d.dateFormat } : {}),
            ...(d.timeFormat !== undefined ? { timeFormat: d.timeFormat } : {}),
          };
        }
        if (Object.keys(keys).length > 0) await writeOrgSettingsKeys(orgId, keys);
        changedKeys = Object.keys(d);
        break;
      }

      case "work":
      case "users":
      case "retention":
      case "data": {
        // Merged into their own top-level key, so a partial save keeps the
        // rest of the key (Invite rules sends its five fields; Apps sends
        // only the automations pause).
        const schema = { work: workSectionSchema, users: usersSectionSchema, retention: retentionSectionSchema, data: dataSectionSchema }[section];
        const parsed = schema.safeParse(data ?? {});
        if (!parsed.success) return NextResponse.json({ error: describeIssue(parsed.error, section), issues: parsed.error.issues }, { status: 400 });
        const d = parsed.data as SettingsBlob;
        if (section === "users" && Array.isArray(d.allowedDomains)) {
          d.allowedDomains = [...new Set((d.allowedDomains as string[]).map((x) => normalizeDomain(x)).filter(Boolean))];
        }
        const cur = currentSettings[section] && typeof currentSettings[section] === "object" ? currentSettings[section] : {};
        await writeOrgSettingsKeys(orgId, { [section]: { ...cur, ...d } });
        changedKeys = Object.keys(d);
        break;
      }

      case "scoring": {
        // Editable Scoring & reviews config (weights, bands, cadences,
        // behavioral anchors). Validate the numeric invariants so a bad
        // payload can't silently corrupt the composite-score engine.
        const parsed = scoringSectionSchema.safeParse(data);
        if (!parsed.success) return NextResponse.json({ error: describeIssue(parsed.error, "scoring"), issues: parsed.error.issues }, { status: 400 });
        const d = parsed.data;
        const scoring: SettingsBlob = {};
        if (d.reviewFrequency !== undefined) scoring.reviewFrequency = d.reviewFrequency;
        if (d.scoreWeights !== undefined) {
          const v = validateScoreWeights(d.scoreWeights);
          if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
          // Merged over the stored weights: the monthly performance score
          // (services/performanceScoreService.ts) still reads the older
          // manager and self keys, so a save here never deletes them.
          const prior = currentSettings.scoreWeights && typeof currentSettings.scoreWeights === "object" ? (currentSettings.scoreWeights as Record<string, unknown>) : {};
          scoring.scoreWeights = { ...prior, ...d.scoreWeights };
        }
        if (d.scoringBands !== undefined) {
          const v = validateScoringBands(d.scoringBands);
          if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
          scoring.scoringBands = d.scoringBands;
        }
        if (d.reviewCadences !== undefined) scoring.reviewCadences = d.reviewCadences;
        if (d.behavioralAnchors !== undefined) scoring.behavioralAnchors = d.behavioralAnchors;
        await writeOrgSettingsKeys(orgId, scoring);
        changedKeys = Object.keys(d);
        break;
      }

      case "security": {
        // Merged over the stored policy (a partial write keeps the rest).
        const parsed = securitySectionSchema.safeParse(data);
        if (!parsed.success) return NextResponse.json({ error: describeIssue(parsed.error, "security"), issues: parsed.error.issues }, { status: 400 });
        const current = currentSettings.security && typeof currentSettings.security === "object" ? currentSettings.security : {};
        const next = { ...current, ...parsed.data };
        await writeOrgSettingsKeys(orgId, { security: next });
        changedKeys = Object.keys(parsed.data);
        // The sign-in policy is the one section whose every change is a
        // security event (settings spec 5.12): old and new values, so the
        // Audit log drawer can show exactly what moved.
        const before = signInPolicyOf({ security: current });
        const after = signInPolicyOf({ security: next });
        const moved = (Object.keys(after) as (keyof typeof after)[]).filter((k) => before[k] !== after[k]);
        if (moved.length > 0) {
          logAuditEvent({
            type: "security.policy.updated",
            actorId: (session.user as SessionUser).id,
            organizationId: orgId,
            description: `Changed the sign-in policy: ${moved.map((k) => auditKeyWords(k).toLowerCase()).join(", ")}`,
            targetType: "Organization",
            targetId: orgId,
            severity: "warning",
            oldValue: Object.fromEntries(moved.map((k) => [k, before[k]])),
            newValue: Object.fromEntries(moved.map((k) => [k, after[k]])),
            metadata: { keys: moved },
          });
        }
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
          return NextResponse.json({ error: describeIssue(partial.error, "access"), issues: partial.error.issues }, { status: 400 });
        }
        // Merged over the STORED keys only, never over the filled-in
        // defaults: saving one toggle must not quietly persist the other
        // nine at their defaults (a later read flip would then widen an org
        // nobody chose to widen). Readers fill defaults with
        // parseAccessSettings, so today's behaviour is unchanged.
        const stored = currentSettings.access && typeof currentSettings.access === "object" && !Array.isArray(currentSettings.access) ? currentSettings.access : {};
        const merged = { ...stored, ...partial.data };
        await writeOrgSettingsKeys(orgId, { access: merged });
        changedKeys = Object.keys(partial.data);
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
        await writeOrgSettingsKeys(orgId, { process: merged });
        changedKeys = Object.keys(partial.data);
        break;
      }

      case "console": {
        // The first-run console (spec-account-auth `/onboard`): the step to
        // resume at, and Finish / Finish later. Admin only, like every
        // section but process and scoring. The server stamps the dates.
        const parsed = consoleSectionSchema.safeParse(data ?? {});
        if (!parsed.success) return NextResponse.json({ error: describeIssue(parsed.error, "console"), issues: parsed.error.issues }, { status: 400 });
        const next = nextConsole(currentSettings.console, parsed.data);
        await writeOrgSettingsKeys(orgId, { console: next.console, ...(next.setupCompleted ? { setupCompleted: true } : {}) });
        changedKeys = Object.keys(parsed.data);
        break;
      }

      default:
        return NextResponse.json({ error: "Invalid section" }, { status: 400 });
    }

    // Audit-log every org-settings change: the section name plus the list
    // of changed keys is enough for SOC 2 / compliance review; the full body
    // is not stored, so ActivityLog does not bloat with large JSON blobs.
    // One naming scheme, settings.updated.{section} (settings-architecture
    // 9.1); the process section already used it.
    logAuditEvent({
      type: `settings.updated.${section}`,
      actorId: (session.user as SessionUser).id,
      organizationId: orgId,
      description: `Updated org settings: ${section}`,
      targetType: "Organization",
      targetId: orgId,
      metadata: { section, keys: changedKeys },
      collapseWithinMs: 60_000,
    });

    return NextResponse.json({ success: true, ok: true });
  } catch (error) {
    console.error("Settings PATCH error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
