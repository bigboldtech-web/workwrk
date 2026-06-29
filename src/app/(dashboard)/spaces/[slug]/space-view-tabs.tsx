"use client";

// Client wrapper for the Space view-tab strip. The lucide icon components are
// functions, which a Server Component cannot pass across the boundary into the
// client ViewTab. Keeping the icons here (client -> client) fixes that crash.

import { ViewTabStrip, ViewTab } from "@/components/ui/view-tabs";
import {
  LayoutDashboard, List as ListIcon, Kanban, Users as UsersIcon,
  Calendar as CalendarIcon, GanttChart, type LucideIcon,
} from "lucide-react";

const VIEW_TABS: { key: string; label: string; Icon: LucideIcon; tile: string }[] = [
  { key: "overview", label: "Overview", Icon: LayoutDashboard, tile: "#6366F1" },
  { key: "list", label: "List", Icon: ListIcon, tile: "#6B7280" },
  { key: "board", label: "Board", Icon: Kanban, tile: "#4F6BED" },
  { key: "team", label: "Team", Icon: UsersIcon, tile: "#A855F7" },
  { key: "calendar", label: "Calendar", Icon: CalendarIcon, tile: "#F59E0B" },
  { key: "gantt", label: "Gantt", Icon: GanttChart, tile: "#EF4444" },
];

export function SpaceViewTabs({ view, spaceSlug }: { view: string; spaceSlug: string }) {
  return (
    <ViewTabStrip className="px-6">
      {VIEW_TABS.map((t) => (
        <ViewTab
          key={t.key}
          icon={t.Icon}
          iconTileColor={t.tile}
          label={t.label}
          active={view === t.key}
          href={t.key === "overview" ? `/spaces/${spaceSlug}` : `/spaces/${spaceSlug}?view=${t.key}`}
        />
      ))}
    </ViewTabStrip>
  );
}
