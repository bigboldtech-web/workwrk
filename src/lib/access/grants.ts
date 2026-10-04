// The ONLY writer of person grants, and of the activity rows that record them.
//
// Every change to who can open a node goes through here: the Manage access
// dialog's POST and DELETE /api/access/:kind/:id/grants, the three member
// routes (/api/spaces|folders|boards/[id]/members, which keep their URLs and
// shapes), doc sharing's restricted and public link switches, the Space,
// Folder and List visibility changes (as activity rows) and the workspace's
// Private rule. Nothing else writes SpaceMember, FolderMember, BoardMember,
// AccessGrant or Organization.settings.docSharing for a person, with one
// exception that keeps its own route: a Space invitation by email (the
// dialog's Email tab) creates the SpaceMember row when the invitee accepts,
// inside accept-invite's user-creation transaction. It records both steps
// here (recordSpaceInvite, recordSpaceInviteAccepted), so every grant made
// from the dialog is security activity (A7).
//
// DATA INTEGRITY. Each change is ONE transaction: the node's row (or, for a
// doc, the Organization row that holds every doc's sharing) is locked FOR
// UPDATE first, the person's current row is read inside the lock, the plan
// (grant-plan.ts) is made against that fresh read, the row is written and
// the activity row is written, or none of it is. A client that last saw a
// different role gets 409 conflict with a fresh panel instead of silently
// overwriting someone else's change. The notification is sent after the
// commit and is best effort: a failed notification never undoes a grant.
//
// ROLES NEVER CLIMB. A grant writes exactly one row on exactly the node it
// names. Nothing here ever creates a membership on a node's Space or its
// Folder: that was the reported bug (the canvas door wrote a SpaceMember),
// and this module has no code path that could do it.
//
// Server-only: prisma.

import { randomBytes } from "crypto";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { addressHref } from "@/lib/nav/object-href";
import {
  ACCESS_NODE_NOUN,
  GRANT_ERROR_MESSAGE,
  MANAGE_BAR,
  panelRoleLabel,
  type AccessPanel,
  type AccessVia,
  type GrantChange,
  type GrantErrorCode,
  type GrantWriteBody,
  type GrantWriteResult,
  type PanelRole,
} from "./access-panel";
import {
  NodeEvaluator,
  boardMemberToRole,
  isListRung,
  memberToRole,
  notepadOwnerOf,
  placementContainers,
  refKey,
  roleAtLeast,
  spaceMemberToRole,
  toDocRole,
  type DocSharingFact,
  type MemberRole,
  type NodeCtx,
  type NodeRef,
  type NodeRows,
  type NodeVia,
  type PrivateRule,
  type ViewerGrants,
} from "./node-rules";
import { maxGrantFor, memberRouteKeepsRow, planGrant, planRemove, type StoredRole } from "./grant-plan";
import { ACCESS_ACTIVITY_TYPES, ACTIVITY_TARGET_TYPE, accessActivityDescription, type AccessActivityType } from "./access-activity";
import {
  accessGrantTableReady,
  deleteObjectGrant,
  docSharingEntries,
  lockOrgSettings,
  objectGrants,
  upsertObjectGrant,
  writeDocSharingEntry,
} from "./access-grant-store";
import { loadPathEvidence, loadRows, loadViewerGrants, seedsOf } from "./node-world";
import { accessPanel } from "./node-access";
import { nodeName } from "./node-tree";
import { RULE_1_DENIED_STATUSES } from "./resolve";
import { writeOrgSettingsKeys } from "../org-settings-write";
import { requestRolesCoveredBy, requestTypesForNode, resolveRequestsFor } from "./access-requests";

export const GRANT_ERROR_STATUS: Readonly<Record<GrantErrorCode, number>> = {
  not_found: 404,
  forbidden: 403,
  invalid_body: 400,
  invalid_role: 400,
  not_in_org: 400,
  owner_fixed: 400,
  last_full: 409,
  above_own_role: 400,
  private_note: 400,
  conflict: 409,
  grants_unavailable: 503,
  server_error: 500,
};

export class GrantError extends Error {
  readonly code: GrantErrorCode;
  readonly status: number;
  panel: AccessPanel | null;
  readonly detail?: string;
  constructor(code: GrantErrorCode, panel: AccessPanel | null = null, detail?: string) {
    super(GRANT_ERROR_MESSAGE[code]);
    this.code = code;
    this.status = GRANT_ERROR_STATUS[code];
    this.panel = panel;
    this.detail = detail;
  }
}

