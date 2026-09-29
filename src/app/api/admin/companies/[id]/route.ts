import { NextRequest } from "next/server";
import { getSessionOrFail, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { requirePlatformAdminApi } from "@/lib/platform-admin";
import { applyCompanyPatch, validateCompanyPatch } from "@/lib/admin/company-patch";
import { requestIp, staffActorFromSession } from "@/lib/staff-audit";
import { loadCompanyDetail } from "@/lib/admin/company-detail";

/**
 * Staff console, one company. Platform staff only.
 *
 * GET    company facts, subscription, modules, Owners, counts and the last
 *        five staff changes (src/lib/admin/company-detail.ts). Counts only:
 *        never the customer's settings or content.
 * PATCH  one or more of { plan }, { status }, { seats } (a whole number, or
 *        null for unlimited; needs a subscription), { feature, enabled }
 *        (byok, whiteLabel) or { module, enabled } (chat, tables). Every
 *        branch runs in one transaction with its StaffAction row
 *        (src/lib/admin/company-patch.ts); SUSPENDED and CANCELLED also need
 *        { confirm: "<company name>" }, checked here and not only in the
 *        dialog, and sign out every member with no other healthy workspace.
 */

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePlatformAdminApi(session);
  if (denied) return denied;

  const { id } = await params;
  const company = await loadCompanyDetail(id);
  if (!company) return jsonError("Company not found", 404);
  return jsonSuccess(company);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePlatformAdminApi(session);
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const validated = validateCompanyPatch(body);
  if (!validated.ok) return jsonError(validated.error);

  const result = await applyCompanyPatch({
    id,
    patch: validated.patch,
    actor: staffActorFromSession(session),
    ip: requestIp(req),
  });
  if (!result.ok) return jsonError(result.error, result.status);

  return jsonSuccess({ ok: true, changed: result.changed, signedOut: result.signedOut, company: result.company });
}
