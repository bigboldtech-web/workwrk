// The interim Workspace-settings write gate for routes that had none
// (Phase 8 Stage A). ONE predicate over the session, inside src/lib/access
// so no route reads a level itself: Owner and Admin (SUPER_ADMIN,
// COMPANY_ADMIN), the same people who can open the settings page the route
// serves. The engine's requireCan("manage", { type: "settings", page })
// replaces it at the door-gate stage without touching the call sites' shape.
import { legacyIsAdminLevel } from "./legacy-levels";

export function sessionIsWorkspaceAdmin(session: unknown): boolean {
  const level = (session as { user?: { accessLevel?: string } } | null | undefined)?.user?.accessLevel;
  return legacyIsAdminLevel(level);
}
