import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sessionIsWorkspaceAdmin, sessionMayManageOwnerPage } from "@/lib/access/workspace-admin";
import { parseAccessSettings } from "@/lib/access/settings";
import { MODULE_SLUGS } from "@/lib/modules";
import { getReviewCadences } from "@/lib/review-cadence";
import { PLAN_LIMITS } from "@/lib/plan-limits-data";
import {
  MFA_AUDIENCE_LABELS,
  MONTH_NAMES,
  localeSettingsOf,
  retentionOf,
  scoreWeightsOf,
  signInPolicyOf,
  weightsTotal,
} from "@/lib/settings/org-policy";
import { orgCurrencyFromSettings } from "@/lib/org/org-currency";
import { readConsole } from "@/lib/setup/console-state";

// GET /api/settings/overview: every Overview card's two live values in ONE
// round trip (spec-settings-workspace `/settings` Data: "fourteen separate
// fetches is the thing to avoid"). Owner and Admin only, like the page.
// Every value is counted or read, never invented; a value the product does
// not hold says so in words.

const NEW_SPACE_LABELS: Record<string, string> = {
  everyone_edit: "open, Can edit",
  everyone_view: "open, Can view",
  private: "private",
};
const GUEST_INVITE_LABELS: Record<string, string> = {
  full_access: "anyone with Full access",
  admins: "Admins only",
  nobody: "nobody",
};

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function relative(d: Date | null): string {
  if (!d) return "never";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "a month ago" : `${months} months ago`;
}

export async function GET() {
  try {
    return await overview();
  } catch (err) {
    console.error("[settings/overview] failed:", err);
    return NextResponse.json(
      { error: "Couldn't load the overview", ...(process.env.NODE_ENV !== "production" ? { detail: String(err) } : {}) },
      { status: 500 },
    );
  }
}

async function overview() {
  const session = await getServerSession(authOptions);
  const su = session?.user as { id?: string; organizationId?: string } | undefined;
  if (!su?.id || !su.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!sessionIsWorkspaceAdmin(session)) return NextResponse.json({ error: "no_access", page: "overview" }, { status: 403 });
  const orgId = su.organizationId;

  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [org, pref, members, pending, departments, titles, offices, itemTypes, tags, modulesOn, keys, hooks, events7, lastExport] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, plan: true, status: true, logo: true, settings: true } }),
    prisma.orgPreference.findUnique({ where: { organizationId: orgId }, select: { sidebarDefault: true } }),
    prisma.user.count({ where: { organizationId: orgId, deletedAt: null, status: { not: "INACTIVE" } } }),
    prisma.invitation.count({ where: { organizationId: orgId, accepted: false, expiresAt: { gt: new Date() } } }),
    prisma.department.count({ where: { organizationId: orgId } }),
    prisma.role.count({ where: { organizationId: orgId } }),
    prisma.office.count({ where: { organizationId: orgId } }),
    prisma.itemType.count({ where: { organizationId: orgId } }),
    prisma.tag.count({ where: { organizationId: orgId, archived: false } }),
    prisma.productInstallation.count({ where: { organizationId: orgId, status: "ACTIVE", product: { slug: { in: [...MODULE_SLUGS] } } } }),
    prisma.apiKey.count({ where: { organizationId: orgId, revokedAt: null } }),
    prisma.webhookSubscription.count({ where: { organizationId: orgId } }),
    prisma.activityLog.count({ where: { organizationId: orgId, createdAt: { gte: weekAgo } } }),
    prisma.activityLog.findFirst({ where: { organizationId: orgId, type: "data.exported" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });

  const settings = (org.settings ?? {}) as Record<string, unknown>;
  const profile = (settings.companyProfile ?? {}) as { mission?: string; values?: unknown[] };
  const values = Array.isArray(profile.values) ? profile.values.length : 0;
  const locale = localeSettingsOf(settings, orgCurrencyFromSettings(settings));
  const access = parseAccessSettings(settings.access);
  const signIn = signInPolicyOf(settings);
  const retention = retentionOf(settings);
  const weights = scoreWeightsOf(settings);
  const cadences = getReviewCadences(settings);
  const onCadences = (Object.keys(cadences) as (keyof typeof cadences)[]).filter((k) => cadences[k].enabled);
  const apps = ((pref?.sidebarDefault ?? {}) as { apps?: { hidden?: unknown[] } }).apps;
  const hidden = Array.isArray(apps?.hidden) ? apps!.hidden!.length : 0;
  const seats = PLAN_LIMITS[String(org.plan)]?.users ?? null;
  const ownerOk = await sessionMayManageOwnerPage(session);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  const cards: Record<string, [string, string]> = {
    identity: [plural(values, "core value"), profile.mission?.trim() ? "Mission set" : "No mission yet"],
    locale: [locale.timezone, `${locale.currency} · fiscal year starts ${MONTH_NAMES[locale.fiscalYearStart - 1]}`],
    apps: [`${modulesOn} of ${MODULE_SLUGS.length} modules on`, plural(hidden, "app") + " hidden"],
    members: [plural(members, "member"), plural(pending, "pending invite")],
    structure: [plural(departments, "department"), `${plural(titles, "job title")} · ${plural(offices, "office")}`],
    access: [`New Spaces: ${NEW_SPACE_LABELS[access.newSpaceDefault] ?? access.newSpaceDefault}`, `Guest invites: ${GUEST_INVITE_LABELS[access.whoCanInviteGuests] ?? access.whoCanInviteGuests}`],
    tasks: [plural(itemTypes, "task type"), plural(tags, "tag")],
    scoring: [onCadences.length ? onCadences.map(cap).join(", ") : "No review cadence on", `Weights sum to ${weightsTotal(weights)}`],
    security: [`Two-factor: ${MFA_AUDIENCE_LABELS[signIn.mfaRequired]}`, `Idle timeout ${signIn.sessionIdleMinutes} minutes`],
    data: [`Trash kept ${retention.trashDays} days`, `Last export ${relative(lastExport?.createdAt ?? null)}`],
    audit: [plural(events7, "event") + " in the last 7 days", retention.auditDays ? `Kept ${retention.auditDays} days` : "Kept forever"],
    api: [plural(keys, "active key"), plural(hooks, "webhook")],
    billing: [`${cap(String(org.plan).toLowerCase())} · ${String(org.status).toLowerCase()}`, seats && seats < 99999 ? `${members} of ${seats} seats` : `${plural(members, "seat")} in use`],
  };
  // An Owner-only page an Admin cannot open (only with the split on).
  const ownerOnly = ownerOk ? [] : ["security", "api", "billing"];

  return NextResponse.json(
    {
      org: { name: org.name, plan: String(org.plan), status: String(org.status) },
      members,
      pendingInvites: pending,
      cards,
      ownerOnly,
      setup: {
        console: readConsole(settings),
        consoleRaw: settings.console ?? null,
        hasLogoOrMission: !!org.logo || !!profile.mission?.trim() || values > 0,
        activeUsers: members,
        activeModules: modulesOn,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
