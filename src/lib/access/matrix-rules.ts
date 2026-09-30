// The permission matrix's live cells as engine gate rules (access-model-spec
// section 9, Phase 8 stage E). With ACCESS_V2_RESOLVER on, hasPermission()
// answers every cell named here from this table instead of
// Organization.settings.permissions; a cell NOT named here keeps the matrix
// answer, so nothing a customer configured is silently widened by a cell this
// table forgot.
//
// The cells are the ones a server route or page actually asks (the fourteen
// section 9 names plus the four hasPermission reads the recon found:
// people.create in the directory, organization.manageDepartments,
// assets.assign, announcements.create). The rules are section 9's, at the
// org level: a call site that asks the matrix has no object in hand, so a
// rule the spec states over an object ("EDIT on the target person", "Full on
// the SOP folder") is answered by the org-level half and the route's own
// object check that already follows (canWriteToFolder, the person gates).
// Where the org-level half would WIDEN today's reach it is narrowed instead,
// and the row says so (the smallest worst case): sops.delete and kras.delete
// stay Owner and Admin until step 6 moves those calls onto requireCan with the
// object.
//
// The SOP content cells (create, edit, publish) are `narrowOnly`: the engine
// rule may take reach away but never adds it, so the answer is the rule AND
// the stored matrix. The reason is the unfiled SOP: the routes' object check
// (canWriteToFolder) passes for a SOP with no folder, so "any Member" at the
// org level would let every Member read, rewrite and publish other people's
// unfiled drafts on flip day. Those cells widen only when step 6 moves the
// SOP routes onto requireCan with the SOP in hand (author Full on own drafts).
//
// Pure: imports only types and the toggle schema's type.

import type { AccessSettings, OrgRole } from "./types";

export interface MatrixViewer {
  orgRole: OrgRole;
  isAgent: boolean;
  peopleTeam: boolean;
  hasReports: boolean;
}

export type MatrixRule =
  | "owner-admin"
  | "owner-admin-people-team"
  | "owner-admin-people-team-reports"
  | "member"
  | "publish-toggle";

export interface MatrixCellRow {
  module: string;
  action: string;
  rule: MatrixRule;
  /** Where the rule comes from, in one line, for the parity report and the export. */
  note: string;
  /**
   * The rule only narrows: the answer is the rule AND the stored matrix, so
   * nobody gains a cell they do not hold today (the SOP content cells).
   */
  narrowOnly?: boolean;
}

export const MATRIX_CELL_RULES: readonly MatrixCellRow[] = [
  { module: "people", action: "create", rule: "owner-admin", note: "org.invite_member: Owner and Admin (spec 2.8; the in-domain Member invite waits for its Invite rules switch)." },
  { module: "organization", action: "manageDepartments", rule: "owner-admin", note: "Departments: Owner and Admin (managers lose it, spec 10.1)." },
  { module: "kras", action: "create", rule: "owner-admin-people-team", note: "KRA definitions: Owner, Admin and the People team." },
  { module: "kras", action: "edit", rule: "owner-admin-people-team", note: "KRA definitions: Owner, Admin and the People team." },
  { module: "kras", action: "delete", rule: "owner-admin", note: "Delete a KRA: Admin." },
  { module: "kras", action: "assign", rule: "owner-admin-people-team-reports", note: "EDIT on the target person: the manager chain, the People team, Admin (the route checks the person)." },
  { module: "sops", action: "create", rule: "member", narrowOnly: true, note: "EDIT on the SOP folder (the route's canWriteToFolder); never wider than today's cell until step 6 checks the SOP itself." },
  { module: "sops", action: "edit", rule: "member", narrowOnly: true, note: "EDIT on the SOP folder (the route's canWriteToFolder); never wider than today's cell, so no Member edits another person's unfiled draft." },
  { module: "sops", action: "publish", rule: "publish-toggle", narrowOnly: true, note: "Toggle 7: editors, or Admins and the People team; never wider than today's cell." },
  { module: "sops", action: "delete", rule: "owner-admin", note: "Full on the folder or the author (spec 9) needs the object; Owner and Admin until step 6." },
  { module: "policies", action: "create", rule: "owner-admin-people-team", note: "Policies: Admin and the People team." },
  { module: "announcements", action: "create", rule: "owner-admin-people-team", note: "Org announcements: Admin and the People team (a Space announcement needs Full on the Space)." },
  { module: "assets", action: "create", rule: "owner-admin-people-team", note: "Assets: Admin and the People team." },
  { module: "assets", action: "edit", rule: "owner-admin-people-team", note: "Assets: Admin and the People team." },
  { module: "assets", action: "delete", rule: "owner-admin", note: "Delete an asset: Admin." },
  { module: "assets", action: "assign", rule: "owner-admin-people-team-reports", note: "EDIT on the target person: the manager chain, the People team, Admin." },
];

export function matrixCellRow(module: string, action: string): MatrixCellRow | null {
  return MATRIX_CELL_RULES.find((r) => r.module === module && r.action === action) ?? null;
}

/** The engine's answer for one cell, or null when this table does not own it (the matrix answers). */
export function matrixCellAllowed(
  module: string,
  action: string,
  v: MatrixViewer,
  access: Pick<AccessSettings, "whoCanPublish">,
): boolean | null {
  const row = matrixCellRow(module, action);
  if (!row) return null;
  const admin = v.orgRole === "OWNER" || v.orgRole === "ADMIN";
  const guest = v.orgRole === "GUEST";
  if (guest) return false;
  // Agents never administer: an Agent is a Member for content, never for
  // people, structure or org-wide records.
  const agentAllowed = row.rule === "member" || (row.rule === "publish-toggle" && access.whoCanPublish === "editors");
  if (v.isAgent && !agentAllowed) return false;
  switch (row.rule) {
    case "owner-admin":
      return admin;
    case "owner-admin-people-team":
      return admin || v.peopleTeam;
    case "owner-admin-people-team-reports":
      return admin || v.peopleTeam || v.hasReports;
    case "member":
      return true;
    case "publish-toggle":
      return access.whoCanPublish === "editors" ? true : admin || v.peopleTeam;
  }
}

/**
 * The answer hasPermission gives under ACCESS_V2_RESOLVER for a cell this
 * table owns: the rule, or for a `narrowOnly` row the rule AND today's stored
 * answer. Null when the table does not own the cell. The parity job calls
 * this same function, so the report measures what the server enforces.
 */
export function matrixCellDecision(
  module: string,
  action: string,
  v: MatrixViewer,
  access: Pick<AccessSettings, "whoCanPublish">,
  stored: boolean,
): boolean | null {
  const row = matrixCellRow(module, action);
  if (!row) return null;
  const rule = matrixCellAllowed(module, action, v, access) === true;
  return row.narrowOnly ? rule && stored : rule;
}
