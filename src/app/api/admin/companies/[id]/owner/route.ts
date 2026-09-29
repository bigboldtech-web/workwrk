import { NextRequest } from "next/server";
import { getSessionOrFail, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { requirePlatformAdminApi } from "@/lib/platform-admin";
import { requestIp, staffActorFromSession } from "@/lib/staff-audit";
import { setWorkspaceOwner, validateOwnerBody } from "@/lib/admin/set-owner";

/**
 * POST /api/admin/companies/[id]/owner  { userId, reason, confirm }
 *
 * Set workspace Owner (spec-admin-backoffice 2.3 card 5). Adds the Owner role
 * to one live Member or Admin of this workspace; never removes or demotes an
 * existing Owner. `reason` is required and stored on the audit row;
 * `confirm` is the company name as the staff member typed it, checked here
 * and not only in the modal. One transaction with its StaffAction row; the
 * person's tokenVersion is bumped so the role lands on their next request.
 * Platform staff only.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePlatformAdminApi(session);
  if (denied) return denied;

  const { id } = await params;
  const body = validateOwnerBody(await req.json().catch(() => null));
  if (!body.ok) return jsonError(body.error, 400);

  const result = await setWorkspaceOwner({
    companyId: id,
    userId: body.userId,
    reason: body.reason,
    confirm: body.confirm,
    actor: staffActorFromSession(session),
    ip: requestIp(req),
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return jsonSuccess({ ok: true, person: result.person, company: result.company });
}
