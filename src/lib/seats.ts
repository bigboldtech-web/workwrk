// Seats: how many people a workspace may have, and how many it uses.
//
// WHY. Pricing sells Starter for up to 10 people and Growth up to 50, and says
// "the seat count the product enforces is the number of people in it". No
// path checked it: invitations, the CSV import (up to 1,000 at once) and
// accepting an invitation never compared anything with the plan, so a free
// workspace could hold any number of people. Seats a customer bought (a
// Subscription's seats, staff-set or from an AppSumo code) were not enforced
// either.
//
// THE COUNT. A seat is a person who can sign in, or an invitation still open:
//   - live people anchored here (not removed, not deactivated);
//   - live people in through a membership (anchored in another workspace);
//   - addresses with an invitation not accepted and not expired, each address
//     once, whatever its case, and none that is already one of the people
//     above: one person invited to the workspace and to two of its Spaces
//     used to hold three seats.
// Invitations count because an invite is a promise of a seat: counting them
// is what stops 40 invitations going out on a 10-person plan.
//
// THE LIMIT. Seats bought, where seats were bought: a lifetime (AppSumo)
// subscription's seats (never fewer than free Starter's people limit: a paid
// code never leaves a workspace with less than it had for free), and a
// per-person Stripe subscription's seats. A flat
// Stripe price stores its checkout quantity (1) in seats, which is not a seat
// count: it, and every workspace without a live subscription, uses the plan's
// people limit (PLAN_LIMITS[plan].users). Unlimited seats (the staff
// console's empty field, AppSumo Tier 3's 999,999) mean no limit. The source
// and "unlimited" are read exactly as the staff console reads them
// (src/lib/admin/companies-list.ts), so "12 of 25" there is the cap here.
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { PLAN_LIMITS } from "@/lib/plan-limits-data";
import { seatsAreUnlimited, subscriptionSource, UNLIMITED_SEATS } from "@/lib/admin/companies-list";

type Db = Prisma.TransactionClient | typeof prisma;

const LIVE_SUBSCRIPTION = ["ACTIVE", "TRIALING", "PAST_DUE"] as const;
const PLAN_LABEL: Record<string, string> = { STARTER: "Starter", GROWTH: "Growth", SCALE: "Scale", ENTERPRISE: "Enterprise" };

export interface SeatUse {
  /** People who can sign in: anchored here or in through a membership. */
  members: number;
  /** Addresses with an invitation not accepted and not expired, not already people here. */
  pending: number;
  /** The cap; UNLIMITED_SEATS (99,999) or more is no limit. */
  limit: number;
  plan: string;
  /** The cap is per-person Stripe seats, so more can be bought in the billing portal. */
  canBuyMore: boolean;
}

/** `plan`: the plan the subscription gives (the row's), when known. */
type SubFacts = { seats: number; status: string; billingMode: string; stripeSubscriptionId: string | null; plan?: string | null };

/** The cap for a plan and its subscription (see THE LIMIT above). */
export function seatLimit(plan: string, sub: SubFacts | null): { limit: number; canBuyMore: boolean } {
  const planLimit = (PLAN_LIMITS[plan] ?? PLAN_LIMITS.STARTER).users;
  if (!sub || !(LIVE_SUBSCRIPTION as readonly string[]).includes(String(sub.status))) return { limit: planLimit, canBuyMore: false };
  const source = subscriptionSource(sub);
  if (source === "lifetime") {
    return { limit: seatsAreUnlimited(sub.seats) ? UNLIMITED_SEATS : Math.max(sub.seats, PLAN_LIMITS.STARTER.users), canBuyMore: false };
  }
  // Seats bought in Stripe are the cap only while the workspace is on the
  // plan they were bought for: staff moving a subscriber to another plan
  // (Enterprise, say) gives that plan's people limit, never "buy more Growth
  // seats".
  if (source === "stripe" && sub.billingMode === "PER_USER" && sub.seats > 0 && (!sub.plan || sub.plan === plan)) {
    return sub.seats >= UNLIMITED_SEATS ? { limit: UNLIMITED_SEATS, canBuyMore: false } : { limit: sub.seats, canBuyMore: true };
  }
  return { limit: planLimit, canBuyMore: false };
}

/**
 * Open invitations, one per address (any case), leaving out every address
 * that is already a live person here (anchored, or through a membership).
 * Matched against this workspace's own people only, so it stays one hash
 * join however many accounts the database holds.
 */
