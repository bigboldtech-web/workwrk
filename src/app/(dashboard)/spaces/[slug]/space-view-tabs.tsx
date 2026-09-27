"use client";

// Client wrapper for the Space view-tab strip. The lucide icon components are
// functions, which a Server Component cannot pass across the boundary into the
// client ViewTab. Keeping the icons here (client -> client) fixes that crash.
//
// Order and links come from src/lib/work/space-default-view.ts, the rule the
// page itself resolves its view with, so the first tab is always the one the
// bare /spaces/<slug> opens. A pinned view renders first with a pin glyph;
// the default tab links to the bare URL and every other tab names itself, so
// Overview stays reachable as ?view=overview once something else is pinned.
// Tabs are wrapped in SpaceTabMenu (Pin as default view / Unpin) only for a
// person who may pin; everyone else keeps the browser's own context menu.

import { Fragment } from "react";
import { ViewTabStrip, ViewTab } from "@/components/ui/view-tabs";
import {
  Binoculars, Calendar as CalendarIcon, GanttChart, Kanban, LayoutDashboard,
  List as ListIcon, Pin, Users as UsersIcon, type LucideIcon,
} from "lucide-react";
import {
  SPACE_VIEW_LABELS,
  defaultSpaceView,
  orderSpaceTabs,
  spaceTabHref,
  spaceTabMenuRow,
  type SpaceViewKey,
} from "@/lib/work/space-default-view";
import { SpaceTabMenu } from "./space-tab-menu";

const TAB_ICONS: Record<SpaceViewKey, LucideIcon> = {
  overview: LayoutDashboard,
  birdseye: Binoculars,
  list: ListIcon,
  board: Kanban,
  team: UsersIcon,
  calendar: CalendarIcon,
  gantt: GanttChart,
};

export function SpaceViewTabs({
  view,
  spaceSlug,
  spaceId,
  hiddenViews,
  pinnedView,
  canPin,
}: {
  view: SpaceViewKey;
  spaceSlug: string;
  spaceId: string;
  hiddenViews: SpaceViewKey[];
  pinnedView: SpaceViewKey | null;
  canPin: boolean;
}) {
  const keys = orderSpaceTabs(hiddenViews, pinnedView);
  const defaultKey = defaultSpaceView(pinnedView, hiddenViews);
  const pinShown = pinnedView !== null && keys.includes(pinnedView);
  const pinnedLabel = pinnedView ? SPACE_VIEW_LABELS[pinnedView] : undefined;

  return (
    <ViewTabStrip className="px-6" aria-label="Space views">
      {keys.map((key) => {
        const pinned = pinShown && key === pinnedView;
        const tab = (
          <ViewTab
            icon={TAB_ICONS[key]}
            label={SPACE_VIEW_LABELS[key]}
            active={view === key}
            href={spaceTabHref(spaceSlug, key, defaultKey)}
            title={pinned ? "Pinned as the default view" : undefined}
            trailing={
              pinned ? (
                <>
                  <Pin className="h-3 w-3 shrink-0 text-ink-3" strokeWidth={1.75} aria-hidden />
                  <span className="sr-only">, pinned as the default view</span>
                </>
              ) : undefined
            }
          />
        );
        const row = spaceTabMenuRow({ key, pinned: pinnedView, hidden: hiddenViews, canPin });
        if (row === "none") return <Fragment key={key}>{tab}</Fragment>;
        return (
          <SpaceTabMenu
            key={key}
            spaceId={spaceId}
            spaceSlug={spaceSlug}
            viewKey={key}
            row={row}
            pinnedKey={pinnedView}
            pinnedLabel={pinnedLabel}
            activeView={view}
          >
            {tab}
          </SpaceTabMenu>
        );
      })}
    </ViewTabStrip>
  );
}
