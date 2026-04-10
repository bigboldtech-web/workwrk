"use client";

import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { ToastProvider } from "@/components/ui/toast";
import { KudosFab } from "@/components/kudos/kudos-fab";
import { ScreenProtection } from "@/components/security/screen-protection";
import { TourProvider } from "@/components/tour-provider";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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

  // Check if setup is completed
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

  if (status === "loading" || (status === "authenticated" && !setupChecked)) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
          <span className="text-sm text-muted">Loading...</span>
        </div>
      </div>
    );
  }

  if (status === "unauthenticated") return null;

  return (
    <ToastProvider>
      <TourProvider>
        <div className="flex h-screen">
          <Sidebar />
          <div className="flex flex-1 flex-col transition-all duration-300" style={{ paddingLeft: "var(--sidebar-width, 220px)" }}>
            <Topbar />
            <main className="flex-1 overflow-y-auto p-4">{children}</main>
          </div>
          <KudosFab />
          <ScreenProtection />
        </div>
      </TourProvider>
    </ToastProvider>
  );
}
