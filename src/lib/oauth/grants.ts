// Grants: one person's consent for one AI app in one workspace
// (docs/plans/mcp-server.md Decisions 6, 10; 3.4 step 6; 3.9; 5.3).
//
// A LIVE GRANT is unrevoked, before its endsBy, and holds the account's
// tokenVersion. A grant stores the version it was given at, so every way an
// account's sessions end (Sign out everywhere, a password change or reset, a
// demotion's bump, a staff action) ends its apps too, at their next request
// (sessions_ended). The one exception is the ORDINARY log out: signOutBump
// moves the account and its matching grants together, so a plain log out in
// one browser keeps the person's apps connected (the accepted risk, H1).
//
// REVOKED, the row keeps its reason and who did it, its tokens are revoked
// with it, and one `mcp.app.revoked` audit row says so (actor or the system,
// actingForId the person, never a title or what the app read).
//
// LOCKS: 73_050 is the person (consent, the ordinary log out, the account
// erasure), 73_051 the workspace's AI app policy (shared here; the policy
// route takes it alone), 73_052 one OAuth client (a consent landing on it,
// and the sweep that deletes unused clients). Always in that order.
//
// Server-only. Kept free of the access engine: src/lib/auth.ts imports this.

import { randomBytes } from "node:crypto";
import type { Prisma } from "@/generated/prisma";
import { logActivity } from "@/lib/activity";
import { MCP_AUDIT_COPY, MCP_NOTICE_COPY } from "@/lib/mcp/mcp-copy";
import { appAllowed } from "@/lib/mcp/policy";
import { prisma } from "@/lib/prisma";
import { publishToUser } from "@/lib/realtime-bus";
import type { McpScope } from "./metadata";
import { hashSecret, newFamilyId, newSecret } from "./tokens";

export const PERSON_LOCK_CLASS = 73_050;
export const POLICY_LOCK_CLASS = 73_051;
export const CLIENT_LOCK_CLASS = 73_052;

/** The most live grants one person may hold, across workspaces (3.4 consent step 5). */
export const LIVE_GRANTS_MAX = 20;
export const CODE_TTL_MS = 5 * 60 * 1000;
const DAY_MS = 86_400_000;

export type RevokeReason =
  | "person"
  | "client_revoked"
  | "admin_off"
  | "app_not_allowed"
  | "left"
  | "deactivated"
  | "no_access"
  | "workspace_closed"
  | "sessions_ended"
  | "password_changed"
  | "signed_out_everyone"
  | "expired"
  | "reuse_detected"
  | "code_reuse"
  | "client_disabled";

export interface GrantRef {
  id: string;
  clientId: string;
  organizationId: string;
  userId: string;
  appName: string;
  redirectHost: string;
}

const REF_SELECT = { id: true, clientId: true, organizationId: true, userId: true, appName: true, redirectHost: true } as const;

/** Where an Inbox notice about an AI app links: My settings, Calendar & connections, the AI apps card. */
export const CONNECTED_APPS_HREF = "/account/connections#ai-apps";

/** The live-grant filter for one person (5.3), given the account's tokenVersion now. */
export function liveGrantWhere(userId: string, tokenVersion: number, now: Date): Prisma.OAuthGrantWhereInput {
  return { userId, revokedAt: null, endsBy: { gt: now }, tokenVersion };
}

// ── The ordinary log out ──

/**
 * The signOut event's bump (src/lib/auth.ts): the account's tokenVersion and
 * every unrevoked grant that held the version before it, together, under
 * the person's lock. A grant left behind by an earlier bump stays behind.
 */
