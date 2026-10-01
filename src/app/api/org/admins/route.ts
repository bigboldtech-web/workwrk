import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { listOrgAdmins } from "@/lib/access/admins";

// GET /api/org/admins: the workspace's Owners and Admins (up to five,
// earliest first) for both settings denial views and "Ask an admin" lines
// (spec-settings-workspace 1.4). Real people only, never a fabricated stack.
// Any signed-in person of the organisation may read it: it is the answer to
// "who do I ask", and it carries name, avatar and a mailto address, nothing
// else.
export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  if (!orgId) return jsonError("No organization", 400);
  const admins = await listOrgAdmins(orgId, 5);
  return jsonSuccess({ admins });
}
