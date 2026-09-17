// Building a Viewer, once per request.
//
// Spec 5.1: the Viewer comes from the JWT; the report tree, People team,
// department, teams and tags load lazily and memoise for the request (the
// WeakMap trick api-helpers.ts:103 already uses). Spec 2.5 / graft G2: keys,
// agents and crons never hold a role of their own, they act AS a person and
// resolve at min(that person's live level, cap).
//
// Step 0 has no User.orgRole column, so orgRole is derived from
// User.accessLevel through orgRoleOf(). Spec 10.1: `viewerFromSession` falls
// back to that derivation until step 8, which is also why sessions issued
// before step 0 keep working.
//
// Server-only: imports prisma and next-auth.

import { getServerSession } from "next-auth";
import { authOptions } from "../auth";
import { prisma } from "../prisma";
import { adminScopesOf, isAgentOf, isSeededPeopleTeam, orgRoleOf } from "./org-role";
import type { ActingAs, ObjectRole, Viewer, ViewerStatus } from "./types";

/** Per-request memo of the expensive Viewer fields. */
const MEMO = new WeakMap<object, Partial<Viewer>>();

interface SessionLike {
  user?: {
    id?: string;
    organizationId?: string;
    accessLevel?: string | null;
  };
}

/**
 * Build a Viewer from a session object. `isEarliestAdmin` cannot be answered
 * from the JWT, so a COMPANY_ADMIN resolves as Admin, which is the
 * conservative half of the spec 2.1 mapping (Admin is a strict subset of
 * Owner and the backfill's pre-flight report promotes the right person).
 */
export function viewerFromSessionObject(session: SessionLike | null | undefined): Viewer | null {
  const user = session?.user;
  if (!user?.id || !user.organizationId) return null;
  const accessLevel = user.accessLevel ?? null;
  const orgRole = orgRoleOf({ accessLevel });
  return {
    userId: user.id,
    organizationId: user.organizationId,
    orgRole,
    isAgent: isAgentOf(accessLevel),
    adminScopes: adminScopesOf(orgRole, null),
    peopleTeam: isSeededPeopleTeam(accessLevel),
  };
}

/** The server-side entry point every API route and page gate uses. */
export async function viewerFromSession(): Promise<Viewer | null> {
  const session = (await getServerSession(authOptions)) as SessionLike | null;
  const viewer = viewerFromSessionObject(session);
  if (!viewer) return null;
  // A token issued before step 0 carries no accessLevel claim, which
  // orgRoleOf reads as GUEST. hydrate() re-derives the role from the User row
  // in that one case (spec 10.1).
  return hydrate(viewer, session as unknown as object, {
    reDeriveOrgRole: !session?.user?.accessLevel,
  });
}

/**
 * Load the lazily-resolved Viewer fields and memoise them on the session
 * object for the rest of the request. The report tree is the manager chain
 * rule 9 reads; it excludes the viewer.
 */
export async function hydrate(
  viewer: Viewer,
  memoKey?: object,
  opts: { reDeriveOrgRole?: boolean } = {},
): Promise<Viewer> {
  const key = memoKey ?? viewer;
  const cached = MEMO.get(key as object);
  if (cached) return { ...viewer, ...cached };

  const [row, reports, people] = await Promise.all([
    prisma.user.findUnique({
      where: { id: viewer.userId },
      select: {
        status: true,
        deletedAt: true,
        departmentId: true,
        officeId: true,
        roleId: true,
        // Spec 10.1: "Sessions issued before step 0 lack orgRole ... token
        // refresh re-reads the user; viewerFromSession falls back to
        // orgRoleOf(accessLevel)". orgRoleOf(null) is GUEST (spec 2.1's
        // "(none) -> Guest" row), so a token whose accessLevel claim is
        // missing would otherwise resolve as a Guest: no EVERYONE grants, no
        // directory, no discoverability. Re-reading the level here is what
        // makes the promised fallback actually be the fallback.
        accessLevel: true,
      },
    }),
    reportTreeFor(viewer.userId),
    peopleTeamIdsFor(viewer.organizationId),
  ]);

  const tags = await prisma.tagAssignment.findMany({
    where: { entityType: "USER", entityId: viewer.userId },
    select: { tagId: true },
  });

  // A viewer built from a token with no accessLevel claim came in as GUEST.
  // The row is the authority, so re-derive from it; never the other way round,
  // which would let a stale token widen a demoted person's role.
  const storedLevel = row?.accessLevel ?? null;
  const reDerived =
    opts.reDeriveOrgRole && storedLevel ? orgRoleOf({ accessLevel: storedLevel }) : null;

  const extra: Partial<Viewer> = {
    status: (row?.status as ViewerStatus | undefined) ?? "ACTIVE",
    deleted: row?.deletedAt != null,
    departmentId: row?.departmentId ?? null,
    officeId: row?.officeId ?? null,
    roleId: row?.roleId ?? null,
    reportTree: reports,
    peopleTeam:
      viewer.peopleTeam || people.includes(viewer.userId) || isSeededPeopleTeam(storedLevel),
    teamIds: [], // no Team table until step 4
    tagIds: tags.map((t) => t.tagId),
    ...(reDerived
      ? {
          orgRole: reDerived,
          isAgent: isAgentOf(storedLevel),
          adminScopes: adminScopesOf(reDerived, null),
        }
      : {}),
  };
  MEMO.set(key as object, extra);
  return { ...viewer, ...extra };
}

