"use client";

import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { CommandPalette } from "@/components/layout/command-palette";
import { ToastProvider } from "@/components/ui/toast";
import { DialogProvider } from "@/components/ui/dialog-provider";
import { KudosFab } from "@/components/kudos/kudos-fab";
import { ScreenProtection } from "@/components/security/screen-protection";
import { TourProvider } from "@/components/tour-provider";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import "./app-shell.css";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { status } = useSession();
  const router = useRouter();
  const [setupChecked, setSetupChecked] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  useEffect(() => {
    if (status === "authenticated") {
      fetch("/api/setup")
        .then((res) => res.json())
        .then((data) => {
          if (!data.setupCompleted) {
            router.push("/setup");
          } else {
            setSetupChecked(true);
          }
        })
        .catch(() => setSetupChecked(true));
    }
  }, [status, router]);

  useEffect(() => {
    // Light is the new default — matches the ClickUp-clean direction.
    // The Sidebar still has a Light/Dark toggle, and the user's choice
    // is persisted by `next-themes` (handled at the root layout). On
    // first mount we ensure neither class is forced; next-themes
    // resolves to the user's preference (or light by default).
    if (typeof document !== "undefined") {
      // Don't force `dark` anymore. If a user previously had it set,
      // next-themes picks it up from localStorage and re-applies.
      // Brand-new visitors land in light mode.
      document.documentElement.classList.remove("dark-forced");
    }
  }, []);

  if (status === "loading" || (status === "authenticated" && !setupChecked)) {
    return (
      <div className="app-loader">
        <span className="app-loader-dot" aria-hidden />
        <span className="app-loader-text">Loading workspace</span>
      </div>
    );
  }

  if (status === "unauthenticated") return null;

  return (
    <ToastProvider>
      <DialogProvider>
        <TourProvider>
          <div className="app-shell" style={{ display: "flex", minHeight: "100vh" }}>
            <Sidebar />
            <div
              className="app-shell-main"
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                paddingLeft: "var(--sidebar-width, 232px)",
                transition: "padding-left 0.3s cubic-bezier(0.2, 0.9, 0.3, 1)",
                minWidth: 0,
              }}
            >
              <Topbar />
              <main className="app-content">{children}</main>
            </div>
            <KudosFab />
            <CommandPalette />
            <ScreenProtection />
          </div>
        </TourProvider>
      </DialogProvider>
    </ToastProvider>
  );
}
