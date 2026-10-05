import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sessionMayManageOwnerPage } from "@/lib/access/workspace-admin";
import { PLAN_LIMITS } from "@/lib/plan-limits-data";
import { isBillingLive, priceConfigured } from "@/services/billing";
import { aiQuestionsUsed } from "@/lib/ai-allowance";
import { seatUse } from "@/lib/seats";

// GET /api/settings/billing-summary: Plan & billing in one read. Owner page
// (every Admin until the Owner and Admin split).
//
// Every number is the one the product enforces:
//   - seats: people who can sign in plus open invitations, against the cap
//     src/lib/seats.ts refuses at (seats bought, else the plan's limit);
//   - AI questions IN TOTAL, the count src/lib/ai-allowance.ts refuses at (a
//     per-month meter read "0 of 50" on the 1st while every question was
//     refused).
//
// And every button is one that works: `portalAvailable` only when Stripe is
// configured AND this workspace has a Stripe customer (the portal refuses
// any other), `upgrade` only when checkout can open (Stripe configured, the
// Growth price set, the workspace on Starter without a live subscription).
const LIVE_SUBSCRIPTION = new Set(["ACTIVE", "TRIALING", "PAST_DUE"]);

export async function GET() {
  const session = await getServerSession(authOptions);
  const orgId = (session?.user as { organizationId?: string } | undefined)?.organizationId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await sessionMayManageOwnerPage(session, "billing"))) return NextResponse.json({ error: "no_access", page: "billing" }, { status: 403 });
  const [org, seats, sops, ai, sub] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId }, select: { plan: true, status: true } }),
    seatUse(orgId),
    prisma.sOP.count({ where: { organizationId: orgId } }),
    aiQuestionsUsed(orgId),
    prisma.subscription.findUnique({ where: { organizationId: orgId }, select: { stripeCustomerId: true, stripeSubscriptionId: true, status: true } }),
  ]);
  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  const plan = String(org.plan);
  const planLimits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.STARTER;
  const liveStripe = !!sub?.stripeSubscriptionId && LIVE_SUBSCRIPTION.has(String(sub.status));
  const portalAvailable = isBillingLive && !!sub?.stripeCustomerId;
  const upgradeAvailable = isBillingLive && priceConfigured("growth-per-user") && plan === "STARTER" && !liveStripe;
  return NextResponse.json(
    {
      plan,
      status: String(org.status),
      limits: { users: seats.limit, sops: planLimits.sops, ai: planLimits.ai },
      usage: { members: seats.members, pendingInvites: seats.pending, sops, aiUsed: ai },
      billingLive: isBillingLive,
      portalAvailable,
      // A live Stripe subscription: an AppSumo code is refused while it lasts.
      stripeSubscribed: liveStripe,
      // Checkout starts at the seats already in use; the buyer can raise it
      // there, up to Growth's 50 people.
      upgrade: upgradeAvailable ? { key: "growth-per-user", seats: Math.max(1, seats.members + seats.pending) } : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