/**
 * The manager chain, self excluded. Solid line plus DIRECT dotted reports, the
 * Workday convention getEffectiveReportTree already implements. The other live
 * walker (team.ts getTeamUserIds, solid only, no depth cap) disagrees with it
 * for dotted reports and for chains deeper than six; the engine picks this one
 * and the parity harness records the difference rather than hiding it.
 */
async function reportTreeFor(userId: string): Promise<Set<string>> {
  const { getEffectiveReportTree } = await import("../reporting-line");
  const ids = await getEffectiveReportTree(userId, { maxDepth: 6 });
  const out = new Set(ids);
  out.delete(userId);
  return out;
}

async function peopleTeamIdsFor(organizationId: string): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: { organizationId, accessLevel: "HR", deletedAt: null },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

// ── Non-human principals (spec 2.5) ───────────────────────────────

async function actingForViewer(userId: string, actingAs: ActingAs): Promise<Viewer | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      organizationId: true,
      accessLevel: true,
      status: true,
      deletedAt: true,
    },
  });
  if (!user) return null;
  const orgRole = orgRoleOf({ accessLevel: user.accessLevel });
  const base: Viewer = {
    userId: user.id,
    organizationId: user.organizationId,
    orgRole,
    isAgent: isAgentOf(user.accessLevel),
    adminScopes: adminScopesOf(orgRole, null),
    actingAs,
    status: user.status as ViewerStatus,
    deleted: user.deletedAt != null,
  };
  return hydrate(base);
}

/**
 * An API key acts for its creator. cap = EDIT for READ and WRITE scopes;
 * cap = FULL only when the key holds ADMIN scope AND the creator is currently
 * Owner or Admin, re-checked here at request time so a demotion downgrades the
 * key on its next call (example F).
 */
export async function viewerFromApiKey(apiKeyId: string): Promise<Viewer | null> {
  const key = await prisma.apiKey.findUnique({
    where: { id: apiKeyId },
    select: { id: true, createdById: true, scopes: true, revokedAt: true },
  });
  if (!key || key.revokedAt) return null;
  const creator = await prisma.user.findUnique({
    where: { id: key.createdById },
    select: { accessLevel: true },
  });
  const creatorRole = orgRoleOf({ accessLevel: creator?.accessLevel ?? null });
  const admin = creatorRole === "OWNER" || creatorRole === "ADMIN";
  const cap: ObjectRole = key.scopes.includes("ADMIN") && admin ? "FULL" : "EDIT";
  return actingForViewer(key.createdById, { type: "api-key", id: key.id, cap });
}

/**
 * An agent run acts for whoever triggered it, or for the agent's creator on an
 * autonomous run. cap = EDIT, always: agents never share, never export and
 * never read people data beyond the acting user.
 */
export async function viewerForAgentRun(runId: string): Promise<Viewer | null> {
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: { id: true, triggeredBy: true },
  });
  if (!run?.triggeredBy) return null;
  return actingForViewer(run.triggeredBy, { type: "agent", id: run.id, cap: "EDIT" });
}

/**
 * A cron acts for the object owner on per-object work, else for the org's
 * first Owner. cap = VIEW for read-only aggregation, EDIT for the one write
 * the cron exists for. No cron path holds FULL.
 */
export async function viewerForCron(
  organizationId: string,
  actingForId: string | null,
  cap: ObjectRole = "VIEW",
): Promise<Viewer | null> {
  const capped: ObjectRole = cap === "FULL" ? "EDIT" : cap;
  if (actingForId) {
    return actingForViewer(actingForId, { type: "cron", id: `cron:${organizationId}`, cap: capped });
  }
  const firstOwner = await prisma.user.findFirst({
    where: { organizationId, accessLevel: { in: ["SUPER_ADMIN", "COMPANY_ADMIN"] }, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!firstOwner) return null;
  return actingForViewer(firstOwner.id, { type: "cron", id: `cron:${organizationId}`, cap: capped });
}
