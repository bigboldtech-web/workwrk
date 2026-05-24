// Dashboard home — composition shell. Server-rendered so we can do
// the department-aware landing redirect before any hero markup
// hydrates (avoids a flash of the wrong page).
//
// Behavior:
//   - If the user is non-admin / non-manager AND their department maps
//     to a known workspace (Sales → /crm, Engineering → /dev, etc.),
//     they land directly in that workspace instead of seeing a generic
//     dashboard. Aligns with the "open into your work, not a summary"
//     vision pillar.
//   - Admins and managers always see the dashboard (they need the
//     cross-org snapshot).
//   - A `?stay=1` query param bypasses the redirect — used by the
//     "Workspace home" link in AppWorkspaceNav and any bookmark that
//     wants the dashboard view explicitly.

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deptHomeFor } from "@/lib/dept-home";
import { ClickupHomeHero } from "@/components/dashboard/clickup-home-hero";
import { FirstRunWelcome } from "@/components/dashboard/first-run-welcome";
import DashboardContent from "./dashboard-content";

export const dynamic = "force-dynamic";

const ALWAYS_DASHBOARD_LEVELS = new Set([
  "SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR",
  "MANAGER", "TEAM_LEAD", "HR",
]);

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ stay?: string }>;
}) {
  const { stay } = await searchParams;

  // Bookmark / nav-link bypass — render the dashboard as-is.
  if (stay !== "1") {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string } | undefined)?.id;
    const accessLevel =
      (session?.user as { accessLevel?: string } | undefined)?.accessLevel ?? "EMPLOYEE";

    // Admins / managers see the dashboard — they need the cross-org
    // snapshot. ICs get routed to their team's workspace.
    if (userId && !ALWAYS_DASHBOARD_LEVELS.has(accessLevel)) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { department: { select: { name: true } } },
      });
      const home = deptHomeFor(user?.department?.name ?? null);
      if (home) redirect(home.href);
    }
  }

  return (
    <>
      <FirstRunWelcome />
      <ClickupHomeHero />
      <DashboardContent />
    </>
  );
}
