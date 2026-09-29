import { getSessionOrFail, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { requirePlatformAdminApi } from "@/lib/platform-admin";
import { loadConsoleMe, staffEmailOf } from "@/lib/admin/console-me";

/**
 * GET /api/admin/me: the signed-in staff member and their console-local
 * layout state (spec-admin-backoffice section 1 "Console preferences"):
 * sidebar collapsed, company drawer width, column choices, and the recent
 * companies resolved to name, plan and status for Search's RECENT section.
 * Platform staff only. Theme and density are not here: they are product
 * preferences and the layout reads them from UserPreference.
 */
export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePlatformAdminApi(session);
  if (denied) return denied;

  const email = await staffEmailOf(session);
  if (!email) return jsonError("This session has no email", 400);
  const name = (session.user as { name?: string | null }).name ?? null;
  return jsonSuccess(await loadConsoleMe(email, name));
}
