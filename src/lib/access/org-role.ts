// orgRoleOf: today's AccessLevel ladder mapped onto the four org roles.
//
// Spec 2.1's mapping table, verbatim:
//
//   SUPER_ADMIN            -> Owner
//   COMPANY_ADMIN          -> Owner if the org's earliest-created admin, else Admin
//   C_LEVEL, VP, DIRECTOR  -> Member
//   HR                     -> Member, auto-added to the People team
//   MANAGER, TEAM_LEAD     -> Member
//   EMPLOYEE               -> Member
//   AGENT                  -> Member + Agent flag
//   (none)                 -> Guest
//
// Step 0 runs entirely over today's tables: there is no User.orgRole column
// yet (confirmed absent in prisma/schema.prisma), so this mapping IS the org
// role until step 4 writes the column. Kept pure so the golden suite and the
// parity harness can both call it.
//
// Pure: imports only ./types.

import type { AdminScope, OrgRole } from "./types";

export const OWNER_ACCESS_LEVEL = "SUPER_ADMIN";
export const ADMIN_ACCESS_LEVEL = "COMPANY_ADMIN";

export interface OrgRoleInput {
  accessLevel: string | null | undefined;
  /**
   * True when this COMPANY_ADMIN is the org's earliest-created admin. The
   * backfill's pre-flight report (spec 10 step 4.1) picks that person per org;
   * until then a caller that cannot tell passes false and gets Admin, which is
   * the conservative answer (Admin is a strict subset of Owner).
   */
  isEarliestAdmin?: boolean;
}

/** Spec 2.1. An unknown or missing level is a Guest, never a Member. */
export function orgRoleOf(input: OrgRoleInput): OrgRole {
  const level = input.accessLevel ?? null;
  if (!level) return "GUEST";
  if (level === OWNER_ACCESS_LEVEL) return "OWNER";
  if (level === ADMIN_ACCESS_LEVEL) return input.isEarliestAdmin ? "OWNER" : "ADMIN";
  if (
    level === "C_LEVEL" ||
    level === "VP" ||
    level === "DIRECTOR" ||
    level === "MANAGER" ||
    level === "TEAM_LEAD" ||
    level === "HR" ||
    level === "EMPLOYEE" ||
    level === "AGENT"
  ) {
    return "MEMBER";
  }
  return "GUEST";
}

/** Spec 2.1: AGENT becomes Member + the Agent flag. */
export function isAgentOf(accessLevel: string | null | undefined): boolean {
  return accessLevel === "AGENT";
}

/**
 * Spec 10 step 0: "People team = users at HR until toggle 6 exists." A viewer
 * whose stored People-team list is empty falls back to this.
 */
export function isSeededPeopleTeam(accessLevel: string | null | undefined): boolean {
  return accessLevel === "HR";
}

/**
 * The written mirror (spec 10 step 0): User.accessLevel and the JWT claim stay
 * for two releases, derived from orgRole + isAgent on every role change. This
 * is the inverse map, used by the step-4 writer and by the parity harness when
 * it needs to state today's level for a synthesised viewer.
 */
export function accessLevelMirror(orgRole: OrgRole, isAgent: boolean): string {
  if (orgRole === "OWNER") return OWNER_ACCESS_LEVEL;
  if (orgRole === "ADMIN") return ADMIN_ACCESS_LEVEL;
  if (orgRole === "GUEST") return "EMPLOYEE";
  return isAgent ? "AGENT" : "EMPLOYEE";
}

/**
 * Owners hold both Admin scopes implicitly (spec 2.1). There is no
 * User.adminScopes column today, so every Admin starts with none.
 */
export function adminScopesOf(orgRole: OrgRole, stored: string[] | null | undefined): AdminScope[] {
  if (orgRole === "OWNER") return ["billing", "security"];
  if (!stored) return [];
  return stored.filter((s): s is AdminScope => s === "billing" || s === "security");
}

/**
 * The four-role word for a membership's stored level (the workspace
 * switcher's per-workspace label). Same mapping as orgRoleOf; a caller
 * outside src/lib/access passes the membership's `role` column here rather
 * than reading a level itself.
 */
export function orgRoleOfMembership(role: string | null | undefined): OrgRole {
  return orgRoleOf({ accessLevel: role });
}

/**
 * Phase 8 stage E: the org role with ACCESS_V2_TABLES on.
 *
 * The accessLevel mirror decides, refined in ONE way: an Admin who is the
 * workspace's Owner pick (ownerIdsOf: every SUPER_ADMIN, else the earliest
 * live COMPANY_ADMIN, computed live, the rule the Staff console and
 * SETTINGS_OWNER_SPLIT use) is an Owner. The stored User.orgRole column is
 * NOT read for the Owner and Admin rungs (it is read only to narrow a Member
 * to a Guest, below): it is the step-8 mirror the backfill writes, and a
 * column a later role change or ownership transfer did not touch would
 * otherwise keep a previous Owner's reach. Worst case of this rule: none
 * beyond today's (the pick is the one every Owner-only page already uses).
 */
export function effectiveOrgRole(accessLevel: string | null | undefined, isOwnerPick: boolean, stored?: string | null): OrgRole {
  const mirror = orgRoleOf({ accessLevel });
  if (mirror === "ADMIN" && isOwnerPick) return "OWNER";
  // The stored column is read in ONE direction only: a person the column
  // names a Guest is a Guest even though their level mirror says Member
  // (the Guest invitation writes the column; Guest is not a level). The
  // column never widens: a stale OWNER or ADMIN value is ignored.
  if (mirror === "MEMBER" && stored === "GUEST") return "GUEST";
  return mirror;
}

/** Scopes count only for an Admin (Owners hold both); a demoted person's stored scopes are inert. */
export function effectiveAdminScopes(orgRole: OrgRole, stored: string[] | null | undefined): AdminScope[] {
  if (orgRole === "OWNER") return ["billing", "security"];
  if (orgRole !== "ADMIN") return [];
  return adminScopesOf(orgRole, stored);
}

/** The Agent flag follows the mirror (a stale column must not cap a person who is no longer an Agent). */
export function effectiveIsAgent(accessLevel: string | null | undefined): boolean {
  return isAgentOf(accessLevel);
}

/**
 * Is this person on the People team, as the engine answers it (resolve.ts
 * isPeopleTeam over hydrate's viewer and loadOrgFacts' peopleTeamIds)?
 *
 *   ACCESS_V2_TABLES off   the configured list OR an HR-level person
 *   ACCESS_V2_TABLES on    toggle 6 governs: a non-empty configured list is
 *                          the People team (an Admin CAN take an HR person
 *                          off it); an empty list falls back to HR
 *
 * /api/boot uses this so the frame's reader sidebar never lists a page the
 * gate refuses.
 */
export function peopleTeamOf(input: {
  userId: string;
  accessLevel: string | null | undefined;
  configured: readonly string[];
  tablesOn: boolean;
}): boolean {
  const seeded = isSeededPeopleTeam(input.accessLevel);
  if (input.tablesOn) return input.configured.length > 0 ? input.configured.includes(input.userId) : seeded;
  return input.configured.includes(input.userId) || seeded;
}
