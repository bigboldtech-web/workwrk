// What a person may do inside one conversation (spec-talk.md section 1 Access).
//
// One pure function over four facts, so the page, the right panel, the sidebar
// row menu and the five API routes all answer the same question the same way.
// Nothing here reads prisma, next/navigation or a session: the caller loads the
// row, and this decides. That is what makes it testable and what stops the
// "any member can rename and add people" rule from living in six places.
//
// The ladder is the access model's, not a Talk vocabulary:
//
//   none     not in it, and not allowed to see that it exists
//   view     read messages, files and details; no message box, no reactions
//   comment  view plus reactions and thread replies; no new top-level posts
//   edit     a member: post, react, attach, call, add people, star, leave
//   full     the creator, and Owners and Admins on a PUBLIC channel: also
//            rename, topic, remove members, restricted, archive, transfer
//
// Two rules are easy to get backwards and are therefore stated as code:
//
//   * A private channel has NO admin read-around (access rule 3). An Owner
//     sees its name and member count in Browse channels and may archive it
//     from there, and never reads a message in it. That is why `restricted`
//     short-circuits before the org-role check below.
//   * An archived conversation is capped at `view` for everyone, EXCEPT that
//     a Full holder keeps Full so there is somebody who can restore it. The
//     cap is applied last, over the role the rest of the rules produced.

/** The org-level role, as `orgRoleOf()` in src/lib/access/org-role.ts spells it. */
export type TalkOrgRole = "OWNER" | "ADMIN" | "MEMBER" | "GUEST" | "AGENT";

export type TalkRole = "none" | "view" | "comment" | "edit" | "full";

export interface TalkConversationFacts {
  type: "DM" | "GROUP" | "CHANNEL";
  /** Channel display name without the "#". Null for a DM. */
  name: string | null;
  createdById: string | null;
  restricted: boolean;
  archivedAt: Date | string | null;
}

export interface TalkViewerFacts {
  userId: string;
  orgRole: TalkOrgRole;
  /** Is there a ConversationMember row for this viewer? */
  isMember: boolean;
}

const RANK: Record<TalkRole, number> = { none: 0, view: 1, comment: 2, edit: 3, full: 4 };

/** Rank comparison so callers never string-compare a role. */
export function atLeast(role: TalkRole, floor: TalkRole): boolean {
  return RANK[role] >= RANK[floor];
}

/** #general is the one channel nobody can leave, rename, restrict or archive. */
export function isGeneralChannel(c: Pick<TalkConversationFacts, "type" | "name">): boolean {
  return c.type === "CHANNEL" && (c.name ?? "").trim().toLowerCase() === "general";
}

/** True while the conversation is archived (read-only for everyone but Full). */
export function isArchived(c: Pick<TalkConversationFacts, "archivedAt">): boolean {
  return c.archivedAt != null;
}

/**
 * The viewer's role in this conversation. `none` means 404, never 403: a
 * conversation you are not in must not confirm that it exists, and the one
 * exception (a findable public channel, which renders a Join page) is decided
 * by `canSelfJoin` below rather than by widening this.
 */
export function talkRole(c: TalkConversationFacts, v: TalkViewerFacts): TalkRole {
  const isCreator = Boolean(c.createdById) && c.createdById === v.userId;
  const isOrgAdmin = v.orgRole === "OWNER" || v.orgRole === "ADMIN";

  let role: TalkRole = "none";

  if (c.type === "DM") {
    // Nobody holds Full on a DM: there is no name to change and no member
    // list to manage, so "the creator" would be a power over another person.
    role = v.isMember ? "edit" : "none";
  } else if (c.type === "GROUP") {
    if (isCreator && v.isMember) role = "full";
    else if (v.isMember) role = "edit";
  } else if (c.restricted) {
    // Private channel: no read-around at all, admins included.
    if (isCreator && v.isMember) role = "full";
    else if (v.isMember) role = "edit";
  } else {
    // Public channel.
    if (isCreator || isOrgAdmin) role = "full";
    else if (v.isMember) role = "edit";
  }

  // A Guest never holds more than the membership they were given, and never
  // holds Full: a Guest with Full on a channel could add people to the org's
  // conversation, which is exactly the thing a Guest is not.
  if (v.orgRole === "GUEST" && role === "full") role = "edit";

  // Archived caps everyone at view, except whoever can restore it.
  if (isArchived(c) && role !== "full" && role !== "none") role = "view";

  return role;
}

