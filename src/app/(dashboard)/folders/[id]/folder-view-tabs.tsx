"use client";

// Client wrapper for the Folder view-tab strip — mirrors SpaceViewTabs so a
// Folder page reads exactly like a Space page (same underline tabs, same icon
// tiles). Overview + List are the functional set today.

import { ViewTabStrip, ViewTab } from "@/components/ui/view-tabs";
import {
  LayoutDashboard, List as ListIcon, type LucideIcon,
} from "lucide-react";

const VIEW_TABS: { key: string; label: string; Icon: LucideIcon; tile: string }[] = [
  { key: "overview", label: "Overview", Icon: LayoutDashboard, tile: "#6366F1" },
  { key: "list", label: "List", Icon: ListIcon, tile: "#6B7280" },
];

export function FolderViewTabs({ view, folderId, hiddenViews = [] }: { view: string; folderId: string; hiddenViews?: string[] }) {
  return (
    <ViewTabStrip className="px-6">
      {VIEW_TABS.filter((t) => !hiddenViews.includes(t.key)).map((t) => (
        <ViewTab
          key={t.key}
          icon={t.Icon}
          iconTileColor={t.tile}
          label={t.label}
          active={view === t.key}
          href={t.key === "overview" ? `/folders/${folderId}` : `/folders/${folderId}?view=${t.key}`}
        />
      ))}
    </ViewTabStrip>
  );
}
