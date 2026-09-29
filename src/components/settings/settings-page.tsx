"use client";

// SettingsPage (spec-settings-workspace section 3 and 1.7): the one page
// frame inside both settings doors. The title is ALWAYS the registry label
// (SETTINGS_PAGES[pageKey].label), so the sidebar row, the top-bar crumb and
// the page title can never disagree. It draws the compact OsPageHeader
// (title row, text-tab pills wired to `?tab=`, the toolbar with at most one
// blue button) and the content column: 760px for form pages, 1120px for
// list pages, 24px padding (16px below 900px).
//
// ONE PRIMARY PER PAGE by construction: `primary` is a single action, and on
// a tabbed page the primary belongs to the active tab (a tab object carries
// its own `primary`), so two can never render. No in-page breadcrumb, no
// "Settings" chip, no "Back to settings" link: the takeover header is the
// only chrome (settings-architecture 8.3).

import { Suspense, useCallback, useMemo, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { OsPageHeader, type HeaderMenuEntry, type PrimaryAction } from "@/components/layout/os/page-header";
import { ViewTab } from "@/components/ui/view-tabs";
import { SETTINGS_PAGES } from "@/lib/settings-registry";
import { leaveThen } from "@/lib/dirty-guard";
import type { SettingsPageKey } from "@/lib/access/types";
import { cn } from "@/lib/utils";
import { pickSettingsTab } from "@/lib/settings-tabs";

export interface SettingsTab {
  key: string;
  label: string;
  /** The tab's one blue button. A tab with a Save bar passes none. */
  primary?: PrimaryAction;
  /** The bordered "..." square for this tab. */
  menu?: HeaderMenuEntry[];
}

export { pickSettingsTab };

/**
 * The `?tab=` state for a tabbed settings page: reads the URL, writes it with
 * router.replace (so Back walks pages, not tabs), and asks the dirty guard
 * before switching away from unsaved work.
 */
export function useSettingsTab(tabs: readonly { key: string }[]): [string | null, (key: string) => void] {
  const router = useRouter();
  const pathname = usePathname() || "";
  const params = useSearchParams();
  const active = pickSettingsTab(tabs, params?.get("tab"));
  const setTab = useCallback(
    (key: string) => {
      if (key === active) return;
      void leaveThen(() => {
        const next = new URLSearchParams(params?.toString() ?? "");
        next.set("tab", key);
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      });
    },
    [active, params, pathname, router],
  );
  return [active, setTab];
}

export interface SettingsPageProps {
  pageKey: SettingsPageKey;
  /** Tabs in order; the active one comes from `?tab=`. One tab renders no views row. */
  tabs?: readonly SettingsTab[];
  /** The page's one blue button on an untabbed page. */
  primary?: PrimaryAction;
  /** The bordered "..." square on an untabbed page. */
  menu?: HeaderMenuEntry[];
  /** Ghost title-row actions (real controls only). */
  actions?: ReactNode;
  /** 760px form column (default) or the 1120px list column. */
  width?: "form" | "list";
  /** Page body. For a tabbed page a function receives the active tab key. */
  children: ReactNode | ((tab: string | null) => ReactNode);
  className?: string;
}

/**
 * `?tab=` is read with useSearchParams, which needs a Suspense boundary on a
 * page Next could prerender; the fallback is the same title row, so the
 * frame never flashes empty.
 */
export function SettingsPage(props: SettingsPageProps) {
  const label = SETTINGS_PAGES[props.pageKey]?.label ?? props.pageKey;
  return (
    <Suspense
      fallback={
        <div className={cn("w-full pb-16", props.width === "list" ? "max-w-[1168px]" : "max-w-[808px]")}>
          <OsPageHeader title={label} />
        </div>
      }
    >
      <SettingsPageInner {...props} />
    </Suspense>
  );
}

function SettingsPageInner({ pageKey, tabs = [], primary, menu, actions, width = "form", children, className }: SettingsPageProps) {
  const page = SETTINGS_PAGES[pageKey];
  const [active, setTab] = useSettingsTab(tabs);
  const activeTab = useMemo(() => tabs.find((t) => t.key === active) ?? null, [tabs, active]);
  const tabPrimary = tabs.length > 0 ? activeTab?.primary : primary;
  const tabMenu = tabs.length > 0 ? activeTab?.menu : menu;

  return (
    <div className={cn("w-full pb-16", width === "list" ? "max-w-[1168px]" : "max-w-[808px]", className)}>
      <OsPageHeader
        title={page?.label ?? pageKey}
        actions={actions}
        views={
          tabs.length > 1 ? (
            <>
              {tabs.map((t) => (
                <ViewTab key={t.key} label={t.label} active={t.key === active} onClick={() => setTab(t.key)} />
              ))}
            </>
          ) : undefined
        }
        primary={tabPrimary}
        menu={tabMenu}
      />
      <div className="mt-4 px-6 max-[900px]:px-4">{typeof children === "function" ? children(active) : children}</div>
    </div>
  );
}
