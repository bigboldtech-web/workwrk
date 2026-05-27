"use client";

import { OsShellProvider } from "./shell-context";
import { OsSidebar } from "./sidebar";
import { OsTopbar } from "./topbar";
import { OsSidekickPanel } from "./sidekick-panel";
import { OsCommandPalette } from "./command-palette";
import { OsItemDrawer } from "./item-drawer";
import { OsToastProvider } from "./toast";

export function OsShell({ children }: { children: React.ReactNode }) {
  return (
    <OsShellProvider>
      <OsToastProvider>
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
        </div>
      </OsToastProvider>
    </OsShellProvider>
  );
}
