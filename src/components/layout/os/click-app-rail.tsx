"use client";

// ClickAppRail — left icon column. Each icon is a pinned app the user
// has chosen to surface. Beyond the basic click/hover model:
//   - drag any icon to reorder the pin set
//   - right-click an icon for Open / Unpin
//   - Cmd+1..9 jumps to the Nth pinned app (handled in shell-context)
//   - active app shows a violet pill plus a curved "tab notch" that
//     visually merges with the secondary sidebar
//   - "More" tile at the bottom opens AppsMorePopover

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { UserPlus, ArrowUpCircle, LayoutGrid, ExternalLink, PinOff, Sparkles } from "lucide-react";
import { useSession } from "next-auth/react";
import { MenuItem, MenuList } from "@/components/ui/menu";
import { APPS, canAccessApp, findAppForPath, isAlwaysPinned, type AppEntry } from "./apps-catalog";
import { useOsShell } from "./shell-context";

const HOVER_OPEN_MS = 180;
const HOVER_CLOSE_MS = 120;

// One rail-label treatment so every cell is the same height and full
// words never clip. Centered under the icon, up to 2 lines, then
// ellipsis — no more hard-coded "Dashboa.." / "Timeshe..".
function RailLabel({ children, italic }: { children: React.ReactNode; italic?: boolean }) {
  return (
    <span className="flex h-[20px] w-full items-center justify-center px-px">
      <span
        className={`line-clamp-2 break-words text-center text-[9px] leading-[1.1] ${
          italic ? "italic" : ""
        }`}
      >
        {children}
      </span>
    </span>
  );
}

