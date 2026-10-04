// The one dialog on a team (batch 7; access-model-spec 3.3: "members VIEW
// the Team page; lead FULL; Admin FULL"), over TeamMember and its lead flag,
// the rows Settings > Members > Teams reads. Served only while
// ACCESS_V2_TABLES is on (common.ts).
//
//   roles       Lead (FULL), Member (VIEW)
//   who sees    whoever opens Members (the Teams tab's readers) and the
//               team's own people
//   who changes Owners and Admins, read fresh from the database as the
//               team routes read them; and the team's leads who can open
//               Settings > Members (the dialog's only door), who add and
//               remove its members. Only Owners and Admins make someone a
//               lead or take it away: a lead never hands out what they hold,
//               and never changes another lead. An Agent lead changes nothing
//   what a team a named group: being on it opens nothing else (no grant
//   opens        names a team yet), and the dialog says so
//   writes      one row at a time in a transaction that locks the team row,
//               with the role the dialog showed checked (409 when it moved),
//               and an access activity row

import { prisma } from "@/lib/prisma";
import { freshWorkspaceActor } from "../workspace-admin";
import { settingsDoorAllows } from "../settings-door";
import { legacySettingsAllows } from "../settings-legacy";
import { settingsGateMode } from "../settings-gate-engine";
import { accessV2Resolver, settingsGateLogOnly } from "../flags";
import { GrantError } from "../grants";
import {
  ACCESS_NODE_NOUN, ROLES_BY_KIND,
  type AccessDirectEntry, type AccessPanel, type GrantChange, type GrantWriteBody, type GrantWriteResult, type PanelRole,
} from "../access-panel";
import {
  NO_GENERAL, USER_SELECT, answerRequests, notifyObjectGrantee, objectActivity, orgAdminCount, orgNameOf, personOf, rank,
  targetInOrg, type ObjectShareCtx, type Tx,
} from "./common";

const KIND = "team" as const;

const HREF = "/settings/members?tab=teams";

const roleOfRow = (row: { lead: boolean } | null | undefined): PanelRole | null => (row ? (row.lead ? "FULL" : "VIEW") : null);

type TeamRow = { id: string; name: string };

async function loadTeam(db: Tx | typeof prisma, organizationId: string, id: string): Promise<TeamRow | null> {
  return db.team.findFirst({ where: { id, organizationId, archivedAt: null }, select: { id: true, name: true } });
}

/** An Owner or Admin by the session AND the database (a demotion lands now), as the team routes decide. */
async function freshAdmin(ctx: ObjectShareCtx): Promise<boolean> {
  if (!ctx.orgAdmin) return false;
  const fresh = await freshWorkspaceActor(ctx.session);
  return fresh.ok && fresh.admin;
}

/**
 * Opens Settings > Members, where the team dialog's only door is (the
 * manager tier today). A lead who cannot is never told they change members.
 */
async function opensMembers(session: ObjectShareCtx["session"]): Promise<boolean> {
  return settingsDoorAllows("members", session).catch(() => false);
}

/**
 * ANOTHER person's door to Settings > Members, from their own facts.
 * settingsDoorAllows takes its engine half from the request's session, so it
 * would answer for the viewer: engine mode asks the engine as them; every
 * other mode reads their level against today's table. Never logs a
 * disagreement (that log is about the person asking).
 */
async function membersDoorFor(organizationId: string, userId: string, accessLevel: string): Promise<boolean> {
  try {
    if (settingsGateMode({ resolver: accessV2Resolver(), logOnly: settingsGateLogOnly() }) === "engine") {
      const { viewerForUser } = await import("../viewer");
      const { can } = await import("../index");
      const viewer = await viewerForUser(organizationId, userId);
      return !!viewer && (await can(viewer, "view", { type: "settings", page: "members" })).allowed;
    }
    return legacySettingsAllows("members", accessLevel);
  } catch {
    return false;
  }
}

/** What the viewer may give: an Admin anything; a lead who can open Members, Member only; anyone else nothing. */
function maxGrantOf(admin: boolean, mine: PanelRole | null, isAgent: boolean, door: boolean): PanelRole | null {
  if (isAgent) return null;
  if (admin) return "FULL";
  return mine === "FULL" && door ? "VIEW" : null;
}

const AGENT_LEAD_NOTE = "An Agent lead never adds or takes off members.";
const DOORLESS_LEAD_NOTE = "They can't open Members, so they don't change who is on it.";

