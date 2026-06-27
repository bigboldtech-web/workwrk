"use client";

import { OsShell } from "@/components/layout/os/os-shell";
import { ToastProvider } from "@/components/ui/toast";
import { DialogProvider } from "@/components/ui/dialog-provider";
import { ScreenProtection } from "@/components/security/screen-protection";
import { TourProvider } from "@/components/tour-provider";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { applyDensity, getInitialDensity } from "@/lib/density";
import { DotsLoaderScreen } from "@/components/brand/dots-loader";
import "./os.css";

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
            router.push("/onboard");
          } else {
            setSetupChecked(true);
          }
        })
        .catch(() => setSetupChecked(true));
    }
  }, [status, router]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.classList.remove("dark-forced");
    }
    applyDensity(getInitialDensity());
  }, []);

  if (status === "loading" || (status === "authenticated" && !setupChecked)) {
    return <DotsLoaderScreen label="Loading workspace" background="#FBFAF7" />;
  }

  if (status === "unauthenticated") return null;

  return (
    <ToastProvider>
      <DialogProvider>
        <TourProvider>
          <OsShell>{children}</OsShell>
          <ScreenProtection />
        </TourProvider>
      </DialogProvider>
    </ToastProvider>
  );
}
