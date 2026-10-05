import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  jsonError,
  jsonSuccess,
  } from "@/lib/api-helpers";
import { createCheckoutSession, isBillingLive, ownReturnUrl, type BillingKey } from "@/services/billing";
import { settingsWriteGate } from "@/lib/access/settings-write";

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

  // The Billing page rule (an Owner, or an Admin holding the Billing scope
  // once the Owner split is on), the actor re-read.
  const writeGate = await settingsWriteGate(session, "billing");
  if (!writeGate.ok) return writeGate.response;

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
  const seats = Math.max(1, Math.floor(Number(body.seats) || 1));
  // Back to Plan & billing, or to the page asked for on this site only.
  const successUrl = ownReturnUrl(body.successUrl, "/settings/billing?billing=success");
  const cancelUrl = ownReturnUrl(body.cancelUrl, "/settings/billing?billing=canceled");

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true },
  });
  if (!org) return jsonError("Organization not found", 404);
  // One subscription per workspace: a second checkout would bill twice.
  const current = await prisma.subscription.findUnique({ where: { organizationId: orgId }, select: { stripeSubscriptionId: true, status: true } });
  if (current?.stripeSubscriptionId && ["ACTIVE", "TRIALING", "PAST_DUE"].includes(String(current.status))) {
    return jsonError("This workspace already has a subscription. Change it from Manage billing.", 409);
  }

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
