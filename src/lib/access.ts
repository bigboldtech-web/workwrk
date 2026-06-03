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
import { getEffectiveReportTree, isInReportTree } from "@/lib/reporting-line";
import { hrCanReadUser } from "@/lib/hr-segment";
import type { AccessLevel } from "@/generated/prisma";

// ── Types ─────────────────────────────────────────────────────────

export type Permission = "read" | "edit" | "admin";

export type ResourceRef =
  | { type: "space";          id: string }
  | { type: "board";          id: string }
  | { type: "item";           id: string }   // a Board Item row
  | { type: "user";           id: string }   // another user's profile / aggregates
  | { type: "weekly-review";  id: string }
  | { type: "kra";            id: string }
  | { type: "module";         name: ModuleName };

export type ModuleName =
  | "today"             // every authed user
  | "team/alignment"    // manager+
  | "team/reviews"      // manager+
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

const ORG_ADMIN_LEVELS = new Set<string>(["SUPER_ADMIN", "COMPANY_ADMIN"]);
const DIRECTOR_LEVELS = new Set<string>(["SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR"]);
const MANAGER_LEVELS  = new Set<string>(["SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR", "MANAGER", "TEAM_LEAD", "HR"]);

export function isOrgAdmin(viewer: ViewerContext): boolean {
  return ORG_ADMIN_LEVELS.has(String(viewer.accessLevel));
}
export function isDirectorOrAbove(viewer: ViewerContext): boolean {
  return DIRECTOR_LEVELS.has(String(viewer.accessLevel));
}
export function isManagerOrAbove(viewer: ViewerContext): boolean {
  return MANAGER_LEVELS.has(String(viewer.accessLevel));
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

async function resolveSpace(viewer: ViewerContext, spaceId: string): Promise<AccessDecision> {
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    include: { members: { where: { userId: viewer.userId }, select: { role: true } } },
  });
  if (!space || space.organizationId !== viewer.organizationId) {
    return { permission: "none", reason: "space not found in your org" };
  }
  if (isOrgAdmin(viewer)) return { permission: "admin", reason: "org admin override" };

  const member = space.members[0];
  if (member?.role === "OWNER" || member?.role === "ADMIN") {
    return { permission: "edit", reason: `space ${member.role.toLowerCase()}` };
  }
  if (member?.role === "MEMBER" || member?.role === "GUEST") {
    return { permission: "read", reason: `space ${member.role.toLowerCase()}` };
  }
  if (space.visibility === "ORG") {
    return { permission: "read", reason: "space is org-visible" };
  }
  return { permission: "none", reason: "not a member of this space" };
}

async function resolveBoard(viewer: ViewerContext, boardId: string): Promise<AccessDecision> {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { spaceId: true, organizationId: true, visibility: true },
  });
  if (!board || board.organizationId !== viewer.organizationId) {
    return { permission: "none", reason: "board not found in your org" };
  }
  if (isOrgAdmin(viewer)) return { permission: "admin", reason: "org admin override" };
  if (!board.spaceId) {
    return { permission: "none", reason: "board not attached to a space" };
  }
  // Inherit from parent space, but boards can be narrower (PRIVATE
  // overrides a WORKSPACE space). Phase 6b can add BoardACL.
  const spaceDecision = await resolveSpace(viewer, board.spaceId);
  if (spaceDecision.permission === "none") return spaceDecision;
  if (board.visibility === "PRIVATE" && spaceDecision.permission === "read") {
    return { permission: "none", reason: "board is private to its owners" };
  }
  return spaceDecision;
}

async function resolveItem(viewer: ViewerContext, itemId: string): Promise<AccessDecision> {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { boardId: true, ownerId: true, organizationId: true },
  });
  if (!item || item.organizationId !== viewer.organizationId) {
    return { permission: "none", reason: "item not found in your org" };
  }
  if (isOrgAdmin(viewer)) return { permission: "admin", reason: "org admin override" };
  // Inherit from parent board.
  const boardDecision = await resolveBoard(viewer, item.boardId);
  if (boardDecision.permission === "none") return boardDecision;
  // Item owners always have at least edit on their own row.
  if (item.ownerId === viewer.userId && boardDecision.permission === "read") {
    return { permission: "edit", reason: "you own this item" };
  }
  return boardDecision;
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
    case "board":          return resolveBoard(viewer, resource.id);
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
