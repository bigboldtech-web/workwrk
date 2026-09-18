"use client";

// Rail (design-system 4.1, spec-shell 2.1): the 64px navy column flush to
// the viewport edge. Top: the four-dot logo, which is also the route loader.
// Then the hubs in the org's order, each a 56px cell with a 20px icon in a
// 40px pill area and a 10px label; the active hub is the white pill on navy
// (the N200 pill in the light flip), derived from the URL and nothing else.
// Settings is pinned last at the bottom. Attention dots, never numeric
// badges. Owners and Admins also see the premium modules the org switched
// off as dim tiles that open the hub's ModuleOff page with the switch.
//
// Nothing else lives here: Invite and Upgrade moved to the workspace menu,
// the More launcher's job moved to the palette's Apps group and every folded
// app has a hub-sidebar row. The rail never scrolls.

import { useCallback, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { resolveHub, type HubKey } from "@/lib/nav/route-hub";
import { HUB_LABELS } from "@/lib/nav/labels";
import { hubShortcutHint } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { getApp, type AppEntry } from "./apps-catalog";
import { useOsShell } from "./shell-context";
import { useBoot } from "./boot-context";

function RailItem({
  app, active, dot, shortcut, off, onClick, onKeyDown, tabIndex, buttonRef,
}: {
  app: AppEntry;
  active: boolean;
  dot: boolean;
  shortcut: string;
  off?: boolean;
  onClick: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  tabIndex?: number;
  buttonRef?: (el: HTMLButtonElement | null) => void;
}) {
  const Icon = app.Icon as LucideIcon;
  const label = HUB_LABELS[app.key as HubKey] ?? app.label;
  const title = off ? `${label} is off · Turn it on in Settings` : shortcut ? `${label} · ${shortcut}` : label;
  return (
    <li className="w-full">
      <button
        ref={buttonRef}
        type="button"
        onClick={onClick}
        onKeyDown={onKeyDown}
        tabIndex={tabIndex}
        title={title}
        aria-label={title}
        aria-current={active ? "page" : undefined}
        aria-disabled={off ? "true" : undefined}
        className={cn(
          "group/hub flex h-14 w-full flex-col items-center justify-center gap-0.5",
          active ? "text-chrome-fg" : "text-chrome-fg-2 hover:text-chrome-fg",
          off && "opacity-40",
        )}
      >
        <span
          className={cn(
            "relative flex h-10 w-10 items-center justify-center rounded-lg",
            active ? "bg-chrome-pill text-chrome-pill-fg" : "group-hover/hub:bg-chrome-hov",
          )}
        >
          <Icon className="h-5 w-5" strokeWidth={1.5} aria-hidden />
          {dot ? (
            <span
              className="absolute end-2 top-2 h-1.5 w-1.5 rounded-full bg-chrome-attention ring-2 ring-chrome"
              aria-hidden
            />
          ) : null}
          {off ? (
            <span className="absolute end-2 top-2 h-1.5 w-1.5 rounded-full bg-line-strong ring-2 ring-chrome" aria-hidden />
          ) : null}
        </span>
        <span className={cn("line-clamp-2 max-w-full px-0.5 text-center text-rail", active && "font-medium")}>
          {label}
        </span>
      </button>
    </li>
  );
}

export function Rail() {
  const router = useRouter();
  const pathname = usePathname() || "";
  const { railApps, hubHref, pushRecentApp, sidebarCollapsed, setSidebarCollapsed, routePending, manageableOffModules } = useOsShell();
  const { counts } = useBoot();
  const activeHub = resolveHub(pathname);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const hubs = railApps.filter((a) => a.key !== "settings");
  const settings = railApps.find((a) => a.key === "settings") ?? getApp("settings");
  // Talk survives on the rail via Announcements with its module off, so an
  // off-module tile never duplicates a hub that is already a nav item.
  const railKeys = new Set(railApps.map((a) => a.key));
  const offModules = manageableOffModules
    .filter((k) => !railKeys.has(k))
    .map((k) => getApp(k))
    .filter((a): a is AppEntry => Boolean(a));

  const dotFor = (key: string): boolean => {
    if (key === "home") return counts.inboxUnread > 0;
    if (key === "chat") return counts.talkUnread > 0;
    return false;
  };

  const go = useCallback((app: AppEntry) => {
    // Clicking the already-active hub reopens a collapsed sidebar and
    // otherwise does nothing (spec-shell 1.1).
    setSidebarCollapsed(false);
    if (activeHub === app.key) return;
    pushRecentApp(app.key);
    router.push(hubHref(app.key));
  }, [activeHub, hubHref, pushRecentApp, router, setSidebarCollapsed]);

  // Arrow keys move focus between hubs (Settings included), Enter opens. The
  // rail is ONE tab stop (roving tabindex): Tab lands on the active hub, or
  // the first when none is active, and the arrows do the rest; the off-module
  // tiles come after the hubs in the tab order (spec-shell 1.4).
  const onKeyDown = (index: number) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const list = itemRefs.current.filter((el): el is HTMLButtonElement => Boolean(el));
    if (list.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = e.key === "ArrowDown" ? (index + 1) % list.length : (index - 1 + list.length) % list.length;
      list[next]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      list[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      list[list.length - 1]?.focus();
    }
  };

  const hubKeys = [...hubs.map((a) => a.key), ...(settings ? [settings.key] : [])];
  const tabStopKey = hubKeys.includes(activeHub) ? activeHub : hubKeys[0];

  let index = 0;
  const bind = (key: string) => {
    const i = index++;
    return {
      buttonRef: (el: HTMLButtonElement | null) => { itemRefs.current[i] = el; },
      onKeyDown: onKeyDown(i),
      tabIndex: key === tabStopKey ? 0 : -1,
    };
  };

  return (
    <nav
      aria-label="Hubs"
      className="os-chrome relative flex h-full w-[var(--os-rail-w)] shrink-0 flex-col items-center bg-chrome text-chrome-fg-2"
    >
      <button
        type="button"
        onClick={() => { const work = getApp("home"); if (work) go(work); }}
        aria-label="WorkwrK, go to Work"
        title="WorkwrK"
        className="mt-4 flex h-7 w-10 items-center justify-center rounded-md hover:bg-chrome-hov"
      >
        <Logo width={28} pulsing={routePending} />
      </button>

      <ul role="list" className="mt-3 flex w-full flex-col items-center gap-2">
        {hubs.map((app, i) => (
          <RailItem
            key={app.key}
            app={app}
            active={activeHub === app.key}
            dot={dotFor(app.key)}
            shortcut={hubShortcutHint(i) ?? ""}
            onClick={() => go(app)}
            {...bind(app.key)}
          />
        ))}
        {offModules.map((app) => (
          <RailItem
            key={`off-${app.key}`}
            app={app}
            active={false}
            dot={false}
            shortcut=""
            off
            onClick={() => router.push(hubHref(app.key))}
            tabIndex={0}
          />
        ))}
      </ul>

      <div className="mt-auto flex w-full flex-col items-center pb-3">
        {settings ? (
          <ul role="list" className="w-full">
            <RailItem
              app={settings}
              active={activeHub === "settings"}
              dot={false}
              shortcut={hubShortcutHint(railApps.findIndex((a) => a.key === "settings")) ?? ""}
              onClick={() => go(settings)}
              {...bind(settings.key)}
            />
          </ul>
        ) : null}
      </div>

      {sidebarCollapsed ? (
        <button
          type="button"
          onClick={() => setSidebarCollapsed(false)}
          aria-label="Show sidebar"
          title="Show sidebar (⌘\\)"
          className="absolute -end-3 bottom-4 z-20 flex h-6 w-6 items-center justify-center rounded-full border border-line bg-raised text-ink-2 shadow-[var(--os-shadow-pop)] opacity-40 hover:opacity-100 focus-visible:opacity-100 max-lg:hidden"
        >
          <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={1.5} />
        </button>
      ) : null}
    </nav>
  );
}
