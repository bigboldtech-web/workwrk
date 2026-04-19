import { NextRequest } from "next/server";
import {
  getSessionOrFail,
  getOrgId,
  hasRole,
  jsonError,
  jsonSuccess,
} from "@/lib/api-helpers";
import { createPortalSession, isBillingLive } from "@/services/billing";

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!hasRole(session, ["SUPER_ADMIN", "COMPANY_ADMIN"])) {
    return jsonError("Only admins can manage billing", 403);
  }
  if (!isBillingLive) {
    return jsonError("Stripe not configured", 503);
  }

  const orgId = getOrgId(session);
  const body = (await req.json().catch(() => ({}))) as { returnUrl?: string };
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const returnUrl = body.returnUrl ?? `${base}/settings`;

  try {
    const url = await createPortalSession({ organizationId: orgId, returnUrl });
    return jsonSuccess({ url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Portal failed";
    return jsonError(msg, 500);
  }
}
