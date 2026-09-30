import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sessionMayManageOwnerPage } from "@/lib/access/workspace-admin";
import { PLAN_LIMITS } from "@/lib/plan-limits-data";
import { isBillingLive } from "@/services/billing";

// GET /api/settings/billing-summary: Plan & billing in one read. Owner page
// (every Admin until the Owner and Admin split). `billingLive` says whether
// the Stripe portal can open, so the page never renders a button that 503s;
// AI queries are counted for THIS calendar month (the old bar counted every
// query ever made while the Overview claimed the period).
export async function GET() {
  const session = await getServerSession(authOptions);
  const orgId = (session?.user as { organizationId?: string } | undefined)?.organizationId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await sessionMayManageOwnerPage(session, "billing"))) return NextResponse.json({ error: "no_access", page: "billing" }, { status: 403 });
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [org, members, sops, ai] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId }, select: { plan: true, status: true } }),
    prisma.user.count({ where: { organizationId: orgId, deletedAt: null, status: { not: "INACTIVE" } } }),
    prisma.sOP.count({ where: { organizationId: orgId } }),
    prisma.aIQuery.count({ where: { organizationId: orgId, createdAt: { gte: monthStart } } }),
  ]);
  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  const plan = String(org.plan);
  return NextResponse.json(
    {
      plan,
      status: String(org.status),
      limits: PLAN_LIMITS[plan] ?? PLAN_LIMITS.STARTER,
      usage: { members, sops, aiThisMonth: ai },
      billingLive: !!isBillingLive,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