async function openInvitedAddresses(organizationId: string, db: Db): Promise<number> {
  const rows = await db.$queryRaw<{ n: number }[]>`
    WITH open_inv AS (
      SELECT DISTINCT lower(i."email") AS e
      FROM "Invitation" i
      WHERE i."organizationId" = ${organizationId}
        AND i."accepted" = false
        AND i."expiresAt" > (now() AT TIME ZONE 'UTC')
    ),
    inside AS (
      SELECT lower(u."email") AS e FROM "User" u
      WHERE u."organizationId" = ${organizationId} AND u."deletedAt" IS NULL AND u."status" <> 'INACTIVE'
      UNION
      SELECT lower(u."email") FROM "OrganizationMembership" m JOIN "User" u ON u."id" = m."userId"
      WHERE m."organizationId" = ${organizationId} AND u."deletedAt" IS NULL AND u."status" <> 'INACTIVE'
    )
    SELECT count(*)::int AS n FROM open_inv o WHERE NOT EXISTS (SELECT 1 FROM inside WHERE inside.e = o.e)`;
  return Number(rows[0]?.n ?? 0);
}

export async function seatUse(organizationId: string, db: Db = prisma): Promise<SeatUse> {
  const [org, anchored, viaMembership, pending, sub] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { plan: true } }),
    db.user.count({ where: { organizationId, deletedAt: null, status: { not: "INACTIVE" } } }),
    db.organizationMembership.count({
      where: { organizationId, user: { deletedAt: null, status: { not: "INACTIVE" }, NOT: { organizationId } } },
    }),
    openInvitedAddresses(organizationId, db),
    db.subscription.findUnique({
      where: { organizationId },
      select: { seats: true, status: true, billingMode: true, stripeSubscriptionId: true, plan: true },
    }),
  ]);
  const plan = String(org?.plan ?? "STARTER");
  const cap = seatLimit(plan, sub ? { seats: sub.seats, status: String(sub.status), billingMode: String(sub.billingMode), stripeSubscriptionId: sub.stripeSubscriptionId, plan: sub.plan ? String(sub.plan) : null } : null);
  return { members: anchored + viaMembership, pending, limit: cap.limit, plan, canBuyMore: cap.canBuyMore };
}

/** The sentence a workspace with no room is shown. */
export function seatCapMessage(use: SeatUse, adding: number): string {
  const label = PLAN_LABEL[use.plan] ?? use.plan;
  const used = use.members + use.pending;
  const tail = use.canBuyMore
    ? "An Owner or Admin can add seats in Settings, Plan & billing (Manage billing)."
    : "An Owner or Admin can change the plan in Settings, Plan & billing.";
  if (adding > 1) return `This workspace has ${used} of its ${use.limit} seats in use (people and open invitations), so ${adding} more do not fit on the ${label} plan. ${tail}`;
  return `This workspace has used all ${use.limit} seats (people and open invitations) on the ${label} plan. ${tail}`;
}

/**
 * Whether `adding` more seats fit (new invitations, or people created
 * directly). Pass the transaction the add runs in, after taking the
 * workspace's row lock (lockWorkspaceSeats), so two adds at once cannot both
 * fit into the last seat.
 */
export async function seatsFor(organizationId: string, adding: number, db: Db = prisma): Promise<{ ok: true; use: SeatUse } | { ok: false; message: string; use: SeatUse }> {
  const use = await seatUse(organizationId, db);
  if (use.members + use.pending + adding <= use.limit) return { ok: true, use };
  return { ok: false, message: seatCapMessage(use, adding), use };
}

/**
 * Accepting an invitation turns an open invitation (already counted) into a
 * person, so it adds no seat. The check here is that the PEOPLE still fit:
 * the plan may have been lowered since the invitation went out.
 */
export async function personFitsOnAccept(organizationId: string, db: Db = prisma): Promise<{ ok: true } | { ok: false; message: string }> {
  const use = await seatUse(organizationId, db);
  if (use.members + 1 <= use.limit) return { ok: true };
  return { ok: false, message: `This workspace has no free seat for you right now. Ask whoever invited you to make room, or an Owner or Admin to change the plan.` };
}

/**
 * The seats one more invitation for this address takes: none when the address
 * already holds one here (another invitation still open, or a live person,
 * anchored or through a membership, any case of the address), else one. The
 * count holds each address once, so a second invitation for it adds nothing
 * and is never refused at the cap. `exceptInvitationId`: the row being renewed.
 */
export async function seatsForAddress(organizationId: string, email: string, db: Db = prisma, exceptInvitationId?: string): Promise<0 | 1> {
  const address = { equals: email.trim(), mode: "insensitive" as const };
  const live = { deletedAt: null, status: { not: "INACTIVE" as const } };
  const [invited, anchored, member] = await Promise.all([
    db.invitation.count({
      where: { organizationId, accepted: false, expiresAt: { gt: new Date() }, email: address, ...(exceptInvitationId ? { id: { not: exceptInvitationId } } : {}) },
    }),
    db.user.count({ where: { organizationId, email: address, ...live } }),
    db.organizationMembership.count({ where: { organizationId, user: { email: address, ...live } } }),
  ]);
  return invited + anchored + member > 0 ? 0 : 1;
}

/** Take the workspace's row lock inside a transaction, so seat checks there run one at a time. */
export async function lockWorkspaceSeats(tx: Prisma.TransactionClient, organizationId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
}
