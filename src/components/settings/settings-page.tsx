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
//      wrapping onto a second line below 640px rather than cut at the edge,
//   4. the 44px toolbar when the page or tab has Filter, Sort, a primary, a
//      secondary control at its right or a "..." menu. On a tabbed page
//      where ANY tab has one, every tab holds that 44px row, empty where its
//      own tab has nothing for it, so the first card starts at the same
//      height on every tab of the page (final Settings review, M3: Structure
//      258 against 214, Members 162 against 118, Security 214 against 258).
//
// A tab whose toolbar drives state that lives in its content (Members >
// People's search, filter panel and sort; Structure's Departments and Job
// titles) says `ownToolbar`, and its content draws the toolbar with
// SettingsToolbar: the toolbar is rendered INTO the header's fourth row
// (settings-cleanup Phase 4, "toolbars live in the header stack"), so it
// sits straight under the tabs on every tab, and the first thing in the
// content is the content. The header holds that row from the first paint at
// the height the toolbar really takes, so nothing below it moves when it
// arrives: 44px where it is one line, and below 768px, where it wraps onto
// two or three, the tab's own `toolbarRow` heights, measured per breakpoint
// (settings-cleanup Phase 4 review, L3; the 44px alone let a phone's content
// jump 44 to 88px on a direct load).
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