/** Where a write came from, for the activity row's metadata. */
export type GrantSource = "dialog" | "members-route" | "doc-sharing" | "script";

// The activity types, named once (access-activity.ts lists them all).
const T_GRANTED: AccessActivityType = "access.granted";
const T_CHANGED: AccessActivityType = "access.role_changed";
const T_REVOKED: AccessActivityType = "access.revoked";
const T_VISIBILITY: AccessActivityType = "access.visibility_changed";
const T_RESTRICTED: AccessActivityType = "access.restricted_changed";
const T_LINK_ON: AccessActivityType = "access.public_link.on";
const T_LINK_OFF: AccessActivityType = "access.public_link.off";
const T_RULE: AccessActivityType = "access.private_rule_changed";
void ACCESS_ACTIVITY_TYPES;

type Tx = Prisma.TransactionClient;

// ── shared gates ─────────────────────────────────────────────────────

interface NodeGate {
  rows: NodeRows;
  actorGrants: ViewerGrants;
  actorRole: ReturnType<NodeEvaluator["effective"]>["role"];
  maxGrant: PanelRole | null;
  notepad: boolean;
  ownerId: string | null;
}

function nodeExists(rows: NodeRows, ref: NodeRef): boolean {
  switch (ref.kind) {
    case "space":
      return rows.spaces.has(ref.id);
    case "folder":
      return rows.folders.has(ref.id);
    case "list":
      return rows.lists.has(ref.id);
    case "doc":
      return rows.docs.has(ref.id);
    case "table":
      return rows.tables.has(ref.id);
    case "canvas":
      return rows.canvases.has(ref.id);
    case "form":
      return rows.forms.has(ref.id);
  }
}

/** The object creator whose Full access is fixed (docs, tables, canvases, forms). */
function objectOwnerOf(rows: NodeRows, ref: NodeRef): string | null {
  switch (ref.kind) {
    case "doc":
      return rows.docs.get(ref.id)?.createdById ?? null;
    case "table":
      return rows.tables.get(ref.id)?.createdById ?? null;
    case "canvas":
      return rows.canvases.get(ref.id)?.ownerId ?? null;
    case "form":
      return rows.forms.get(ref.id)?.createdById ?? null;
    default:
      return null;
  }
}

/** The node, org-scoped; the actor's role on it; 404 without a role, 403 below the manage bar. */
async function gateNode(actor: NodeCtx, ref: NodeRef): Promise<NodeGate> {
  if (actor.denied) throw new GrantError("not_found");
  const rows = await loadRows(actor.organizationId, seedsOf([ref]));
  if (!nodeExists(rows, ref)) throw new GrantError("not_found");
  const actorGrants = await loadViewerGrants(actor, rows);
  const actorRole = new NodeEvaluator(rows, actorGrants).effective(ref).role;
  if (actorRole === "none") throw new GrantError("not_found");
  if (!roleAtLeast(actorRole, MANAGE_BAR[ref.kind])) throw new GrantError("forbidden");
  const doc = ref.kind === "doc" ? rows.docs.get(ref.id) : undefined;
  return {
    rows,
    actorGrants,
    actorRole,
    maxGrant: maxGrantFor(ref.kind, actorRole),
    notepad: !!doc && notepadOwnerOf(rows, doc) !== undefined,
    ownerId: objectOwnerOf(rows, ref),
  };
}

/**
 * Whether the actor clears the same manage bar a grant on this node needs
 * (gateNode). The access-request decline asks this, so declining a request
 * never needs more power than granting it.
 */
export async function mayManageNode(actor: NodeCtx, ref: NodeRef): Promise<boolean> {
  try {
    await gateNode(actor, ref);
    return true;
  } catch (err) {
    if (err instanceof GrantError) return false;
    throw err;
  }
}

/** SELECT ... FOR UPDATE on the node (docs lock the Organization row that holds their sharing). */
async function lockNode(tx: Tx, orgId: string, ref: NodeRef): Promise<void> {
  switch (ref.kind) {
    case "space":
      await tx.$queryRaw`SELECT "id" FROM "Space" WHERE "id" = ${ref.id} AND "organizationId" = ${orgId} FOR UPDATE`;
      return;
    case "folder":
      await tx.$queryRaw`SELECT "id" FROM "Folder" WHERE "id" = ${ref.id} AND "organizationId" = ${orgId} FOR UPDATE`;
      return;
    case "list":
      await tx.$queryRaw`SELECT "id" FROM "Board" WHERE "id" = ${ref.id} AND "organizationId" = ${orgId} FOR UPDATE`;
      return;
    case "doc":
      await lockOrgSettings(tx, orgId);
      return;
    case "table":
      await tx.$queryRaw`SELECT "id" FROM "DataTable" WHERE "id" = ${ref.id} AND "organizationId" = ${orgId} FOR UPDATE`;
      return;
    case "canvas":
      await tx.$queryRaw`SELECT "id" FROM "Whiteboard" WHERE "id" = ${ref.id} AND "organizationId" = ${orgId} FOR UPDATE`;
      return;
    case "form":
      await tx.$queryRaw`SELECT "id" FROM "FormDefinition" WHERE "id" = ${ref.id} AND "organizationId" = ${orgId} FOR UPDATE`;
      return;
  }
}

