// The /join decisions, pure (spec-account-auth `/join`): which of the four
// variants renders, which failure screen an invitation earns, the role in
// the four-role words, and where the person lands afterwards. The GET and
// POST on /api/auth/accept-invite and the page share these, so the page
// never guesses what the server will do.

import { OBJECT_ROLE_LABEL, ORG_ROLE_LABEL } from "./labels";
import { roleFromSpaceRole } from "./id-sets";
import { orgRoleOf } from "./org-role";
import { WORK_HOME_HREF } from "../nav/route-hub";

export type JoinOrgRole = "ADMIN" | "MEMBER" | "GUEST";

/**
 *   A  a new person, signed out: names and a password.
 *   B  this address already has a live account, signed out: log in first.
 *   C  signed in as the invited address: one click, no password.
 *   D  signed in as somebody else: log out first, nothing is posted.
 */
export type JoinVariant = "A" | "B" | "C" | "D";

export type InviteFailure = "invalid" | "used" | "expired" | "member";

function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function joinVariant(input: { sessionEmail: string | null | undefined; inviteEmail: string; accountExists: boolean }): JoinVariant {
  if (input.sessionEmail) return sameEmail(input.sessionEmail, input.inviteEmail) ? "C" : "D";
  return input.accountExists ? "B" : "A";
}

/** The failure an invitation row earns, or null when it can be accepted. "member" is checked by the caller (it needs the database). */
export function inviteFailure(row: { accepted: boolean; expiresAt: Date } | null, now: Date = new Date()): Exclude<InviteFailure, "member"> | null {
  if (!row) return "invalid";
  if (row.accepted) return "used";
  if (row.expiresAt.getTime() < now.getTime()) return "expired";
  return null;
}

/**
 * The org role an invitation gives, never Owner (Owner is never given by
 * invitation, and SUPER_ADMIN is refused at invite time). A level the
 * mapping does not know reads as Member, the conservative answer for a row
 * that already exists.
 */
export function inviteOrgRole(accessLevel: string | null | undefined, explicit?: string | null): JoinOrgRole {
  if (explicit === "GUEST" || explicit === "ADMIN" || explicit === "MEMBER") return explicit;
  const role = orgRoleOf({ accessLevel: accessLevel ?? "EMPLOYEE", isEarliestAdmin: false });
  return role === "OWNER" || role === "ADMIN" ? "ADMIN" : "MEMBER";
}

export function inviteRoleLabel(role: JoinOrgRole): string {
  return ORG_ROLE_LABEL[role];
}

/** A Space invitation's role there, in the access model's words ("Can edit"). */
export function spaceObjectRoleLabel(spaceRole: string | null | undefined): string {
  return OBJECT_ROLE_LABEL[roleFromSpaceRole(spaceRole ?? "MEMBER")];
}

/** Where the person lands after joining: the invitation's object, else its Space, else Work home. Never guessed by the client. */
export function joinLanding(input: { objectUrl?: string | null; spaceId?: string | null }): string {
  if (input.objectUrl && input.objectUrl.startsWith("/") && !input.objectUrl.startsWith("//")) return input.objectUrl;
  if (input.spaceId) return `/spaces/${encodeURIComponent(input.spaceId)}`;
  return WORK_HOME_HREF;
}

/** Names are plain text: no angle brackets, collapsed whitespace, capped (they reach email HTML and exports). */
export function cleanPersonName(value: unknown, max = 60): string {
  return typeof value === "string" ? value.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";
}
