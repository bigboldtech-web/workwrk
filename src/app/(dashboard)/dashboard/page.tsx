// Dashboard home — composition shell. Server-rendered hero for fast
// first paint, then role-aware dashboard content below, and a
// client-mounted welcome that fires once per browser.

import { ClickupHomeHero } from "@/components/dashboard/clickup-home-hero";
import { FirstRunWelcome } from "@/components/dashboard/first-run-welcome";
import DashboardContent from "./dashboard-content";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <>
      <FirstRunWelcome />
      <ClickupHomeHero />
      <DashboardContent />
    </>
  );
}
