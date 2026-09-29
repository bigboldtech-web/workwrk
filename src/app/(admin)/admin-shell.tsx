"use client";

// The Staff console's reduced frame (spec-admin-backoffice section 1 "Hub and
// sidebar", section 2.1 "Top bar", section 3 item 1; design-system section 4
// without the rail). The platform-staff gate lives in the server layout
// (layout.tsx) and in every /api/admin/* handler; this renders the frame once
// access is granted.
//
//   - the 48px navy top bar: back and forward, the breadcrumb with the fixed
//     first crumb "Staff console", the Search field (a button: typing happens
//     in the overlay), Help when a runbook is configured, the avatar menu
//     (Signed in as, My settings, Log out; no Theme row),
//   - the 264px N50 sidebar: the four-dot header, the four destinations, the
//     CONSOLE section, the N200 active pill derived from the URL,
//   - no rail: that absence is what tells a staff member they are not inside
//     a customer's workspace.
//
// html[data-chrome="navy"] is stamped unconditionally (the navy frame is the
// console's identity); html[data-density] and the theme come from the staff
// member's OWN preferences, which live in My settings and are only read here.
// Below 1280 the search field narrows to 240; below 1024 the sidebar becomes
// a 264 slide-over behind a Menu button and the breadcrumb keeps two crumbs.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useTheme } from "next-themes";
import { ChevronLeft, ChevronRight, CircleHelp, LogOut, Menu, Search, Settings, X } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { MenuItem, MenuSeparator } from "@/components/ui/menu";
import { ToastProvider } from "@/components/ui/toast";
import { DialogProvider } from "@/components/ui/dialog-provider";
import { OsToastProvider } from "@/components/layout/os/toast";
import { ChromeIconButton, ChromePopover } from "@/components/layout/os/chrome-popover";
import { LayerStackProvider, useLayer, useLayerStack } from "@/components/layout/os/shell-context";
import { useNavHistory, useNavHistoryRecorder } from "@/components/layout/os/top-bar/nav-history";
import { APP_ROOT_ID, SessionExpiredDialog, SessionIdleWarning } from "@/components/layout/os/session-expired-dialog";
import { SidebarRow, SidebarSectionLabel } from "@/components/layout/os/sidebar-primitives";
import { shortcutHint, shortcuts, useShortcut, SHORTCUTS } from "@/lib/shortcuts";
import { isSessionExpired } from "@/lib/session-expiry";
import { activeConsoleNav, consoleCrumbs, shippedConsoleNav, type ConsoleCrumb } from "@/lib/admin/console-nav";
import type { ConsolePrefs } from "@/lib/admin/console-prefs";
import type { RecentCompany } from "@/lib/admin/console-me";
import type { DateFormatPrefs } from "@/lib/format/date";
import type { DensityPref } from "@/lib/preferences";
import { cn } from "@/lib/utils";
import { ConsoleProvider, useConsole, type ConsoleStaff } from "./console-context";
import { CONSOLE_NAV_ICONS } from "./console-icons";
import { StaffSearch, STAFF_SEARCH_PLACEHOLDER } from "./staff-search";

const SIDEBAR_ID = "console-sidebar";
const canon = Object.fromEntries(SHORTCUTS.map((s) => [s.id, s]));

export interface AdminShellProps {
  staff: ConsoleStaff;
  prefs: ConsolePrefs;
  recents: RecentCompany[];
  persisted: boolean;
  density: DensityPref;
  appearance: "LIGHT" | "DARK" | "AUTO";
  datePrefs: DateFormatPrefs;
  /** NEXT_PUBLIC_APP_URL without a trailing slash; "" when unset. */
  appUrl: string;
  /** My settings > Preferences > Appearance, or null where no link can reach it. */
  mySettingsHref: string | null;
  /** STAFF_RUNBOOK_URL; Help renders only when it is set. */
  runbookUrl: string | null;
  children: React.ReactNode;
}