interface CurrentRow {
  role: PanelRole | null;
  stored: StoredRole | null;
  docEntry?: DocSharingFact | undefined;
}

/** The person's current DIRECT row on the node, read inside the transaction. */
async function readCurrent(tx: Tx, orgId: string, ref: NodeRef, userId: string): Promise<CurrentRow> {
  switch (ref.kind) {
    case "space": {
      const r = await tx.spaceMember.findUnique({ where: { spaceId_userId: { spaceId: ref.id, userId } }, select: { role: true } });
      return r ? { role: spaceMemberToRole(r.role as MemberRole), stored: r.role as MemberRole } : { role: null, stored: null };
    }
    case "folder": {
      const r = await tx.folderMember.findUnique({ where: { folderId_userId: { folderId: ref.id, userId } }, select: { role: true } });
      return r ? { role: memberToRole(r.role as MemberRole), stored: r.role as MemberRole } : { role: null, stored: null };
    }
    case "list": {
      const r = await tx.boardMember.findUnique({ where: { boardId_userId: { boardId: ref.id, userId } }, select: { role: true, rung: true } });
      if (!r) return { role: null, stored: null };
      // A rung reads as its own stored value, so moving between Can view,
      // Can comment and Can edit assigned tasks is a change (grant-plan.ts).
      const rung = isListRung(r.rung) && r.role === "GUEST" ? r.rung : null;
      return { role: boardMemberToRole(r.role as MemberRole, rung), stored: rung ?? (r.role as MemberRole) };
    }
    case "doc": {
      const entry = (await docSharingEntries(orgId, [ref.id], tx)).get(ref.id);
      const granted = entry?.roles?.[userId];
      if (granted) return { role: granted, stored: granted, docEntry: entry };
      const legacy = entry?.members?.[userId];
      if (legacy) return { role: legacy === "edit" ? "EDIT" : "COMMENT", stored: legacy === "edit" ? "EDIT" : "COMMENT", docEntry: entry };
      return { role: null, stored: null, docEntry: entry };
    }
    case "table":
    case "canvas":
    case "form": {
      const [r] = await objectGrants(ref.kind, [ref.id], { userId, db: tx });
      return r ? { role: memberToRole(r.role), stored: r.role } : { role: null, stored: null };
    }
  }
}

/** Active OWNER or ADMIN rows on a Space other than this person's (the last Full holder rule). */
async function otherActiveFullRows(tx: Tx, spaceId: string, exceptUserId: string): Promise<number> {
  const rows = await tx.spaceMember.findMany({
    where: { spaceId, role: { in: ["OWNER", "ADMIN"] }, userId: { not: exceptUserId }, user: { deletedAt: null } },
    select: { user: { select: { status: true } } },
  });
  return rows.filter((r) => !RULE_1_DENIED_STATUSES.has(String(r.user.status))).length;
}

const projection = (role: PanelRole): "edit" | "view" => (toDocRole(role) === "edit" ? "edit" : "view");

function isEmptyEntry(e: DocSharingFact): boolean {
  const members = e.members && Object.keys(e.members).length > 0;
  const roles = e.roles && Object.keys(e.roles).length > 0;
  return !members && !roles && !e.restricted && !e.publicSecret;
}

function tidy(e: DocSharingFact): DocSharingFact | null {
  const out: DocSharingFact = { ...e };
  if (out.members && Object.keys(out.members).length === 0) delete out.members;
  if (out.roles && Object.keys(out.roles).length === 0) delete out.roles;
  return isEmptyEntry(out) ? null : out;
}

