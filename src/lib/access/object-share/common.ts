// The pieces every object the one dialog serves beside the nodes shares
// (batch 7: SOP folders, tools, goals, teams; access-model-spec section 6.1).
//
// ONE GATE. Every object kind is served only while ACCESS_V2_TABLES is on
// (objectShareOn): with it off, /api/access/<kind>/... answers 404 for these
// kinds and no Share entry renders, so production keeps the surfaces it has
// today, byte for byte, until the founder flips the flag.
//
// ONE STORE PER KIND, the one its own gates already read (SOPFolderAccess,
// ToolShare, GoalAssignee, TeamMember). Never AccessGrant: nothing reads
// those rows, so a share written there would do nothing.

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { accessV2Tables } from "../flags";
import { legacyIsAdminLevel } from "../legacy-levels";
import { RULE_1_DENIED_STATUSES } from "../resolve";
import { accessActivityDescription, ACTIVITY_TARGET_TYPE, type AccessActivityType } from "../access-activity";
import { grantedNoticeText } from "./words";
import { requestRolesCoveredBy, resolveRequestsFor } from "../access-requests";
import { PANEL_ROLE_RANK, type AccessGeneral, type AccessPerson, type ObjectShareKind, type PanelRole } from "../access-panel";

export type Tx = Prisma.TransactionClient;

/** Who is asking, as the object gates read them (the session, not node-access). */
export interface ObjectShareCtx {
  userId: string;
  organizationId: string;
  accessLevel: string;
  /** An org Owner or Admin (SUPER_ADMIN, COMPANY_ADMIN). */
  orgAdmin: boolean;
  isAgent: boolean;
  /**
   * The session shape the object gates take (hasPermission, folderGrantRole,
   * canSeeGoal), with the session's tokenVersion so the fresh checks
   * (freshWorkspaceActor) refuse a session signed out everywhere.
   */
  session: { user: { id: string; organizationId: string; accessLevel: string; tokenVersion?: number } };
}

/** The flag every object kind rides behind. Read per request. */
export function objectShareOn(): boolean {
  return accessV2Tables();
}

/**
 * The asker, or null (the routes answer 401) when the database no longer
 * backs the session: the account is deleted or INACTIVE, or it was signed out
 * everywhere (its tokenVersion moved). The level is the session's, as each
 * object's own routes read it (legacySessionTiers, isOrgAdmin, canSeeGoal);
 * the team writer re-reads an Admin fresh (freshWorkspaceActor).
 */
export async function objectShareCtxFromSession(): Promise<ObjectShareCtx | null> {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string; accessLevel?: string; tokenVersion?: number } | undefined;
  if (!u?.id || !u.organizationId) return null;
  const row = await prisma.user.findUnique({ where: { id: u.id }, select: { deletedAt: true, status: true, tokenVersion: true } });
  if (!row || row.deletedAt || RULE_1_DENIED_STATUSES.has(String(row.status))) return null;
  if (typeof u.tokenVersion === "number" && u.tokenVersion !== row.tokenVersion) return null;
  return objectShareCtxFor(u.id, u.organizationId, u.accessLevel ?? "EMPLOYEE", u.tokenVersion);
}

export function objectShareCtxFor(userId: string, organizationId: string, accessLevel: string, tokenVersion?: number): ObjectShareCtx {
  return {
    userId,
    organizationId,
    accessLevel,
    orgAdmin: legacyIsAdminLevel(accessLevel),
    isAgent: accessLevel === "AGENT",
    session: { user: { id: userId, organizationId, accessLevel, ...(typeof tokenVersion === "number" ? { tokenVersion } : {}) } },
  };
}

export const rank = (r: PanelRole | "none" | null | undefined): number => (r ? PANEL_ROLE_RANK[r] : 0);

/** No general switches on these objects: no visibility, Restricted, public link or org-wide Space. */
export const NO_GENERAL: AccessGeneral = { visibility: null, restricted: null, publicLink: null, orgWideSpace: null, privateRule: "legacy" };

