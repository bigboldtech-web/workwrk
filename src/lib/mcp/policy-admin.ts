// The AI apps switch and its allow list as Owners and Admins change them
// (docs/plans/mcp-server.md Decision 9, 3.9, 6.3).
//
// A CHANGE IS MADE UNDER THE WORKSPACE'S POLICY LOCK, ALONE:
// pg_advisory_xact_lock(73_051, hashtext(organizationId)). A consent holds
// the same lock shared while it re-reads the switch and the list and lands
// its grant (src/lib/oauth/grants.ts grantConsent), so a consent can never
// land between the switch going off and its connections being revoked, nor
// for an app the new list leaves out. Under the lock: the row is written,
// then the connections it ends are revoked, admin_off for the switch going
// off and app_not_allowed for an app no longer on the list, each with its
// audit row (revokeWhere). Turning on revokes nothing.
//
// What a change was and is come from the same transaction, so the route's
// audit row (apps.mcp_changed) says this change.
//
// The view counts only: live connections, the people they belong to, and
// today's calls and changes. Never who connected what, never what an app read.
//
// Server-only.

import { aiEnabledFromSettings } from "@/lib/ai/ai-enabled";
import { POLICY_LOCK_CLASS, revokeWhere } from "@/lib/oauth/grants";
import { prisma } from "@/lib/prisma";
import { ALLOWED_APPS_MAX, appAllowed, readMcpPolicy, type McpPolicyView } from "./policy";
import { utcDay } from "./usage";

const OPEN = new Set(["ACTIVE", "TRIAL"]);
const TX = { timeout: 60_000, maxWait: 10_000 } as const;

export interface McpPolicyAdminView {
  enabled: boolean;
  allowedApps: string[];
  allowedAppsMax: number;
  /** AI features are off here: the switch shows disabled, and nothing an app asks runs. */
  aiOff: boolean;
  /** The workspace is ACTIVE or TRIAL. */
  workspaceOpen: boolean;
  /** Live connections now, and how many people hold them. */
  connections: number;
  people: number;
  /** Today's (UTC) requests and changes, summed over the workspace. */
  today: { calls: number; changes: number };
}

/** The workspace's live grants: unrevoked, before endsBy, at the account's tokenVersion (5.3). */
export async function liveWorkspaceGrants(organizationId: string, now: Date = new Date()): Promise<Array<{ id: string; userId: string; redirectHost: string }>> {
  const rows = await prisma.oAuthGrant.findMany({
    where: { organizationId, revokedAt: null, endsBy: { gt: now } },
    select: { id: true, userId: true, redirectHost: true, tokenVersion: true },
  });
  if (rows.length === 0) return [];
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, tokenVersion: true } });
  const version = new Map(users.map((u) => [u.id, u.tokenVersion]));
  return rows.filter((r) => version.get(r.userId) === r.tokenVersion).map((r) => ({ id: r.id, userId: r.userId, redirectHost: r.redirectHost }));
}

/** What the Settings section shows (6.3). */
export async function mcpPolicyAdminView(organizationId: string, now: Date = new Date()): Promise<McpPolicyAdminView> {
  const [policy, org, live, usage] = await Promise.all([
    readMcpPolicy(organizationId),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { status: true, settings: true } }),
    liveWorkspaceGrants(organizationId, now),
    prisma.mcpUsageDay.findMany({ where: { organizationId, day: utcDay(now) }, select: { calls: true, writes: true } }),
  ]);
  return {
    enabled: policy.enabled,
    allowedApps: policy.allowedApps,
    allowedAppsMax: ALLOWED_APPS_MAX,
    aiOff: !aiEnabledFromSettings(org?.settings),
    workspaceOpen: !!org && OPEN.has(org.status),
    connections: live.length,
    people: new Set(live.map((g) => g.userId)).size,
    today: { calls: usage.reduce((n, u) => n + u.calls, 0), changes: usage.reduce((n, u) => n + u.writes, 0) },
  };
}

/** Why the switch may not go on here now, or null (6.3: 409 workspace_closed or ai_off). */
export async function turnOnRefusal(organizationId: string): Promise<"workspace_closed" | "ai_off" | null> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { status: true, settings: true } });
  if (!org || !OPEN.has(org.status)) return "workspace_closed";
  if (!aiEnabledFromSettings(org.settings)) return "ai_off";
  return null;
}

export interface PolicyChange {
  before: McpPolicyView;
  after: McpPolicyView;
  /** Connections this change ended. */
  revoked: number;
}

/** The switch, on or off; off revokes every connection in the workspace (admin_off). */
export async function setMcpEnabled(organizationId: string, enabled: boolean, actorId: string): Promise<PolicyChange> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${POLICY_LOCK_CLASS}::int, hashtext(${organizationId}))`;
    const row = await tx.mcpPolicy.findUnique({ where: { organizationId }, select: { enabled: true, allowedApps: true } });
    const before: McpPolicyView = { enabled: row?.enabled === true, allowedApps: [...(row?.allowedApps ?? [])] };
    await tx.mcpPolicy.upsert({
      where: { organizationId },
      create: { organizationId, enabled, allowedApps: [], updatedById: actorId },
      update: { enabled, updatedById: actorId, updatedAt: new Date() },
    });
    const revoked = enabled ? 0 : await revokeWhere({ organizationId }, "admin_off", actorId);
    return { before, after: { enabled, allowedApps: before.allowedApps }, revoked };
  }, TX);
}

/** The allow list (stored entries, already parsed); a connection whose app it leaves out is revoked (app_not_allowed). */
export async function setMcpAllowedApps(organizationId: string, allowedApps: readonly string[], actorId: string): Promise<PolicyChange> {
  const list = [...new Set(allowedApps)].slice(0, ALLOWED_APPS_MAX);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${POLICY_LOCK_CLASS}::int, hashtext(${organizationId}))`;
    const row = await tx.mcpPolicy.findUnique({ where: { organizationId }, select: { enabled: true, allowedApps: true } });
    const before: McpPolicyView = { enabled: row?.enabled === true, allowedApps: [...(row?.allowedApps ?? [])] };
    await tx.mcpPolicy.upsert({
      where: { organizationId },
      create: { organizationId, enabled: false, allowedApps: list, updatedById: actorId },
      update: { allowedApps: list, updatedById: actorId, updatedAt: new Date() },
    });
    const open = await tx.oAuthGrant.findMany({ where: { organizationId, revokedAt: null }, select: { id: true, redirectHost: true } });
    const out = open.filter((g) => !appAllowed(list, g.redirectHost)).map((g) => g.id);
    const revoked = out.length ? await revokeWhere({ organizationId, id: { in: out } }, "app_not_allowed", actorId) : 0;
    return { before, after: { enabled: before.enabled, allowedApps: list }, revoked };
  }, TX);
}
