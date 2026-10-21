// Who may connect an app where, and whether a connection still stands
// (docs/plans/mcp-server.md 3.4 consent step 4, 3.8 steps 3 to 10, 5.3).
//
// A WORKSPACE IS ELIGIBLE for a person and an app when it is ACTIVE or TRIAL,
// its switch is on, the app is on its allow list (or the list is empty), a
// teammate could act for the person there (resolveActingPerson: present,
// active, holds a level, not a Guest or an agent account, the AI app open),
// no hold applies (account-holds.ts, read from the database for THAT
// workspace, never from the session), and no Sign everyone out there came
// after the session's sign in. A hold in the session's own workspace sends
// the person to the hold page.
//
// A GRANT STANDS (3.8 steps 3 to 10) while: it is unrevoked and before its
// endsBy; its client is not disabled; the switch and the allow list still
// admit it; the workspace is ACTIVE or TRIAL; the account still holds the
// grant's tokenVersion; a teammate could still act for the person; no
// password change and no Sign everyone out came after the consent. Each
// failure names the reason the grant is revoked with. AI off and the holds
// only BLOCK (the token endpoint still answers; tools/call refuses, step 2).
//
// Server-only.

import { levelHeldIn } from "@/lib/access/acting-workspace";
import { orgRoleOfMembership } from "@/lib/access/org-role";
import type { ActingPerson } from "@/lib/agents/acting";
import { resolveActingPerson } from "@/lib/agents/acting";
import { accountHolds, heldBy } from "@/lib/auth/account-holds";
import { policyRefusal, readMcpPolicies, readMcpPolicy } from "@/lib/mcp/policy";
import { prisma } from "@/lib/prisma";
import { signInPolicyOf } from "@/lib/settings/org-policy";
import { liveGrantWhere, revokeClientGrants, revokeGrant, type RevokeReason } from "./grants";

const OPEN_STATUSES = new Set(["ACTIVE", "TRIAL"]);

export interface EligibleWorkspace {
  id: string;
  name: string;
  /** The workspace's absolute session life, the connection's cap. */
  sessionMaxDays: number;
}

export interface Eligibility {
  workspaces: EligibleWorkspace[];
  /** The person's other workspaces that cannot be chosen. */
  unavailable: number;
  /** A hold on the session's own workspace: the person goes to the hold page. */
  held: "mfa" | "password" | null;
  /** The session's own workspace signed everyone out after this session signed in: the session is ending. */
  ownEnded: boolean;
}

/** How many live grants the person holds now, in every workspace (the cap of 20). */
export async function liveGrantCount(userId: string, tokenVersion: number, now: Date = new Date()): Promise<number> {
  return prisma.oAuthGrant.count({ where: liveGrantWhere(userId, tokenVersion, now) });
}

/**
 * The workspaces this person may connect this app in, read fresh.
 * `authAt` is the session's sign-in time (ms), null when unknown.
 */
export async function mcpWorkspacesFor(input: {
  userId: string;
  sessionOrgId: string;
  authAt: number | null;
  redirectHost: string;
}): Promise<Eligibility> {
  const none: Eligibility = { workspaces: [], unavailable: 0, held: null, ownEnded: false };
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { organizationId: true, mfaEnabled: true, passwordChangedAt: true, deletedAt: true, status: true },
  });
  if (!user || user.deletedAt || user.status === "INACTIVE") return none;
  const memberships = await prisma.organizationMembership.findMany({ where: { userId: input.userId }, select: { organizationId: true } });
  const ids = [...new Set([user.organizationId, ...memberships.map((m) => m.organizationId)])];
  const orgs = await prisma.organization.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, status: true, settings: true } });
  const policies = await readMcpPolicies(ids);

  // The session's own workspace first, then by name.
  orgs.sort((a, b) => (a.id === input.sessionOrgId ? -1 : b.id === input.sessionOrgId ? 1 : a.name.localeCompare(b.name)));
  let held: Eligibility["held"] = null;
  let ownEnded = false;
  const workspaces: EligibleWorkspace[] = [];
  for (const org of orgs) {
    // The role held THERE, read fresh (never the anchored workspace's level elsewhere).
    const holds = accountHolds(user, orgRoleOfMembership(await levelHeldIn(input.userId, org.id)), org);
    const hold = heldBy(holds);
    const signedOut = holds.signedOutEveryoneAt !== null && (input.authAt === null || input.authAt < holds.signedOutEveryoneAt);
    if (org.id === input.sessionOrgId) {
      if (hold) held = hold;
      if (signedOut) ownEnded = true;
    }
    if (hold || signedOut) continue;
    if (!OPEN_STATUSES.has(org.status)) continue;
    if (policyRefusal(policies.get(org.id) ?? { enabled: false, allowedApps: [] }, input.redirectHost)) continue;
    const acting = await resolveActingPerson(org.id, input.userId);
    if (!acting.ok) continue;
    workspaces.push({ id: org.id, name: org.name, sessionMaxDays: holds.policy?.sessionMaxDays ?? signInPolicyOf(null).sessionMaxDays });
  }
  return { workspaces, unavailable: Math.max(0, orgs.length - workspaces.length), held, ownEnded };
}

