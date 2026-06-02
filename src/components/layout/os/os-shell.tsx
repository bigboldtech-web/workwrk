"use client";

import { OsShellProvider, useOsShell } from "./shell-context";
import { OsSidebar } from "./sidebar";
import { OsTopbar } from "./topbar";
import { OsSidekickPanel } from "./sidekick-panel";
import { OsCommandPalette } from "./command-palette";
import { OsItemDrawer } from "./item-drawer";
import { OsToastProvider } from "./toast";
import { CustomizePanel } from "./customize-panel";
import { ThemeApplier } from "./theme-applier";

function CustomizeMount() {
  const { customizeOpen, setCustomizeOpen } = useOsShell();
  return <CustomizePanel open={customizeOpen} onOpenChange={setCustomizeOpen} />;
}

export function OsShell({ children }: { children: React.ReactNode }) {
  return (
    <OsShellProvider>
      <OsToastProvider>
        <ThemeApplier />
        <div className="workwrk-os">
          <div className="os-shell">
            <OsSidebar />
            <main className="os-main">
              <OsTopbar />
              <div className="os-canvas">{children}</div>
            </main>
            <OsSidekickPanel />
          </div>
          <OsCommandPalette />
          <OsItemDrawer />
          <CustomizeMount />
        </div>
      </OsToastProvider>
    </OsShellProvider>
  );
}
