// Central access resolver — the architectural lid.
//
// Every page and API can call `resolveAccess(viewer, resource)` to
// get a uniform `{ permission, reason }` decision rather than
// reinventing role/membership/reporting checks. The resolver composes:
//
//   1. Org-admin override (SUPER_ADMIN / COMPANY_ADMIN → admin on everything in their org)
//   2. Resource ownership / membership (Space members, Board parent-Space, etc.)
//   3. Reporting-tree visibility (managers see their effective tree)
//   4. HR segment ownership (HR users see their segment)
//   5. Role-tier defaults (employees only see their own surfaces)
//
// Three permission levels: `read`, `edit`, `admin`. `none` = denied.
//
// Migration strategy: this file is additive. Existing helpers
// (canEditSpace, isInReportTree, etc.) still work; new code SHOULD
// use resolveAccess so policy is centralized. Phase 6 migrates the
// /team pages as proof; subsequent phases will refactor more.

import { prisma } from "@/lib/prisma";
import { delegatedNodeRole } from "@/lib/access/delegate";
import { getEffectiveReportTree, isInReportTree } from "@/lib/reporting-line";
import { hrCanReadUser } from "@/lib/hr-segment";
import type { AccessLevel } from "@/generated/prisma";
import {
  legacyIsAdminLevel,
  legacyIsDirectorLevel,
  legacyIsManagerLevel,
} from "@/lib/access/legacy-levels";
import { nodeCtxFromLevel, nodeRoles } from "@/lib/access/node-access";
import { toLegacyPermission, type NodeDecision, type NodeRef, type NodeVia } from "@/lib/access/node-rules";
import { loadRows, seedsOf } from "@/lib/access/node-world";
import { nodeName } from "@/lib/access/node-tree";

// ── Types ─────────────────────────────────────────────────────────

export type Permission = "read" | "edit" | "admin";

export type ResourceRef =
  | { type: "space";          id: string }
  | { type: "folder";         id: string }   // a Folder inside a Space
  | { type: "board";          id: string }
  | { type: "doc";            id: string }   // a Doc / note
  | { type: "item";           id: string }   // a Board Item row
  | { type: "user";           id: string }   // another user's profile / aggregates
  | { type: "weekly-review";  id: string }
  | { type: "kra";            id: string }
  | { type: "module";         name: ModuleName };

export type ModuleName =
  | "today"             // every authed user
  | "team/alignment"    // manager+
  | "team/reviews"      // manager+
  | "team/kpi-reviews"  // manager+
  | "team/rollup"       // director+
  | "org/admin"         // org admin
  | "spaces"            // every authed user
  | "boards"            // every authed user
  | "kra-kpi"           // every authed user reads; managers edit
  | "sops"              // every authed user reads; managers edit
  | "people"            // manager+ for full directory
  | "settings/org";     // org admin

export interface ViewerContext {
  userId: string;
  organizationId: string;
  accessLevel: AccessLevel | string;
}

export interface AccessDecision {
  permission: Permission | "none";
  /** Why this decision was made — useful for audit + support. */
  reason: string;
}

// ── Role tiers ────────────────────────────────────────────────────

// The three tier sets moved to src/lib/access/legacy-levels.ts (migration step
// 1). String() is preserved around accessLevel so an enum value and a plain
// string still compare the same way.

export function isOrgAdmin(viewer: ViewerContext): boolean {
  return legacyIsAdminLevel(String(viewer.accessLevel));
}
export function isDirectorOrAbove(viewer: ViewerContext): boolean {
  return legacyIsDirectorLevel(String(viewer.accessLevel));
}
export function isManagerOrAbove(viewer: ViewerContext): boolean {
  return legacyIsManagerLevel(String(viewer.accessLevel));
}

// ── Module-level gate ─────────────────────────────────────────────

function resolveModule(viewer: ViewerContext, name: ModuleName): AccessDecision {
  switch (name) {
    case "today":
    case "spaces":
    case "boards":
    case "kra-kpi":
    case "sops":
      return { permission: "read", reason: "open to every authenticated user in the org" };
    case "people":
      return isManagerOrAbove(viewer)
        ? { permission: "read", reason: "manager+ access level" }
        : { permission: "read", reason: "limited to your own row (employee tier)" };
    case "team/alignment":
    case "team/reviews":
    case "team/kpi-reviews":
      return isManagerOrAbove(viewer)
        ? { permission: "read", reason: "manager+ access level" }
        : { permission: "none", reason: "below manager tier" };
    case "team/rollup":
      return isDirectorOrAbove(viewer)
        ? { permission: "read", reason: "director+ access level" }
        : { permission: "none", reason: "below director tier" };
    case "org/admin":
    case "settings/org":
      return isOrgAdmin(viewer)
        ? { permission: "admin", reason: "org-admin access level" }
        : { permission: "none", reason: "not an org admin" };
  }
}

// ── Resource resolvers ────────────────────────────────────────────

