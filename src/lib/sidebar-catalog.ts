// Shared sidebar catalog — single source of truth for nav items the
// user can show/hide via the CustomizePanel. Used by both:
//   - CustomizePanel (Navigation tab — toggle visibility, reorder)
//   - OsSidebar (PINNED section — render the resulting filtered list)
//
// Keys here match the keys persisted in `UserPreference.sidebar`. Adding
// a new pinned nav item: add a row here. The customize panel auto-picks
// it up; the sidebar auto-renders it.

import {
  Home as HomeIcon,
  Inbox,
  Layers,
  Calendar as CalendarIcon,
  Sparkles,
  Users,
  FileText,
  BarChart3,
  Brush,
  ClipboardCheck,
  Video,
  Trophy,
  Clock,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  key: string;          // persisted in UserPreference.sidebar.hidden/order
  label: string;
  Icon: LucideIcon;
  href: string;
  /** alwaysOn items can't be hidden from the customize panel. */
  alwaysOn?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { key: "home",        label: "Home",        Icon: HomeIcon,        href: "/today",         alwaysOn: true },
  { key: "ai",          label: "AI",          Icon: Sparkles,        href: "/sidekick" },
  { key: "teams",       label: "Teams",       Icon: Users,           href: "/team/alignment" },
  { key: "docs",        label: "Docs",        Icon: FileText,        href: "/docs" },
  { key: "dashboards",  label: "Dashboards",  Icon: BarChart3,       href: "/dashboard" },
  { key: "whiteboards", label: "Whiteboards", Icon: Brush,           href: "/whiteboards" },
  { key: "forms",       label: "Forms",       Icon: ClipboardCheck,  href: "/forms" },
  { key: "clips",       label: "Clips",       Icon: Video,           href: "/notetaker" },
  { key: "goals",       label: "Goals",       Icon: Trophy,          href: "/okrs" },
  { key: "timesheets",  label: "Timesheets",  Icon: Clock,           href: "/timesheets" },
  // "spaces" + "planner" + "inbox" rendered by the sidebar as section
  // headers / fixed surfaces, not as pinned nav items — included in the
  // customize panel for the toggle UI but no href here.
  { key: "inbox",       label: "Inbox",       Icon: Inbox,           href: "/inbox" },
  { key: "planner",     label: "Planner",     Icon: CalendarIcon,    href: "/today" },
  { key: "spaces",      label: "Spaces",      Icon: Layers,          href: "/spaces" },
];

/**
 * Filter + order a set of nav keys per the user's effective preferences.
 * `hidden` removes items; `order` rearranges the remainder; items not
 * mentioned in `order` keep their catalog order, appended after.
 */
export function arrangeNavItems(items: NavItem[], hidden: string[], order: string[]): NavItem[] {
  const hiddenSet = new Set(hidden);
  const filtered = items.filter((it) => it.alwaysOn || !hiddenSet.has(it.key));
  if (order.length === 0) return filtered;
  const byKey = new Map(filtered.map((it) => [it.key, it] as const));
  const ordered: NavItem[] = [];
  for (const k of order) {
    const it = byKey.get(k);
    if (it) {
      ordered.push(it);
      byKey.delete(k);
    }
  }
  for (const it of byKey.values()) ordered.push(it);
  return ordered;
}
