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
// Pure, so the rules are tested without a database.

export interface ToolViewer {
  userId: string;
  /** One of the four tool-admin levels (src/lib/access/legacy-session.ts). */
  toolAdmin: boolean;
  isManager: boolean;
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

/** Whether a saved login has anything in it. */
export function hasLogin(credentials: unknown): boolean {
  if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) return false;
  return Object.values(credentials as Record<string, unknown>).some((v) => typeof v === "string" && v.trim().length > 0);
}
