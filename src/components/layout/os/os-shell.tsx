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

import { usePathname } from "next/navigation";
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
import { MyWorkPanel } from "./my-work-panel";
import { NotepadPanel } from "./notepad-panel";
import { CreateListModal } from "./create-list-modal";
import { TemplateCenter } from "@/components/templates/template-center";

function CustomizeMount() {
  const { customizeOpen, setCustomizeOpen } = useOsShell();
  return <CustomizePanel open={customizeOpen} onOpenChange={setCustomizeOpen} />;
}

function TemplateCenterMount() {
  const { templateCenterOpen, templateCenterOpts, closeTemplateCenter, openCreateTask } = useOsShell();
  return (
    <TemplateCenter
      open={templateCenterOpen}
      onClose={closeTemplateCenter}
      kind={templateCenterOpts?.kind}
      applyContext={templateCenterOpts?.applyContext}
      onApplied={(result) => {
        // A TASK template hands off to the create-task modal, which has
        // its own template picker for filling the task config.
        if (result.kind === "TASK") openCreateTask();
      }}
    />
  );
}

export function OsShell({ children }: { children: React.ReactNode }) {
  // ClickUp-style shell: compact topbar over rounded rail, sidebar, and
  // content panels with small page-background gutters between them.
  //
  // Settings/account run in a dedicated full-screen "settings mode": the
  // rail + Home sidebar + topbar step aside and the settings/account
  // layouts supply their own SettingsShell chrome. We keep the providers
  // mounted so settings pages still get shell-context + toasts + theme.
  const pathname = usePathname() || "";
  const settingsMode = pathname.startsWith("/settings") || pathname.startsWith("/account");

  return (
    <OsShellProvider>
      <OsToastProvider>
        <ThemeApplier />
        {settingsMode ? (
          <div className="workwrk-os h-screen overflow-hidden bg-white text-zinc-900">
            {children}
          </div>
        ) : (
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
            <MyWorkPanel />
            <NotepadPanel />
            <TemplateCenterMount />
          </div>
        )}
      </OsToastProvider>
    </OsShellProvider>
  );
}
