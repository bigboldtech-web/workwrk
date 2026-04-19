import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  jsonError,
  jsonSuccess,
  hasRole,
} from "@/lib/api-helpers";
import { createCheckoutSession, isBillingLive, type BillingKey } from "@/services/billing";

type Body = {
  key?: BillingKey;
  seats?: number;
  successUrl?: string;
  cancelUrl?: string;
};

const VALID_KEYS: BillingKey[] = ["growth-per-user", "team-flat", "growth-flat", "scale-flat"];

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  // Only org admins can initiate billing.
  if (!hasRole(session, ["SUPER_ADMIN", "COMPANY_ADMIN"])) {
    return jsonError("Only admins can manage billing", 403);
  }

  if (!isBillingLive) {
    return jsonError(
      "Stripe not configured on this environment. Set STRIPE_SECRET_KEY to enable self-serve billing.",
      503,
    );
  }

  const orgId = getOrgId(session);
  const body = (await req.json()) as Body;

  if (!body.key || !VALID_KEYS.includes(body.key)) {
    return jsonError(`key must be one of: ${VALID_KEYS.join(", ")}`);
  }
  const seats = Math.max(1, Math.floor(body.seats ?? 1));
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const successUrl = body.successUrl ?? `${base}/settings?billing=success`;
  const cancelUrl = body.cancelUrl ?? `${base}/settings?billing=canceled`;

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true },
  });
  if (!org) return jsonError("Organization not found", 404);

  const adminEmail = session.user.email;
  if (!adminEmail) return jsonError("Admin email missing from session");

  try {
    const { url, sessionId } = await createCheckoutSession({
      organizationId: orgId,
      organizationName: org.name,
      adminEmail,
      key: body.key,
      seats,
      successUrl,
      cancelUrl,
    });
    return jsonSuccess({ url, sessionId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create checkout session";
    return jsonError(msg, 500);
  }
}
