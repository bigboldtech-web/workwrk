"use client";

// OsShell — ClickUp-style three-column shell rebuilt 2026-06-03.
// Layout (top to bottom, left to right):
//
//   ┌─────────────────────────── Top bar (48px) ──────────────────────────┐
//   │ [Workspace] [📅] [    Search ⌘K          ] [👥 avatars]            │
//   ├──────┬──────────────┬──────────────────────────────────────────────┤
//   │ App  │  Sidebar     │  Main content                                │
//   │ Rail │  (Home /     │  (page renders here)                         │
//   │ 88px │  Favorites / │                                              │
//   │      │  Spaces)     │                                              │
//   │      │  280px       │                                              │
//   └──────┴──────────────┴──────────────────────────────────────────────┘
//
// Old components (OsTopbar / OsSidebar in topbar.tsx / sidebar.tsx) are
// untouched in case we want to revert; this shell uses the new Click*
// variants in click-topbar.tsx / click-app-rail.tsx / click-sidebar.tsx.

import { OsShellProvider, useOsShell } from "./shell-context";
import { OsCommandPalette } from "./command-palette";
import { QuickCaptureHandler } from "./quick-capture";
import { OsItemDrawer } from "./item-drawer";
import { OsToastProvider } from "./toast";
import { CustomizePanel } from "./customize-panel";
import { ThemeApplier } from "./theme-applier";
import { ClickAppRail } from "./click-app-rail";
import { ClickSidebar } from "./click-sidebar";
import { ClickTopbar } from "./click-topbar";
import { AppsMorePopover } from "./apps-more-popover";
import { OsSidekickPanel } from "./sidekick-panel";
import { SetStatusModal } from "./set-status-modal";
import { CreateTaskModal } from "./create-task-modal";
import { CreateListModal } from "./create-list-modal";

function CustomizeMount() {
  const { customizeOpen, setCustomizeOpen } = useOsShell();
  return <CustomizePanel open={customizeOpen} onOpenChange={setCustomizeOpen} />;
}

export function OsShell({ children }: { children: React.ReactNode }) {
  // ClickUp-style shell: compact topbar over rounded rail, sidebar, and
  // content panels with small page-background gutters between them.
  return (
    <OsShellProvider>
      <OsToastProvider>
        <ThemeApplier />
        <div className="workwrk-os h-screen flex flex-col bg-zinc-100 text-zinc-900 p-1.5 gap-1.5 overflow-hidden">
          <ClickTopbar />
          <div className="flex-1 flex min-h-0 relative gap-1.5 overflow-hidden">
            <ClickAppRail />
            <ClickSidebar />
            <AppsMorePopover />
            <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden bg-white rounded-xl border border-zinc-200">
              {children}
            </main>
            <OsSidekickPanel />
          </div>
          <OsCommandPalette />
          <OsItemDrawer />
          <CustomizeMount />
          <SetStatusModal />
          <QuickCaptureHandler />
          <CreateTaskModal />
          <CreateListModal />
        </div>
      </OsToastProvider>
    </OsShellProvider>
  );
}
