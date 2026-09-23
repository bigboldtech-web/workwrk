// Who may read, edit, delete and remind about one announcement.
//
// Spec: docs/plans/ui-refresh/spec-talk.md section 2.3 ("Editing and
// deleting: the author, Owners and Admins") and section 1 Access.
//
// WHAT WAS WRONG. Three different gates answered one question. The POST used
// `requirePermission("announcements","create")`; the PATCH used `isManager()`
// with NO organization check at all, so a manager in one workspace could edit
// another workspace's announcement by id; the DELETE used `isManager()` with
// an org check; and the GET let every manager read every post, so a team lead
// with one report was reading posts aimed at the finance department.
//
// The read widening is the visible behaviour change and it is deliberate: the
// oversight read is Owner, Admin, the People team and the author, which is
// who the spec names. A Member with reports is an ordinary reader now.
//
// NO IMPORTS, on purpose: the three API routes, the page and the drawer all
// read this, and vitest's node environment does not resolve "@/".

/** The org-level role, as `orgRoleOf()` in src/lib/access/org-role.ts spells it. */
export type AnnouncementOrgRole = "OWNER" | "ADMIN" | "MEMBER" | "GUEST" | "AGENT";

export interface AnnouncementViewerFacts {
  userId: string;
  orgRole: AnnouncementOrgRole;
  /**
   * The People team: whoever the permission matrix grants
   * `announcements.create` beyond Owner and Admin. The caller resolves it
   * from the matrix so this module stays a pure rule.
   */
  canCreate: boolean;
}

export interface AnnouncementFacts {
  authorId: string | null;
  organizationId: string;
}

/** An Owner or an Admin. A Guest is never either, whatever else is true. */
export function isOrgAdminRole(role: AnnouncementOrgRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/**
 * The oversight read: who sees a post that is NOT aimed at them.
 * Everybody else reads it only when the audience names them.
 */
export function canReadAnyAnnouncement(v: AnnouncementViewerFacts): boolean {
  if (v.orgRole === "GUEST") return false;
  return isOrgAdminRole(v.orgRole) || v.canCreate;
}

/** A Guest never reaches the announcements app at all (spec section 1 Access). */
export function canOpenAnnouncements(v: Pick<AnnouncementViewerFacts, "orgRole">): boolean {
  return v.orgRole !== "GUEST";
}

/** Edit, pin, unpin and extend expiry: the author, Owners and Admins. */
export function canEditAnnouncement(a: AnnouncementFacts, v: AnnouncementViewerFacts): boolean {
  if (v.orgRole === "GUEST") return false;
  if (isOrgAdminRole(v.orgRole)) return true;
  return Boolean(a.authorId) && a.authorId === v.userId;
}

/** Delete is the same right as edit: nothing here is deleted by a bystander. */
export function canDeleteAnnouncement(a: AnnouncementFacts, v: AnnouncementViewerFacts): boolean {
  return canEditAnnouncement(a, v);
}

/** The Acknowledgments roster and Remind pending: the same holders as edit. */
export function canSeeAckRoster(a: AnnouncementFacts, v: AnnouncementViewerFacts): boolean {
  return canEditAnnouncement(a, v);
}

/**
 * Which audience kinds this viewer may aim at.
 *
 * Owners, Admins and the People team address the organization. A person who
 * only holds Full access on a Space may address that Space and nothing else,
 * which is what makes "People in {Space}" safe to offer at all.
 */
export const ORG_AUDIENCE_KINDS = ["ALL", "DEPARTMENTS", "OFFICES", "USERS", "TAGS"] as const;

export function allowedAudienceKinds(
  v: AnnouncementViewerFacts,
  holdsAnySpaceFullAccess: boolean,
): string[] {
  const kinds: string[] = [];
  if (isOrgAdminRole(v.orgRole) || v.canCreate) kinds.push(...ORG_AUDIENCE_KINDS);
  if (holdsAnySpaceFullAccess || isOrgAdminRole(v.orgRole) || v.canCreate) kinds.push("SPACE");
  return kinds;
}

/** May this viewer post at all? One rule behind the row, the button, the palette entry and the API. */
export function canCreateAnnouncement(
  v: AnnouncementViewerFacts,
  holdsAnySpaceFullAccess = false,
): boolean {
  if (v.orgRole === "GUEST") return false;
  return isOrgAdminRole(v.orgRole) || v.canCreate || holdsAnySpaceFullAccess;
}