/**
 * May this viewer self-join by opening the URL? Only a public, findable,
 * unarchived channel, and only a Member (a Guest holds exactly what they were
 * handed). This is the one case where "not a member" renders a Join page
 * instead of a 404.
 */
export function canSelfJoin(
  c: TalkConversationFacts & { findable: boolean },
  v: TalkViewerFacts,
): boolean {
  if (v.isMember) return false;
  if (v.orgRole === "GUEST") return false;
  if (c.type !== "CHANNEL") return false;
  if (c.restricted) return false;
  if (isArchived(c)) return false;
  return c.findable;
}

/** Post a new top-level message. */
export function canPost(c: TalkConversationFacts, role: TalkRole): boolean {
  return !isArchived(c) && atLeast(role, "edit");
}

/** React or reply in a thread (the Can comment acts). */
export function canReact(c: TalkConversationFacts, role: TalkRole): boolean {
  return !isArchived(c) && atLeast(role, "comment");
}

/** Start or join a call on this conversation. */
export function canCall(c: TalkConversationFacts, role: TalkRole): boolean {
  return !isArchived(c) && atLeast(role, "edit");
}

/** Add people. Public channels: any member. Private channels and groups: Full. */
export function canAddPeople(c: TalkConversationFacts, role: TalkRole): boolean {
  if (isArchived(c)) return false;
  if (c.type === "DM") return false;
  if (c.type === "CHANNEL" && !c.restricted) return atLeast(role, "edit");
  return atLeast(role, "full");
}

/** Rename. Full only, never a DM, never #general. */
export function canRename(c: TalkConversationFacts, role: TalkRole): boolean {
  if (c.type === "DM") return false;
  if (isGeneralChannel(c)) return false;
  if (isArchived(c)) return false;
  return atLeast(role, "full");
}

/** Edit the topic. Full only, channels and groups. */
export function canEditTopic(c: TalkConversationFacts, role: TalkRole): boolean {
  if (c.type === "DM") return false;
  if (isArchived(c)) return false;
  return atLeast(role, "full");
}

/** Archive. Full only, channels except #general. Restore is the same right. */
export function canArchive(c: TalkConversationFacts, role: TalkRole): boolean {
  if (c.type !== "CHANNEL") return false;
  if (isGeneralChannel(c)) return false;
  return atLeast(role, "full");
}

/** Flip Restricted or Findable. Full only, channels except #general. */
export function canSetVisibility(c: TalkConversationFacts, role: TalkRole): boolean {
  return canArchive(c, role);
}

/** Remove another member, or transfer ownership. Full only, never a DM. */
export function canManageMembers(c: TalkConversationFacts, role: TalkRole): boolean {
  if (c.type === "DM") return false;
  if (isArchived(c)) return false;
  return atLeast(role, "full");
}

/** Leave. Members of a channel or group, never a DM (that is Close), never
 *  #general (everyone belongs in the company channel). */
export function canLeave(c: TalkConversationFacts, v: TalkViewerFacts): boolean {
  if (!v.isMember) return false;
  if (c.type === "DM") return false;
  if (isGeneralChannel(c)) return false;
  return true;
}

/** Copy or reset the guest link. Copy is an `edit` act, Reset is Full. */
export function canCopyGuestLink(c: TalkConversationFacts, role: TalkRole): boolean {
  return !isArchived(c) && atLeast(role, "edit");
}
export function canResetGuestLink(c: TalkConversationFacts, role: TalkRole): boolean {
  return !isArchived(c) && atLeast(role, "full");
}

/** The read-only banner sentence, or null when the viewer may write. */
export function readOnlyReason(
  c: TalkConversationFacts,
  role: TalkRole,
  ownerName: string | null,
): string | null {
  if (isArchived(c) && role !== "full") {
    return ownerName ? `Archived. Ask ${ownerName} to restore.` : "Archived. Ask a workspace admin to restore.";
  }
  if (isArchived(c)) return "Archived. Restore it to post again.";
  if (role === "view") return "View only.";
  if (role === "comment") return "You can react and reply in threads here.";
  return null;
}
