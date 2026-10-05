import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { settingsWriteGate } from "@/lib/access/settings-write";
import { rateLimit } from "@/lib/rate-limit-memory";

/**
 * POST /api/appsumo/redeem
 *
 * Body: { code: "abc123" }
 *
 * Customer-facing endpoint (Settings, Plan & billing has the form). The
 * signed-in Owner or billing Admin pastes their AppSumo code, we look it up,
 * validate it's unredeemed and not refunded, and move the workspace onto the
 * plan the code grants.
 *
 * Rules:
 *   · The Plan & billing rule (an Owner, or an Admin holding the Billing
 *     scope once the Owner split is on), the actor re-read: random employees
 *     can't redeem codes on behalf of their org.
 *   · Ten tries in fifteen minutes per person: a code is a secret, and an
 *     unlimited form would let anyone guess them.
 *   · Each code is single-use across the whole system, claimed in the same
 *     transaction that applies it: two workspaces redeeming one code at once
 *     cannot both get it.
 *   · We don't accept a code if the org already has a live Stripe
 *     subscription (active, trialing or past due): refund Stripe first, then
 *     redeem.
 *   · On success: the code is stamped with redeemedById + redeemedAt +
 *     redeemedByOrg, the Subscription carries the code's plan and seats
 *     (lifetime), and the WORKSPACE's own plan becomes the code's, which is
 *     what every limit reads (PLAN_LIMITS[Organization.plan]). It used to
 *     stay on Starter, so a redeemed code granted nothing but its seats. A
 *     free workspace (TRIAL) becomes ACTIVE; a suspended or cancelled one
 *     keeps its status (a code never reopens a workspace staff closed).
 */
const LIVE_STRIPE = new Set(["ACTIVE", "TRIALING", "PAST_DUE"]);
const PLAN_LABEL: Record<string, string> = { STARTER: "Starter", GROWTH: "Growth", SCALE: "Scale", ENTERPRISE: "Enterprise" };

class CodeTaken extends Error {}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const gate = await settingsWriteGate(session, "billing");
  if (!gate.ok) return gate.response;

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const limited = rateLimit(`appsumo-redeem:${userId}`, { max: 10, windowMs: 15 * 60 * 1000 });
  if (!limited.ok) return jsonError(`Too many tries. Try again in ${Math.ceil(limited.retryAfter / 60)} minutes.`, 429);

  const body = await req.json().catch(() => ({}));
  const code = typeof body?.code === "string" ? body.code.trim() : "";

  if (!code) return jsonError("Paste your AppSumo code");
  if (code.length > 200) return jsonError("That is not an AppSumo code.");

  const row = await prisma.appsumoCode.findUnique({ where: { code } });
  if (!row) {
    return jsonError(
      "We couldn't find that code. Double-check it on the AppSumo email: codes are case-sensitive.",
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

  // Refuse if there's a live Stripe sub: avoid double-billing.
  const existing = await prisma.subscription.findUnique({
    where: { organizationId: orgId },
    select: { stripeSubscriptionId: true, status: true, plan: true },
  });
  if (existing?.stripeSubscriptionId && LIVE_STRIPE.has(String(existing.status))) {
    return jsonError(
      "Your organization has an active Stripe subscription. Cancel it first (Settings, Plan & billing, Manage billing) before redeeming an AppSumo code.",
      409,
    );
  }

  // Apply atomically: the claim, the subscription and the workspace's plan.
  let result: { sub: { plan: string; seats: number } };
  try {
    result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.appsumoCode.updateMany({
        where: { id: row.id, redeemedAt: null, refundedAt: null },
        data: {
          redeemedById: userId,
          redeemedByOrg: orgId,
          redeemedAt: new Date(),
        },
      });
      if (claimed.count !== 1) throw new CodeTaken();

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
        select: { plan: true, seats: true },
      });

      const org = await tx.organization.findUnique({ where: { id: orgId }, select: { status: true } });
      await tx.organization.update({
        where: { id: orgId },
        data: { plan: row.plan, ...(String(org?.status) === "TRIAL" ? { status: "ACTIVE" as const } : {}) },
      });

      return { sub: { plan: String(sub.plan), seats: sub.seats } };
    });
  } catch (e) {
    if (e instanceof CodeTaken) return jsonError("This code has already been redeemed.", 409);
    throw e;
  }

  logActivity({
    type: "appsumo_redeemed",
    actorId: userId,
    organizationId: orgId,
    description: `Redeemed AppSumo Tier ${row.tier} code → ${PLAN_LABEL[String(row.plan)] ?? row.plan}, ${row.seats} seats`,
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