async function writeRow(tx: Tx, orgId: string, ref: NodeRef, userId: string, role: StoredRole, actorId: string, cur: CurrentRow): Promise<void> {
  switch (ref.kind) {
    case "space":
      await tx.spaceMember.upsert({
        where: { spaceId_userId: { spaceId: ref.id, userId } },
        create: { spaceId: ref.id, userId, role: role as MemberRole, invitedBy: actorId },
        update: { role: role as MemberRole },
      });
      return;
    case "folder":
      await tx.folderMember.upsert({
        where: { folderId_userId: { folderId: ref.id, userId } },
        create: { folderId: ref.id, userId, role: role as MemberRole, invitedBy: actorId },
        update: { role: role as MemberRole },
      });
      return;
    case "list": {
      // Can comment and Can edit assigned tasks are a GUEST row with a rung;
      // every other value clears the rung, so a plain Can view stays plain.
      const rung = role === "COMMENT" || role === "ASSIGNED" ? role : null;
      const stored: MemberRole = rung ? "GUEST" : (role as MemberRole);
      await tx.boardMember.upsert({
        where: { boardId_userId: { boardId: ref.id, userId } },
        create: { boardId: ref.id, userId, role: stored, rung, invitedBy: actorId },
        update: { role: stored, rung },
      });
      return;
    }
    case "doc": {
      const prev = cur.docEntry ?? {};
      const panelRole = role as PanelRole;
      const next: DocSharingFact = {
        ...prev,
        roles: { ...(prev.roles ?? {}), [userId]: panelRole === "OWNER" ? "FULL" : (panelRole as "FULL" | "EDIT" | "COMMENT" | "VIEW") },
        // The rollback projection: a release that reads members alone keeps
        // this person listed.
        members: { ...(prev.members ?? {}), [userId]: projection(panelRole) },
      };
      await writeDocSharingEntry(tx, orgId, ref.id, tidy(next));
      return;
    }
    case "table":
    case "canvas":
    case "form":
      await upsertObjectGrant(tx, { organizationId: orgId, kind: ref.kind, objectId: ref.id, userId, role: role as MemberRole, grantedById: actorId });
      return;
  }
}

async function deleteRow(tx: Tx, orgId: string, ref: NodeRef, userId: string, cur: CurrentRow): Promise<void> {
  switch (ref.kind) {
    case "space":
      await tx.spaceMember.deleteMany({ where: { spaceId: ref.id, userId } });
      return;
    case "folder":
      await tx.folderMember.deleteMany({ where: { folderId: ref.id, userId } });
      return;
    case "list":
      await tx.boardMember.deleteMany({ where: { boardId: ref.id, userId } });
      return;
    case "doc": {
      const prev = cur.docEntry ?? {};
      const members = { ...(prev.members ?? {}) };
      const roles = { ...(prev.roles ?? {}) };
      delete members[userId];
      delete roles[userId];
      await writeDocSharingEntry(tx, orgId, ref.id, tidy({ ...prev, members, roles }));
      return;
    }
    case "table":
    case "canvas":
    case "form":
      await deleteObjectGrant(tx, { kind: ref.kind, objectId: ref.id, userId });
      return;
  }
}

async function activity(
  tx: Tx,
  actor: NodeCtx,
  ref: NodeRef,
  type: AccessActivityType,
  fields: { granteeId?: string | null; role?: string | null; previousRole?: string | null; store?: string; source: string; extra?: Record<string, unknown> },
): Promise<void> {
  await tx.activityLog.create({
    data: {
      type,
      actorId: actor.userId,
      organizationId: actor.organizationId,
      targetType: ACTIVITY_TARGET_TYPE[ref.kind],
      targetId: ref.id,
      description: accessActivityDescription(type, ref.kind),
      metadata: {
        nodeKind: ref.kind,
        nodeId: ref.id,
        granteeId: fields.granteeId ?? null,
        role: fields.role ?? null,
        previousRole: fields.previousRole ?? null,
        store: fields.store ?? null,
        source: fields.source,
        ...(fields.extra ?? {}),
      } as Prisma.InputJsonValue,
      oldValue: { role: fields.previousRole ?? null } as Prisma.InputJsonValue,
      newValue: { role: fields.role ?? null } as Prisma.InputJsonValue,
      severity: "warning",
    },
  });
}

/**
 * A Space invitation by email was sent: who sent it, for which Space, at
 * which role. The email is kept in metadata for the audit (the invitee has
 * no account yet); the description stays name free like every access row.
 */
