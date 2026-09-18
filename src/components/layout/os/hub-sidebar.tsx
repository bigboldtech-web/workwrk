"use client";

// HubSidebar (design-system 4.2, spec-shell 1.2 and 2.1): the 264px N50
// column for whichever hub the URL resolves to. The container is the
// shell's; the rows inside are each hub unit's. It carries:
//
//   header 56px   the workspace switcher (org tile + name + chevron) and
//                 the hub's one 32px "+"
//   search        only when the hub tree exceeds 12 rows, filtering in place
//   body          the hub's rows in `.os-row` (36px, 15px labels)
//   footer 44px   the one "Customize Sidebar" button (a founder rule)
//   collapse      the 24px circular chevron on the outer edge, always at 40%
//   resize        a 12px handle on the outer edge, 240 to 320, persisted
//
// Collapsed and width both persist through PATCH /api/preferences; nothing
// here touches localStorage. Between 768 and 1023 the sidebar is an overlay
// drawer opened from the bar's Menu button.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronLeft, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { useSession } from "next-auth/react";
import { EntityTile } from "@/components/ui/entity-tile";
import { isHubKey, resolveHub, type HubKey } from "@/lib/nav/route-hub";
import { HUB_LABELS, SHELL_LABELS } from "@/lib/nav/labels";
import { cn } from "@/lib/utils";
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_DEFAULT_WIDTH, useOsShell } from "./shell-context";
import { useBoot } from "./boot-context";
import { canAccessTier, type CreateAction } from "./apps-catalog";
import { SidebarSearchProvider, useSidebarSearch } from "./sidebar-search-context";
import { CreateMenu } from "./create-menu";
import { SidebarCreateMenu, runCreateAction, useCreateActionContext } from "./sidebar-create-menu";
import { WorkspaceMenu } from "./workspace-menu";
import { SIDEBAR_ROW_ATTR } from "./sidebar-primitives";
import { SIDEBAR_DRAWER_ID } from "./skip-links";

const SEARCH_THRESHOLD = 12;

export function HubSidebar({ overlay, onClose }: { overlay?: boolean; onClose?: () => void }) {
  const { sidebarCollapsed } = useOsShell();
  if (sidebarCollapsed && !overlay) return null;
  return (
    <SidebarSearchProvider>
      <HubSidebarBody overlay={overlay} onClose={onClose} />
    </SidebarSearchProvider>
  );
}

