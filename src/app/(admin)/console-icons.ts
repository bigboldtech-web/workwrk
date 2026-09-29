// One icon per Staff console destination (spec-admin-backoffice section 1
// sidebar rows), shared by the sidebar and Search's GO TO section so the two
// never draw a destination differently.

import { BarChart3, Building2, KeyRound, LayoutDashboard, ScrollText, ShieldCheck, type LucideIcon } from "lucide-react";
import type { ConsoleNavKey } from "@/lib/admin/console-nav";

export const CONSOLE_NAV_ICONS: Record<ConsoleNavKey, LucideIcon> = {
  overview: LayoutDashboard,
  companies: Building2,
  analytics: BarChart3,
  appsumo: KeyRound,
  staff: ShieldCheck,
  audit: ScrollText,
};
