import { NextRequest } from "next/server";
import { getSessionOrFail, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { requirePlatformAdminApi } from "@/lib/platform-admin";
import { saveConsolePrefs, staffEmailOf } from "@/lib/admin/console-me";
import { validateConsolePatch } from "@/lib/admin/console-prefs";

/**
 * PATCH /api/admin/me/console: save the caller's OWN console layout state.
 * Body: any of { sidebar: { collapsed }, companies: { drawerWidth, columns },
 * audit: { columns }, recent: [ids], openedCompany: id }. Unknown keys are
 * refused (400) rather than dropped, the drawer width is clamped to 480 to
 * 720, and `openedCompany` puts one company first in Search's RECENT list
 * (five kept, oldest dropped).
 *
 * Not a StaffAction: this is the staff member's own sidebar and columns,
 * not a change to any company or to the staff list, and logging every
 * sidebar toggle would bury the rows the log exists for.
 */
export async function PATCH(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePlatformAdminApi(session);
  if (denied) return denied;

  const email = await staffEmailOf(session);
  if (!email) return jsonError("This session has no email", 400);

  const body = await req.json().catch(() => null);
  const validated = validateConsolePatch(body);
  if (!validated.ok) return jsonError(validated.error, 400);

  const result = await saveConsolePrefs(email, validated.patch);
  if (!result.ok) return jsonError(result.error, result.status);
  return jsonSuccess({ prefs: result.prefs, recents: result.recents });
}