// ── Whether a grant still stands ──

export interface GrantForStanding {
  id: string;
  clientId: string;
  organizationId: string;
  userId: string;
  appName: string;
  redirectHost: string;
  tokenVersion: number;
  authorizedAt: Date;
  endsBy: Date;
  revokedAt: Date | null;
}

export type Standing =
  | {
      ok: true;
      /** Null only when AI features are off for the person there (resolveActingPerson's ai_off). */
      person: ActingPerson | null;
      /** What blocks tools/call without ending the grant (3.8 steps 8 and 10). */
      blocked: "ai_off" | "mfa" | "password" | null;
      /** The workspace's absolute session life now, in days (the refresh recomputes endsBy with it). */
      sessionMaxDays: number;
    }
  | { ok: false; revoke: RevokeReason | null; clientWide?: boolean };

const ACTING_REVOKE = { gone: "left", inactive: "deactivated", guest: "no_access", agent_account: "no_access" } as const;

/** 3.8 steps 3 to 10 for one grant, reads only: the caller revokes (enforceStanding). */
export async function grantStanding(grant: GrantForStanding, client: { disabledAt: Date | null }, now: Date = new Date()): Promise<Standing> {
  if (grant.revokedAt) return { ok: false, revoke: null };
  if (now.getTime() >= grant.endsBy.getTime()) return { ok: false, revoke: "expired" };
  if (client.disabledAt) return { ok: false, revoke: "client_disabled", clientWide: true };
  const refusal = policyRefusal(await readMcpPolicy(grant.organizationId), grant.redirectHost);
  if (refusal) return { ok: false, revoke: refusal };
  const org = await prisma.organization.findUnique({ where: { id: grant.organizationId }, select: { status: true, settings: true } });
  if (!org || !OPEN_STATUSES.has(org.status)) return { ok: false, revoke: "workspace_closed" };
  const account = await prisma.user.findUnique({
    where: { id: grant.userId },
    select: { tokenVersion: true, deletedAt: true, status: true, mfaEnabled: true, passwordChangedAt: true },
  });
  if (!account || account.deletedAt) return { ok: false, revoke: "left" };
  if (account.tokenVersion !== grant.tokenVersion) return { ok: false, revoke: "sessions_ended" };
  const acting = await resolveActingPerson(grant.organizationId, grant.userId);
  if (!acting.ok && acting.reason !== "ai_off") return { ok: false, revoke: ACTING_REVOKE[acting.reason] };
  if (account.passwordChangedAt && account.passwordChangedAt.getTime() > grant.authorizedAt.getTime()) return { ok: false, revoke: "password_changed" };
  const role = acting.ok ? acting.person.orgRole : orgRoleOfMembership(await levelHeldIn(grant.userId, grant.organizationId));
  const holds = accountHolds(account, role, org, now);
  if (holds.signedOutEveryoneAt !== null && holds.signedOutEveryoneAt > grant.authorizedAt.getTime()) return { ok: false, revoke: "signed_out_everyone" };
  const hold = heldBy(holds);
  return {
    ok: true,
    person: acting.ok ? acting.person : null,
    blocked: !acting.ok ? "ai_off" : hold,
    sessionMaxDays: holds.policy?.sessionMaxDays ?? signInPolicyOf(null).sessionMaxDays,
  };
}

/** grantStanding, with the revocation it names carried out. */
export async function enforceStanding(grant: GrantForStanding, client: { id: string; disabledAt: Date | null }, now: Date = new Date()): Promise<Standing> {
  const s = await grantStanding(grant, client, now);
  if (!s.ok && s.revoke) {
    if (s.clientWide) await revokeClientGrants(client.id, "client_disabled");
    else await revokeGrant(grant.id, s.revoke, null);
  }
  return s;
}
