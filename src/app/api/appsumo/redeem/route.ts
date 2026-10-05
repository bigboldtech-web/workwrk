import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { settingsWriteGate } from "@/lib/access/settings-write";
import { rateLimit } from "@/lib/rate-limit-memory";
import { lockWorkspaceSeats, seatUse } from "@/lib/seats";
import { seatsAreUnlimited, UNLIMITED_SEATS } from "@/lib/admin/companies-list";
import { PLAN_LIMITS } from "@/lib/plan-limits-data";
import { subscriptionStillOpen } from "@/services/billing";
import type { Plan } from "@/generated/prisma";

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
 *   · We don't accept a code while the org has a Stripe subscription that can
 *     still bill (active, trialing, past due, and, by Stripe's own status,
 *     unpaid, incomplete or paused): cancel it first, then redeem.
 *   · A code NEVER LOWERS what the workspace has: the plan becomes the higher
 *     of its plan and the code's, the seats the larger of its seats now and
 *     the code's (never fewer than free Starter's). A code that would add
 *     nothing is refused before it is claimed, so it is not used up.
 *   · On success: the code is stamped with redeemedById + redeemedAt +
 *     redeemedByOrg, the Subscription becomes the lifetime deal (a flat tier
 *     with the seats, and no Stripe subscription: one that ended before is
 *     unlinked, so nothing reads the code as a card subscription and no late
 *     Stripe event can overwrite it; the Stripe customer is kept for its
 *     invoices), and the WORKSPACE's own plan is set, which is what every
 *     limit reads (PLAN_LIMITS[Organization.plan]). A free workspace (TRIAL)
 *     becomes ACTIVE; a suspended or cancelled one keeps its status (a code
 *     never reopens a workspace staff closed).
 *   · A code this workspace redeemed before is not applied twice; its plan is
 *     applied if the workspace is below it (codes redeemed before Batch 13
 *     left the workspace on Starter).
 */
const LIVE_STRIPE = new Set(["ACTIVE", "TRIALING", "PAST_DUE"]);
const PLAN_LABEL: Record<string, string> = { STARTER: "Starter", GROWTH: "Growth", SCALE: "Scale", ENTERPRISE: "Enterprise" };
const PLAN_RANK: Record<string, number> = { STARTER: 0, GROWTH: 1, SCALE: 2, ENTERPRISE: 3 };
const rank = (plan: string) => PLAN_RANK[plan] ?? 0;
const seatWords = (n: number) => (n >= UNLIMITED_SEATS ? "unlimited seats" : `${n} seats`);

class CodeTaken extends Error {}
class AddsNothing extends Error {
  constructor(readonly plan: string, readonly seats: number) { super("adds nothing"); }
}

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
      // Redeemed here before: the code's plan, if the workspace is below it.
      const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { plan: true, status: true } });
      if (org && rank(String(org.plan)) < rank(String(row.plan))) {
        await prisma.organization.updateMany({
          where: { id: orgId, plan: org.plan },
          data: { plan: row.plan, ...(String(org.status) === "TRIAL" ? { status: "ACTIVE" as const } : {}) },
        });
      }
      return jsonSuccess({ alreadyRedeemed: true, plan: row.plan, seats: row.seats });
    }
    return jsonError("This code has already been redeemed by another organization.", 409);
  }

  // Refuse while a Stripe subscription can still bill: avoid double-billing.
  // The row stores unpaid and paused as INCOMPLETE, so Stripe is asked.
  const existing = await prisma.subscription.findUnique({
    where: { organizationId: orgId },
    select: { stripeSubscriptionId: true, status: true },
  });
  if (existing?.stripeSubscriptionId && String(existing.status) !== "CANCELED") {
    const open = LIVE_STRIPE.has(String(existing.status)) || (await subscriptionStillOpen(existing.stripeSubscriptionId).catch(() => true));
    if (open) {
      return jsonError(
        "Your organization has an active Stripe subscription. Cancel it first (Settings, Plan & billing, Manage billing) before redeeming an AppSumo code.",
        409,
      );
    }
  }

  // Apply atomically, under the workspace's seat lock: the claim, the
  // subscription and the workspace's plan.
  let result: { sub: { plan: string; seats: number } };
  try {
    result = await prisma.$transaction(async (tx) => {
      await lockWorkspaceSeats(tx, orgId);
      const org = await tx.organization.findUnique({ where: { id: orgId }, select: { plan: true, status: true } });
      if (!org) throw new CodeTaken();
      const use = await seatUse(orgId, tx);
      const codeSeats = seatsAreUnlimited(row.seats) ? UNLIMITED_SEATS : Math.max(row.seats, PLAN_LIMITS.STARTER.users);
      const plan = rank(String(row.plan)) > rank(String(org.plan)) ? String(row.plan) : String(org.plan);
      const seats = Math.max(use.limit, codeSeats);
      if (plan === String(org.plan) && seats === use.limit) throw new AddsNothing(plan, use.limit);

      const claimed = await tx.appsumoCode.updateMany({
        where: { id: row.id, redeemedAt: null, refundedAt: null },
        data: {
          redeemedById: userId,
          redeemedByOrg: orgId,
          redeemedAt: new Date(),
        },
      });
      if (claimed.count !== 1) throw new CodeTaken();

      const lifetime = {
        plan: plan as Plan,
        status: "ACTIVE" as const,
        billingMode: "FLAT_TIER" as const,
        seats,
        // AppSumo deals are lifetime → no Stripe period end. Set to
        // far future so any "is active?" check stays positive.
        stripeCurrentPeriodEnd: new Date("2099-12-31"),
      };
      const sub = await tx.subscription.upsert({
        where: { organizationId: orgId },
        // A Stripe subscription that ended is unlinked (the customer stays).
        update: { ...lifetime, stripeSubscriptionId: null, stripePriceId: null, canceledAt: null, trialEndsAt: null },
        create: { organizationId: orgId, ...lifetime },
        select: { plan: true, seats: true },
      });

      await tx.organization.update({
        where: { id: orgId },
        data: { plan: plan as Plan, ...(String(org.status) === "TRIAL" ? { status: "ACTIVE" as const } : {}) },
      });

      return { sub: { plan: String(sub.plan), seats: sub.seats } };
    });
  } catch (e) {
    if (e instanceof CodeTaken) return jsonError("This code has already been redeemed.", 409);
    if (e instanceof AddsNothing) {
      return jsonError(
        `This code would add nothing: this workspace already has the ${PLAN_LABEL[e.plan] ?? e.plan} plan with ${seatWords(e.seats)}. It was not used, so it still works for another workspace.`,
        409,
      );
    }
    throw e;
  }

  logActivity({
    type: "appsumo_redeemed",
    actorId: userId,
    organizationId: orgId,
    description: `Redeemed AppSumo Tier ${row.tier} code → ${PLAN_LABEL[result.sub.plan] ?? result.sub.plan}, ${seatWords(result.sub.seats)}`,
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
