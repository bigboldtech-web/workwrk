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
