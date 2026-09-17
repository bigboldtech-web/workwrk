// Write-path guards.
//
// Invariants 10 to 13 and 16 to 19 are about WRITES (grants, role changes,
// deactivation, invitations, signed URLs, public links), not about decide().
// Their tables (AccessGrant, AccessRequest) do not exist until step 4 and
// their routes are step 3 and step 5, so in step 0 they ship as PURE guard
// functions with golden tests: the rule is written down and asserted now, and
// grants.ts / requests.ts call these when they land.
//
// Pure: imports ./types only. Nothing here writes anything.

import type { AccessSettings, ObjectRole, OrgRole } from "./types";

export interface GuardResult {
  ok: boolean;
  /** Machine-readable refusal, or null when allowed. */
  code: string | null;
  reason: string;
  /** Something the caller must show a confirmation for before proceeding. */
  requiresConfirmation?: boolean;
  /** What the audit row must name (spec 6.1, graft G10). */
  audit?: Record<string, unknown>;
}

const OK: GuardResult = { ok: true, code: null, reason: "" };

/**
 * Invariant 10: at least one Owner per org, always. A change that would leave
 * the org with no Owner is refused; platform staff reset the last Owner from
 * /admin instead.
 */
export function lastOwnerGuard(input: {
  ownerIds: string[];
  targetUserId: string;
  newOrgRole: OrgRole;
}): GuardResult {
  const { ownerIds, targetUserId, newOrgRole } = input;
  const isOwner = ownerIds.includes(targetUserId);
  if (!isOwner || newOrgRole === "OWNER") return OK;
  if (ownerIds.length > 1) return OK;
  return {
    ok: false,
    code: "last_owner",
    reason: "This workspace must always have at least one owner.",
  };
}

/**
 * Invariant 11: last Full holder guard on every object. Refused unless an
 * Owner or Admin does it, and then it is logged with the displaced holder's
 * name.
 */
export function lastFullHolderGuard(input: {
  fullHolderIds: string[];
  targetUserId: string;
  actorOrgRole: OrgRole;
}): GuardResult {
  const { fullHolderIds, targetUserId, actorOrgRole } = input;
  if (!fullHolderIds.includes(targetUserId)) return OK;
  if (fullHolderIds.length > 1) return OK;
  const admin = actorOrgRole === "OWNER" || actorOrgRole === "ADMIN";
  if (!admin) {
    return {
      ok: false,
      code: "last_full_holder",
      reason: "Someone must keep Full access on this. Give it to another person first.",
    };
  }
  return {
    ok: true,
    code: null,
    reason: "Removing the last Full access holder.",
    requiresConfirmation: true,
    audit: { event: "access.changed", displacedUserId: targetUserId },
  };
}

/**
 * Invariant 12 / graft G10: an Admin never silently owns. Deleting or
 * transferring an object the Admin does not own is a confirmed act with an
 * audit row naming the owner.
 */
export function adminOwnsGuard(input: {
  actorUserId: string;
  actorOrgRole: OrgRole;
  objectOwnerId: string | null;
  /**
   * The actor's OBJECT role, from decide(). Invariant 12 is about Admins
   * ("Admin never silently owns"); it does not invent an ownership requirement
   * for Full holders. Spec 3.1 and rule 13 give delete, transfer, move and
   * archive to anyone holding FULL, ownership or not, so a Member granted Full
   * access on a List they did not create must pass this guard. Omitting it
   * (which is what this guard used to do) refused them with `not_owner`.
   */
  actorRole?: ObjectRole | "none";
  confirmed: boolean;
}): GuardResult {
  const { actorUserId, actorOrgRole, objectOwnerId, actorRole, confirmed } = input;
  if (objectOwnerId === actorUserId) return OK;
  // A FULL holder acts on their own authority. Nothing to confirm and nothing
  // to displace: they are on the object's access list by name.
  if (actorRole === "FULL") return OK;
  const admin = actorOrgRole === "OWNER" || actorOrgRole === "ADMIN";
  if (!admin) {
    return { ok: false, code: "not_owner", reason: "Only the owner can do that." };
  }
  if (!confirmed) {
    return {
      ok: false,
      code: "confirmation_required",
      reason: "This belongs to someone else. Confirm to continue.",
      requiresConfirmation: true,
      audit: { event: "access.changed", ownerId: objectOwnerId },
    };
  }
  return {
    ok: true,
    code: null,
    reason: "Admin acted on an object they do not own.",
    audit: { event: "access.changed", ownerId: objectOwnerId, actorUserId },
  };
}