export async function teamPanel(ctx: ObjectShareCtx, id: string): Promise<AccessPanel | null> {
  const team = await loadTeam(prisma, ctx.organizationId, id);
  if (!team) return null;
  const rows = await prisma.teamMember.findMany({
    where: { teamId: id },
    select: { userId: true, lead: true, user: { select: { ...USER_SELECT, organizationId: true, accessLevel: true } } },
    orderBy: { createdAt: "asc" },
  });
  const live = rows.filter((r) => r.user && !r.user.deletedAt && r.user.organizationId === ctx.organizationId);
  const mine = roleOfRow(live.find((r) => r.userId === ctx.userId));
  const admin = await freshAdmin(ctx);
  const door = admin || (await opensMembers(ctx.session));
  // The team's own people read it, and whoever opens Members reads every team.
  if (!mine && !door) return null;
  const maxGrant = maxGrantOf(admin, mine, ctx.isAgent, door);
  const canManage = maxGrant !== null;
  const orgName = await orgNameOf(ctx.organizationId);

  const direct: AccessDirectEntry[] = [];
  for (const r of live) {
    const role = roleOfRow(r)!;
    const editable = canManage && rank(role) <= rank(maxGrant);
    const entry: AccessDirectEntry = {
      person: personOf(r.user),
      role,
      owner: false,
      source: "TeamMember",
      editable,
      // A lead may always step off the team themselves.
      removable: editable || (canManage && r.userId === ctx.userId),
      lastFull: false,
      cap: false,
      // An Admin keeps changing the team without their own row.
      alsoVia: admin && r.userId === ctx.userId ? { role: "FULL", via: { type: "org_admin", orgName } } : null,
    };
    if (role === "FULL") {
      const level = String(r.user.accessLevel);
      if (level === "AGENT") entry.note = AGENT_LEAD_NOTE;
      else if (!(await membersDoorFor(ctx.organizationId, r.userId, level))) entry.note = DOORLESS_LEAD_NOTE;
    }
    direct.push(entry);
  }
  direct.sort((a, b) => rank(b.role) - rank(a.role) || a.person.name.localeCompare(b.person.name));

  const adminCount = await orgAdminCount(ctx.organizationId);
  return {
    node: { kind: KIND, id: team.id, name: team.name, noun: ACCESS_NODE_NOUN[KIND], href: HREF, space: null, notepadOwner: null },
    viewer: { role: admin ? "FULL" : mine ?? "VIEW", canManage, maxGrant, isAgent: ctx.isAgent },
    roles: ROLES_BY_KIND[KIND],
    general: NO_GENERAL,
    direct,
    inherited: [],
    inheritedMore: [],
    hiddenInherited: [],
    everyone: null,
    admins: { count: adminCount },
    notes: [
      "A lead who can open Members adds and takes off the team's members. Only Owners and Admins make someone a lead.",
      "A team is a named group: being on it opens nothing else yet.",
    ],
    orgName,
    grantsAvailable: true,
  };
}

async function freshPanel(ctx: ObjectShareCtx, id: string): Promise<AccessPanel | null> {
  return teamPanel(ctx, id).catch(() => null);
}

/** The actor's right to change the team's people, after locking the team row. */
async function actorGate(tx: Tx, ctx: ObjectShareCtx, id: string): Promise<{ maxGrant: PanelRole; admin: boolean }> {
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Team" WHERE id = ${id} AND "organizationId" = ${ctx.organizationId} AND "archivedAt" IS NULL FOR UPDATE`;
  if (locked.length === 0) throw new GrantError("not_found");
  const mineRow = await tx.teamMember.findUnique({ where: { teamId_userId: { teamId: id, userId: ctx.userId } }, select: { lead: true } });
  const mine = roleOfRow(mineRow);
  const admin = await freshAdmin(ctx);
  const door = admin || (await opensMembers(ctx.session));
  if (!mine && !door) throw new GrantError("not_found");
  const maxGrant = maxGrantOf(admin, mine, ctx.isAgent, door);
  if (!maxGrant) throw new GrantError("forbidden");
  return { maxGrant, admin };
}

async function withFreshPanel<T>(ctx: ObjectShareCtx, id: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof GrantError && err.code === "conflict") err.panel = await freshPanel(ctx, id);
    throw err;
  }
}

export async function setTeamGrant(ctx: ObjectShareCtx, id: string, body: GrantWriteBody): Promise<GrantWriteResult> {
  const role = body.role;
  if (role !== "FULL" && role !== "VIEW") throw new GrantError("invalid_role");
  const out = await withFreshPanel(ctx, id, () =>
    prisma.$transaction(async (tx) => {
      const { maxGrant } = await actorGate(tx, ctx, id);
      if (rank(role) > rank(maxGrant)) throw new GrantError("above_own_role");
      if (!(await targetInOrg(tx, ctx.organizationId, body.userId))) throw new GrantError("not_in_org");
      const cur = await tx.teamMember.findUnique({ where: { teamId_userId: { teamId: id, userId: body.userId } }, select: { lead: true } });
      const curRole = roleOfRow(cur);
      if (body.expected !== undefined && (body.expected ?? null) !== curRole) throw new GrantError("conflict");
      // A lead never changes another lead.
      if (curRole && rank(curRole) > rank(maxGrant)) throw new GrantError("above_own_role");
      const mode = body.mode ?? "set";
      if (curRole && (curRole === role || (mode === "raise" && rank(curRole) >= rank(role)))) {
        return { noChange: true, previousRole: curRole, role: curRole, how: "none" as const };
      }
      await tx.teamMember.upsert({
        where: { teamId_userId: { teamId: id, userId: body.userId } },
        create: { teamId: id, userId: body.userId, lead: role === "FULL" },
        update: { lead: role === "FULL" },
      });
      await objectActivity(tx, ctx, KIND, id, curRole ? "access.role_changed" : "access.granted", {
        granteeId: body.userId, role, previousRole: curRole, store: "TeamMember",
      });
      const how = !curRole ? ("shared" as const) : rank(role) > rank(curRole) ? ("upgraded" as const) : ("none" as const);
      return { noChange: false, previousRole: curRole, role, how };
    }, { timeout: 20_000, maxWait: 10_000 }),
  );
  const panel = await freshPanel(ctx, id);
  if (!out.noChange) {
    if (out.how !== "none" && panel) {
      // The link only for someone who can open it: Members is the manager tier's.
      const target = await prisma.user.findUnique({ where: { id: body.userId }, select: { accessLevel: true } });
      const href = target && (await membersDoorFor(ctx.organizationId, body.userId, String(target.accessLevel))) ? HREF : null;
      await notifyObjectGrantee(ctx, KIND, { id, name: panel.node.name, href }, body.userId, role, out.how);
    }
    await answerRequests(ctx, KIND, id, body.userId, role);
  }
  const change: GrantChange = { userId: body.userId, role: out.role, previousRole: out.previousRole, noChange: out.noChange, stillReaches: null, keepsInside: [] };
  return { panel, change };
}

