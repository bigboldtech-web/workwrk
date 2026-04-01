import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonSuccess } from "@/lib/api-helpers";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);

  const [
    teamCount,
    departmentCount,
    kraCount,
    kpiCount,
    kraAssignmentCount,
    sopCount,
    reviewCycleCount,
    org,
  ] = await Promise.all([
    prisma.user.count({ where: { organizationId: orgId, deletedAt: null } }),
    prisma.department.count({ where: { organizationId: orgId } }),
    prisma.kRA.count({ where: { organizationId: orgId } }),
    prisma.kPI.count({ where: { organizationId: orgId } }),
    prisma.kRAAssignment.count({ where: { kra: { organizationId: orgId } } }),
    prisma.sOP.count({ where: { organizationId: orgId, status: "PUBLISHED" } }),
    prisma.reviewCycle.count({ where: { organizationId: orgId } }),
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { settings: true, logo: true },
    }),
  ]);

  const settings = (org?.settings as Record<string, unknown>) || {};
  const hasLogo = !!org?.logo;
  const setupCompleted = !!settings.setupCompleted;

  const steps = [
    {
      id: "setup",
      label: "Complete workspace setup",
      description: "Configure your organization basics",
      completed: setupCompleted,
      href: "/setup",
    },
    {
      id: "team",
      label: "Invite team members",
      description: "Add at least 2 team members",
      completed: teamCount >= 3, // admin + 2 members
      href: "/settings",
    },
    {
      id: "departments",
      label: "Set up departments",
      description: "Create and organize departments",
      completed: departmentCount >= 2,
      href: "/organization",
    },
    {
      id: "kra",
      label: "Create your first KRA",
      description: "Define a key responsible area",
      completed: kraCount >= 1,
      href: "/kra-kpi",
    },
    {
      id: "kpi",
      label: "Add KPIs to a KRA",
      description: "Set measurable indicators",
      completed: kpiCount >= 1,
      href: "/kra-kpi",
    },
    {
      id: "assign_kra",
      label: "Assign a KRA to someone",
      description: "Link a team member to their responsibilities",
      completed: kraAssignmentCount >= 1,
      href: "/kra-kpi",
    },
    {
      id: "sop",
      label: "Publish your first SOP",
      description: "Document a standard operating procedure",
      completed: sopCount >= 1,
      href: "/sops",
    },
    {
      id: "review",
      label: "Create a review cycle",
      description: "Set up your first performance review",
      completed: reviewCycleCount >= 1,
      href: "/reviews",
    },
  ];

  const completedCount = steps.filter((s) => s.completed).length;
  const totalCount = steps.length;
  const percentage = Math.round((completedCount / totalCount) * 100);

  return jsonSuccess({
    steps,
    completedCount,
    totalCount,
    percentage,
    allDone: completedCount === totalCount,
  });
}