export function ClickAppRail() {
  const pathname = usePathname() || "";
  const router = useRouter();
  const {
    activeAppKey, setActiveApp, sidebarCollapsed,
    pinnedAppKeys, openAppsGrid, appsGridOpen,
    togglePinned, movePinned, pushRecentApp, iconsOnly,
  } = useOsShell();
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: session } = useSession();
  const accessLevel = (session?.user as { accessLevel?: string } | undefined)?.accessLevel;

  const pinnedApps = useMemo<AppEntry[]>(() => {
    const byKey = new Map(APPS.map((a) => [a.key, a] as const));
    return pinnedAppKeys
      .map((k) => byKey.get(k))
      .filter((a): a is AppEntry =>
        Boolean(a) &&
        canAccessApp(a!, accessLevel),
      );
  }, [pinnedAppKeys, accessLevel]);

  const routeApp = findAppForPath(pathname);
  const highlightedKey = activeAppKey ?? routeApp?.key ?? "home";

  // Ghost icon: the user is on a route that maps to an app they
  // haven't pinned. Surface it temporarily so the rail still reflects
  // where they are, with a "Pin to keep" affordance.
  const ghostApp = routeApp && !pinnedAppKeys.includes(routeApp.key) ? routeApp : null;

  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  // Close context menu on outside click / Escape.
  useEffect(() => {
    if (!ctxMenu) return;
    const onDown = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setCtxMenu(null); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [ctxMenu]);

  const scheduleOpen = (key: string) => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHoverKey(key), HOVER_OPEN_MS);
  };
  const scheduleClose = () => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setHoverKey(null), HOVER_CLOSE_MS);
  };

  const handleClick = (app: AppEntry) => {
    setActiveApp(app.key);
    pushRecentApp(app.key);
    if (app.defaultHref) router.push(app.defaultHref);
  };

  const onContextMenu = (e: React.MouseEvent, key: string) => {
    e.preventDefault();
    setCtxMenu({ key, x: e.clientX, y: e.clientY });
  };

  // ─── Drag-and-drop reorder ──────────────────────────────────
  const onDragStart = (e: React.DragEvent, key: string) => {
    setDragKey(key);
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", key); } catch {}
  };
  const onDragOverItem = (e: React.DragEvent, key: string) => {
    if (!dragKey || dragKey === key) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverKey(key);
  };
  const onDropItem = (e: React.DragEvent, key: string) => {
    e.preventDefault();
    if (!dragKey || dragKey === key) {
      setDragKey(null);
      setDragOverKey(null);
      return;
    }
    const targetIdx = pinnedAppKeys.indexOf(key);
    if (targetIdx !== -1) movePinned(dragKey, targetIdx);
    setDragKey(null);
    setDragOverKey(null);
  };
  const onDragEndItem = () => {
    setDragKey(null);
    setDragOverKey(null);
  };

  // ClickUp-style theming: the rail uses a *dark, muted* version of the
  // accent (--os-brand-rail) regardless of light/dark theme — that's
  // what gives the composed look. The full-saturation brand reappears
  // on the active pill (white background, brand-colored icon).
  // Why full white (not /85): the saturated brand-rail tones (mint, teal,
  // pink, …) dim a translucent white into the background hue, so 85%
  // read as faded brand-tinted ghosts in light mode. Full white at this
  // size (18px stroked) holds up cleanly against every accent.
  const railTextColor = "text-white";
  const railHoverBg = "hover:bg-white/15";

  return (
    <aside
      // `color: #fff` here is load-bearing. `.workwrk-os button { color:
      // inherit }` in os.css has higher specificity than Tailwind's
      // `.text-white`, so Tailwind utilities on rail buttons would lose
      // and the icons would inherit `--os-ink` (dark text on dark rail =
      // invisible in light mode). Setting it on the <aside> lets the
      // inactive children inherit white, while active items still win
      // with their own inline `color: var(--os-brand-rail)` for the
      // dark-icon-on-white-pill look.
      style={{ backgroundColor: "var(--os-brand-rail)", color: "#fff" }}
      className="w-[60px] flex-shrink-0 h-full flex flex-col relative transition-colors rounded-xl overflow-hidden"
      onMouseLeave={scheduleClose}
    >
      <nav className="flex-1 pt-3 pb-2 overflow-y-auto overflow-x-visible os-no-scrollbar">
        {pinnedApps.map((app, idx) => {
          const active = highlightedKey === app.key && !sidebarCollapsed;
          const isHovered = hoverKey === app.key;
          const isDragOver = dragOverKey === app.key && dragKey && dragKey !== app.key;
          const shortcut = idx < 9 ? `⌘${idx + 1}` : undefined;
          return (
            <div
              key={app.key}
              className="relative mb-2"
              onMouseEnter={() => scheduleOpen(app.key)}
              onMouseLeave={scheduleClose}
              draggable
              onDragStart={(e) => onDragStart(e, app.key)}
              onDragOver={(e) => onDragOverItem(e, app.key)}
              onDrop={(e) => onDropItem(e, app.key)}
              onDragEnd={onDragEndItem}
            >
              {isDragOver ? (
                <div aria-hidden className="absolute -top-1 left-1 right-1 h-0.5 rounded bg-white" />
              ) : null}
              <button
                type="button"
                onClick={() => handleClick(app)}
                onContextMenu={(e) => onContextMenu(e, app.key)}
                title={`${app.label.replace(/\.\.$/, "")}${shortcut ? `  ${shortcut}` : ""}`}
                className={`group w-full flex flex-col items-center justify-center gap-0.5 px-0.5 py-1 transition-colors ${
                  active ? "text-white" : `${railTextColor} hover:text-white`
                } ${dragKey === app.key ? "opacity-40" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                <span
                  className={`flex items-center justify-center w-[26px] h-[26px] rounded-md transition-colors ${
                    active ? "" : isHovered ? railHoverBg : ""
                  }`}
                  style={active ? {
                    background: "rgba(255,255,255,0.95)",
                    color: "var(--os-brand-rail)",
                  } : undefined}
                >
                  <app.Icon className="w-[16px] h-[16px]" />
                </span>
                {iconsOnly ? null : <RailLabel>{app.label}</RailLabel>}
              </button>
              {isHovered && !dragKey && !active ? <AppRailHoverPreview app={app} /> : null}
            </div>
          );
        })}

        {ghostApp ? (
          <div
            className="relative mb-1.5 mt-2 pt-2 border-t border-dashed border-white/30"
            onMouseEnter={() => scheduleOpen(ghostApp.key)}
            onMouseLeave={scheduleClose}
          >
            <button
              type="button"
              onClick={() => {
                setActiveApp(ghostApp.key);
                pushRecentApp(ghostApp.key);
              }}
              onContextMenu={(e) => onContextMenu(e, ghostApp.key)}
              title={`${ghostApp.label.replace(/\.\.$/, "")} (not pinned — right-click to pin)`}
              className="group w-full flex flex-col items-center justify-center gap-0.5 px-0.5 py-1 text-white/70 hover:text-white"
            >
              <span className="flex items-center justify-center w-[26px] h-[26px] rounded-md border border-dashed border-white/40 group-hover:bg-white/10">
                <ghostApp.Icon className="w-[16px] h-[16px]" />
              </span>
              {iconsOnly ? null : <RailLabel italic>{ghostApp.label}</RailLabel>}
            </button>
            {hoverKey === ghostApp.key && !dragKey ? <AppRailHoverPreview app={ghostApp} /> : null}
          </div>
        ) : null}

        <div className="relative mt-1">
          <button
            type="button"
            onClick={openAppsGrid}
            title="Add apps, customize navigation"
            className={`group w-full flex flex-col items-center justify-center gap-0.5 px-0.5 py-1 transition-colors ${
              appsGridOpen ? "text-white" : `${railTextColor} hover:text-white`
            }`}
            aria-haspopup="dialog"
            aria-expanded={appsGridOpen}
          >
            <span
              className={`flex items-center justify-center w-[26px] h-[26px] rounded-md transition-colors ${
                appsGridOpen ? "" : "group-hover:bg-white/15"
              }`}
              style={appsGridOpen ? {
                background: "rgba(255,255,255,0.95)",
                color: "var(--os-brand-rail)",
              } : undefined}
            >
              <LayoutGrid className="w-[16px] h-[16px]" />
            </span>
            {iconsOnly ? null : <RailLabel>More</RailLabel>}
          </button>
        </div>
      </nav>

      <div className="pb-2 pt-1 border-t border-white/20">
        <Link
          href="/people"
          title="Invite teammates"
          className="w-full flex flex-col items-center gap-0.5 py-1.5 text-white hover:bg-white/15"
        >
          <UserPlus className="w-[16px] h-[16px]" />
          {iconsOnly ? null : <RailLabel>Invite</RailLabel>}
        </Link>
        <Link
          href="/settings"
          title="Upgrade workspace"
          className="w-full flex flex-col items-center gap-0.5 py-1.5 text-white hover:bg-white/15"
        >
          <ArrowUpCircle className="w-[16px] h-[16px]" />
          {iconsOnly ? null : <RailLabel>Upgrade</RailLabel>}
        </Link>
      </div>

      {ctxMenu ? (
        <RailContextMenu
          appKey={ctxMenu.key}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          onOpen={() => {
            const app = APPS.find((a) => a.key === ctxMenu.key);
            if (app) handleClick(app);
            setCtxMenu(null);
          }}
          onUnpin={() => {
            togglePinned(ctxMenu.key);
            setCtxMenu(null);
          }}
        />
      ) : null}
    </aside>
  );
}

function AppRailHoverPreview({ app }: { app: AppEntry }) {
  return (
    <div className="absolute left-full top-0 ml-1 z-40 pointer-events-auto">
      <div className="w-[240px] max-h-[480px] overflow-y-auto bg-white rounded-lg shadow-lg border border-zinc-200 py-1.5">
        <div className="px-3 pt-1 pb-2 flex items-center gap-2 border-b border-zinc-100 mb-1.5">
          <app.Icon className="w-3.5 h-3.5 text-zinc-500" />
          <h3 className="text-[13px] font-semibold text-zinc-900 flex-1">{app.label.replace(/\.\.$/, "")}</h3>
          <Sparkles className="w-3 h-3" style={{ color: "var(--os-brand)" }} />
        </div>
        <div className="px-1.5 pb-1">
          <app.Sidebar />
        </div>
      </div>
    </div>
  );
}

function RailContextMenu({
  appKey, x, y, onClose, onOpen, onUnpin,
}: {
  appKey: string;
  x: number;
  y: number;
  onClose: () => void;
  onOpen: () => void;
  onUnpin: () => void;
}) {
  const app = APPS.find((a) => a.key === appKey);
  if (!app) return null;
  return (
    <MenuList
      className="fixed z-50 w-[200px]"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => { e.preventDefault(); onClose(); }}
    >
      <MenuItem
        icon={ExternalLink}
        label={`Open ${app.label.replace(/\.\.$/, "")}`}
        onClick={onOpen}
      />
      {!isAlwaysPinned(app.key) ? (
        <MenuItem
          icon={PinOff}
          label="Unpin from sidebar"
          onClick={onUnpin}
        />
      ) : null}
    </MenuList>
  );
}
