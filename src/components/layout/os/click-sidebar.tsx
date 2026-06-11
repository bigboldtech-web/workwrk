"use client";

// ClickSidebar — the second column. Renders whichever app is active
// from apps-catalog.tsx. Header has the app's name + an action button
// row + a [«] close button that collapses the entire column.
//
// When collapsed, returns null. To reopen, the user clicks any rail
// icon — `setActiveApp` flips `sidebarCollapsed` back to false.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  Brush,
  CheckCircle2,
  ChevronsLeft,
  ChevronDown,
  FileText,
  Import,
  LayoutDashboard,
  ListChecks,
  Plus,
  Rocket,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
  ClipboardCheck,
  type LucideIcon,
} from "lucide-react";
import { useOsShell } from "./shell-context";
import { APPS, findAppForPath, getApp, NEW_EVENT_PREFIX } from "./apps-catalog";
import { usePathname } from "next/navigation";
import { SidebarSearchProvider, useSidebarSearch } from "./sidebar-search-context";
import { MorePortal } from "./more-portal";

const SIDEBAR_WIDTH_KEY = "workwrk:os:sidebar-width";
const DEFAULT_SIDEBAR_WIDTH = 244;
const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 320;

function clampSidebarWidth(width: number) {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)));
}

function CreateMenuItem({
  Icon,
  label,
  description,
  shortcut,
  badge,
  active,
  iconClassName = "text-zinc-500",
  onClick,
}: {
  Icon: LucideIcon;
  label: string;
  description?: string;
  shortcut?: string;
  badge?: string;
  active?: boolean;
  iconClassName?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-8 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-zinc-900 ${
        active ? "bg-zinc-100" : "hover:bg-zinc-50"
      }`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${iconClassName}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{label}</span>
        {description ? (
          <span className="block truncate text-[12px] font-normal text-zinc-500">{description}</span>
        ) : null}
      </span>
      {badge ? (
        <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-600">
          {badge}
        </span>
      ) : null}
      {shortcut ? <span className="text-[12px] text-zinc-400">{shortcut}</span> : null}
    </button>
  );
}

export function ClickSidebar() {
  const { sidebarCollapsed } = useOsShell();
  if (sidebarCollapsed) return null;

  return (
    <SidebarSearchProvider>
      <ClickSidebarBody />
    </SidebarSearchProvider>
  );
}

function ClickSidebarBody() {
  const { activeAppKey, toggleSidebar, openCustomize, openCreateTask, openCreateList } = useOsShell();
  const pathname = usePathname() || "";
  const router = useRouter();
  const { query, setQuery } = useSidebarSearch();
  const [searching, setSearching] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [resizing, setResizing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const createPanelRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef({ startX: 0, startWidth: DEFAULT_SIDEBAR_WIDTH });
  const sidebarWidthRef = useRef(DEFAULT_SIDEBAR_WIDTH);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
        if (!stored) return;
        const parsed = Number(stored);
        if (Number.isFinite(parsed)) setSidebarWidth(clampSidebarWidth(parsed));
      } catch {}
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  const app = useMemo(() => {
    return getApp(activeAppKey) ?? findAppForPath(pathname) ?? APPS[0];
  }, [activeAppKey, pathname]);

  const title = app.label.replace(/\.\.$/, "");
  const runAppNewAction = () => {
    const newAction = app.newAction;
    if (!newAction) {
      router.push("/spaces");
      return;
    }
    if (newAction.href) {
      router.push(newAction.href);
    } else if (newAction.event && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(`${NEW_EVENT_PREFIX}${newAction.event}`));
    }
  };

  const closeCreateMenu = () => setCreateOpen(false);

  const runCreateAction = (action: () => void) => {
    closeCreateMenu();
    action();
  };

  const openSearch = () => {
    setSearching(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const closeSearch = () => {
    setQuery("");
    setSearching(false);
  };

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

    const onPointerMove = (event: PointerEvent) => {
      const delta = event.clientX - resizeRef.current.startX;
      const nextWidth = clampSidebarWidth(resizeRef.current.startWidth + delta);
      sidebarWidthRef.current = nextWidth;
      setSidebarWidth(nextWidth);
    };

    const onPointerUp = () => {
      setResizing(false);
      try {
        window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidthRef.current));
      } catch {}
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    window.addEventListener("pointercancel", onPointerUp, { once: true });
    return () => {
      document.body.style.cursor = originalCursor;
      document.body.style.userSelect = originalUserSelect;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [resizing]);

  const resetWidth = () => {
    sidebarWidthRef.current = DEFAULT_SIDEBAR_WIDTH;
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(DEFAULT_SIDEBAR_WIDTH));
    } catch {}
  };

  return (
    <aside
      data-branded="0"
      className={`group/sidebar relative flex-shrink-0 h-full bg-zinc-50 border border-zinc-200 rounded-[14px] ${
        resizing
          ? "select-none transition-[background-color,border-color] shadow-[0_0_0_1px_rgba(161,161,170,0.35)]"
          : "transition-[width,background-color,border-color]"
      }`}
      style={{
        width: sidebarWidth,
        minWidth: MIN_SIDEBAR_WIDTH,
        maxWidth: MAX_SIDEBAR_WIDTH,
      }}
    >
      <div className="h-full flex flex-col overflow-hidden rounded-[13px]">
        <div className="px-3 pt-3 pb-1.5">
          {searching ? (
            <div className="flex items-center gap-2 h-7 px-2.5 rounded-md border border-zinc-200 bg-white focus-within:border-zinc-400">
              <Search className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") closeSearch(); }}
                placeholder={`Search ${title}…`}
                className="flex-1 min-w-0 bg-transparent text-[13px] focus:outline-none"
              />
              <button
                type="button"
                onClick={closeSearch}
                className="h-6 w-6 inline-flex items-center justify-center rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100"
                aria-label="Close search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex h-8 items-center gap-1">
              <h2 className="text-[15px] font-semibold flex-1 truncate text-zinc-900 tracking-[-0.02em]">{title}</h2>
              <button
                type="button"
                onClick={openSearch}
                className="h-6 w-0 shrink-0 overflow-hidden inline-flex items-center justify-center rounded-md text-zinc-600 opacity-0 pointer-events-none transition-[width,opacity] hover:bg-zinc-100 group-hover/sidebar:w-6 group-hover/sidebar:opacity-100 group-hover/sidebar:pointer-events-auto focus-visible:w-6 focus-visible:opacity-100 focus-visible:pointer-events-auto"
                aria-label="Search sidebar"
                title="Search sidebar"
              >
                <Search className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={toggleSidebar}
                className="h-6 w-0 shrink-0 overflow-hidden inline-flex items-center justify-center rounded-md text-zinc-700 opacity-0 pointer-events-none transition-[width,opacity] hover:bg-zinc-100 group-hover/sidebar:w-6 group-hover/sidebar:opacity-100 group-hover/sidebar:pointer-events-auto focus-visible:w-6 focus-visible:opacity-100 focus-visible:pointer-events-auto"
                aria-label="Close sidebar"
                title="Close sidebar"
              >
                <ChevronsLeft className="w-3.5 h-3.5" />
              </button>
              <button
                ref={createButtonRef}
                type="button"
                onClick={() => setCreateOpen((v) => !v)}
                className="h-[28px] shrink-0 inline-flex items-center gap-1 rounded-[10px] border border-zinc-200 bg-white px-2 text-zinc-900 shadow-[0_2px_4px_rgba(0,0,0,0.04)] hover:bg-zinc-50 hover:shadow-[0_2px_6px_rgba(0,0,0,0.06)] transition-all"
                aria-label="Create"
                aria-haspopup="menu"
                aria-expanded={createOpen}
              >
                <Plus className="w-[18px] h-[18px] text-zinc-800" strokeWidth={2.5} />
                <ChevronDown className="w-3.5 h-3.5 text-zinc-500" strokeWidth={2.5} />
              </button>
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-2">
          <app.Sidebar />
        </nav>

        <div className="px-3 pb-3 pt-2 flex justify-start">
          <button
            type="button"
            onClick={openCustomize}
            className="inline-flex items-center justify-center gap-2 w-full h-[26px] rounded-lg text-[12px] font-medium text-zinc-700 bg-zinc-200/70 hover:bg-zinc-200 transition-colors"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-500" />
            <span>Customize Sidebar</span>
          </button>
        </div>
      </div>

      {createOpen ? (
        <>
          <div className="fixed inset-0 z-30" onClick={closeCreateMenu} aria-hidden />
          <MorePortal anchorRef={createButtonRef} panelRef={createPanelRef} width={330} open={createOpen} placement="below">
            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_14px_34px_rgba(0,0,0,0.14)]">
              <div className="p-2">
                <input
                  type="text"
                  className="h-8 w-full rounded-lg border border-[#b78d80] bg-white px-2.5 text-[13px] outline-none"
                  placeholder="Describe anything to create"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") runCreateAction(openCreateTask);
                    if (event.key === "Escape") closeCreateMenu();
                  }}
                  autoFocus
                />
              </div>
              <div className="px-2 pb-2">
                <div className="px-2 py-1 text-[12px] font-medium text-zinc-500">Create</div>
                <CreateMenuItem
                  Icon={CheckCircle2}
                  label="Task"
                  shortcut="⌥T"
                  active
                  onClick={() => runCreateAction(openCreateTask)}
                />
                <CreateMenuItem
                  Icon={ListChecks}
                  label="List"
                  description="Track tasks, projects, people & more"
                  onClick={() => runCreateAction(openCreateList)}
                />
                <CreateMenuItem
                  Icon={Sparkles}
                  label="Space"
                  description="Organize work by team or department"
                  onClick={() => runCreateAction(runAppNewAction)}
                />
              </div>
              <div className="border-t border-zinc-100 px-2 py-2">
                <CreateMenuItem
                  Icon={Sparkles}
                  label="Create with AI"
                  iconClassName="text-fuchsia-500"
                  onClick={() => runCreateAction(() => router.push("/sidekick"))}
                />
                <CreateMenuItem
                  Icon={Bot}
                  label="Super Agent"
                  badge="Hot"
                  iconClassName="text-blue-500"
                  onClick={() => runCreateAction(() => router.push("/agents"))}
                />
              </div>
              <div className="border-t border-zinc-100 px-2 py-2">
                <CreateMenuItem
                  Icon={FileText}
                  label="Doc"
                  iconClassName="text-blue-500"
                  onClick={() => runCreateAction(() => router.push("/docs?new=1"))}
                />
                <CreateMenuItem
                  Icon={ClipboardCheck}
                  label="Form"
                  iconClassName="text-violet-500"
                  onClick={() => runCreateAction(() => router.push("/forms?new=1"))}
                />
                <CreateMenuItem
                  Icon={LayoutDashboard}
                  label="Dashboard"
                  iconClassName="text-purple-500"
                  onClick={() => runCreateAction(() => router.push("/dashboard?new=1"))}
                />
                <CreateMenuItem
                  Icon={Brush}
                  label="Whiteboard"
                  iconClassName="text-amber-500"
                  onClick={() => runCreateAction(() => router.push("/whiteboards?new=1"))}
                />
              </div>
              <div className="border-t border-zinc-100 px-2 py-2">
                <CreateMenuItem
                  Icon={SlidersHorizontal}
                  label="Customize your sidebar"
                  onClick={() => runCreateAction(openCustomize)}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 border-t border-zinc-100 p-2">
                <button
                  type="button"
                  onClick={() => runCreateAction(() => router.push("/imports"))}
                  className="flex h-9 items-center justify-center gap-2 rounded-lg border border-zinc-200 text-[13px] font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  <Import className="h-4 w-4 text-zinc-500" />
                  Import
                </button>
                <button
                  type="button"
                  onClick={() => runCreateAction(() => router.push("/templates"))}
                  className="flex h-9 items-center justify-center gap-2 rounded-lg border border-zinc-200 text-[13px] font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  <Rocket className="h-4 w-4 text-zinc-500" />
                  Templates
                </button>
              </div>
            </div>
          </MorePortal>
        </>
      ) : null}

      <div
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuemax={MAX_SIDEBAR_WIDTH}
        aria-valuenow={sidebarWidth}
        onPointerDown={startResize}
        onDoubleClick={resetWidth}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            const nextWidth = clampSidebarWidth(sidebarWidth - 12);
            sidebarWidthRef.current = nextWidth;
            setSidebarWidth(nextWidth);
            try { window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(nextWidth)); } catch {}
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            const nextWidth = clampSidebarWidth(sidebarWidth + 12);
            sidebarWidthRef.current = nextWidth;
            setSidebarWidth(nextWidth);
            try { window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(nextWidth)); } catch {}
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            resetWidth();
          }
        }}
        className={`absolute -right-1.5 top-2 bottom-2 z-30 w-3 touch-none select-none cursor-col-resize rounded-full outline-none focus-visible:bg-zinc-300/55 ${
          resizing ? "bg-zinc-300/55" : "bg-transparent"
        }`}
        style={{ cursor: "col-resize" }}
        aria-label="Resize sidebar"
        title="Drag to resize · Double-click to reset"
      >
        <span
          className={`pointer-events-none absolute left-1/2 top-2 bottom-2 w-px -translate-x-1/2 rounded-full transition-colors ${
            resizing ? "bg-zinc-400" : "bg-transparent group-hover/sidebar:bg-zinc-300"
          }`}
          aria-hidden
        />
      </div>
    </aside>
  );
}