export async function recordSpaceInvite(
  db: Tx | typeof prisma,
  input: { actorId: string; organizationId: string; spaceId: string; invitationId: string; email: string; role: string },
): Promise<void> {
  await db.activityLog.create({
    data: {
      type: "access.invited",
      actorId: input.actorId,
      organizationId: input.organizationId,
      targetType: ACTIVITY_TARGET_TYPE.space,
      targetId: input.spaceId,
      description: accessActivityDescription("access.invited", "space"),
      metadata: {
        nodeKind: "space",
        nodeId: input.spaceId,
        granteeId: null,
        email: input.email,
        invitationId: input.invitationId,
        role: input.role,
        previousRole: null,
        store: "Invitation",
        source: "email_invite",
      } as Prisma.InputJsonValue,
      oldValue: { role: null } as Prisma.InputJsonValue,
      newValue: { role: input.role } as Prisma.InputJsonValue,
      severity: "warning",
    },
  });
}

/**
 * The invitee accepted, inside accept-invite's transaction, right after the
 * SpaceMember row was written: the grant row, credited to the person who
 * sent the invitation (read back from their invite row) and to the invitee
 * when that row predates this release. Writes nothing when the membership
 * already existed with a role (the upsert changed nothing).
 */
export async function recordSpaceInviteAccepted(
  tx: Tx,
  input: { organizationId: string; spaceId: string; invitationId: string; userId: string; role: string; previousRole: string | null },
): Promise<string | null> {
  if (input.previousRole) return null;
  const sent = await tx.activityLog.findFirst({
    where: { organizationId: input.organizationId, type: "access.invited", metadata: { path: ["invitationId"], equals: input.invitationId } },
    orderBy: { createdAt: "desc" },
    select: { actorId: true },
  });
  const actorId = sent?.actorId ?? input.userId;
  await tx.activityLog.create({
    data: {
      type: T_GRANTED,
      actorId,
      organizationId: input.organizationId,
      targetType: ACTIVITY_TARGET_TYPE.space,
      targetId: input.spaceId,
      description: accessActivityDescription(T_GRANTED, "space"),
      metadata: {
        nodeKind: "space",
        nodeId: input.spaceId,
        granteeId: input.userId,
        invitationId: input.invitationId,
        role: input.role,
        previousRole: null,
        store: "SpaceMember",
        source: "email_invite",
      } as Prisma.InputJsonValue,
      oldValue: { role: null } as Prisma.InputJsonValue,
      newValue: { role: input.role } as Prisma.InputJsonValue,
      severity: "warning",
    },
  });
  return sent?.actorId ?? null;
}

/** A person's link to a node they were given: Spaces by id (the Space page sends an id on to its slug). */
function grantLink(ref: NodeRef): string {
  const enc = encodeURIComponent;
  switch (ref.kind) {
    case "space":
      return `/spaces/${enc(ref.id)}`;
    case "folder":
      return `/folders/${enc(ref.id)}`;
    case "list":
      return `/boards/${enc(ref.id)}`;
    case "doc":
    case "table":
    case "canvas":
    case "form":
      return addressHref(ref.kind, ref.id, { scope: "work" });
  }
}

async function notifyGrantee(actor: NodeCtx, ref: NodeRef, rows: NodeRows, granteeId: string, role: PanelRole, kind: "shared" | "upgraded"): Promise<void> {
  try {
    const who = await prisma.user.findUnique({ where: { id: actor.userId }, select: { firstName: true, lastName: true, email: true } });
    const actorName = `${who?.firstName ?? ""} ${who?.lastName ?? ""}`.trim() || who?.email || "Someone";
    const name = nodeName(rows, ref);
    const label = panelRoleLabel(role);
    await prisma.notification.create({
      data: {
        userId: granteeId,
        type: "access_granted",
        title: kind === "shared" ? `${actorName} shared ${name} with you` : `${actorName} gave you ${label} on ${name}`,
        message: `${label} on this ${ACCESS_NODE_NOUN[ref.kind]}.`,
        link: grantLink(ref),
      },
    });
  } catch (err) {
    console.error(`[grants] notification failed for ${ref.kind} ${ref.id}:`, err instanceof Error ? err.message : err);
  }
}

async function freshPanel(actor: NodeCtx, ref: NodeRef): Promise<AccessPanel | null> {
  try {
    return await accessPanel(actor, ref);
  } catch {
    return null;
  }
}

/** Runs the transaction and turns a planned refusal into a GrantError carrying a fresh panel. */
async function inTx<T>(actor: NodeCtx, ref: NodeRef, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(fn, { timeout: 20_000, maxWait: 10_000 });
  } catch (err) {
    if (err instanceof GrantError) {
      if (err.code === "conflict" || err.code === "last_full") err.panel = await freshPanel(actor, ref);
      throw err;
    }
    throw err;
  }
}

// ── set ──────────────────────────────────────────────────────────────

export type SetGrantInput = GrantWriteBody | { userId: string; memberRole: MemberRole; expected?: PanelRole | null };

