// The interim Workspace-settings write gates (Phase 8). ONE place, inside
// src/lib/access, so no route reads a level itself:
//
//   sessionIsWorkspaceAdmin     Owner and Admin (SUPER_ADMIN, COMPANY_ADMIN),
//                               the people who can open the settings page the
//                               route serves.
//   sessionIsWorkspaceOwner     an Owner: SUPER_ADMIN, or the org's earliest
//                               live COMPANY_ADMIN (org-role.ts spec 2.1,
//                               ownerIdsFor in src/lib/admin/company-detail).
//   sessionMayManageOwnerPage   the Owner-only pages and actions (Security,
//                               API, Billing, Retention, Danger zone). Until
//                               SETTINGS_OWNER_SPLIT=true (default OFF) every
//                               Admin still counts, which is today's reach:
//                               the split turns on only after the pre-flight
//                               report naming each org's Owner is approved.
//
// The engine's requireCan("manage", { type: "settings", page }) replaces
// these at the door-gate stage without touching the call sites' shape.
import { legacyIsAdminLevel, legacyIsManagerLevel } from "./legacy-levels";
import { ownerIdsFor } from "@/lib/admin/company-detail";

type SessionLike = { user?: { id?: string; accessLevel?: string; organizationId?: string } } | null | undefined;

export function sessionIsWorkspaceAdmin(session: unknown): boolean {
  const level = (session as SessionLike)?.user?.accessLevel;
  return legacyIsAdminLevel(level);
}

/**
 * Who may open Members, Access and Scoring today (the legacy manager tier,
 * HR included), read-only below Admin. The engine's People-team rule
 * replaces this at the door-gate stage.
 */
export function sessionIsSettingsReader(session: unknown): boolean {
  return legacyIsManagerLevel((session as SessionLike)?.user?.accessLevel);
}

/** Read at request time, so a local test can flip it in .env.local without a restart of the code path. */
export function ownerSplitOn(): boolean {
  return process.env.SETTINGS_OWNER_SPLIT === "true";
}

export async function sessionIsWorkspaceOwner(session: unknown): Promise<boolean> {
  const u = (session as SessionLike)?.user;
  if (!u?.id || !u.organizationId || !legacyIsAdminLevel(u.accessLevel)) return false;
  if (u.accessLevel === "SUPER_ADMIN") return true;
  const owners = await ownerIdsFor(u.organizationId);
  return owners.includes(u.id);
}

export async function sessionMayManageOwnerPage(session: unknown): Promise<boolean> {
  if (!sessionIsWorkspaceAdmin(session)) return false;
  if (!ownerSplitOn()) return true;
  return sessionIsWorkspaceOwner(session);
}