function HubSidebarBody({ overlay, onClose }: { overlay?: boolean; onClose?: () => void }) {
  const { toggleSidebar, openCustomize, hubSidebarApp, sidebarWidth, setSidebarWidth } = useOsShell();
  const { boot } = useBoot();
  const pathname = usePathname() || "";
  const { query, setQuery } = useSidebarSearch();
  const [rowCount, setRowCount] = useState(0);
  const [createOpenFor, setCreateOpenFor] = useState<string | null>(null);
  const [resizing, setResizing] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const resizeRef = useRef({ startX: 0, startWidth: SIDEBAR_DEFAULT_WIDTH });

  const hub = resolveHub(pathname);
  const app = useMemo(() => hubSidebarApp(hub), [hub, hubSidebarApp]);
  // The landmark, the search placeholder and the "+" tooltip name the hub
  // whose rows actually render: Work when the URL's hub is one this viewer
  // cannot open, Talk when the module is off and Announcements stands in.
  const renderedHub: HubKey = app.hubKey && isHubKey(app.hubKey) ? app.hubKey : isHubKey(app.key) ? app.key : hub;
  const hubLabel = HUB_LABELS[renderedHub];

  // The tablet overlay drawer takes focus when it opens (spec-shell 1.16),
  // so a keyboard user is inside it rather than on the <main> behind it.
  useEffect(() => {
    if (!overlay) return;
    asideRef.current?.focus({ preventScroll: true });
  }, [overlay]);

  // The per-app "+" contract: "global" opens the Create menu, a list of one
  // fires it, two or more open a MenuList, none hides the button.
  const { data: session } = useSession();
  const accessLevel = (session?.user as { accessLevel?: string } | undefined)?.accessLevel ?? null;
  const createCtx = useCreateActionContext();
  const createActions = useMemo<CreateAction[]>(() => {
    if (!Array.isArray(app.createActions)) return [];
    return app.createActions.filter((a) => canAccessTier(a.requiredAccess, accessLevel));
  }, [app, accessLevel]);
  const createMode: "custom" | "global" | "menu" | "single" | "none" =
    app.CreateMenu ? "custom"
    : app.createActions === "global" ? "global"
    : createActions.length > 1 ? "menu"
    : createActions.length === 1 ? "single"
    : "none";
  const createOpen = createOpenFor === app.key;
  const closeCreate = () => setCreateOpenFor(null);

  // The in-place filter renders only when the rendered tree exceeds 12 rows.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const count = () => {
      const marked = nav.querySelectorAll(`[${SIDEBAR_ROW_ATTR}]`).length;
      const legacy = nav.querySelectorAll("li:not([data-os-row]) > a[href], li:not([data-os-row]) > button").length;
      setRowCount(marked + legacy);
    };
    count();
    const mo = new MutationObserver(() => count());
    mo.observe(nav, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [app.key]);
  const searchable = rowCount > SEARCH_THRESHOLD || query.length > 0;

  // Resize: pointer drag, arrow keys, double-click to reset. Under dir="rtl"
  // the sidebar is on the right edge, so the handle grows the column when it
  // moves toward smaller clientX and ArrowLeft is the widening key. Every
  // other position in this file is already logical (-end-*, rtl:rotate-180);
  // pointer and key deltas are the one pair CSS cannot mirror for us.
  const rtlSign = useCallback(() => (
    typeof document !== "undefined" && getComputedStyle(document.documentElement).direction === "rtl" ? -1 : 1
  ), []);
  const startResize = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizeRef.current = { startX: event.clientX, startWidth: sidebarWidth };
    setResizing(true);
  }, [sidebarWidth]);
  useEffect(() => {
    if (!resizing) return;
    const originalCursor = document.body.style.cursor;
    const originalUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const sign = rtlSign();
    const onMove = (event: PointerEvent) => {
      const delta = (event.clientX - resizeRef.current.startX) * sign;
      setSidebarWidth(resizeRef.current.startWidth + delta, { persist: false });
    };
    const onUp = (event: PointerEvent) => {
      setResizing(false);
      const delta = (event.clientX - resizeRef.current.startX) * sign;
      setSidebarWidth(resizeRef.current.startWidth + delta);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onUp, { once: true });
    return () => {
      document.body.style.cursor = originalCursor;
      document.body.style.userSelect = originalUserSelect;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [resizing, setSidebarWidth, rtlSign]);

  const plusButton = createMode !== "none" ? (
    <button
      ref={createButtonRef}
      type="button"
      onClick={() => {
        if (createMode === "single") runCreateAction(createActions[0], createCtx);
        else setCreateOpenFor((v) => (v === app.key ? null : app.key));
      }}
      aria-label={createMode === "single" ? createActions[0].label : `New in ${hubLabel}`}
      title={createMode === "single" ? createActions[0].label : `New in ${hubLabel}`}
      aria-haspopup={createMode === "single" ? undefined : "menu"}
      aria-expanded={createMode === "single" ? undefined : createOpen}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
    >
      <Plus className="h-5 w-5" strokeWidth={1.5} aria-hidden />
    </button>
  ) : null;

  // The drawer is scrim-backed, so a pointer cannot reach the page behind it.
  // Keyboard has to match: without this, Tab walked straight out of the drawer
  // into content the scrim hides and the pointer cannot click.
  const trapTab = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const root = asideRef.current;
    if (!root) return;
    const focusable = Array.from(
      root.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'),
    ).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === root)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  return (
    <aside
      ref={asideRef}
      id={overlay ? SIDEBAR_DRAWER_ID : undefined}
      tabIndex={overlay ? -1 : undefined}
      role={overlay ? "dialog" : undefined}
      aria-modal={overlay ? true : undefined}
      onKeyDown={overlay ? trapTab : undefined}
      aria-label={`${hubLabel} sidebar`}
      className={cn(
        "os-chrome group/sidebar relative flex shrink-0 flex-col border-e border-line bg-side outline-none",
        // The drawer is sized by its top and bottom insets; the docked column
        // fills the grid cell.
        overlay ? "" : "h-full",
        // The tablet drawer sits inside the frame: after the rail, under the
        // bar, 320 wide (spec-shell 1.16). Rail and bar keep working.
        overlay ? "fixed bottom-0 start-[var(--os-rail-w)] top-[var(--os-top-h)] z-40 w-[320px] shadow-[var(--os-shadow-modal)]" : "",
        resizing ? "select-none" : "transition-[width] duration-[var(--os-dur-slow)]",
      )}
      style={overlay ? undefined : { width: sidebarWidth, minWidth: SIDEBAR_MIN_WIDTH, maxWidth: SIDEBAR_MAX_WIDTH }}
    >
      <div className="flex h-14 shrink-0 items-center gap-1 ps-3 pe-2">
        <WorkspaceMenu
          trigger={
            <button
              type="button"
              aria-label={SHELL_LABELS.switchWorkspace}
              title={boot.org.name}
              aria-haspopup="menu"
              className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-start hover:bg-hover"
            >
              {boot.org.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={boot.org.logo} alt="" className="h-5 w-5 shrink-0 rounded-[5px] object-cover" />
              ) : (
                <EntityTile size="sm" name={boot.org.name} />
              )}
              <span className="os-row min-w-0 flex-1 truncate font-medium text-ink">{boot.org.name}</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
            </button>
          }
        />
        {createMode === "global" ? (
          <CreateMenu open={createOpen} onOpenChange={(v) => setCreateOpenFor(v ? app.key : null)} align="start" layerId="sidebar-create" trigger={plusButton} />
        ) : plusButton}
        {overlay && onClose ? (
          <button type="button" onClick={onClose} aria-label="Close sidebar" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        ) : null}
      </div>

      {searchable ? (
        <div className="px-3 pb-2">
          <div className="flex h-9 items-center gap-2 rounded-md border border-line-strong bg-raised px-3 focus-within:shadow-[0_0_0_3px_var(--os-focus-halo)]">
            <Search className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${hubLabel}…`}
              aria-label={`Search ${hubLabel}`}
              className="min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-3 focus:outline-none"
            />
            {query ? (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-3 hover:bg-hover hover:text-ink">
                <X className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <nav ref={navRef} aria-label={`${hubLabel} navigation`} className="os-row min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <app.Sidebar />
      </nav>

      <div className="flex h-11 shrink-0 items-center border-t border-line px-2">
        <button
          type="button"
          onClick={openCustomize}
          className="inline-flex h-9 w-full items-center gap-2 rounded-md px-3 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink"
        >
          <SlidersHorizontal className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          <span>{SHELL_LABELS.customizeSidebar}</span>
        </button>
      </div>

      {createMode === "custom" && app.CreateMenu ? (
        <app.CreateMenu anchorRef={createButtonRef} open={createOpen} onClose={closeCreate} />
      ) : createMode === "menu" ? (
        <SidebarCreateMenu anchorRef={createButtonRef} open={createOpen} onClose={closeCreate} actions={createActions} />
      ) : null}
      {!overlay ? (
        <>
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label="Hide sidebar"
            title="Hide sidebar (⌘\\)"
            className="absolute -end-3 bottom-4 z-20 flex h-6 w-6 items-center justify-center rounded-full border border-line bg-raised text-ink-2 opacity-40 shadow-[var(--os-shadow-pop)] hover:opacity-100 focus-visible:opacity-100"
          >
            <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={1.5} />
          </button>
          <div
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-valuemin={SIDEBAR_MIN_WIDTH}
            aria-valuemax={SIDEBAR_MAX_WIDTH}
            aria-valuenow={sidebarWidth}
            aria-label="Resize sidebar"
            title="Drag to resize · Double-click to reset"
            onPointerDown={startResize}
            onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT_WIDTH)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") { e.preventDefault(); setSidebarWidth(sidebarWidth - 12 * rtlSign()); }
              else if (e.key === "ArrowRight") { e.preventDefault(); setSidebarWidth(sidebarWidth + 12 * rtlSign()); }
              else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSidebarWidth(SIDEBAR_DEFAULT_WIDTH); }
            }}
            // Always visible at 40%, full on hover or keyboard focus (spec-shell
            // 1.16): it is one of the two ways to change the sidebar's width.
            className={cn(
              "absolute -end-1.5 bottom-12 top-0 z-10 w-3 cursor-col-resize touch-none select-none hover:opacity-100 focus-visible:opacity-100",
              resizing ? "opacity-100" : "opacity-40",
            )}
          >
            <span
              className={cn(
                "pointer-events-none absolute inset-y-0 start-[5px] w-0.5 rounded-full",
                resizing ? "bg-brand" : "bg-line-strong",
              )}
              aria-hidden
            />
          </div>
        </>
      ) : null}
    </aside>
  );
}