/**
 * Give one person a role on one node, or change it. `memberRole` is the
 * member routes' vocabulary, written through unchanged (an OWNER write on a
 * Folder stays an OWNER row), and checked against the same gates.
 */
export async function setNodeGrant(actor: NodeCtx, ref: NodeRef, input: SetGrantInput, source: GrantSource): Promise<GrantWriteResult> {
  const gate = await gateNode(actor, ref);
  const userId = input.userId;
  const stored = "memberRole" in input ? input.memberRole : null;
  const requested: PanelRole = "memberRole" in input
    ? ref.kind === "space" ? spaceMemberToRole(input.memberRole) : memberToRole(input.memberRole)
    : input.role;
  const mode = "memberRole" in input ? "set" : input.mode ?? "set";

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { organizationId: true, deletedAt: true, status: true } });
  const targetInOrg = !!target && target.organizationId === actor.organizationId && target.deletedAt === null;
  const targetActive = !!target && target.deletedAt === null && !RULE_1_DENIED_STATUSES.has(String(target.status));
  if ((ref.kind === "table" || ref.kind === "canvas" || ref.kind === "form") && !(await accessGrantTableReady())) {
    throw new GrantError("grants_unavailable");
  }

  const outcome = await inTx(actor, ref, async (tx) => {
    await lockNode(tx, actor.organizationId, ref);
    const cur = await readCurrent(tx, actor.organizationId, ref, userId);
    const spaceFullOthers = ref.kind === "space" ? await otherActiveFullRows(tx, ref.id, userId) : 0;
    const plan = planGrant({
      kind: ref.kind,
      current: cur.role,
      currentRow: cur.stored,
      requested,
      expected: input.expected,
      mode,
      actorMax: gate.maxGrant,
      isObjectOwner: !!gate.ownerId && gate.ownerId === userId,
      notepad: gate.notepad,
      spaceFullOthers,
      targetActive,
      targetInOrg,
      self: userId === actor.userId,
    });
    if (plan.error) throw new GrantError(plan.error);
    const writeRole = stored ?? plan.writeRole;
    // The member routes' GUEST onto a List rung row is that same row
    // (grant-plan.ts memberRouteKeepsRow).
    const noChange = stored ? memberRouteKeepsRow(ref.kind, stored, cur.stored) : plan.noChange;
    if (noChange || !writeRole) return { previousRole: cur.role, role: cur.role, noChange: true, notify: "none" as const };
    await writeRow(tx, actor.organizationId, ref, userId, writeRole, actor.userId, cur);
    await activity(tx, actor, ref, cur.role ? T_CHANGED : T_GRANTED, {
      granteeId: userId,
      role: String(writeRole),
      previousRole: cur.stored ? String(cur.stored) : null,
      store: plan.store,
      source,
    });
    // A raise that joined two List rungs gives the union (grant-plan.ts).
    return { previousRole: cur.role, role: plan.role ?? requested, noChange: false, notify: plan.notify };
  });

  if (outcome.notify === "shared" || outcome.notify === "upgraded") {
    await notifyGrantee(actor, ref, gate.rows, userId, outcome.role ?? requested, outcome.notify);
  }
  // A grant answers the person's open Request access on this node (spec 5.6
  // item 2), whichever door made it: the dialog, a members route or the
  // Access requests card. The row this person holds on this node now decides
  // which asks it covers (on no change that is the row they already held).
  await resolveRequestsFor({
    organizationId: actor.organizationId,
    objectTypes: requestTypesForNode(ref.kind),
    objectId: ref.id,
    requesterId: userId,
    roles: requestRolesCoveredBy(outcome.role),
    deciderId: actor.userId,
  });
  const change: GrantChange = {
    userId,
    role: outcome.role,
    previousRole: outcome.previousRole,
    noChange: outcome.noChange,
    stillReaches: null,
    keepsInside: [],
  };
  return { panel: await freshPanel(actor, ref), change };
}

// ── remove ───────────────────────────────────────────────────────────

/** How the actor may see where a person's remaining access comes from. */
function viaForActor(rows: NodeRows, actorEv: NodeEvaluator, via: NodeVia, orgName: string): AccessVia {
  switch (via.type) {
    case "org_admin":
      return { type: "org_admin", orgName };
    case "owner":
      return { type: "owner" };
    case "everyone":
      return { type: "everyone", orgName, from: via.node ? { kind: via.node.kind, name: nodeName(rows, via.node) } : null };
    case "floor":
      return { type: "older_rule", from: null };
    case "own":
    case "lift":
    case "pierce":
    case "inherited": {
      const role = actorEv.effective(via.node).role;
      if (!roleAtLeast(role, "VIEW")) return { type: "hidden" };
      return {
        type: "node",
        kind: via.node.kind,
        id: via.node.id,
        name: nodeName(rows, via.node),
        href: null,
        canManage: roleAtLeast(role, MANAGE_BAR[via.node.kind]),
      };
    }
    default:
      return { type: "hidden" };
  }
}

