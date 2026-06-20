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
import { Search, Settings, Pin, Clock as ClockIcon } from "lucide-react";
import { useOsShell } from "./shell-context";
import { APPS, CATALOG_APPS, CATEGORY_ORDER, canAccessApp, isAlwaysPinned, type AppEntry } from "./apps-catalog";
import { useSession } from "next-auth/react";

export function AppsMorePopover() {
  const router = useRouter();
  const {
    appsGridOpen, closeAppsGrid,
    pinnedAppKeys, togglePinned,
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

  const { data: session } = useSession();
  const accessLevel = (session?.user as { accessLevel?: string } | undefined)?.accessLevel;

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const accessible = CATALOG_APPS.filter((a) => canAccessApp(a, accessLevel));
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
  }, [query, accessLevel]);

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
    const pinned = pinnedAppKeys.includes(app.key);
    const always = isAlwaysPinned(app.key);
    return (
      <div className="relative group">
        <button
          type="button"
          onClick={() => launch(app)}
          className={`w-full h-[72px] flex flex-col items-center justify-center gap-1 px-1.5 rounded-lg border transition-colors ${
            pinned
              ? "border-[var(--os-brand)] bg-[color-mix(in_srgb,var(--os-brand)_6%,transparent)]"
              : "border-zinc-200 hover:bg-zinc-50 hover:border-zinc-300"
          }`}
          title={app.label.replace(/\.\.$/, "")}
        >
          <app.Icon className="w-[18px] h-[18px] text-zinc-700" />
          <span className="text-[11px] text-zinc-700 truncate max-w-full leading-tight">
            {app.label.replace(/\.\.$/, "")}
          </span>
        </button>
        {/* Pin chip at top-right. Click to toggle (always-pinned apps
            show a static filled pin in the brand color). */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (!always) togglePinned(app.key);
          }}
          disabled={always}
          aria-pressed={pinned}
          aria-label={pinned ? `Unpin ${app.label}` : `Pin ${app.label}`}
          title={always ? "Always pinned" : pinned ? "Unpin" : "Pin"}
          className={`absolute top-1 right-1 w-[18px] h-[18px] rounded flex items-center justify-center transition-opacity ${
            pinned || always
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 focus:opacity-100"
          }`}
          style={pinned || always ? {
            background: "color-mix(in srgb, var(--os-brand) 16%, transparent)",
            color: "var(--os-brand-deep)",
          } : {
            background: "rgba(244,244,245,1)",
            color: "rgb(82, 82, 91)",
          }}
        >
          <Pin
            className="w-3 h-3"
            fill={pinned || always ? "currentColor" : "none"}
            strokeWidth={2}
          />
        </button>
      </div>
    );
  }

  return (
    // Anchored beside the rail (rail is 52px + 6px shell gap), aligned
    // vertically with the More button which sits near the bottom of
    // the rail nav. Sliding out to the right keeps the rail's icons in
    // view while the user picks what to pin.
    <div
      ref={panelRef}
      className="absolute right-[66px] top-2 z-50 w-[380px] max-h-[560px] bg-white rounded-xl shadow-xl border border-zinc-200 flex flex-col"
      role="dialog"
      aria-label="Add apps to sidebar"
    >
      <div className="px-4 pt-3 pb-2">
        <h2 className="text-[13px] font-semibold text-zinc-900">Pin apps to sidebar</h2>
        <p className="text-[11px] text-zinc-500 mt-0.5">
          Tap the pin on any card to add it to your left rail.
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
            className="w-full h-8 pl-7 pr-2 rounded-md bg-zinc-50 border border-zinc-200 text-[12px] focus:outline-none focus:border-[var(--os-brand)]"
            autoFocus
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {showRecents ? (
          <section className="mb-3">
            <div className="px-0.5 pt-1 pb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
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
          <div className="text-center text-[12px] text-zinc-500 py-6">No matches.</div>
        ) : (
          grouped.map((group) => (
            <section key={group.category} className="mb-3 last:mb-0">
              <div className="px-0.5 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
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
          className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-[12px] text-zinc-700 hover:bg-zinc-50"
        >
          <Settings className="w-3.5 h-3.5 text-zinc-500" />
          <span>Customize navigation</span>
        </button>
      </div>
    </div>
  );
}
