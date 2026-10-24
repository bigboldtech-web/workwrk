"use client";

// SettingsPage (spec-settings-workspace section 3 and 1.7): the one page
// frame inside both settings doors. The title is ALWAYS the registry label
// (SETTINGS_PAGES[pageKey].label), so the sidebar row, the top-bar crumb and
// the page title can never disagree. The content column is 760px for form
// pages and fluid to 1120px for list pages, 24px padding (16px below 900px).
//
// ONE HEADER STACK on every page (settings-cleanup B2), in this order and
// never another:
//
//   1. the 40px title row (the compact OsPageHeader, 18/600 title),
//   2. one 13/400 subtitle line: SETTINGS_PAGES[pageKey].summary, the same
//      string as the Overview tile, so every page has one and every header
//      is the same height (only a subtitle that carries live information,
//      the Overview's org line or My settings > Security's email, overrides
//      it through `subtitle`),
//   3. the 36px tabs row (28px pills) when the page has more than one tab,
//   4. the 44px toolbar when the page or tab has Filter, Sort, a primary or
//      a "..." menu.
//
// Content starts 16px under the last row. Content that applies to every tab
// (`lead`, Notifications' Quiet card) is the first card of the content, so
// the tabs always sit directly under the subtitle, never under a card.
//
// ONE PRIMARY PER PAGE by construction: `primary` is a single action, and on
// a tabbed page the primary belongs to the active tab (a tab object carries
// its own `primary`), so two can never render. No in-page breadcrumb, no
// "Settings" chip, no "Back to settings" link: the takeover header is the
// only chrome (settings-architecture 8.3).

import { Suspense, useCallback, useMemo, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { OsPageHeader, OsToolbar, OsViewsRow, type HeaderMenuEntry, type OsToolbarProps, type PrimaryAction } from "@/components/layout/os/page-header";
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
  /** This tab's Filter chip (the toolbar's left). */
  filter?: OsToolbarProps["filter"];
  /** This tab's Sort chip (the toolbar's left, never a native select). */
  sort?: OsToolbarProps["sort"];
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
  /** The Filter chip on an untabbed page. */
  filter?: OsToolbarProps["filter"];
  /** The Sort chip on an untabbed page. */
  sort?: OsToolbarProps["sort"];
  /** Ghost title-row actions (real controls only). */
  actions?: ReactNode;
  /** 760px form column (default) or the 1120px list column. */
  width?: "form" | "list";
  /**
   * Only for a subtitle that carries live information (the Overview's org
   * line, My settings > Security's email). Every other page shows its
   * registry summary, and so does this page until its value is known.
   */
  subtitle?: ReactNode;
  /** Content that applies to every tab: the first card of every tab, under the tabs (Notifications' Quiet card). */
  lead?: ReactNode;
  /** Page body. For a tabbed page a function receives the active tab key. */
  children: ReactNode | ((tab: string | null) => ReactNode);
  className?: string;
}

/**
 * `?tab=` is read with useSearchParams, which needs a Suspense boundary on a
 * page Next could prerender; the fallback is the same title row and
 * subtitle, so the frame never flashes empty and never changes height.
 */
export function SettingsPage(props: SettingsPageProps) {
  const page = SETTINGS_PAGES[props.pageKey];
  return (
    <Suspense
      fallback={
        <div className={cn("w-full pb-16", props.width === "list" ? "max-w-[1168px]" : "max-w-[808px]")}>
          <SettingsHead title={page?.label ?? props.pageKey} subtitle={props.subtitle ?? page?.summary} />
        </div>
      }
    >
      <SettingsPageInner {...props} />
    </Suspense>
  );
}

/** The page's 24px gutter (16px below 900px), shared by every row of the stack and the content. */
const GUTTER = "px-[24px] max-[900px]:px-[16px]";

/**
 * The header stack: title row, subtitle line, then (when there are any) the
 * tabs row and the toolbar, all on one left edge. Exported for the stack's
 * tests; pages use SettingsPage.
 */
export function SettingsHead({
  title,
  subtitle,
  actions,
  tabs,
  toolbar,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
  toolbar?: OsToolbarProps | null;
}) {
  return (
    <header data-settings-head="">
      <OsPageHeader title={title} actions={actions} className="max-[900px]:[&>div]:px-[16px]" />
      {subtitle ? <p data-settings-subtitle="" className={cn("text-sm text-ink-2", GUTTER)}>{subtitle}</p> : null}
      {tabs || toolbar ? (
        <div className="mt-2">
          {tabs ? <OsViewsRow className={GUTTER} aria-label="Tabs">{tabs}</OsViewsRow> : null}
          {toolbar ? <OsToolbar {...toolbar} className={GUTTER} /> : null}
        </div>
      ) : null}
    </header>
  );
}

function SettingsPageInner({ pageKey, tabs = [], primary, menu, filter, sort, actions, width = "form", subtitle, lead, children, className }: SettingsPageProps) {
  const page = SETTINGS_PAGES[pageKey];
  const [active, setTab] = useSettingsTab(tabs);
  const activeTab = useMemo(() => tabs.find((t) => t.key === active) ?? null, [tabs, active]);
  const tabbed = tabs.length > 0;
  const tabPrimary = tabbed ? activeTab?.primary : primary;
  const tabMenu = tabbed ? activeTab?.menu : menu;
  const tabFilter = tabbed ? activeTab?.filter : filter;
  const tabSort = tabbed ? activeTab?.sort : sort;

  // The Settings scope's "Switch tab 1 / 2 / 3" (the /account/shortcuts
  // reference lists it): a digit while a tab has keyboard focus opens that
  // tab. Only while the strip holds focus, so a digit typed in a field is
  // never taken.
  const onTabKey = (e: ReactKeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (!/^[1-9]$/.test(e.key)) return;
    const t = tabs[Number(e.key) - 1];
    if (!t) return;
    e.preventDefault();
    setTab(t.key);
  };
  const tabStrip =
    tabs.length > 1 ? (
      <div className="contents" onKeyDown={onTabKey}>
        {tabs.map((t) => (
          <ViewTab key={t.key} label={t.label} active={t.key === active} onClick={() => setTab(t.key)} />
        ))}
      </div>
    ) : undefined;
  const toolbar: OsToolbarProps | null =
    tabPrimary || tabMenu?.length || tabFilter || tabSort ? { primary: tabPrimary, menu: tabMenu, filter: tabFilter, sort: tabSort } : null;
  const body = typeof children === "function" ? children(active) : children;

  return (
    <div className={cn("w-full pb-16", width === "list" ? "max-w-[1168px]" : "max-w-[808px]", className)}>
      <SettingsHead title={page?.label ?? pageKey} subtitle={subtitle ?? page?.summary} actions={actions} tabs={tabStrip} toolbar={toolbar} />
      <div className={cn("mt-4", GUTTER)}>
        {lead ? <div className="mb-6">{lead}</div> : null}
        {body}
      </div>
    </div>
  );
}