import { Suspense, createContext, useCallback, useContext, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
  /** Secondary controls at the toolbar's right, before the primary (Pending invites' "Invite people"). */
  right?: ReactNode;
  /**
   * The tab's content draws its own toolbar with SettingsToolbar, because the
   * state it drives lives there; the header keeps its row for it.
   */
  ownToolbar?: boolean;
  /**
   * The row an `ownToolbar` tab's header holds before its toolbar arrives, as
   * min-height classes per breakpoint: the heights that toolbar really wraps
   * to at each width (measured at 1px steps), so nothing below it moves on a
   * direct load. Default SETTINGS_TOOLBAR_ROW, the one line's 44px.
   */
  toolbarRow?: string;
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
  /** Secondary toolbar controls on an untabbed page. */
  right?: ReactNode;
  /**
   * An untabbed page whose primary arrives with a read (Plan & billing's
   * Upgrade or Manage billing): while true, and no toolbar is drawn yet, the
   * header holds the toolbar's 44px row, so the content does not move down
   * when the button arrives (settings-cleanup Phase 7 review).
   */
  holdToolbar?: boolean;
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

/**
 * The search field a door's index page starts with (Overview, both All
 * settings pages): one look and ONE width, 480, full width on a phone
 * (settings-cleanup Phase 7: All settings' was 560 beside Overview's 480).
 */
export const SETTINGS_SEARCH_FIELD =
  "flex h-9 w-full max-w-[480px] items-center gap-2 rounded-md border border-line-strong bg-raised px-3 focus-within:shadow-[0_0_0_3px_var(--os-focus-halo)]";

/** The page's 24px gutter (16px below 900px), shared by every row of the stack and the content. */
const GUTTER = "px-[24px] max-[900px]:px-[16px]";

/**
 * Below 640px the tabs wrap onto a second line instead of running past the
 * screen's edge, where the row's hidden scroll left a tab cut off ("Side",
 * "Pending inv"; settings-cleanup P12, found again in the Phase 3 390 shots).
 * The 28px pills, their 14px text and the 36px row above 640px are kept.
 */
export const SETTINGS_TABS_PHONE = "max-[640px]:h-auto max-[640px]:min-h-9 max-[640px]:py-1 max-[640px]:[&>div]:flex-wrap max-[640px]:[&>div]:gap-y-1 max-[640px]:[&>div]:overflow-visible";

/** The header's fourth row while a tab's content has not drawn its toolbar into it yet: the toolbar's own 44px, its one line. */
export const SETTINGS_TOOLBAR_ROW = "min-h-11";

/**
 * The classes the header's toolbar row holds for the active tab (pure;
 * tested): none for a tab without its own toolbar, else the tab's measured
 * heights, else the one line's 44px.
 */
export function settingsToolbarRow(tab: Pick<SettingsTab, "ownToolbar" | "toolbarRow"> | null | undefined): string | undefined {
  if (!tab?.ownToolbar) return undefined;
  return tab.toolbarRow ?? SETTINGS_TOOLBAR_ROW;
}

/** Whether a tab puts anything in the header's toolbar row (pure; tested). */
export function tabHasToolbar(t: Pick<SettingsTab, "primary" | "menu" | "filter" | "sort" | "right" | "ownToolbar">): boolean {
  return Boolean(t.primary || t.menu?.length || t.filter || t.sort || t.right || t.ownToolbar);
}

/**
 * The min-height classes the header's toolbar row holds (pure; tested): an
 * `ownToolbar` tab's measured row (settingsToolbarRow); else, while no
 * toolbar is drawn, the one line's 44px when the page is holding it for a
 * primary still to come (`holdToolbar`) or when another tab of the page has
 * a toolbar, so changing tabs never moves the content (final review, M3);
 * else nothing.
 */
export function reservedToolbarRow(
  tabs: readonly SettingsTab[],
  active: SettingsTab | null,
  drawn: boolean,
  holdToolbar = false,
): string | undefined {
  const own = settingsToolbarRow(active);
  if (own) return own;
  if (drawn) return undefined;
  const siblings = tabs.length > 1 && tabs.some(tabHasToolbar);
  return holdToolbar || siblings ? SETTINGS_TOOLBAR_ROW : undefined;
}

/**
 * Where a SettingsToolbar draws (pure; tested): into the header's toolbar
 * row once the page has given it one ("header"), nowhere for the moment
 * before the page has drawn that row ("wait": the first paint and the
 * server's HTML, where the row already holds its 44px), or in the content
 * itself when it is rendered outside any SettingsPage ("inline").
 */
export function settingsToolbarPlace(slot: Element | null | undefined): "header" | "wait" | "inline" {
  return slot === undefined ? "inline" : slot === null ? "wait" : "header";
}

/**
 * The header's toolbar row a SettingsToolbar draws into: undefined outside a
 * SettingsPage. Exported for the tests, which hand a toolbar a row of their
 * own (the server never has one: the row is set from its ref).
 */
export const ToolbarSlot = createContext<HTMLElement | null | undefined>(undefined);

/**
 * A toolbar drawn by a tab's content, into the page header's fourth row
 * (see the header comment). Takes the same props as OsToolbar.
 */
export function SettingsToolbar(props: OsToolbarProps) {
  const slot = useContext(ToolbarSlot);
  const place = settingsToolbarPlace(slot);
  if (place === "inline") return <OsToolbar {...props} className={cn("!px-0", props.className)} />;
  if (place === "wait" || !slot) return null;
  return createPortal(<OsToolbar {...props} className={cn(GUTTER, props.className)} />, slot);
}

/**
 * The header stack: title row, subtitle line, then (when there are any) the
 * tabs row and the toolbar, all on one left edge. Exported for the stack's
 * tests; pages use SettingsPage. `onToolbarRow` receives the row a tab's own
 * toolbar is drawn into; `reserveToolbarRow` is the min-height classes that
 * keep its height before it arrives (settingsToolbarRow).
 */
export function SettingsHead({
  title,
  subtitle,
  actions,
  tabs,
  toolbar,
  onToolbarRow,
  reserveToolbarRow,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
  toolbar?: OsToolbarProps | null;
  onToolbarRow?: (el: HTMLDivElement | null) => void;
  reserveToolbarRow?: string;
}) {
  // The row is always in the tree when asked for, so a toolbar has somewhere
  // to go; empty and unreserved it is 0px tall and moves nothing.
  const row = onToolbarRow ? (
    <div ref={onToolbarRow} data-settings-toolbar-row="" className={reserveToolbarRow || undefined} />
  ) : null;
  return (
    <header data-settings-head="">
      <OsPageHeader title={title} actions={actions} className="max-[900px]:[&>div]:px-[16px]" />
      {subtitle ? <p data-settings-subtitle="" className={cn("text-sm text-ink-2", GUTTER)}>{subtitle}</p> : null}
      {tabs || toolbar || (row && reserveToolbarRow) ? (
        <div className="mt-2">
          {tabs ? <OsViewsRow className={cn(GUTTER, SETTINGS_TABS_PHONE)} aria-label="Tabs">{tabs}</OsViewsRow> : null}
          {toolbar ? <OsToolbar {...toolbar} className={GUTTER} /> : null}
          {row}
        </div>
      ) : (
        row
      )}
    </header>
  );
}

function SettingsPageInner({ pageKey, tabs = [], primary, menu, filter, sort, right, holdToolbar, actions, width = "form", subtitle, lead, children, className }: SettingsPageProps) {
  const page = SETTINGS_PAGES[pageKey];
  const [active, setTab] = useSettingsTab(tabs);
  const activeTab = useMemo(() => tabs.find((t) => t.key === active) ?? null, [tabs, active]);
  const tabbed = tabs.length > 0;
  const tabPrimary = tabbed ? activeTab?.primary : primary;
  const tabMenu = tabbed ? activeTab?.menu : menu;
  const tabFilter = tabbed ? activeTab?.filter : filter;
  const tabSort = tabbed ? activeTab?.sort : sort;
  const tabRight = tabbed ? activeTab?.right : right;
  // The toolbar row a tab's own SettingsToolbar draws into. Set from the
  // row's ref during the commit, so the toolbar is drawn before the browser
  // paints (a client navigation never shows the row empty).
  const [slot, setSlot] = useState<HTMLElement | null>(null);

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
    tabPrimary || tabMenu?.length || tabFilter || tabSort || tabRight ? { primary: tabPrimary, menu: tabMenu, filter: tabFilter, sort: tabSort, right: tabRight } : null;
  const body = typeof children === "function" ? children(active) : children;

  return (
    <div className={cn("w-full pb-16", width === "list" ? "max-w-[1168px]" : "max-w-[808px]", className)}>
      <SettingsHead
        title={page?.label ?? pageKey}
        subtitle={subtitle ?? page?.summary}
        actions={actions}
        tabs={tabStrip}
        toolbar={toolbar}
        onToolbarRow={setSlot}
        reserveToolbarRow={reservedToolbarRow(tabs, activeTab, !!toolbar, holdToolbar)}
      />
      <ToolbarSlot.Provider value={slot}>
        <div className={cn("mt-4", GUTTER)}>
          {lead ? <div className="mb-6">{lead}</div> : null}
          {body}
        </div>
      </ToolbarSlot.Provider>
    </div>
  );
}
