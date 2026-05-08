// Workforce planning. Server-rendered analytics joining live
// User.departmentId counts to HeadcountPlan rows for the current
// period. Manager+ reads the page; admin writes plans via the
// dialog (gated server-side).

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { WorkforcePlanningView, type PlanRow, type DepartmentSnapshot } from "./planning-view";

export const dynamic = "force-dynamic";

function defaultPeriod(): string {
  const now = new Date();
  const q = Math.floor(now.getUTCMonth() / 3) + 1;
  return `${now.getUTCFullYear()}-Q${q}`;
}

export default async function WorkforcePlanningPage(
  { searchParams }: { searchParams: Promise<{ period?: string }> },
) {
  const sp = await searchParams;
  const period = (sp.period && sp.period.trim()) || defaultPeriod();

  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const orgId = (session.user as { organizationId: string }).organizationId;
  const accessLevel = (session.user as { accessLevel?: string }).accessLevel ?? "EMPLOYEE";
  const isAdmin = ["SUPER_ADMIN", "COMPANY_ADMIN"].includes(accessLevel);

  const [departments, plans, openJobs, hiresThisYear, leaversThisYear] = await Promise.all([
    prisma.department.findMany({
      where: { organizationId: orgId },
      include: {
        _count: { select: { members: { where: { status: "ACTIVE" } } } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.headcountPlan.findMany({
      where: { organizationId: orgId, period },
      include: { department: { select: { id: true, name: true } } },
    }),
    prisma.job.count({ where: { organizationId: orgId, status: "OPEN" } }),
    prisma.application.count({
      where: {
        organizationId: orgId,
        stage: "HIRED",
        updatedAt: { gte: new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)) },
      },
    }),
    prisma.user.count({
      where: {
        organizationId: orgId,
        status: "INACTIVE",
        updatedAt: { gte: new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)) },
      },
    }),
  ]);

  // Total active employees (denominator for ratios).
  const totalActive = await prisma.user.count({
    where: { organizationId: orgId, status: "ACTIVE" },
  });

  // Build a map: deptId → plan row for quick join.
  const planByDept = new Map<string | null, typeof plans[number]>();
  for (const p of plans) planByDept.set(p.departmentId, p);

  const snapshots: DepartmentSnapshot[] = departments.map((d) => {
    const plan = planByDept.get(d.id);
    const planned = plan?.plannedHeadcount ?? null;
    const current = d._count.members;
    return {
      departmentId: d.id,
      name: d.name,
      currentHeadcount: current,
      plannedHeadcount: planned,
      variance: planned === null ? null : current - planned,
      plannedBudget: plan?.plannedBudget === null || plan?.plannedBudget === undefined
        ? null
        : Number(plan.plannedBudget),
      budgetCurrency: plan?.budgetCurrency ?? "USD",
      planId: plan?.id ?? null,
    };
  });

  // Org-wide row, if a planId == null plan exists.
  const orgPlan = planByDept.get(null);
  const orgRow: DepartmentSnapshot | null = orgPlan
    ? {
        departmentId: null,
        name: "(Organization-wide)",
        currentHeadcount: totalActive,
        plannedHeadcount: orgPlan.plannedHeadcount,
        variance: totalActive - orgPlan.plannedHeadcount,
        plannedBudget: orgPlan.plannedBudget === null ? null : Number(orgPlan.plannedBudget),
        budgetCurrency: orgPlan.budgetCurrency,
        planId: orgPlan.id,
      }
    : null;

  const allPlans: PlanRow[] = plans.map((p) => ({
    id: p.id,
    period: p.period,
    departmentId: p.departmentId,
    departmentName: p.department?.name ?? null,
    plannedHeadcount: p.plannedHeadcount,
    plannedBudget: p.plannedBudget === null ? null : Number(p.plannedBudget),
    budgetCurrency: p.budgetCurrency,
    notes: p.notes,
  }));

  return (
    <WorkforcePlanningView
      period={period}
      isAdmin={isAdmin}
      totalActive={totalActive}
      openJobs={openJobs}
      hiresThisYear={hiresThisYear}
      leaversThisYear={leaversThisYear}
      orgRow={orgRow}
      snapshots={snapshots}
      allPlans={allPlans}
      departments={departments.map((d) => ({ id: d.id, name: d.name }))}
    />
  );
}
