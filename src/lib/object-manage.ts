// Who may DELETE a table or a form, or turn its public link on or off, until
// the access engine flips (access-model-spec step 1 is blocked on the access
// unit, and src/lib/access stays inert in Phase 5).
//
// The interim rule the spec names (spec-tables-forms section 3 ask 1, section
// 4 step 1): the object's creator, or an Owner or Admin of the org. That is
// exactly who holds Full access on a table or a form under the decided model
// today (creator Full for life, Admins Full on everything), so this closes
// "any member can publish or delete any table or form" without inventing a
// role the engine does not have yet.
//
// Pure: it reads the engine's Viewer shape, never a legacy access level.

import type { OrgRole } from "@/lib/access/types";

export interface ManageViewer {
  userId: string;
  orgRole: OrgRole;
}

export function canManageObject(viewer: ManageViewer | null | undefined, createdById: string | null | undefined): boolean {
  if (!viewer) return false;
  if (viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN") return true;
  return !!createdById && createdById === viewer.userId;
}

/** The one refusal both object routes send, so the client can say it plainly. */
export const MANAGE_REFUSAL = {
  delete: "Only the person who made this, or an admin, can delete it.",
  publish: "Only the person who made this, or an admin, can change its public link.",
  move: "Only the person who made this, or an admin, can move it to another Space.",
} as const;
