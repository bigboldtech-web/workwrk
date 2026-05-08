// Dashboard home — composition shell. ClickUp-style greeting + KPI
// tiles + Inbox preview at the top (server-rendered for fast first
// paint), then the existing role-aware dashboard content below.

import { ClickupHomeHero } from "@/components/dashboard/clickup-home-hero";
import DashboardContent from "./dashboard-content";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <>
      <ClickupHomeHero />
      <DashboardContent />
    </>
  );
}