/**
 * Invariant 13: deactivating or removing a person transfers their owned
 * objects and leaves nothing ownerless. The dialog preselects their manager,
 * else the acting admin; automated paths (SCIM, cron) use their manager, else
 * the first Owner. Removing a Guest transfers to the nearest container's
 * owner, else the removing admin.
 */
export function transferTargetFor(input: {
  subjectOrgRole: OrgRole;
  managerId: string | null;
  actingAdminId: string | null;
  firstOwnerId: string | null;
  nearestContainerOwnerId?: string | null;
  automated: boolean;
}): { userId: string | null; via: string } {
  const { subjectOrgRole, managerId, actingAdminId, firstOwnerId, automated } = input;

  if (subjectOrgRole === "GUEST") {
    if (input.nearestContainerOwnerId) {
      return { userId: input.nearestContainerOwnerId, via: "nearest container owner" };
    }
    if (actingAdminId) return { userId: actingAdminId, via: "removing admin" };
    return { userId: firstOwnerId, via: "first owner" };
  }
  if (managerId) return { userId: managerId, via: "manager" };
  if (automated) return { userId: firstOwnerId, via: "first owner" };
  if (actingAdminId) return { userId: actingAdminId, via: "acting admin" };
  return { userId: firstOwnerId, via: "first owner" };
}

/**
 * Invariant 16: denials on discoverable objects are logged, sampled to one row
 * per viewer per target per 10 minutes, never for random id probes.
 */
export const DENIAL_SAMPLE_WINDOW_MS = 10 * 60 * 1000;

export function denialSampleKey(viewerId: string, objectType: string, objectId: string): string {
  return `${viewerId}:${objectType}:${objectId}`;
}

export function shouldLogDenial(input: {
  discoverable: boolean;
  lastLoggedAt: number | null;
  now: number;
}): boolean {
  // A not-discoverable denial is an id probe: never logged.
  if (!input.discoverable) return false;
  if (input.lastLoggedAt === null) return true;
  return input.now - input.lastLoggedAt >= DENIAL_SAMPLE_WINDOW_MS;
}

/**
 * Invariant 17: invitations are domain-locked. An outside-domain email typed
 * by a Member is always a Guest; only Owners and Admins invite outside the
 * domain as Members.
 */
export function invitationOrgRoleFor(input: {
  email: string;
  allowedDomains: string[];
  inviterOrgRole: OrgRole;
  requestedOrgRole: OrgRole;
}): OrgRole {
  const domain = input.email.split("@")[1]?.toLowerCase() ?? "";
  const inDomain =
    input.allowedDomains.length === 0
      ? false
      : input.allowedDomains.some((d) => d.toLowerCase() === domain);
  const admin = input.inviterOrgRole === "OWNER" || input.inviterOrgRole === "ADMIN";

  if (input.requestedOrgRole === "GUEST") return "GUEST";
  if (inDomain) return admin ? input.requestedOrgRole : "MEMBER";
  // Outside the domain: only an Owner or Admin may mint anything but a Guest.
  return admin ? input.requestedOrgRole : "GUEST";
}

// ── The people-data field table (spec 3.5) ────────────────────────

/**
 * How the viewer relates to the person whose row is being written.
 *
 * Owner and Admin are SEPARATE members, not one "owner-admin" rung. Spec 3.5's
 * Role row reads "Owner: all; Admin: orgRole except Owner", and spec 2.1 lists
 * "Promote to Owner" and delegating Admin scopes under what an Admin cannot
 * do. Collapsing the two (which is what this type used to do) let the matrix
 * hand an Admin `write` on adminScopes and, together with the missing
 * promotion check, on `orgRole = OWNER`.
 */
export type PeopleRelationship =
  | "self"
  | "manager-chain"
  | "people-team"
  | "admin"
  | "owner"
  | "none";

export type PeopleFieldGroup =
  | "personal"
  | "membership-p"
  | "membership-a"
  | "role"
  /** Owner-only: adminScopes, which is an Owner delegating to an Admin. */
  | "role-owner-only"
  | "identity";

/**
 * Spec 3.5's field whitelist, enforced at PATCH /api/users/[id]. A field
 * outside the caller's whitelist is a 403 `field_forbidden` naming the field,
 * never a silent drop.
 */
