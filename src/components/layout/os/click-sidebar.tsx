"use client";

// ClickSidebar — the second column. Renders whichever app is active
// from apps-catalog.tsx. Header has the app's name + an action button
// row + a [«] close button that collapses the entire column.
//
// When collapsed, returns null. To reopen, the user clicks any rail
// icon — `setActiveApp` flips `sidebarCollapsed` back to false.

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Plus, ChevronsLeft, ChevronDown, SlidersHorizontal } from "lucide-react";
import { useOsShell } from "./shell-context";
import { APPS, findAppForPath, getApp, NEW_EVENT_PREFIX } from "./apps-catalog";
import { usePathname } from "next/navigation";

export function ClickSidebar() {
  const { activeAppKey, sidebarCollapsed, toggleSidebar, openCustomize } = useOsShell();
  const pathname = usePathname() || "";
  const router = useRouter();

  const app = useMemo(() => {
    return getApp(activeAppKey) ?? findAppForPath(pathname) ?? APPS[0];
  }, [activeAppKey, pathname]);

  if (sidebarCollapsed) return null;

  const title = app.label.replace(/\.\.$/, "");
  const newAction = app.newAction;

  const onNew = () => {
    if (!newAction) return;
    if (newAction.href) {
      router.push(newAction.href);
    } else if (newAction.event && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(`${NEW_EVENT_PREFIX}${newAction.event}`));
    }
  };

  // Secondary sidebar is a rounded card — the OsShell parent provides
  // the gap to its rail sibling via `gap-1.5`, so no margin needed here.
  return (
    <aside
      data-branded="0"
      className="w-[220px] flex-shrink-0 h-full flex flex-col bg-white border border-zinc-200 rounded-xl overflow-hidden transition-colors"
    >
      <div className="px-3 pt-4 pb-2 flex items-center gap-1">
        <h2 className="text-[14px] font-semibold flex-1 truncate text-zinc-900">{title}</h2>
        {newAction ? (
          <button
            type="button"
            onClick={onNew}
            className="p-1 rounded text-zinc-500 hover:bg-zinc-100"
            aria-label={newAction.label}
            title={newAction.label}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          className="p-1 rounded text-zinc-500 hover:bg-zinc-100"
          aria-label="Section menu"
        >
          <ChevronDown className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={toggleSidebar}
          className="p-1 rounded text-zinc-500 hover:bg-zinc-100"
          aria-label="Close sidebar"
          title="Close sidebar"
        >
          <ChevronsLeft className="w-3.5 h-3.5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-1.5 pb-2">
        <app.Sidebar />
      </nav>

      <div className="px-2 pb-2 pt-1 flex justify-center">
        <button
          type="button"
          onClick={openCustomize}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] text-zinc-500 bg-zinc-50 border border-zinc-200 hover:bg-zinc-100 hover:text-zinc-700 hover:border-zinc-300 transition-colors"
        >
          <SlidersHorizontal className="w-3 h-3 text-zinc-400" />
          <span>Customize Sidebar</span>
        </button>
      </div>
    </aside>
  );
}

