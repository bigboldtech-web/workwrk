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

/** Map a Space/Folder/Board membership role to a decision: OWNER/ADMIN edit,
 *  MEMBER/GUEST read, anything else (no row) → null so the caller falls through
 *  to the next access source. */
function roleToDecision(role: string | null | undefined, reason: string): AccessDecision | null {
  if (role === "OWNER" || role === "ADMIN") {
    return { permission: "edit", reason: `${reason} (${role.toLowerCase()})` };
  }
  if (role === "MEMBER" || role === "GUEST") {
    return { permission: "read", reason: `${reason} (${role.toLowerCase()})` };
  }
  return null;
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

// ── Folder ────────────────────────────────────────────────────────
//
// Access is additive + inherited DOWNWARD: a grant on a Folder (or any of its
// ancestor folders, or the parent Space) grants the folder; a grant lower down
// never leaks upward. A folder-only grantee reaches this folder without any
// Space membership — this is what lets "share one folder" work.
async function resolveFolder(viewer: ViewerContext, folderId: string): Promise<AccessDecision> {
  const folder = await prisma.folder.findUnique({
    where: { id: folderId },
    select: {
      organizationId: true, spaceId: true, ownerId: true,
      visibility: true, parentFolderId: true,
      members: { where: { userId: viewer.userId }, select: { role: true } },
    },
  });
  if (!folder || folder.organizationId !== viewer.organizationId) {
    return { permission: "none", reason: "folder not found in your org" };
  }
  if (isOrgAdmin(viewer)) return { permission: "admin", reason: "org admin override" };

  const grant = roleToDecision(folder.members[0]?.role, "folder member");
  if (grant) return grant;
  if (folder.ownerId === viewer.userId) return { permission: "edit", reason: "folder owner" };

  // A grant on any ANCESTOR folder covers this one (inheritance downward).
  let cursor = folder.parentFolderId;
  for (let hops = 0; cursor && hops < 8; hops++) {
    const parent = await prisma.folder.findUnique({
      where: { id: cursor },
      select: { parentFolderId: true, members: { where: { userId: viewer.userId }, select: { role: true } } },
    });
    if (!parent) break;
    const inherited = roleToDecision(parent.members[0]?.role, "inherited folder grant");
    if (inherited) return inherited;
    cursor = parent.parentFolderId;
  }

  // A PRIVATE folder is reachable ONLY by an explicit folder/owner grant or an
  // org admin — all handled above. Mere space membership, even OWNER/ADMIN,
  // does NOT pierce it, matching folderVisibleTo and the sidebar/space-page
  // prune. (Whoever reaches this line is not org admin, owner, or a grant
  // holder, so PRIVATE = deny outright.)
  if (folder.visibility === "PRIVATE") {
    return { permission: "none", reason: "folder is private" };
  }
  // Otherwise inherit from the Space.
  return resolveSpace(viewer, folder.spaceId);
}

async function resolveBoard(viewer: ViewerContext, boardId: string): Promise<AccessDecision> {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { spaceId: true, folderId: true, organizationId: true, visibility: true },
  });
  if (!board || board.organizationId !== viewer.organizationId) {
    return { permission: "none", reason: "board not found in your org" };
  }
  if (isOrgAdmin(viewer)) return { permission: "admin", reason: "org admin override" };
  if (!board.spaceId && !board.folderId) {
    return { permission: "none", reason: "board not attached to a space" };
  }
  // A board in a Folder inherits the FOLDER's decision — which itself handles
  // PRIVATE folders, folder grants (so a shared folder's boards open) and the
  // space cascade. A board directly under a Space (no folder) inherits the
  // Space. This is the single gate: routing folder boards through resolveSpace
  // would wrongly reveal a board inside a PRIVATE folder to space members.
  const decision = board.folderId
    ? await resolveFolder(viewer, board.folderId)
    : await resolveSpace(viewer, board.spaceId as string);
  if (decision.permission === "none") return decision;
  // Boards can be narrower than their container (PRIVATE overrides a WORKSPACE).
  if (board.visibility === "PRIVATE" && decision.permission === "read") {
    return { permission: "none", reason: "board is private to its owners" };
  }
  return decision;
}

// ── Doc / note ────────────────────────────────────────────────────
//
// A doc inherits its container: a FOLDER doc from its folder, a SPACE doc from
// its space, a TASK doc from its item. A standalone note (no container) stays
// org-visible, preserving the pre-ACL behaviour for personal notes.
async function resolveDoc(viewer: ViewerContext, docId: string): Promise<AccessDecision> {
  const doc = await prisma.doc.findUnique({
    where: { id: docId },
    select: { organizationId: true, entityType: true, entityId: true, createdById: true },
  });
  if (!doc || doc.organizationId !== viewer.organizationId) {
    return { permission: "none", reason: "doc not found in your org" };
  }
  if (isOrgAdmin(viewer)) return { permission: "admin", reason: "org admin override" };
  if (doc.entityId) {
    // A personal NOTEPAD note is owner-only — even org admins get no read-around
    // (entityId is the owner's userId). Checked BEFORE createdById because a
    // note captured on someone's behalf still belongs to entityId, not the
    // creator. Mirrors docAccessible's NOTEPAD rule.
    if (doc.entityType === "NOTEPAD") {
      return doc.entityId === viewer.userId
        ? { permission: "edit", reason: "your notepad" }
        : { permission: "none", reason: "someone else's notepad" };
    }
    if (doc.createdById === viewer.userId) return { permission: "edit", reason: "you created this doc" };
    if (doc.entityType === "FOLDER") return resolveFolder(viewer, doc.entityId);
    if (doc.entityType === "SPACE") return resolveSpace(viewer, doc.entityId);
    if (doc.entityType === "BOARD") return resolveBoard(viewer, doc.entityId);
    // Item-anchored docs: the live shape is BOARD_ITEM; TASK/BOARD_ROW are
    // tolerated as historical aliases. All defer to the parent item's board.
    if (doc.entityType === "BOARD_ITEM" || doc.entityType === "TASK" || doc.entityType === "BOARD_ROW") {
      return resolveItem(viewer, doc.entityId);
    }
  }
  if (doc.createdById === viewer.userId) return { permission: "edit", reason: "you created this doc" };
  return { permission: "read", reason: "standalone note, org-visible" };
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
