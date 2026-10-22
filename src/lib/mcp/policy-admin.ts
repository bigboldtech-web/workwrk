// The AI apps switch and its allow list as Owners and Admins change them
// (docs/plans/mcp-server.md Decision 9, 3.9, 6.3).
//
// A CHANGE IS MADE UNDER THE WORKSPACE'S POLICY LOCK, ALONE:
// pg_advisory_xact_lock(73_051, hashtext(organizationId)). A consent holds
// the same lock shared while it re-reads the switch and the list and lands
// its grant (src/lib/oauth/grants.ts grantConsent), so a consent can never
// land between the switch going off and its connections being revoked, nor
// for an app the new list leaves out. Under the lock, on the one
// transaction: the row is written, then the connections it ends are revoked
// (admin_off for the switch going off, app_not_allowed for an app no longer
// on the list); their audit rows follow the commit. Turning on revokes
// nothing, and a request for what already is writes and revokes nothing.
//
// What a change was and is come from the same transaction, so the route's
// audit row (apps.mcp_changed) says this change. A change to the allowed
// apps is one app added or taken away, worked out under the lock from the
// list as it is then (changeMcpAllowedApp, review of step 4, L2).
//
// The view counts only: live connections, the people they belong to, and
// today's requests and things made or changed (McpUsageDay calls and
// writes, where a task and each of its subtasks count one each). Never who
// connected what, never what an app read.
//
// Server-only.

import { aiEnabledFromSettings } from "@/lib/ai/ai-enabled";
import type { Prisma } from "@/generated/prisma";
import { POLICY_LOCK_CLASS, auditRevocations, revokeWhereOn, type GrantRef, type RevokeReason } from "@/lib/oauth/grants";
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
  /** Today's (UTC) requests (calls) and things made or changed (changes: McpUsageDay.writes, each subtask one), summed over the workspace. */
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
  /** False when the request asked for what already was: nothing was written and nothing revoked. */
  changed: boolean;
  /** Connections this change ended. */
  revoked: number;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * One change under the workspace's policy lock, alone: read the row, and
 * when the request asks for what already is, write nothing and revoke
 * nothing; else write it and revoke on the same transaction what it ends.
 * The revocations' audit rows follow the commit, so a change that rolled
 * back leaves none.
 */
async function changePolicy(
  organizationId: string,
  actorId: string,
  next: (before: McpPolicyView) => McpPolicyView,
  ends: (tx: Prisma.TransactionClient, after: McpPolicyView, now: Date) => Promise<{ done: GrantRef[]; reason: RevokeReason } | null>,
): Promise<PolicyChange> {
  const now = new Date();
  const out = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${POLICY_LOCK_CLASS}::int, hashtext(${organizationId}))`;
    const row = await tx.mcpPolicy.findUnique({ where: { organizationId }, select: { enabled: true, allowedApps: true } });
    const before: McpPolicyView = { enabled: row?.enabled === true, allowedApps: [...(row?.allowedApps ?? [])] };
    const after = next(before);
    if (before.enabled === after.enabled && sameList(before.allowedApps, after.allowedApps)) {
      return { before, after, changed: false, ended: null };
    }
    await tx.mcpPolicy.upsert({
      where: { organizationId },
      create: { organizationId, enabled: after.enabled, allowedApps: after.allowedApps, updatedById: actorId },
      update: { enabled: after.enabled, allowedApps: after.allowedApps, updatedById: actorId, updatedAt: now },
    });
    return { before, after, changed: true, ended: await ends(tx, after, now) };
  }, TX);
  if (out.ended) await auditRevocations(out.ended.done, out.ended.reason, actorId);
  return { before: out.before, after: out.after, changed: out.changed, revoked: out.ended?.done.length ?? 0 };
}

/** The switch, on or off; off revokes every connection in the workspace (admin_off). */
export async function setMcpEnabled(organizationId: string, enabled: boolean, actorId: string): Promise<PolicyChange> {
  return changePolicy(
    organizationId,
    actorId,
    (before) => ({ enabled, allowedApps: before.allowedApps }),
    async (tx, _after, now) => (enabled ? null : { done: await revokeWhereOn(tx, { organizationId }, "admin_off", actorId, now), reason: "admin_off" }),
  );
}

/**
 * One app added to the allow list or taken from it (a stored entry, already
 * parsed), worked out from the list as it is under the lock, never from a
 * list a page read earlier (review of step 4, L2), so two Admins at once
 * never lose each other's change, and a stale list never disconnects an app
 * another Admin just allowed. A connection whose app the new list leaves
 * out is revoked (app_not_allowed). Adding to a full list changes nothing
 * and answers tooMany; adding what is there, or taking what is not, changes
 * nothing.
 */
export async function changeMcpAllowedApp(
  organizationId: string,
  change: { add: string } | { remove: string },
  actorId: string,
): Promise<PolicyChange & { tooMany?: true }> {
  const full = { seen: false };
  const out = await changePolicy(
    organizationId,
    actorId,
    (before) => {
      if ("remove" in change) return { enabled: before.enabled, allowedApps: before.allowedApps.filter((app) => app !== change.remove) };
      if (before.allowedApps.includes(change.add)) return before;
      if (before.allowedApps.length >= ALLOWED_APPS_MAX) {
        full.seen = true;
        return before;
      }
      return { enabled: before.enabled, allowedApps: [...before.allowedApps, change.add] };
    },
    async (tx, after, now) => {
      const open = await tx.oAuthGrant.findMany({ where: { organizationId, revokedAt: null }, select: { id: true, redirectHost: true } });
      const ended = open.filter((g) => !appAllowed(after.allowedApps, g.redirectHost)).map((g) => g.id);
      return { done: ended.length ? await revokeWhereOn(tx, { organizationId, id: { in: ended } }, "app_not_allowed", actorId, now) : [], reason: "app_not_allowed" };
    },
  );
  return full.seen ? { ...out, tooMany: true } : out;
}
