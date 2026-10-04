// Who may do what with a Tool (spec-tools-misc 2.1), until the access engine
// flips Tools onto AccessGrant (Phase 8). ToolShare stays the store.
//
//   see every tool     the four levels GET /api/tools always treated as tool
//                      admins (SUPER_ADMIN, COMPANY_ADMIN, C_LEVEL, HR)
//   see a tool         a tool admin, the person who added it, or anyone it is
//                      shared with (a share is Can view: the tool and its login)
//   add a tool         a manager or above (unchanged)
//   change, share or   a manager or above who is a tool admin or added it.
//   delete a tool      Before this, PATCH and DELETE took any id with no org
//                      check at all, so any manager in any workspace could
//                      edit or delete another workspace's tool.
//
// A ROLE ON A SHARE (batch 7, only while ACCESS_V2_TABLES is on). The one
// share dialog gives a share Can view, Can edit (change the fields and the
// login) or Full access (also share it and delete it), stored on
// ToolShare.role. With the flag off the role is never read: every share is
// Can view, exactly as before, so turning the flag off leaves each person at
// Can view and takes the tool from nobody.
//
// Pure, so the rules are tested without a database.

export interface ToolViewer {
  userId: string;
  /** One of the four tool-admin levels (src/lib/access/legacy-session.ts). */
  toolAdmin: boolean;
  isManager: boolean;
  /** An Agent holds at most Can edit, as everywhere (resolve.ts principalCaps): it never shares or deletes. */
  isAgent?: boolean;
}

export function seesAllTools(v: ToolViewer): boolean {
  return v.toolAdmin;
}

export function canAddTool(v: ToolViewer): boolean {
  return v.isManager;
}

export function canManageTool(v: ToolViewer, tool: { addedBy: string }): boolean {
  return v.isManager && (seesAllTools(v) || tool.addedBy === v.userId);
}

export function canSeeTool(v: ToolViewer, tool: { addedBy: string }, sharedWithViewer: boolean): boolean {
  return seesAllTools(v) || tool.addedBy === v.userId || sharedWithViewer;
}

export type ToolRole = "FULL" | "EDIT" | "VIEW";

/**
 * What a share row gives: null when there is no row; Can view for a row
 * without a role, and for every row while the roles are off (the flag).
 */
export function toolShareRole(row: { role?: string | null } | null | undefined, rolesOn: boolean): ToolRole | null {
  if (!row) return null;
  if (!rolesOn) return "VIEW";
  return row.role === "FULL" ? "FULL" : row.role === "EDIT" ? "EDIT" : "VIEW";
}

/** The stored value for a role: a row without one is Can view. */
export function storedToolShareRole(role: ToolRole): "FULL" | "EDIT" | null {
  return role === "VIEW" ? null : role;
}

/**
 * The viewer's role on a tool: Full access for whoever manages it (above)
 * or holds a Full access share; else the share's role; Can view for a tool
 * admin who is not a manager; null when they cannot see it.
 */
export function toolViewerRole(v: ToolViewer, tool: { addedBy: string }, share: ToolRole | null): ToolRole | null {
  const role: ToolRole | null = canManageTool(v, tool) || share === "FULL" ? "FULL" : share ?? (canSeeTool(v, tool, false) ? "VIEW" : null);
  return v.isAgent && role === "FULL" ? "EDIT" : role;
}

/** Change the fields and the login: Can edit and up. */
export function canEditTool(v: ToolViewer, tool: { addedBy: string }, share: ToolRole | null): boolean {
  const role = toolViewerRole(v, tool, share);
  return role === "FULL" || role === "EDIT";
}

/** Share it and delete it: Full access. */
export function canShareTool(v: ToolViewer, tool: { addedBy: string }, share: ToolRole | null): boolean {
  return toolViewerRole(v, tool, share) === "FULL";
}

/** Whether a saved login has anything in it. */
export function hasLogin(credentials: unknown): boolean {
  if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) return false;
  return Object.values(credentials as Record<string, unknown>).some((v) => typeof v === "string" && v.trim().length > 0);
}