export function AdminShell({
  staff, prefs, recents, persisted, density, appearance, datePrefs, appUrl, mySettingsHref, runbookUrl, children,
}: AdminShellProps) {
  return (
    <LayerStackProvider>
      <OsToastProvider>
        <ConsoleProvider
          staff={staff}
          initialPrefs={prefs}
          initialRecents={recents}
          persisted={persisted}
          datePrefs={datePrefs}
          appUrl={appUrl}
        >
          <ConsoleAppearance density={density} appearance={appearance} />
          {/* The legacy toast and dialog providers stay until every page is on
              useOsToast: useConfirm and usePrompt throw without them. */}
          <ToastProvider>
            <DialogProvider>
              <div id={APP_ROOT_ID} style={{ display: "contents" }}>
                <Frame mySettingsHref={mySettingsHref} runbookUrl={runbookUrl}>
                  {children}
                </Frame>
              </div>
            </DialogProvider>
          </ToastProvider>
          <SessionExpiredDialog />
          <SessionIdleWarning />
        </ConsoleProvider>
      </OsToastProvider>
    </LayerStackProvider>
  );
}

/**
 * Stamps the document root: navy chrome always, the person's own density,
 * their appearance through next-themes (the same mapping ThemeApplier uses).
 * No accent: the console has one blue.
 */
function ConsoleAppearance({ density, appearance }: { density: DensityPref; appearance: "LIGHT" | "DARK" | "AUTO" }) {
  const { setTheme } = useTheme();
  useEffect(() => {
    setTheme(appearance === "AUTO" ? "system" : appearance === "DARK" ? "dark" : "light");
  }, [appearance, setTheme]);
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-chrome", "navy");
    root.setAttribute("data-density", density || "comfortable");
    root.removeAttribute("data-accent");
  }, [density]);
  return null;
}

/** The slide-over sidebar below 1024: closed on navigation and when the window widens. */
function useOverlaySidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    if (open) setOpen(false);
  }
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => {
      if (mq.matches) setOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  useLayer(open, { id: "console-sidebar-overlay", kind: "panel", close: () => setOpen(false) });
  return { open, setOpen };
}

function Frame({
  mySettingsHref, runbookUrl, children,
}: { mySettingsHref: string | null; runbookUrl: string | null; children: React.ReactNode }) {
  const { prefs, patchPrefs, recents, searchOpen, setSearchOpen } = useConsole();
  const overlay = useOverlaySidebar();
  const setOverlayOpen = overlay.setOpen;
  const collapsed = prefs.sidebar.collapsed;
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  // Below 1024 the wide field is display:none and this icon is the visible
  // trigger, so Esc hands focus back to whichever of the two is on screen.
  const searchIconRef = useRef<HTMLButtonElement>(null);
  const searchReturnTarget = useCallback((): HTMLElement | null => {
    const wide = searchButtonRef.current;
    if (wide && wide.offsetParent !== null) return wide;
    return searchIconRef.current;
  }, []);
  const stack = useLayerStack();
  useNavHistoryRecorder();
  useConsoleKeys();

  const toggleSidebar = useCallback(() => {
    // Below 1024 the chord opens and closes the slide-over; the docked
    // column's stored state is for wide windows only.
    if (!window.matchMedia("(min-width: 1024px)").matches) {
      setOverlayOpen((v) => !v);
      return;
    }
    patchPrefs({ sidebar: { collapsed: !collapsed } });
  }, [collapsed, patchPrefs, setOverlayOpen]);

  useShortcut({ ...canon["toggle-sidebar"], scope: "global", run: toggleSidebar });
  // Cmd+K works from anywhere, a text field included. Inside a drawer or a
  // modal that layer closes FIRST (spec 2.8), so a result never navigates
  // with a confirm still mounted underneath: the console's own layers go
  // through the stack (a layer that refuses, such as a dirty form asking
  // before it discards, keeps Search shut), and an open Radix modal gets
  // the same Escape a person would press. Search opens on the next frame,
  // after that modal has handed focus back.
  const openSearchFromAnywhere = useCallback(() => {
    if (searchOpen) {
      setSearchOpen(false);
      return;
    }
    for (let i = 0; i < 8; i++) {
      const r = stack?.closeTopLayer() ?? "none";
      if (r === "refused") return;
      if (r === "none") break;
    }
    const modal = document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');
    if (modal) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      requestAnimationFrame(() => requestAnimationFrame(() => setSearchOpen(true)));
      return;
    }
    setSearchOpen(true);
  }, [searchOpen, setSearchOpen, stack]);
  useShortcut({ ...canon["search"], scope: "global", run: openSearchFromAnywhere });

  return (
    <div
      className="workwrk-os grid h-screen overflow-hidden bg-app text-ink"
      style={{ gridTemplateColumns: "auto minmax(0, 1fr)", gridTemplateRows: "var(--os-top-h) minmax(0, 1fr)" }}
    >
      <a
        href="#main"
        className="os-chrome sr-only z-[70] rounded-md bg-raised px-3 py-2 text-base text-ink focus:not-sr-only focus:fixed focus:start-3 focus:top-3"
      >
        Skip to content
      </a>
      <div className="col-span-2 row-start-1 flex min-w-0">
        <ConsoleTopBar
          onMenu={toggleSidebar}
          menuOpen={overlay.open}
          sidebarCollapsed={collapsed}
          onSearch={() => setSearchOpen(true)}
          searchButtonRef={searchButtonRef}
          searchIconRef={searchIconRef}
          mySettingsHref={mySettingsHref}
          runbookUrl={runbookUrl}
        />
      </div>
      {!collapsed ? (
        <div className="col-start-1 row-start-2 flex min-h-0 max-lg:hidden">
          <ConsoleSidebar onCollapse={toggleSidebar} />
        </div>
      ) : null}
      {overlay.open ? (
        <div className="contents lg:hidden">
          <button
            type="button"
            aria-label="Close sidebar"
            onClick={() => setOverlayOpen(false)}
            className="fixed inset-x-0 bottom-0 top-[var(--os-top-h)] z-30 bg-[var(--os-scrim)]"
          />
          <ConsoleSidebar overlay onClose={() => setOverlayOpen(false)} />
        </div>
      ) : null}
      <main
        id="main"
        tabIndex={-1}
        className={cn(
          "relative row-start-2 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden bg-app outline-none",
          collapsed ? "col-span-2 col-start-1" : "col-start-2 max-lg:col-span-2 max-lg:col-start-1",
        )}
      >
        {children}
      </main>
      {collapsed ? (
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label="Show sidebar"
          title={`Show sidebar (${shortcutHint("toggle-sidebar")})`}
          className="os-chrome fixed bottom-4 start-2 z-20 flex h-6 w-6 items-center justify-center rounded-full border border-line bg-raised text-ink-2 opacity-40 shadow-[var(--os-shadow-pop)] hover:opacity-100 focus-visible:opacity-100 max-lg:hidden"
        >
          <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={1.5} />
        </button>
      ) : null}
      <StaffSearch
        open={searchOpen}
        onOpenChange={setSearchOpen}
        recents={recents}
        returnFocusTo={searchReturnTarget}
      />
    </div>
  );
}

