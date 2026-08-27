"use client";

// AppsMorePopover — floating grid panel anchored beside the "More"
// rail button. Each catalog app renders as a small card with the icon
// centered + label below; a pin-toggle chip sits at the top-right of
// each card so users can pin/unpin without ever leaving the grid.
//
// Layout (popout to the right of the rail):
//
//   ┌─────────────────────────────────────┐
//   │ Pin apps to sidebar                 │
//   │ [Search apps…                     ] │
//   │ RECENT                              │
//   │ ┌──────┐ ┌──────┐ ┌──────┐          │
//   │ │ 📌   │ │ 📌 ✓ │ │ 📌   │          │
//   │ │ 🏠   │ │ ✨   │ │ 👥   │          │
//   │ │ Home │ │ AI   │ │Teams │          │
//   │ └──────┘ └──────┘ └──────┘          │
//   │ CORE                                │
//   │ ┌──────┐ ┌──────┐ ┌──────┐          │
//   │ │ ...  │ │ ...  │ │ ...  │          │
//   │ └──────┘ └──────┘ └──────┘          │
//   │ [⚙ Customize navigation]           │
//   └─────────────────────────────────────┘

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Settings, Clock as ClockIcon } from "lucide-react";
import { useOsShell } from "./shell-context";
import { APPS, CATEGORY_ORDER, type AppEntry } from "./apps-catalog";

export function AppsMorePopover() {
  const router = useRouter();
  const {
    appsGridOpen, closeAppsGrid,
    railApps,
    setActiveApp, openCustomize, pushRecentApp,
    recentAppKeys,
  } = useOsShell();
  const [query, setQuery] = useState("");
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!appsGridOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current && !panelRef.current.contains(t)) closeAppsGrid();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeAppsGrid(); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [appsGridOpen, closeAppsGrid]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    // railApps is the org-governed set: access-filtered, org-hidden removed,
    // admin-ordered. The launcher must agree with the rail — an app the
    // admin switched off should not resurface here.
    const accessible = railApps;
    const filtered = q
      ? accessible.filter((a) => a.label.toLowerCase().includes(q) || a.key.includes(q))
      : accessible;
    const byCat = new Map<string, AppEntry[]>();
    for (const a of filtered) {
      const c = a.category ?? "Other";
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c)!.push(a);
    }
    return CATEGORY_ORDER
      .filter((c) => byCat.has(c))
      .map((c) => ({ category: c, apps: byCat.get(c)! }))
      .concat(
        Array.from(byCat.keys())
          .filter((c) => !CATEGORY_ORDER.includes(c))
          .map((c) => ({ category: c, apps: byCat.get(c)! })),
      );
  }, [query, railApps]);

  const recentApps = useMemo<AppEntry[]>(() => {
    const byKey = new Map(APPS.map((a) => [a.key, a] as const));
    return recentAppKeys
      .map((k) => byKey.get(k))
      .filter((a): a is AppEntry => Boolean(a))
      .slice(0, 5);
  }, [recentAppKeys]);

  if (!appsGridOpen) return null;

  const launch = (app: AppEntry) => {
    setActiveApp(app.key);
    pushRecentApp(app.key);
    closeAppsGrid();
    if (app.defaultHref) router.push(app.defaultHref);
  };

  // Hide Recents when the user is searching — the filter is what matters then.
  const showRecents = !query.trim() && recentApps.length > 0;

  const onCustomize = () => {
    closeAppsGrid();
    openCustomize();
  };

  function AppCard({ app }: { app: AppEntry }) {
    return (
      <button
        type="button"
        onClick={() => launch(app)}
        className="w-full h-[72px] flex flex-col items-center justify-center gap-1 px-1.5 rounded-lg border border-zinc-200 hover:bg-zinc-50 hover:border-zinc-300 transition-colors"
        title={app.label.replace(/\.\.$/, "")}
      >
        <app.Icon className="w-[18px] h-[18px] text-zinc-700" />
        <span className="text-[12px] text-zinc-700 truncate max-w-full leading-tight">
          {app.label.replace(/\.\.$/, "")}
        </span>
      </button>
    );
  }

  return (
    // Anchored beside the rail (rail is 52px + 6px shell gap), aligned
    // vertically with the More button which sits near the bottom of the
    // rail nav. Sliding out to the right keeps the rail's icons in view.
    <div
      ref={panelRef}
      className="absolute left-[60px] bottom-2 z-50 w-[380px] max-h-[560px] bg-white rounded-xl shadow-2xl border border-zinc-200 flex flex-col"
      role="dialog"
      aria-label="All apps"
    >
      <div className="px-4 pt-3 pb-2">
        <h2 className="text-[14px] font-semibold text-zinc-900">Apps</h2>
        <p className="text-[12px] text-zinc-500 mt-0.5">
          Everything you have access to. Admins manage visibility and order in
          Settings &rsaquo; Apps.
        </p>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search apps…"
            className="w-full h-8 pl-7 pr-2 rounded-md bg-zinc-50 border border-zinc-200 text-[13px] focus:outline-none focus:border-[var(--os-brand)]"
            autoFocus
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {showRecents ? (
          <section className="mb-3">
            <div className="px-0.5 pt-1 pb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              <ClockIcon className="w-3 h-3" />
              <span>Recent</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {recentApps.map((app) => (
                <AppCard key={`recent-${app.key}`} app={app} />
              ))}
            </div>
          </section>
        ) : null}

        {grouped.length === 0 ? (
          <div className="text-center text-[13px] text-zinc-500 py-6">No matches.</div>
        ) : (
          grouped.map((group) => (
            <section key={group.category} className="mb-3 last:mb-0">
              <div className="px-0.5 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                {group.category}
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {group.apps.map((app) => (
                  <AppCard key={app.key} app={app} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      <div className="border-t border-zinc-100 px-2 py-2">
        <button
          type="button"
          onClick={onCustomize}
          className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-[13px] text-zinc-700 hover:bg-zinc-50"
        >
          <Settings className="w-3.5 h-3.5 text-zinc-500" />
          <span>Customize navigation</span>
        </button>
      </div>
    </div>
  );
}
