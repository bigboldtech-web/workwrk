import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isOrgAdmin, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";

/**
 * POST /api/appsumo/redeem
 *
 * Body: { code: "abc123" }
 *
 * Customer-facing endpoint. The signed-in user pastes their AppSumo
 * code, we look it up, validate it's unredeemed and not refunded,
 * and upgrade their org's subscription to the tier the code grants.
 *
 * Rules:
 *   · Caller must be a COMPANY_ADMIN / SUPER_ADMIN of the org. Random
 *     employees can't redeem codes on behalf of their org.
 *   · Each code is single-use across the whole system. If two orgs
 *     try the same code, the second sees "already redeemed."
 *   · We don't accept a code if the org already has an active
 *     paid Stripe subscription — refund Stripe first, then redeem.
 *   · On success: stamp the code with redeemedById + redeemedAt +
 *     redeemedByOrg, upgrade the Subscription, log activity.
 */
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) {
    return jsonError("Only the organization admin can redeem AppSumo codes", 403);
  }

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const body = await req.json().catch(() => ({}));
  const code = typeof body?.code === "string" ? body.code.trim() : "";

  if (!code) return jsonError("Paste your AppSumo code");

  const row = await prisma.appsumoCode.findUnique({ where: { code } });
  if (!row) {
    return jsonError(
      "We couldn't find that code. Double-check it on the AppSumo email — codes are case-sensitive.",
      404,
    );
  }
  if (row.refundedAt) {
    return jsonError("This code has been refunded and is no longer valid.", 410);
  }
  if (row.redeemedAt) {
    if (row.redeemedByOrg === orgId) {
      return jsonSuccess({ alreadyRedeemed: true, plan: row.plan, seats: row.seats });
    }
    return jsonError("This code has already been redeemed by another organization.", 409);
  }

  // Refuse if there's an active Stripe sub — avoid double-billing.
  const existing = await prisma.subscription.findUnique({
    where: { organizationId: orgId },
    select: { stripeSubscriptionId: true, status: true, plan: true },
  });
  if (existing?.stripeSubscriptionId && existing.status === "ACTIVE") {
    return jsonError(
      "Your organization has an active Stripe subscription. Cancel it first (Settings → Billing) before redeeming an AppSumo code.",
      409,
    );
  }

  // Apply atomically.
  const result = await prisma.$transaction(async (tx) => {
    const updatedCode = await tx.appsumoCode.update({
      where: { id: row.id },
      data: {
        redeemedById: userId,
        redeemedByOrg: orgId,
        redeemedAt: new Date(),
      },
    });

    const sub = await tx.subscription.upsert({
      where: { organizationId: orgId },
      update: {
        plan: row.plan,
        status: "ACTIVE",
        billingMode: "FLAT_TIER",
        seats: row.seats,
        // AppSumo deals are lifetime → no Stripe period end. Set to
        // far future so any "is active?" check stays positive.
        stripeCurrentPeriodEnd: new Date("2099-12-31"),
      },
      create: {
        organizationId: orgId,
        plan: row.plan,
        status: "ACTIVE",
        billingMode: "FLAT_TIER",
        seats: row.seats,
        stripeCurrentPeriodEnd: new Date("2099-12-31"),
      },
    });

    return { code: updatedCode, sub };
  });

  logActivity({
    type: "appsumo_redeemed",
    actorId: userId,
    organizationId: orgId,
    description: `Redeemed AppSumo Tier ${row.tier} code → ${row.plan}, ${row.seats} seats`,
    targetId: row.id,
    targetType: "appsumo_code",
  });

  return jsonSuccess({
    redeemed: true,
    plan: result.sub.plan,
    seats: result.sub.seats,
    tier: row.tier,
  });
}
