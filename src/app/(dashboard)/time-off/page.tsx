// Time off — server-rendered shell. Computes my balances on the
// server (single round-trip, no balance flicker) and hands the rest
// to the client manager for tabs + interactivity.

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeBalances } from "@/lib/time-off-balance";
import { TimeOffManager, type Policy } from "./time-off-manager";

export const dynamic = "force-dynamic";

export default async function TimeOffPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const userId = (session.user as { id: string }).id;
  const orgId = (session.user as { organizationId: string }).organizationId;
  const accessLevel = (session.user as { accessLevel?: string }).accessLevel ?? "EMPLOYEE";
  const isManager = !["EMPLOYEE", "AGENT"].includes(accessLevel);
  const isAdmin = ["SUPER_ADMIN", "COMPANY_ADMIN"].includes(accessLevel);

  const [policies, myThisYearRequests] = await Promise.all([
    prisma.timeOffPolicy.findMany({
      where: { organizationId: orgId, archived: false },
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, type: true, color: true, description: true,
        annualHours: true, carryoverHours: true, requiresApproval: true, archived: true,
      },
    }),
    prisma.timeOffRequest.findMany({
      where: {
        organizationId: orgId,
        userId,
        startDate: {
          gte: new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)),
          lt: new Date(Date.UTC(new Date().getUTCFullYear() + 1, 0, 1)),
        },
        status: { in: ["PENDING", "APPROVED"] },
      },
      select: { policyId: true, status: true, hours: true, startDate: true },
    }),
  ]);

  const policiesForUI: Policy[] = policies.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    color: p.color,
    description: p.description,
    annualHours: Number(p.annualHours),
    carryoverHours: Number(p.carryoverHours),
    requiresApproval: p.requiresApproval,
    archived: p.archived,
  }));

  const balances = computeBalances(
    policies.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      color: p.color,
      annualHours: Number(p.annualHours),
    })),
    myThisYearRequests.map((r) => ({
      policyId: r.policyId,
      status: r.status,
      hours: Number(r.hours),
      startDate: r.startDate,
    })),
  );

  return (
    <TimeOffManager
      policies={policiesForUI}
      initialBalances={balances}
      isManager={isManager}
      isAdmin={isAdmin}
    />
  );
}