// The five object resolvers below answer through the one node-access
// resolver (src/lib/access/node-access.ts), so GET /api/boards?folderId,
// /api/me/access, the folder members route, work/locate and the Folder page
// follow the same answer as the Work tree and every write gate. Full access
// (or the Space Owner rung) is "admin", Can edit is "edit", Can comment and
// Can view are "read". The reason is the via, in words.
//
// resolveUser, resolveWeeklyReview, resolveKra and resolveModule are NOT
// node reads: they resolve people data and nav tiers and stay as they were.

const ROLE_WORD: Record<string, string> = { OWNER: "owner", FULL: "admin", EDIT: "member", COMMENT: "commenter", VIEW: "guest" };

function reasonFor(d: NodeDecision, ref: NodeRef, name: (r: NodeRef) => string): string {
  const via: NodeVia = d.via;
  const word = ROLE_WORD[d.role] ?? "member";
  switch (via.type) {
    case "org_admin":
      return "org admin override";
    case "own":
      if (via.source === "SpaceMember") return `space ${word}`;
      if (via.source === "FolderMember") return `folder member (${word})`;
      if (via.source === "BoardMember") return `list member (${word})`;
      return "shared with you";
    case "owner":
      return ref.kind === "doc" ? "you created this doc" : `${ref.kind === "list" ? "list" : ref.kind} owner`;
    case "lift":
      return "space manager named on this folder";
    case "pierce":
      return "space owner";
    case "inherited":
      return `inherited from ${name(via.node)}`;
    case "everyone":
      return via.node ? `${via.node.kind === "list" ? "list" : "space"} is org-visible` : "open to everyone in the org";
    case "floor":
      return "shared before the new rule";
    default:
      return `no access to this ${ref.kind === "list" ? "board" : ref.kind}`;
  }
}

async function resolveNode(viewer: ViewerContext, ref: NodeRef): Promise<AccessDecision> {
  const ctx = nodeCtxFromLevel(viewer.userId, viewer.organizationId, String(viewer.accessLevel));
  const decisions = await nodeRoles(ctx, [ref]);
  const live = decisions.get(`${ref.kind}:${ref.id}`);
  // Step 1 under ACCESS_V2_RESOLVER + ACCESS_V2_TABLES: can()'s role (the
  // same node-access answer plus the engine's caps); otherwise the live one.
  const delegated = live ? await delegatedNodeRole(viewer.userId, viewer.organizationId, String(viewer.accessLevel), ref, live.role) : null;
  const d = live && delegated !== null && delegated !== live.role ? { ...live, role: delegated } : live;
  if (!d || d.role === "none") {
    const exists = await nodeExists(viewer.organizationId, ref);
    if (!exists) return { permission: "none", reason: `${ref.kind === "list" ? "board" : ref.kind} not found in your org` };
    return { permission: "none", reason: d ? reasonFor(d, ref, () => "") : "no access" };
  }
  const rows = await loadRows(viewer.organizationId, seedsOf([ref]), { rowsOnly: true });
  return { permission: toLegacyPermission(d.role), reason: reasonFor(d, ref, (r) => nodeName(rows, r)) };
}

async function nodeExists(organizationId: string, ref: NodeRef): Promise<boolean> {
  const where = { id: ref.id, organizationId };
  switch (ref.kind) {
    case "space":
      return !!(await prisma.space.findFirst({ where, select: { id: true } }));
    case "folder":
      return !!(await prisma.folder.findFirst({ where, select: { id: true } }));
    case "list":
      return !!(await prisma.board.findFirst({ where, select: { id: true } }));
    case "doc":
      return !!(await prisma.doc.findFirst({ where, select: { id: true } }));
    default:
      return false;
  }
}

async function resolveSpace(viewer: ViewerContext, spaceId: string): Promise<AccessDecision> {
  return resolveNode(viewer, { kind: "space", id: spaceId });
}

async function resolveFolder(viewer: ViewerContext, folderId: string): Promise<AccessDecision> {
  return resolveNode(viewer, { kind: "folder", id: folderId });
}

async function resolveBoard(viewer: ViewerContext, boardId: string): Promise<AccessDecision> {
  return resolveNode(viewer, { kind: "list", id: boardId });
}

async function resolveDoc(viewer: ViewerContext, docId: string): Promise<AccessDecision> {
  return resolveNode(viewer, { kind: "doc", id: docId });
}

/** A task follows its List; the task's owner edits where the List reads (today). */
async function resolveItem(viewer: ViewerContext, itemId: string): Promise<AccessDecision> {
  const item = await prisma.item.findFirst({ where: { id: itemId, organizationId: viewer.organizationId }, select: { boardId: true, ownerId: true } });
  if (!item) return { permission: "none", reason: "item not found in your org" };
  const board = await resolveNode(viewer, { kind: "list", id: item.boardId });
  if (board.permission === "read" && item.ownerId === viewer.userId) return { permission: "edit", reason: "you own this item" };
  return board;
}