/**
 * Take one person's row off one node. A row that is not there answers
 * noChange (a retry or a second tab is never a failure). After the commit it
 * says whether the person still reaches the node, and for a Space or Folder
 * which things inside they keep through their own grants.
 */
export async function removeNodeGrant(
  actor: NodeCtx,
  ref: NodeRef,
  input: { userId: string; expected?: PanelRole | null },
  source: GrantSource,
): Promise<GrantWriteResult> {
  const gate = await gateNode(actor, ref);
  const userId = input.userId;
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { organizationId: true, deletedAt: true, status: true, accessLevel: true } });
  const targetActive = !!target && target.deletedAt === null && !RULE_1_DENIED_STATUSES.has(String(target.status));
  if ((ref.kind === "table" || ref.kind === "canvas" || ref.kind === "form") && !(await accessGrantTableReady())) {
    throw new GrantError("grants_unavailable");
  }

  const outcome = await inTx(actor, ref, async (tx) => {
    await lockNode(tx, actor.organizationId, ref);
    const cur = await readCurrent(tx, actor.organizationId, ref, userId);
    const spaceFullOthers = ref.kind === "space" ? await otherActiveFullRows(tx, ref.id, userId) : 0;
    const plan = planRemove({
      kind: ref.kind,
      current: cur.role,
      currentRow: cur.stored,
      expected: input.expected,
      actorMax: gate.maxGrant,
      isObjectOwner: !!gate.ownerId && gate.ownerId === userId,
      notepad: gate.notepad,
      spaceFullOthers,
      targetActive,
    });
    if (plan.error) throw new GrantError(plan.error);
    if (plan.noChange) return { previousRole: null as PanelRole | null, noChange: true };
    await deleteRow(tx, actor.organizationId, ref, userId, cur);
    await activity(tx, actor, ref, T_REVOKED, {
      granteeId: userId,
      role: null,
      previousRole: cur.stored ? String(cur.stored) : null,
      store: plan.store,
      source,
    });
    return { previousRole: cur.role, noChange: false };
  });

  let stillReaches: GrantChange["stillReaches"] = null;
  let keepsInside: GrantChange["keepsInside"] = [];
  if (!outcome.noChange && target && target.organizationId === actor.organizationId) {
    try {
      const org = await prisma.organization.findUnique({ where: { id: actor.organizationId }, select: { name: true } });
      const orgName = org?.name ?? "your organization";
      const granteeCtx: NodeCtx = {
        userId,
        organizationId: actor.organizationId,
        orgAdmin: target.accessLevel === "SUPER_ADMIN" || target.accessLevel === "COMPANY_ADMIN",
        orgGuest: false,
        isAgent: target.accessLevel === "AGENT",
        denied: !targetActive,
      };
      const rows = await loadRows(actor.organizationId, seedsOf([ref]));
      const [granteeGrants, actorGrants] = await Promise.all([loadViewerGrants(granteeCtx, rows), loadViewerGrants(actor, rows)]);
      const actorEv = new NodeEvaluator(rows, actorGrants);
      const d = new NodeEvaluator(rows, granteeGrants).decision(ref);
      if (roleAtLeast(d.role, "VIEW")) stillReaches = { role: d.role as PanelRole, via: viaForActor(rows, actorEv, d.via, orgName) };
      if (ref.kind === "space" || ref.kind === "folder") keepsInside = await keptInside(granteeCtx, actor, ref);
    } catch (err) {
      console.error(`[grants] could not describe the remaining access on ${ref.kind} ${ref.id}:`, err instanceof Error ? err.message : err);
    }
  }
  const change: GrantChange = { userId, role: null, previousRole: outcome.previousRole, noChange: outcome.noChange, stillReaches, keepsInside };
  return { panel: await freshPanel(actor, ref), change };
}

