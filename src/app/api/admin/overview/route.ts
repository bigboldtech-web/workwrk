import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonSuccess } from "@/lib/api-helpers";
import { requirePlatformAdminApi } from "@/lib/platform-admin";
import { companyViewWhere, hasOwnerWhere, trialEndsWithinWhere } from "@/lib/admin/companies-list";
import { DAY_MS } from "@/lib/admin/numbers";
import { readMonthlyRevenue, withStripeDeadline } from "@/lib/admin/stripe-revenue";

/**
 * GET /api/admin/overview: the Staff console's Overview (spec-admin-backoffice
 * 2.1). Platform staff only. Today's numbers and what needs a person.
 *
 *   companies  total, and new in the last 30 days
 *   people     every person not deleted, across every company, and new in 30 days
 *   paying     companies on a Stripe subscription that is active or past due
 *              (the Companies list's Paying view, so the two always agree)
 *   revenue    what Stripe charges per month for WorkwrK's subscriptions
 *              (active or past due, after their discounts), one line per
 *              currency, never converted; "unavailable" when billing is not
 *              connected and "error" when Stripe did not answer in time (the
 *              database numbers never wait on Stripe for more than a few
 *              seconds). Never a price list.
 *   attention  each count is exactly what its link on the page opens: the
 *              trials row opens Trials filtered to "Ends in the next 7 days",
 *              and the no-Owner row leaves cancelled companies out on both
 *              sides (nothing is left to act on in one)
 *   newest     the eight most recent companies
 *
 * Counts, plans, statuses and dates only: no customer's work is read.
 * Replaces the overview half of the old GET /api/admin/stats.
 */
export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const denied = await requirePlatformAdminApi(session);
  if (denied) return denied;

  const now = new Date();
  const ago30 = new Date(now.getTime() - 30 * DAY_MS);
  // "This week" is today and the six days before it, from midnight UTC, so
  // the count is exactly what /admin/appsumo?view=redeemed&redeemed_from=
  // (a whole-day filter) opens.
  const codesSince = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 6 * DAY_MS);

  const [
    companiesTotal,
    companiesNew,
    peopleTotal,
    peopleNew,
    paying,
    trialsEndingIn7,
    pastDue,
    withoutOwner,
    suspended,
    codesRedeemedIn7,
    newestRows,
    revenue,
  ] = await Promise.all([
    prisma.organization.count(),
    prisma.organization.count({ where: { createdAt: { gte: ago30 } } }),
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { deletedAt: null, createdAt: { gte: ago30 } } }),
    prisma.organization.count({ where: companyViewWhere("paying") }),
    // The Trials view with the Filter panel's "Ends in the next 7 days" (?trial_ends=7d).
    prisma.organization.count({ where: { AND: [companyViewWhere("trials"), trialEndsWithinWhere(now)] } }),
    // Past due is a Subscription value (the link opens Paying with the
    // Subscription filter at Past due), counted the way that list counts it.
    prisma.organization.count({ where: { AND: [companyViewWhere("paying"), { subscription: { is: { status: "PAST_DUE" } } }] } }),
    // Opened as ?owners=0&status=ACTIVE,TRIAL,SUSPENDED: every status but Cancelled.
    prisma.organization.count({ where: { AND: [{ status: { not: "CANCELLED" } }, { NOT: hasOwnerWhere() }] } }),
    prisma.organization.count({ where: companyViewWhere("suspended") }),
    prisma.appsumoCode.count({ where: { redeemedAt: { gte: codesSince }, refundedAt: null } }),
    prisma.organization.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 8,
      select: {
        id: true,
        name: true,
        plan: true,
        status: true,
        createdAt: true,
        _count: { select: { users: { where: { deletedAt: null } } } },
      },
    }),
    withStripeDeadline(readMonthlyRevenue()),
  ]);

  return jsonSuccess(
    {
      companies: { total: companiesTotal, newIn30: companiesNew },
      people: { total: peopleTotal, newIn30: peopleNew },
      paying: { count: paying, of: companiesTotal },
      revenue,
      attention: { trialsEndingIn7, pastDue, withoutOwner, suspended, codesRedeemedIn7, codesSince: codesSince.toISOString().slice(0, 10) },
      newest: newestRows.map((r) => ({
        id: r.id,
        name: r.name,
        plan: r.plan,
        status: r.status,
        people: r._count.users,
        createdAt: r.createdAt.toISOString(),
      })),
      generatedAt: now.toISOString(),
    },
    200,
    { "cache-control": "no-store" },
  );
}