export const PEOPLE_FIELD_GROUP: Record<string, PeopleFieldGroup> = {
  firstName: "personal",
  lastName: "personal",
  avatar: "personal",
  phone: "personal",
  dateOfBirth: "personal",
  presenceStatus: "personal",
  presenceUntil: "personal",
  roleId: "membership-p",
  departmentId: "membership-p",
  officeId: "membership-p",
  managerId: "membership-p",
  dottedLines: "membership-p",
  weeklyCapacityHours: "membership-p",
  status: "membership-a",
  isAgent: "membership-a",
  orgRole: "role",
  adminScopes: "role-owner-only",
  email: "identity",
};

export type FieldAccess = "write" | "read" | "none";

const PEOPLE_FIELD_MATRIX: Record<PeopleFieldGroup, Record<PeopleRelationship, FieldAccess>> = {
  personal: {
    self: "write",
    "manager-chain": "read",
    "people-team": "read",
    admin: "write",
    owner: "write",
    none: "none",
  },
  // Today a manager in the reporting line may write these; that ends. Org
  // structure is not people data (spec 3.5, an expected step-2 mismatch).
  "membership-p": {
    self: "read",
    "manager-chain": "read",
    "people-team": "write",
    admin: "write",
    owner: "write",
    none: "none",
  },
  "membership-a": {
    self: "read",
    "manager-chain": "none",
    "people-team": "read",
    admin: "write",
    owner: "write",
    none: "none",
  },
  // An Admin writes orgRole, but never to OWNER: that is orgRolePromotionGuard
  // below, because the whitelist is per FIELD and the limit is per VALUE.
  role: {
    self: "read",
    "manager-chain": "none",
    "people-team": "read",
    admin: "write",
    owner: "write",
    none: "none",
  },
  "role-owner-only": {
    self: "read",
    "manager-chain": "none",
    "people-team": "read",
    admin: "read",
    owner: "write",
    none: "none",
  },
  // No email-change flow exists; nobody writes it.
  identity: {
    self: "read",
    "manager-chain": "read",
    "people-team": "read",
    admin: "read",
    owner: "read",
    none: "none",
  },
};

/** May this viewer relationship write this field of someone's record? */
export function peopleFieldAccess(field: string, relationship: PeopleRelationship): FieldAccess {
  const group = PEOPLE_FIELD_GROUP[field];
  if (!group) return "none";
  return PEOPLE_FIELD_MATRIX[group][relationship];
}

/**
 * Spec 2.1 and 3.5: only an Owner promotes anyone to Owner, and only an Owner
 * demotes one. peopleFieldAccess answers per field; this answers per VALUE,
 * which is the half the field whitelist structurally cannot express.
 */
export function orgRolePromotionGuard(input: {
  actorRelationship: PeopleRelationship;
  currentOrgRole: OrgRole;
  newOrgRole: OrgRole;
}): GuardResult {
  const { actorRelationship, currentOrgRole, newOrgRole } = input;
  if (actorRelationship === "owner") return OK;
  if (newOrgRole === currentOrgRole) return OK;
  if (newOrgRole === "OWNER") {
    return {
      ok: false,
      code: "owner_only",
      reason: "Only a workspace owner can make someone an owner.",
    };
  }
  if (currentOrgRole === "OWNER") {
    return {
      ok: false,
      code: "owner_only",
      reason: "Only a workspace owner can change another owner's role.",
    };
  }
  return OK;
}

/**
 * Every write to Membership (A) and Role bumps the target's tokenVersion
 * (spec 3.5), which is what makes a demotion or deactivation take effect
 * without waiting for the next token refresh (invariant 9).
 */
export function writeBumpsTokenVersion(field: string): boolean {
  const group = PEOPLE_FIELD_GROUP[field];
  return group === "membership-a" || group === "role" || group === "role-owner-only";
}

/**
 * Invariant 18: signed file URLs are minted only after can(view, file), never
 * from a list payload.
 */
export function mayMintSignedUrl(decision: { allowed: boolean; role: ObjectRole | "none" }): boolean {
  return decision.allowed && decision.role !== "none";
}

/**
 * Invariant 19: public links are off by default and never exceed VIEW.
 * Returns the role a public token may serve, or null when public links are off.
 */
export function publicLinkRole(settings: AccessSettings): ObjectRole | null {
  return settings.publicLinks === "view" ? "VIEW" : null;
}