type UserRow = { id: string; firstName: string | null; lastName: string | null; email: string; avatar: string | null; status?: string | null; deletedAt?: Date | null };

export const USER_SELECT = { id: true, firstName: true, lastName: true, email: true, avatar: true, status: true, deletedAt: true } as const;

export function personOf(u: UserRow): AccessPerson {
  const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email;
  const active = !u.deletedAt && !RULE_1_DENIED_STATUSES.has(String(u.status ?? ""));
  return { id: u.id, name, email: u.email, avatar: u.avatar, active };
}

export async function orgNameOf(organizationId: string): Promise<string> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  return org?.name ?? "your organization";
}

export async function orgAdminCount(organizationId: string): Promise<number> {
  return prisma.user.count({ where: { organizationId, deletedAt: null, accessLevel: { in: ["SUPER_ADMIN", "COMPANY_ADMIN"] } } });
}

/** A person in this org who is not deleted: the only people a share may name. */
export async function targetInOrg(tx: Tx, organizationId: string, userId: string): Promise<{ id: string; accessLevel: string } | null> {
  const u = await tx.user.findFirst({ where: { id: userId, organizationId, deletedAt: null }, select: { id: true, accessLevel: true } });
  return u ? { id: u.id, accessLevel: String(u.accessLevel) } : null;
}

/** The access activity row, in the transaction, like grants.ts writes for a node. */
export async function objectActivity(
  tx: Tx,
  ctx: ObjectShareCtx,
  kind: ObjectShareKind,
  id: string,
  type: AccessActivityType,
  fields: { granteeId: string; role: string | null; previousRole: string | null; store: string },
): Promise<void> {
  await tx.activityLog.create({
    data: {
      type,
      actorId: ctx.userId,
      organizationId: ctx.organizationId,
      targetType: ACTIVITY_TARGET_TYPE[kind],
      targetId: id,
      description: accessActivityDescription(type, kind),
      metadata: {
        nodeKind: kind,
        nodeId: id,
        granteeId: fields.granteeId,
        role: fields.role,
        previousRole: fields.previousRole,
        store: fields.store,
        source: "dialog",
      } as Prisma.InputJsonValue,
      oldValue: { role: fields.previousRole } as Prisma.InputJsonValue,
      newValue: { role: fields.role } as Prisma.InputJsonValue,
      severity: "warning",
    },
  });
}

/**
 * Tell the person they were given access, after the write committed. Never
 * fails the write. A null href sends no link: a page the person cannot open
 * would be a dead end.
 */
export async function notifyObjectGrantee(
  ctx: ObjectShareCtx,
  kind: ObjectShareKind,
  object: { id: string; name: string; href: string | null },
  granteeId: string,
  role: PanelRole,
  how: "shared" | "upgraded",
  /** What else decides what the role lets them do, said after it. */
  caveat?: string,
): Promise<void> {
  if (granteeId === ctx.userId) return;
  try {
    const who = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { firstName: true, lastName: true, email: true } });
    const actorName = `${who?.firstName ?? ""} ${who?.lastName ?? ""}`.trim() || who?.email || "Someone";
    const text = grantedNoticeText(kind, actorName, object.name, role, how, caveat);
    await prisma.notification.create({
      data: {
        userId: granteeId,
        type: "access_granted",
        title: text.title,
        message: text.message,
        link: object.href,
      },
    });
  } catch (err) {
    console.error(`[object-share] notification failed for ${kind} ${object.id}:`, err instanceof Error ? err.message : err);
  }
}

/** A share answers the person's open Request access on this object, as a node grant does. */
export async function answerRequests(ctx: ObjectShareCtx, kind: ObjectShareKind, objectId: string, granteeId: string, role: PanelRole): Promise<void> {
  await resolveRequestsFor({
    organizationId: ctx.organizationId,
    objectTypes: [kind],
    objectId,
    requesterId: granteeId,
    roles: requestRolesCoveredBy(role),
    deciderId: ctx.userId,
  });
}