/**
 * The console's ONE window keydown listener (spec section 3 item 1): Esc
 * closes the top layer of the stack and stops there; everything else goes
 * to the shortcut registry, where the frame registers Cmd+K and Cmd+\.
 * Nothing runs while the session-expired dialog owns the screen, and an
 * event some component already consumed is not ours.
 */
function useConsoleKeys() {
  const stack = useLayerStack();
  const closeTopLayer = stack?.closeTopLayer;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isSessionExpired()) return;
      if (e.defaultPrevented) return;
      if (e.key === "Escape" && closeTopLayer) {
        const r = closeTopLayer();
        if (r === "closed" || r === "refused") {
          e.preventDefault();
          return;
        }
      }
      shortcuts.dispatch(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeTopLayer]);
}

/* ─────────────────────────── top bar ─────────────────────────── */

function Crumbs({ items }: { items: ConsoleCrumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
      <ol className="flex min-w-0 items-center gap-1 text-base">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          // Below 1024 only the last two crumbs show (spec section 1). The
          // separator before crumb i goes with crumb i-1.
          const hideAt = (n: number) => (n < items.length - 2 ? "max-lg:hidden" : undefined);
          return (
            // Only the last crumb (a company's name) gives way: "Staff
            // console" and a page label are short by construction.
            <li key={`${c.label}-${i}`} className={cn("flex items-center gap-1", last ? "min-w-0" : "shrink-0", hideAt(i))}>
              {i > 0 ? (
                <span className={cn("inline-block shrink-0 text-chrome-fg-2 opacity-50 rtl:rotate-180", hideAt(i - 1))} aria-hidden>
                  ›
                </span>
              ) : null}
              {last || !c.href ? (
                <span
                  className="truncate font-medium text-chrome-fg"
                  aria-current={last ? "page" : undefined}
                  style={last && i > 0 ? { maxWidth: 240 } : undefined}
                  title={c.label}
                >
                  {c.label}
                </span>
              ) : (
                <Link
                  href={c.href}
                  className="whitespace-nowrap rounded px-0.5 text-chrome-fg-2 hover:text-chrome-fg"
                  title={c.label}
                >
                  {c.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function ConsoleTopBar({
  onMenu, menuOpen, sidebarCollapsed, onSearch, searchButtonRef, searchIconRef, mySettingsHref, runbookUrl,
}: {
  onMenu: () => void;
  menuOpen: boolean;
  /** A collapsed sidebar keeps the Menu button on wide windows too: a second, visible way back. */
  sidebarCollapsed: boolean;
  onSearch: () => void;
  searchButtonRef: React.RefObject<HTMLButtonElement | null>;
  searchIconRef: React.RefObject<HTMLButtonElement | null>;
  mySettingsHref: string | null;
  runbookUrl: string | null;
}) {
  const pathname = usePathname() || "";
  const { companyCrumb } = useConsole();
  const { canBack, canForward, back, forward } = useNavHistory();
  const crumbs = consoleCrumbs(pathname, { companyName: companyCrumb });

  return (
    <header
      aria-label="Page bar"
      className="os-chrome flex h-[var(--os-top-h)] w-full min-w-0 shrink-0 items-center gap-2 bg-chrome px-3 text-chrome-fg"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <ChromeIconButton
          label="Menu"
          onClick={onMenu}
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? SIDEBAR_ID : undefined}
          active={menuOpen}
          className={sidebarCollapsed ? undefined : "lg:hidden"}
        >
          <Menu className="h-5 w-5" strokeWidth={1.5} />
        </ChromeIconButton>
        <ChromeIconButton
          label="Back"
          onClick={back}
          aria-disabled={!canBack}
          className={cn(!canBack && "opacity-40 hover:bg-transparent hover:text-chrome-fg-2")}
        >
          <ChevronLeft className="h-5 w-5 rtl:rotate-180" strokeWidth={1.5} />
        </ChromeIconButton>
        <ChromeIconButton
          label="Forward"
          onClick={forward}
          aria-disabled={!canForward}
          className={cn(!canForward && "opacity-40 hover:bg-transparent hover:text-chrome-fg-2")}
        >
          <ChevronRight className="h-5 w-5 rtl:rotate-180" strokeWidth={1.5} />
        </ChromeIconButton>
        <div className="ms-1 min-w-0 flex-1">
          <Crumbs items={crumbs} />
        </div>
      </div>

      <button
        ref={searchButtonRef}
        type="button"
        onClick={onSearch}
        aria-label="Search"
        aria-haspopup="dialog"
        className="hidden h-8 w-[240px] shrink-0 items-center gap-2 rounded-md border border-chrome-line bg-chrome-field px-3 text-start text-base text-chrome-field-ph hover:bg-chrome-hov lg:flex xl:w-[400px]"
      >
        <Search className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden />
        <span className="min-w-0 flex-1 truncate">{STAFF_SEARCH_PLACEHOLDER}</span>
        {/* dir="ltr": a key sequence, not prose ("⌘K", never "K⌘"). */}
        <kbd dir="ltr" className="font-sans text-xs text-chrome-fg-2">{shortcutHint("search")}</kbd>
      </button>
      <ChromeIconButton ref={searchIconRef} label="Search" onClick={onSearch} aria-haspopup="dialog" className="lg:hidden">
        <Search className="h-5 w-5" strokeWidth={1.5} />
      </ChromeIconButton>

      <div className="flex flex-1 items-center justify-end gap-1">
        {runbookUrl ? (
          <ChromeIconButton label="Help" onClick={() => window.open(runbookUrl, "_blank", "noopener,noreferrer")}>
            <CircleHelp className="h-5 w-5" strokeWidth={1.5} aria-hidden />
          </ChromeIconButton>
        ) : null}
        <ConsoleAvatarMenu mySettingsHref={mySettingsHref} />
      </div>
    </header>
  );
}

function initialsOf(name: string | null, email: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length > 0) {
    return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
  }
  return (email[0] ?? "?").toUpperCase();
}

/**
 * Three entries and no more (spec section 2.1): "Signed in as" (a label),
 * My settings (the one home of theme and density, on the app host, in a new
 * tab) and Log out. No Theme row: the console never offers a second writer
 * for a preference it only reads.
 */
function ConsoleAvatarMenu({ mySettingsHref }: { mySettingsHref: string | null }) {
  const [open, setOpen] = useState(false);
  const { staff } = useConsole();
  return (
    <ChromePopover
      open={open}
      onOpenChange={setOpen}
      layerId="console-avatar-menu"
      width={280}
      ariaLabel="Your account"
      trigger={
        <button
          type="button"
          aria-label="Your account"
          title={staff.email}
          aria-haspopup="menu"
          aria-expanded={open}
          className={cn(
            "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-chrome-hov",
            open && "bg-chrome-hov",
          )}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-active text-micro font-medium normal-case tracking-normal text-ink-strong" aria-hidden>
            {initialsOf(staff.name, staff.email)}
          </span>
        </button>
      }
    >
      <div className="py-1" role="menu" aria-label="Your account">
        <div className="px-3 pb-2 pt-1.5 text-sm text-ink-2">
          <div>Signed in as</div>
          <div className="truncate text-base font-medium text-ink" title={staff.email}>{staff.email}</div>
        </div>
        <MenuSeparator />
        {mySettingsHref ? (
          <MenuItem
            icon={Settings}
            label="My settings"
            onClick={() => {
              setOpen(false);
              window.open(mySettingsHref, "_blank", "noopener,noreferrer");
            }}
          />
        ) : null}
        <MenuItem
          icon={LogOut}
          label="Log out"
          onClick={() => {
            setOpen(false);
            // Absolute, on THIS origin: a relative callbackUrl is resolved
            // against NEXTAUTH_URL (the app host), which dropped staff on the
            // customer /login and, after signing in, in their own product
            // workspace. auth.ts's redirect callback allows the admin origin.
            void signOut({ callbackUrl: `${window.location.origin}/login?callbackUrl=${encodeURIComponent("/admin")}` });
          }}
        />
      </div>
    </ChromePopover>
  );
}

/* ─────────────────────────── sidebar ─────────────────────────── */

function ConsoleSidebar({
  overlay, onClose, onCollapse,
}: { overlay?: boolean; onClose?: () => void; onCollapse?: () => void }) {
  const pathname = usePathname() || "";
  const active = activeConsoleNav(pathname);
  const rows = shippedConsoleNav();
  const asideRef = useRef<HTMLElement>(null);

  // The slide-over takes focus when it opens so the keyboard lands in it.
  useEffect(() => {
    if (overlay) asideRef.current?.focus({ preventScroll: true });
  }, [overlay]);

  const renderRows = (section: "main" | "console") =>
    rows
      .filter((r) => r.section === section)
      .map((r) => (
        <SidebarRow key={r.key} href={r.href} label={r.label} icon={CONSOLE_NAV_ICONS[r.key]} active={active === r.key} />
      ));

  return (
    <aside
      ref={asideRef}
      // Only the slide-over carries the id the Menu button controls: the
      // docked column stays mounted (hidden) below 1024, and two elements
      // with one id made aria-controls ambiguous.
      id={overlay ? SIDEBAR_ID : undefined}
      tabIndex={overlay ? -1 : undefined}
      role={overlay ? "dialog" : undefined}
      aria-modal={overlay ? true : undefined}
      aria-label="Staff console sidebar"
      className={cn(
        "os-chrome group/sidebar relative flex shrink-0 flex-col border-e border-line bg-side outline-none",
        overlay
          ? "fixed bottom-0 start-0 top-[var(--os-top-h)] z-40 w-[var(--os-side-w)] shadow-[var(--os-shadow-modal)]"
          : "h-full w-[var(--os-side-w)]",
      )}
    >
      {/* The four dots and the name: not a switcher, not a menu, not a link. */}
      <div className="flex h-14 shrink-0 items-center gap-2 ps-4 pe-2">
        <Logo width={28} />
        <span className="os-row min-w-0 flex-1 truncate font-medium text-ink">WorkwrK Staff</span>
        {overlay && onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sidebar"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        ) : null}
      </div>
      <nav aria-label="Staff console" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <ul className="flex flex-col gap-0.5">{renderRows("main")}</ul>
        <SidebarSectionLabel>Console</SidebarSectionLabel>
        <ul className="flex flex-col gap-0.5">{renderRows("console")}</ul>
      </nav>
      {!overlay && onCollapse ? (
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Hide sidebar"
          title={`Hide sidebar (${shortcutHint("toggle-sidebar")})`}
          className="absolute -end-3 bottom-4 z-20 flex h-6 w-6 items-center justify-center rounded-full border border-line bg-raised text-ink-2 opacity-40 shadow-[var(--os-shadow-pop)] hover:opacity-100 focus-visible:opacity-100"
        >
          <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={1.5} />
        </button>
      ) : null}
    </aside>
  );
}