export async function signOutBump(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PERSON_LOCK_CLASS}::int, hashtext(${userId}))`;
    const after = await tx.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } }, select: { tokenVersion: true } });
    await tx.oAuthGrant.updateMany({
      where: { userId, revokedAt: null, tokenVersion: after.tokenVersion - 1 },
      data: { tokenVersion: after.tokenVersion },
    });
  });
}

// ── Ending grants ──

async function auditRevoked(g: GrantRef, reason: RevokeReason, actorId: string | null): Promise<void> {
  await logActivity({
    type: "mcp.app.revoked",
    actorId,
    ...(actorId ? {} : { actorType: "system", actorLabel: "WorkwrK" }),
    actingForId: g.userId,
    organizationId: g.organizationId,
    description: MCP_AUDIT_COPY.revoked,
    targetType: "oauth_grant",
    targetId: g.id,
    metadata: { reason, grantId: g.id, clientId: g.clientId, redirectHost: g.redirectHost, appName: g.appName },
    severity: reason === "admin_off" ? "warning" : "info",
  });
}

/**
 * Revoke these grants, each by a swap on `revokedAt IS NULL` so only the
 * first revoker writes it and its audit row; then their tokens. Returns the
 * ones this call revoked.
 */
export async function revokeGrantRows(rows: readonly GrantRef[], reason: RevokeReason, actorId: string | null, now: Date = new Date()): Promise<GrantRef[]> {
  const done: GrantRef[] = [];
  for (const g of rows) {
    const r = await prisma.oAuthGrant.updateMany({
      where: { id: g.id, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason, revokedById: actorId },
    });
    if (r.count === 1) done.push(g);
  }
  if (done.length > 0) {
    await prisma.oAuthToken.updateMany({ where: { grantId: { in: done.map((g) => g.id) }, revokedAt: null }, data: { revokedAt: now } });
    for (const g of done) await auditRevoked(g, reason, actorId);
  }
  return done;
}

/** Every unrevoked grant matching `where` (the policy route's admin_off and app_not_allowed, step 2). */
export async function revokeWhere(where: Prisma.OAuthGrantWhereInput, reason: RevokeReason, actorId: string | null): Promise<number> {
  const rows = await prisma.oAuthGrant.findMany({ where: { ...where, revokedAt: null }, select: REF_SELECT });
  return (await revokeGrantRows(rows, reason, actorId)).length;
}

/** One grant. */
export async function revokeGrant(grantId: string, reason: RevokeReason, actorId: string | null): Promise<boolean> {
  return (await revokeWhere({ id: grantId }, reason, actorId)) === 1;
}

/** Every grant of one account, in every workspace (account erasure, Sign out everywhere, a password change). */
export async function revokeAllGrantsOf(userId: string, reason: RevokeReason, actorId: string | null): Promise<number> {
  return revokeWhere({ userId }, reason, actorId);
}

/** People leaving, deactivated, or made a Guest or an agent account in one workspace (leaver-hooks.ts). */
export async function revokeGrantsFor(organizationId: string, userIds: readonly string[], reason: "left" | "deactivated" | "no_access", actorId: string | null): Promise<number> {
  if (userIds.length === 0) return 0;
  return revokeWhere({ organizationId, userId: { in: [...userIds] } }, reason, actorId);
}

/** A workspace deleted, closed or suspended (leaver-hooks.ts). */
export async function revokeWorkspaceGrants(organizationId: string, actorId: string | null): Promise<number> {
  return revokeWhere({ organizationId }, "workspace_closed", actorId);
}

/** Every grant of a client (a disabled client, 3.8 step 4). */
export async function revokeClientGrants(clientId: string, reason: "client_disabled"): Promise<number> {
  return revokeWhere({ clientId }, reason, null);
}

// ── Notices ──

async function workspaceName(organizationId: string): Promise<string> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }).catch(() => null);
  return org?.name?.trim() || "your workspace";
}

async function notify(userId: string, title: string, message: string): Promise<void> {
  try {
    await prisma.notification.create({ data: { userId, type: "mcp_app", title, message, link: CONNECTED_APPS_HREF } });
    publishToUser(userId, { type: "notification" });
  } catch {
    console.warn("[oauth] notice not_written");
  }
}

/**
 * A code or refresh token used twice (3.5): the family and the grant end
 * (`code_reuse` or `reuse_detected`), with a critical audit row the person's
 * own security activity lists, and an Inbox notice.
 */
export async function reuseDetected(grant: GrantRef, kind: "code" | "refresh"): Promise<void> {
  const reason: RevokeReason = kind === "code" ? "code_reuse" : "reuse_detected";
  const revoked = await revokeGrantRows([grant], reason, null);
  // The family's tokens end even when the grant had already ended.
  await prisma.oAuthToken.updateMany({ where: { grantId: grant.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await logActivity({
    type: "mcp.app.reuse_detected",
    actorId: null,
    actorType: "system",
    actorLabel: "WorkwrK",
    actingForId: grant.userId,
    organizationId: grant.organizationId,
    description: MCP_AUDIT_COPY.reuse,
    targetType: "oauth_grant",
    targetId: grant.id,
    metadata: { kind, grantId: grant.id, clientId: grant.clientId, redirectHost: grant.redirectHost, appName: grant.appName },
    severity: "critical",
  });
  if (revoked.length > 0) await notify(grant.userId, MCP_NOTICE_COPY.reuseTitle, MCP_NOTICE_COPY.reuseMessage(grant.appName, await workspaceName(grant.organizationId)));
}

// ── Consent ──

export interface ConsentInput {
  userId: string;
  organizationId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scopes: McpScope[];
  appName: string;
  redirectHost: string;
  /** The tokenVersion the consenting session carries; the account must still hold it. */
  sessionTokenVersion: number;
  /** The workspace's absolute session life (Workspace settings > Security), in days. */
  sessionMaxDays: number;
  /**
   * The pending request this consent answers, taken in the same transaction
   * (guarded on its viewer and csrf hash), so the sweep, which keeps any
   * client with a request, can never delete the client between the take and
   * the grant.
   */
  take?: { requestId: string; viewerId: string; csrfHash: string | null };
  now?: Date;
}

export type ConsentResult =
  | { ok: true; code: string; grantId: string; again: boolean }
  | { ok: false; reason: "stale" | "too_many" | "unavailable" | "taken" };

/**
 * Allow (3.4 decision step 6): under the person's lock, the workspace
 * policy's (shared) and the client's, the client, the account's tokenVersion
 * and the switch and allow list re-read, the request taken, then the live
 * grant updated in place or made: its
 * scopes, label, redirect host, the account's tokenVersion, authorizedAt,
 * endsBy (now + sessionMaxDays) and a NEW family, the old family's tokens
 * revoked, and a code minted. The audit row and the Inbox notice follow the
 * commit.
 */
export async function grantConsent(input: ConsentInput): Promise<ConsentResult> {
  const now = input.now ?? new Date();
  const endsBy = new Date(now.getTime() + Math.max(1, input.sessionMaxDays) * DAY_MS);
  const result = await prisma.$transaction(async (tx): Promise<ConsentResult> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PERSON_LOCK_CLASS}::int, hashtext(${input.userId}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(${POLICY_LOCK_CLASS}::int, hashtext(${input.organizationId}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CLIENT_LOCK_CLASS}::int, hashtext(${input.clientId}))`;
    const client = await tx.oAuthClient.findUnique({ where: { id: input.clientId }, select: { disabledAt: true } });
    if (!client || client.disabledAt) return { ok: false, reason: "unavailable" };
    const account = await tx.user.findUnique({ where: { id: input.userId }, select: { tokenVersion: true, deletedAt: true, status: true } });
    if (!account || account.deletedAt || account.status === "INACTIVE" || account.tokenVersion !== input.sessionTokenVersion) return { ok: false, reason: "stale" };
    const policy = await tx.mcpPolicy.findUnique({ where: { organizationId: input.organizationId }, select: { enabled: true, allowedApps: true } });
    if (!policy?.enabled || !appAllowed(policy.allowedApps ?? [], input.redirectHost)) return { ok: false, reason: "unavailable" };
    if (input.take) {
      // Taken once (3.4 step 4): of two submits only one finds it. What follows may still refuse; the take stands.
      const taken = await tx.oAuthAuthorizationRequest.deleteMany({
        where: { id: input.take.requestId, viewerId: input.take.viewerId, csrfHash: input.take.csrfHash, expiresAt: { gt: now } },
      });
      if (taken.count !== 1) return { ok: false, reason: "taken" };
    }

    const existing = await tx.oAuthGrant.findFirst({
      where: { clientId: input.clientId, userId: input.userId, organizationId: input.organizationId, revokedAt: null },
      select: { id: true, familyId: true },
    });
    if (!existing) {
      const live = await tx.oAuthGrant.count({ where: liveGrantWhere(input.userId, account.tokenVersion, now) });
      if (live >= LIVE_GRANTS_MAX) return { ok: false, reason: "too_many" };
    }
    const familyId = newFamilyId();
    const fields = {
      scopes: [...input.scopes],
      appName: input.appName,
      redirectHost: input.redirectHost,
      familyId,
      tokenVersion: account.tokenVersion,
      authorizedAt: now,
      endsBy,
    };
    let grantId: string;
    if (existing) {
      await tx.oAuthGrant.update({ where: { id: existing.id }, data: fields });
      await tx.oAuthToken.updateMany({ where: { grantId: existing.id, familyId: existing.familyId, revokedAt: null }, data: { revokedAt: now } });
      grantId = existing.id;
    } else {
      const made = await tx.oAuthGrant.create({
        data: { id: `gr_${randomBytes(18).toString("base64url")}`, clientId: input.clientId, organizationId: input.organizationId, userId: input.userId, ...fields },
        select: { id: true },
      });
      grantId = made.id;
    }
    await tx.oAuthClient.update({ where: { id: input.clientId }, data: { lastUsedAt: now } });
    const code = newSecret("code");
    await tx.oAuthAuthorizationCode.create({
      data: {
        id: hashSecret(code),
        grantId,
        clientId: input.clientId,
        redirectUri: input.redirectUri,
        codeChallenge: input.codeChallenge,
        resource: input.resource,
        familyId,
        expiresAt: new Date(now.getTime() + CODE_TTL_MS),
        createdAt: now,
      },
    });
    return { ok: true, code, grantId, again: !!existing };
  });
  if (!result.ok) return result;

  const access = input.scopes.includes("mcp:write") ? "write" : "read";
  await logActivity({
    type: "mcp.app.connected",
    actorId: input.userId,
    actingForId: input.userId,
    organizationId: input.organizationId,
    description: result.again ? MCP_AUDIT_COPY.reconnected : MCP_AUDIT_COPY.connected,
    targetType: "oauth_grant",
    targetId: result.grantId,
    metadata: { grantId: result.grantId, clientId: input.clientId, redirectHost: input.redirectHost, appName: input.appName, access, again: result.again },
    severity: "warning",
  });
  await notify(input.userId, MCP_NOTICE_COPY.connectedTitle, MCP_NOTICE_COPY.connectedMessage(input.appName, await workspaceName(input.organizationId)));
  return result;
}
