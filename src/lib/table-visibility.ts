// Who may see a table that sits in no Space (a pure rule, no database).
//
// A table in a Space follows the Space (getSpaceForReader, visibleSpaceIds).
// A table in no Space is org-wide for every Owner, Admin and Member, which is
// the Everyone row of the access model ("all Owners, Admins, Members | Never
// Guests", access-model-spec section 3.3). A Guest reaches a table only
// through a direct share (spec-tables-forms section 1 Access), and no share
// path to a table exists while the access engine is inert, so the one
// unscoped table a Guest can hold is one they made themselves: the creator
// keeps Full access for life and is never locked out of it. This is the same
// rule the forms routes apply to a Guest (components/access/forms-gate.tsx).
//
// Every table reader states the rule through this one function (the routes
// through lib/table-gate unscopedTableReadable, which turns the session's
// legacy level into the engine's org role), so the day the engine flips only
// these two files change. It reads the engine's OrgRole, never a legacy level.

import type { OrgRole } from "@/lib/access/types";

/** May this viewer see this table on the strength of the org alone (no Space)? */
export function unscopedTableVisible(
  createdById: string | null | undefined,
  userId: string,
  orgRole: OrgRole,
): boolean {
  if (orgRole !== "GUEST") return true;
  return !!createdById && createdById === userId;
}