async function resolveUser(viewer: ViewerContext, targetUserId: string): Promise<AccessDecision> {
  // Anyone can read their own row at edit level (settings, prefs).
  if (targetUserId === viewer.userId) {
    return { permission: "edit", reason: "your own profile" };
  }
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { organizationId: true },
  });
  if (!target || target.organizationId !== viewer.organizationId) {
    return { permission: "none", reason: "user not found in your org" };
  }
  if (isOrgAdmin(viewer)) return { permission: "admin", reason: "org admin override" };

  // Director+ sees their entire reporting tree.
  if (isDirectorOrAbove(viewer)) {
    const inTree = await isInReportTree(viewer.userId, targetUserId);
    if (inTree) return { permission: "edit", reason: "in your reporting tree (director)" };
  }
  // Manager — solid + dotted direct reports edit; tree below read.
  if (isManagerOrAbove(viewer)) {
    const tree = await getEffectiveReportTree(viewer.userId, { maxDepth: 6 });
    if (tree.includes(targetUserId)) {
      return { permission: "edit", reason: "in your reporting tree (manager)" };
    }
  }
  // HR — segment ownership.
  const hrOk = await hrCanReadUser(viewer.userId, targetUserId);
  if (hrOk) return { permission: "read", reason: "in your HR segment" };

  // Everyone in the same org has at least read on minimal profile
  // fields (name, avatar, email) — needed for tagging / @mentions.
  return { permission: "read", reason: "same-org peer (minimal profile)" };
}

async function resolveWeeklyReview(viewer: ViewerContext, reviewId: string): Promise<AccessDecision> {
  const review = await prisma.weeklyReview.findUnique({
    where: { id: reviewId },
    select: { organizationId: true, userId: true, managerId: true },
  });
  if (!review || review.organizationId !== viewer.organizationId) {
    return { permission: "none", reason: "review not found in your org" };
  }
  if (review.userId === viewer.userId) {
    return { permission: "edit", reason: "your review" };
  }
  if (review.managerId === viewer.userId) {
    return { permission: "edit", reason: "you are the recorded manager" };
  }
  if (isOrgAdmin(viewer)) return { permission: "admin", reason: "org admin override" };
  // Director / VP can read down their tree.
  if (isDirectorOrAbove(viewer)) {
    const inTree = await isInReportTree(viewer.userId, review.userId);
    if (inTree) return { permission: "read", reason: "subject is in your reporting tree" };
  }
  return { permission: "none", reason: "not your review and not your report" };
}

async function resolveKra(viewer: ViewerContext, kraId: string): Promise<AccessDecision> {
  const kra = await prisma.kRA.findUnique({
    where: { id: kraId },
    include: { assignments: { where: { userId: viewer.userId }, select: { id: true }, take: 1 } },
  });
  if (!kra || kra.organizationId !== viewer.organizationId) {
    return { permission: "none", reason: "KRA not found in your org" };
  }
  if (isOrgAdmin(viewer)) return { permission: "admin", reason: "org admin override" };
  if (isManagerOrAbove(viewer)) return { permission: "edit", reason: "manager+ can edit KRAs" };
  if (kra.assignments.length > 0) {
    return { permission: "read", reason: "assigned to you" };
  }
  // Other employees can read for tagging items but not edit.
  return { permission: "read", reason: "same-org employee (read-only)" };
}

// ── Main entrypoint ───────────────────────────────────────────────

/**
 * Single resolver every gate should call. Pure function in spirit
 * (no side effects); it does DB reads to resolve membership but
 * never writes. Failures (denied) include a `reason` string for
 * audit + UX surface.
 */
export async function resolveAccess(
  viewer: ViewerContext,
  resource: ResourceRef,
): Promise<AccessDecision> {
  switch (resource.type) {
    case "module":         return resolveModule(viewer, resource.name);
    case "space":          return resolveSpace(viewer, resource.id);
    case "folder":         return resolveFolder(viewer, resource.id);
    case "board":          return resolveBoard(viewer, resource.id);
    case "doc":            return resolveDoc(viewer, resource.id);
    case "item":           return resolveItem(viewer, resource.id);
    case "user":           return resolveUser(viewer, resource.id);
    case "weekly-review":  return resolveWeeklyReview(viewer, resource.id);
    case "kra":            return resolveKra(viewer, resource.id);
  }
}

// ── Convenience helpers ───────────────────────────────────────────

const PERM_RANK: Record<Permission | "none", number> = {
  none: 0, read: 1, edit: 2, admin: 3,
};

export function meets(decision: AccessDecision, required: Permission): boolean {
  return PERM_RANK[decision.permission] >= PERM_RANK[required];
}

export async function canRead(viewer: ViewerContext, resource: ResourceRef): Promise<boolean> {
  const d = await resolveAccess(viewer, resource);
  return meets(d, "read");
}

export async function canEdit(viewer: ViewerContext, resource: ResourceRef): Promise<boolean> {
  const d = await resolveAccess(viewer, resource);
  return meets(d, "edit");
}

/**
 * Server-side gate that returns a decision; call sites decide whether
 * to redirect, throw 403, etc. Throws if the resolver fails (DB error).
 */
export async function requireAccess(
  viewer: ViewerContext,
  resource: ResourceRef,
  required: Permission,
): Promise<AccessDecision> {
  const decision = await resolveAccess(viewer, resource);
  if (!meets(decision, required)) {
    // Phase 6b can write to an AuditLog row here for denied access.
    return { permission: "none", reason: decision.reason };
  }
  return decision;
}