export async function removeTeamGrant(ctx: ObjectShareCtx, id: string, input: { userId: string; expected?: PanelRole | null }): Promise<GrantWriteResult> {
  const out = await withFreshPanel(ctx, id, () =>
    prisma.$transaction(async (tx) => {
      const { maxGrant } = await actorGate(tx, ctx, id);
      const cur = await tx.teamMember.findUnique({ where: { teamId_userId: { teamId: id, userId: input.userId } }, select: { lead: true } });
      const curRole = roleOfRow(cur);
      // Removing a row that is not there changed nothing: a retry is a
      // success, whatever role the retry still names.
      if (!curRole) return { noChange: true, previousRole: null };
      if (input.expected !== undefined && (input.expected ?? null) !== curRole) throw new GrantError("conflict");
      // A lead takes off members, and themselves; never another lead.
      if (rank(curRole) > rank(maxGrant) && input.userId !== ctx.userId) throw new GrantError("above_own_role");
      await tx.teamMember.delete({ where: { teamId_userId: { teamId: id, userId: input.userId } } });
      await objectActivity(tx, ctx, KIND, id, "access.revoked", { granteeId: input.userId, role: null, previousRole: curRole, store: "TeamMember" });
      return { noChange: false, previousRole: curRole };
    }, { timeout: 20_000, maxWait: 10_000 }),
  );
  const panel = await freshPanel(ctx, id);
  const change: GrantChange = { userId: input.userId, role: null, previousRole: out.previousRole, noChange: out.noChange, stillReaches: null, keepsInside: [] };
  return { panel, change };
}

/** Check access: whether one person is on this team, and what that lets them do. */
export async function checkTeamAccess(
  ctx: ObjectShareCtx,
  id: string,
  userId: string,
): Promise<{ userId: string; name: string; role: string; sentence: string } | "not_found" | "forbidden" | "not_in_org"> {
  const team = await loadTeam(prisma, ctx.organizationId, id);
  if (!team) return "not_found";
  const mine = roleOfRow(await prisma.teamMember.findUnique({ where: { teamId_userId: { teamId: id, userId: ctx.userId } }, select: { lead: true } }));
  const admin = await freshAdmin(ctx);
  const door = admin || (await opensMembers(ctx.session));
  if (!mine && !door) return "not_found";
  if (!maxGrantOf(admin, mine, ctx.isAgent, door)) return "forbidden";
  const person = await prisma.user.findFirst({ where: { id: userId, organizationId: ctx.organizationId, deletedAt: null }, select: { firstName: true, lastName: true, email: true, accessLevel: true } });
  if (!person) return "not_in_org";
  const name = `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim() || person.email;
  const role = roleOfRow(await prisma.teamMember.findUnique({ where: { teamId_userId: { teamId: id, userId } }, select: { lead: true } }));
  const level = String(person.accessLevel);
  const isAdmin = level === "SUPER_ADMIN" || level === "COMPANY_ADMIN";
  const adminToo = isAdmin ? " As an Owner or Admin they also change every team." : "";
  if (role === "FULL") {
    if (level === "AGENT") return { userId, name, role, sentence: `Lead. ${AGENT_LEAD_NOTE}` };
    const opens = isAdmin || (await membersDoorFor(ctx.organizationId, userId, level));
    return { userId, name, role, sentence: opens ? `Lead. They add and take off the team's members.${adminToo}` : `Lead. ${DOORLESS_LEAD_NOTE}` };
  }
  if (role === "VIEW") return { userId, name, role, sentence: `Member. They are on the team.${adminToo}` };
  return { userId, name, role: "none", sentence: `Not on the team.${isAdmin ? " As an Owner or Admin they change every team." : ""}` };
}