/** Nodes inside a Space or Folder the person still reaches through their own grants or ownership, that the actor can open. */
async function keptInside(grantee: NodeCtx, actor: NodeCtx, container: NodeRef): Promise<GrantChange["keepsInside"]> {
  const evidence = await loadPathEvidence(grantee);
  const ev = new NodeEvaluator(evidence.rows, evidence.grants);
  const inside = evidence.candidates.filter((r) => placementContainers(evidence.rows, r).some((c) => c.kind === container.kind && c.id === container.id));
  const kept = inside.filter((r) => roleAtLeast(ev.effective(r).role, "VIEW"));
  if (kept.length === 0) return [];
  const actorGrants = await loadViewerGrants(actor, evidence.rows);
  const actorEv = new NodeEvaluator(evidence.rows, actorGrants);
  const seen = new Set<string>();
  const out: GrantChange["keepsInside"] = [];
  for (const r of kept) {
    const key = refKey(r);
    if (seen.has(key) || !roleAtLeast(actorEv.effective(r).role, "VIEW")) continue;
    seen.add(key);
    out.push({ kind: r.kind, id: r.id, name: nodeName(evidence.rows, r), role: ev.effective(r).role as PanelRole });
  }
  return out.slice(0, 20);
}

// ── doc general access ───────────────────────────────────────────────

export interface DocGeneralResult {
  entry: DocSharingFact | undefined;
  role: ReturnType<NodeEvaluator["effective"]>["role"];
}

/**
 * Restricted and the public link of one doc, in one transaction with their
 * activity rows. Can edit or higher changes them (today's doc sharing rule).
 */
export async function setDocGeneral(actor: NodeCtx, docId: string, change: { restricted?: boolean; publicLink?: boolean }): Promise<DocGeneralResult> {
  const ref: NodeRef = { kind: "doc", id: docId };
  const gate = await gateNode(actor, ref);
  if (gate.notepad) throw new GrantError("private_note");
  const entry = await inTx(actor, ref, async (tx) => {
    await lockOrgSettings(tx, actor.organizationId);
    const prev = (await docSharingEntries(actor.organizationId, [docId], tx)).get(docId) ?? {};
    const next: DocSharingFact = { ...prev };
    if (change.restricted !== undefined && change.restricted !== !!prev.restricted) {
      if (change.restricted) next.restricted = true;
      else delete next.restricted;
      await activity(tx, actor, ref, T_RESTRICTED, { role: change.restricted ? "restricted" : "open", previousRole: prev.restricted ? "restricted" : "open", source: "doc-sharing" });
    }
    if (change.publicLink !== undefined && change.publicLink !== !!prev.publicSecret) {
      if (change.publicLink) {
        next.publicSecret = randomBytes(24).toString("base64url");
        next.publicCreatedAt = new Date().toISOString();
      } else {
        delete next.publicSecret;
        delete next.publicCreatedAt;
      }
      await activity(tx, actor, ref, change.publicLink ? T_LINK_ON : T_LINK_OFF, { source: "doc-sharing" });
    }
    const tidied = tidy(next);
    await writeDocSharingEntry(tx, actor.organizationId, docId, tidied);
    return tidied ?? undefined;
  });
  return { entry, role: gate.actorRole };
}

// ── general access on containers ─────────────────────────────────────

/**
 * The activity row for a Space, Folder or List visibility change, written in
 * the caller's transaction. General access changes send no notification, by
 * decision: only a person's own grant notifies them.
 */
export async function recordGeneralAccessChange(
  tx: Tx,
  actor: { userId: string; organizationId: string },
  ref: NodeRef,
  change: { visibility: { from: string | null; to: string } },
): Promise<void> {
  if (change.visibility.from === change.visibility.to) return;
  await activity(tx, { ...actor, orgAdmin: false, orgGuest: false, isAgent: false, denied: false }, ref, T_VISIBILITY, {
    role: change.visibility.to,
    previousRole: change.visibility.from,
    source: "visibility",
  });
}

// ── the workspace's Private rule ─────────────────────────────────────

/**
 * Set ("strict" or "legacy") or clear the workspace's Private rule, with its
 * activity row, in one transaction. It never touches a grant row.
 */
export async function setPrivateRule(organizationId: string, rule: PrivateRule | "clear", actorId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organizationId} FOR UPDATE`;
    await writeOrgSettingsKeys(
      organizationId,
      { accessModel: rule === "clear" ? null : { privateRule: rule, changedAt: new Date().toISOString(), changedById: actorId } },
      tx,
    );
    await tx.activityLog.create({
      data: {
        type: T_RULE,
        actorId,
        organizationId,
        targetType: "organization",
        targetId: organizationId,
        description: accessActivityDescription(T_RULE, null),
        metadata: { rule } as Prisma.InputJsonValue,
        severity: "warning",
      },
    });
  });
}
